"""FastAPI application: HTTP surface for the Electron main process.

Endpoints:
    GET  /health                — liveness probe
    POST /process               — enqueue a process job, returns job_id
    GET  /jobs                  — list active jobs
    GET  /jobs/{id}             — single job snapshot
    POST /jobs/{id}/cancel      — cooperative cancel
    GET  /documents             — paginated list
    POST /documents/{id}/retry  — requeue a failed document
    DELETE /documents/{id}      — remove from index (does not touch the PDF)
    GET  /search?q=...          — FTS5 search
    GET  /settings              — read settings
    PUT  /settings              — write settings (partial OK)
    GET  /ollama/status         — is Ollama reachable?
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse

from . import __version__
from .config import Config
from .db import Database
from .llm import OllamaClient
from .logging_setup import configure_logging
from .models import (
    DocumentList,
    DocumentSort,
    DocumentStatus,
    HealthResponse,
    IndexHealthResponse,
    IndexRebuildResponse,
    JobList,
    JobProgress,
    MaintenanceResponse,
    ProcessAccepted,
    ProcessRequest,
    RetryAccepted,
    SearchRank,
    SearchResponse,
    SettingsModel,
)
from .queue import JobManager, reconcile_on_startup


def create_app(config: Config) -> FastAPI:
    configure_logging(config.logs_dir)
    db = Database(config.db_path)
    reconcile_on_startup(db)
    ollama = OllamaClient(base_url=config.ollama_url)
    jobs = JobManager(config, db, ollama)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await jobs.shutdown()
            db.close()

    app = FastAPI(title="PDF-Parser sidecar", version=__version__, lifespan=lifespan)
    app.state.config = config
    app.state.db = db
    app.state.jobs = jobs

    # ---- health -----------------------------------------------------------

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(status="ok", version=__version__)

    # ---- processing -------------------------------------------------------

    @app.post("/process", response_model=ProcessAccepted)
    async def process(req: ProcessRequest) -> ProcessAccepted:
        # Read the current model from settings; fall back to the configured default.
        model = db.get_setting("model") or config.default_model
        settings = await get_settings()
        try:
            job_id, count = await jobs.submit(
                input_folder=Path(req.input_folder),
                output_folder=Path(req.output_folder),
                force=req.force,
                rename_with_llm=req.rename_with_llm,
                ocr_language=settings.ocr_language,
                max_concurrent_jobs=settings.max_concurrent_jobs,
                model=model,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        db.set_settings([("output_folder", req.output_folder), ("input_folder", req.input_folder)])
        return ProcessAccepted(job_id=job_id, file_count=count)

    @app.get("/jobs", response_model=JobList)
    async def list_jobs() -> JobList:
        return JobList(items=jobs.list_active())

    @app.get("/jobs/{job_id}", response_model=JobProgress)
    async def get_job(job_id: str) -> JobProgress:
        snap = jobs.snapshot(job_id)
        if snap is None:
            raise HTTPException(status_code=404, detail="job not found")
        return snap

    @app.post("/jobs/{job_id}/cancel")
    async def cancel_job(job_id: str) -> dict[str, bool]:
        return {"cancelled": await jobs.cancel(job_id)}

    # ---- documents --------------------------------------------------------

    @app.get("/documents", response_model=DocumentList)
    async def list_documents(
        limit: int = Query(200, ge=1, le=1000),
        offset: int = Query(0, ge=0),
        status: DocumentStatus | None = None,
        sort: DocumentSort = "processed_desc",
    ) -> DocumentList:
        items, total = db.list_documents(limit=limit, offset=offset, status=status, sort=sort)
        return DocumentList(items=items, total=total)

    @app.post("/documents/{document_id}/retry", response_model=RetryAccepted)
    async def retry_document(document_id: int) -> RetryAccepted:
        document = db.get_document(document_id)
        if document is None:
            raise HTTPException(status_code=404, detail="document not found")
        if document.status != "failed":
            raise HTTPException(status_code=409, detail="only failed documents can be retried")
        settings = await get_settings()
        try:
            job_id = await jobs.submit_single(
                document_id=document_id,
                rename_with_llm=settings.rename_with_llm,
                ocr_language=settings.ocr_language,
                max_concurrent_jobs=settings.max_concurrent_jobs,
                model=db.get_setting("model") or config.default_model,
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="document not found") from exc
        except ValueError as exc:
            detail = str(exc)
            if detail not in {
                "no output folder configured, run a batch first",
                "document is marked as non-retryable",
                "retry limit reached for this document",
            }:
                detail = "configured output folder is invalid"
            raise HTTPException(status_code=409, detail=detail) from exc
        return RetryAccepted(job_id=job_id)

    @app.delete("/documents/{document_id}")
    async def delete_document(document_id: int) -> dict[str, bool]:
        db.delete_document(document_id)
        return {"deleted": True}

    # ---- search -----------------------------------------------------------

    @app.get("/search", response_model=SearchResponse)
    async def search(
        q: str = Query(..., min_length=1),
        limit: int = Query(50, ge=1, le=200),
        offset: int = Query(0, ge=0),
        status: DocumentStatus | None = None,
        name: str | None = Query(None, min_length=1),
        processed_after: str | None = None,
        processed_before: str | None = None,
        rank: SearchRank = "relevance",
    ) -> SearchResponse:
        try:
            hits, total = db.search(
                q,
                limit=limit,
                offset=offset,
                status=status,
                name=name,
                processed_after=processed_after,
                processed_before=processed_before,
                rank=rank,
            )
        except Exception as exc:  # noqa: BLE001
            # Bad FTS5 syntax shouldn't 500 the UI.
            raise HTTPException(status_code=400, detail=f"bad query: {exc}") from exc
        return SearchResponse(
            query=q, total=total, limit=limit, offset=offset, hits=hits, rank=rank
        )

    # ---- settings ---------------------------------------------------------

    @app.get("/settings", response_model=SettingsModel)
    async def get_settings() -> SettingsModel:
        raw = db.get_setting("__all__")
        if raw:
            try:
                return SettingsModel(**json.loads(raw))
            except (ValueError, TypeError):
                pass
        return SettingsModel(
            ollama_url=config.ollama_url,
            model=config.default_model,
            max_concurrent_jobs=config.max_concurrent_jobs,
        )

    @app.put("/settings", response_model=SettingsModel)
    async def put_settings(s: SettingsModel) -> SettingsModel:
        items = [("__all__", s.model_dump_json()), ("model", s.model)]
        if s.input_folder:
            items.append(("input_folder", s.input_folder))
        if s.output_folder:
            items.append(("output_folder", s.output_folder))
        db.set_settings(items)
        return s

    # ---- ollama -----------------------------------------------------------

    @app.get("/ollama/status")
    async def ollama_status() -> dict[str, object]:
        return {"available": ollama.is_available(), "url": config.ollama_url}

    # ---- index / maintenance -----------------------------------------------

    @app.get("/index/health", response_model=IndexHealthResponse)
    async def index_health() -> IndexHealthResponse:
        return IndexHealthResponse(**db.index_health())

    @app.post("/index/rebuild", response_model=IndexRebuildResponse)
    async def index_rebuild() -> IndexRebuildResponse:
        rebuilt_rows = db.rebuild_index()
        return IndexRebuildResponse(rebuilt_rows=rebuilt_rows)

    @app.post("/maintenance/optimize", response_model=MaintenanceResponse)
    async def maintenance_optimize() -> MaintenanceResponse:
        db.optimize()
        return MaintenanceResponse(optimized=True)

    # ---- fallback error handler -------------------------------------------

    @app.exception_handler(Exception)
    async def _unhandled(
        _: object, exc: Exception
    ) -> JSONResponse:  # pragma: no cover - safety net
        return JSONResponse(status_code=500, content={"error": "internal", "detail": str(exc)})

    return app
