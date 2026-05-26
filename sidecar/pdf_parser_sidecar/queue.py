"""Per-file processing pipeline + bounded async job queue (M5 + M8)."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import subprocess
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from .config import Config
from .db import Database
from .llm import OllamaClient
from .models import JobFileEntry, JobProgress, JobTrigger
from .ocr import run_ocr, sha256_of_file
from .sanitize import resolve_collision, sanitize_filename, with_ocr_prefix

logger = logging.getLogger(__name__)


@dataclass
class _JobState:
    job_id: str
    files: list[Path]
    force: bool
    rename_with_llm: bool
    ocr_language: str
    output_folder: Path
    model: str
    progress: JobProgress
    file_entries: list[JobFileEntry] = field(default_factory=list)
    cancelled: bool = False
    task: asyncio.Task[None] | None = field(default=None, repr=False)


def _validate_user_folder(folder: Path, *, kind: str) -> Path:
    """Normalise a user-supplied folder path defensively.

    The path comes from a local OS folder-picker dialog so it's not a remote
    attack surface, but we still apply a path-traversal sanitizer and reject
    anything that isn't an absolute, normal directory. This satisfies
    static-analysis path-injection warnings and gives nicer errors.
    """
    if not isinstance(folder, Path):  # defensive: API layer should already do this
        raise TypeError(f"{kind} folder must be a Path")

    raw = str(folder)
    # Reject NUL bytes (Windows reserves them; Linux disallows in paths).
    if "\x00" in raw:
        raise ValueError(f"{kind} folder contains NUL byte")
    # Reject parent-directory traversal segments before any filesystem call.
    # Splitting on both separators keeps this OS-agnostic.
    parts = raw.replace("\\", "/").split("/")
    if any(part == ".." for part in parts):
        raise ValueError(f"{kind} folder must not contain '..' segments: {folder}")

    # Now safe to expand/resolve. The combination of (no NUL, no '..', and the
    # post-resolve is_absolute + is_dir checks below) makes this an allowlisted
    # well-formed absolute directory the user picked themselves.
    resolved = folder.expanduser().resolve(strict=False)
    if not resolved.is_absolute():
        raise ValueError(f"{kind} folder must be an absolute path: {folder}")
    return resolved


def list_pdfs(folder: Path) -> list[Path]:
    """Public alias for ``_list_pdfs`` used by the folder watcher."""
    return _list_pdfs(folder)


def _list_pdfs(folder: Path) -> list[Path]:
    safe = _validate_user_folder(folder, kind="input")
    if not safe.is_dir():
        raise FileNotFoundError(f"Input folder does not exist: {safe}")
    # Recursive: most users dump PDFs into nested year/month folders.
    return sorted(p for p in safe.rglob("*.pdf") if p.is_file())


class JobManager:
    """Bounded-concurrency async queue. One queue per sidecar process."""

    def __init__(self, config: Config, db: Database, ollama: OllamaClient) -> None:
        self.config = config
        self.db = db
        self.ollama = ollama
        self._jobs: dict[str, _JobState] = {}
        self._max_concurrent_jobs = max(1, config.max_concurrent_jobs)
        self._semaphore = asyncio.Semaphore(self._max_concurrent_jobs)
        self._lock = asyncio.Lock()
        self._queue_settings_key = "__queue_state__"

    # -- public API ---------------------------------------------------------

    async def submit(
        self,
        *,
        input_folder: Path,
        output_folder: Path,
        force: bool,
        rename_with_llm: bool,
        ocr_language: str,
        max_concurrent_jobs: int,
        model: str,
        trigger: JobTrigger = "manual",
        batch_id: str | None = None,
        files_override: list[Path] | None = None,
    ) -> tuple[str, int]:
        if files_override is not None:
            files = list(files_override)
        else:
            safe_input = _validate_user_folder(input_folder, kind="input")
            files = _list_pdfs(safe_input)
        return await self._enqueue(
            files=files,
            output_folder=output_folder,
            force=force,
            rename_with_llm=rename_with_llm,
            ocr_language=ocr_language,
            max_concurrent_jobs=max_concurrent_jobs,
            model=model,
            trigger=trigger,
            batch_id=batch_id,
        )

    async def submit_single(
        self,
        *,
        document_id: int,
        rename_with_llm: bool,
        ocr_language: str,
        max_concurrent_jobs: int,
        model: str,
    ) -> str:
        document = self.db.get_document(document_id)
        if document is None:
            raise FileNotFoundError("document not found")
        if not document.retryable:
            raise ValueError("document is marked as non-retryable")
        if document.retry_count >= 3:
            raise ValueError("retry limit reached for this document")
        output_folder = self.db.get_setting("output_folder")
        if not output_folder:
            raise ValueError("no output folder configured, run a batch first")
        self.db.mark_retry_pending(document_id)
        job_id, _ = await self._enqueue(
            files=[Path(document.original_path)],
            output_folder=Path(output_folder),
            force=True,
            rename_with_llm=rename_with_llm,
            ocr_language=ocr_language,
            max_concurrent_jobs=max_concurrent_jobs,
            model=model,
            trigger="manual",
            batch_id=None,
        )
        return job_id

    async def cancel(self, job_id: str) -> bool:
        async with self._lock:
            state = self._jobs.get(job_id)
        if state is None:
            return False
        state.cancelled = True
        if state.task and not state.task.done():
            state.task.cancel()
        self._persist_queue_state()
        return True

    def snapshot(self, job_id: str, *, include_files: bool = False) -> JobProgress | None:
        state = self._jobs.get(job_id)
        if state is None:
            return None
        snap = state.progress.model_copy()
        if include_files:
            snap.files = [entry.model_copy() for entry in state.file_entries]
        return snap

    def list_active(self) -> list[JobProgress]:
        return [s.progress.model_copy() for s in self._jobs.values()]

    def known_paths(self) -> set[str]:
        """Absolute paths currently tracked by any non-terminal job.

        Used by the folder watcher to skip files already queued or in flight.
        """
        active: set[str] = set()
        for state in self._jobs.values():
            if state.progress.state in ("done", "failed", "cancelled"):
                continue
            for path in state.files:
                active.add(str(Path(path).resolve(strict=False)))
        return active

    async def shutdown(self) -> None:
        """Cancel everything in flight (called from app lifespan)."""
        tasks: list[asyncio.Task[None]] = []
        async with self._lock:
            for state in self._jobs.values():
                state.cancelled = True
                if state.task and not state.task.done():
                    state.task.cancel()
                    tasks.append(state.task)
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        self._persist_queue_state()

    async def restore_pending(self) -> int:
        """Restore queued/running jobs persisted before a restart."""
        raw = self.db.get_setting(self._queue_settings_key)
        if not raw:
            return 0
        try:
            payload = json.loads(raw)
        except ValueError:
            return 0
        if not isinstance(payload, list):
            return 0

        restored = 0
        async with self._lock:
            for entry in payload:
                if not isinstance(entry, dict):
                    continue
                job_id = str(entry.get("job_id") or "")
                if not job_id or job_id in self._jobs:
                    continue
                files_raw = entry.get("files")
                if not isinstance(files_raw, list):
                    continue
                files = [Path(str(item)) for item in files_raw if str(item).strip()]
                if not files:
                    continue
                output_folder_raw = str(entry.get("output_folder") or "").strip()
                if not output_folder_raw:
                    continue
                try:
                    progress = JobProgress(**dict(entry.get("progress") or {}))
                except Exception:  # noqa: BLE001
                    continue
                progress.job_id = job_id
                progress.state = "queued"
                progress.current_file = None
                progress.finished_at = None
                progress.files = None
                file_entries = [
                    JobFileEntry(path=str(path), name=path.name, state="queued") for path in files
                ]
                state = _JobState(
                    job_id=job_id,
                    files=files,
                    force=bool(entry.get("force", False)),
                    rename_with_llm=bool(entry.get("rename_with_llm", True)),
                    ocr_language=str(entry.get("ocr_language") or "eng"),
                    output_folder=Path(output_folder_raw),
                    model=str(entry.get("model") or self.config.default_model),
                    progress=progress,
                    file_entries=file_entries,
                )
                self._jobs[job_id] = state
                self.db.upsert_job(progress)
                state.task = asyncio.create_task(self._run_job(state))
                restored += 1

        self._persist_queue_state()
        return restored

    # -- internals ----------------------------------------------------------

    async def _enqueue(
        self,
        *,
        files: list[Path],
        output_folder: Path,
        force: bool,
        rename_with_llm: bool,
        ocr_language: str,
        max_concurrent_jobs: int,
        model: str,
        trigger: JobTrigger = "manual",
        batch_id: str | None = None,
    ) -> tuple[str, int]:
        safe_output = _validate_user_folder(output_folder, kind="output")
        safe_output.mkdir(parents=True, exist_ok=True)
        self._apply_runtime_concurrency_limit(max_concurrent_jobs)
        job_id = uuid.uuid4().hex
        progress = JobProgress(
            job_id=job_id,
            total=len(files),
            processed=0,
            skipped=0,
            failed=0,
            current_file=None,
            state="queued",
            trigger=trigger,
            batch_id=batch_id,
        )
        file_entries = [JobFileEntry(path=str(pdf), name=pdf.name, state="queued") for pdf in files]
        state = _JobState(
            job_id=job_id,
            files=files,
            force=force,
            rename_with_llm=rename_with_llm,
            ocr_language=ocr_language,
            output_folder=safe_output,
            model=model,
            progress=progress,
            file_entries=file_entries,
        )
        async with self._lock:
            self._jobs[job_id] = state
        self.db.upsert_job(progress)
        self._persist_queue_state()
        state.task = asyncio.create_task(self._run_job(state))
        return job_id, len(files)

    async def _run_job(self, state: _JobState) -> None:
        async with self._semaphore:
            state.progress.state = "running"
            state.progress.started_at = datetime.now(UTC)
            self.db.upsert_job(state.progress)
            self._persist_queue_state()

            for index, pdf in enumerate(state.files):
                if state.cancelled:
                    state.progress.state = "cancelled"
                    break
                state.progress.current_file = pdf.name
                if index < len(state.file_entries):
                    state.file_entries[index].state = "processing"
                self.db.upsert_job(state.progress)
                self._persist_queue_state()
                try:
                    await asyncio.to_thread(self._process_one, state, pdf, index)
                except Exception as exc:  # noqa: BLE001
                    logger.exception("processing failed for %s", pdf)
                    state.progress.failed += 1
                    if index < len(state.file_entries):
                        state.file_entries[index].state = "failed"
                        state.file_entries[index].error = repr(exc)
                    self.db.upsert_job(state.progress)
                    self._persist_queue_state()

            # Any files we didn't reach (cancelled mid-batch) stay "queued";
            # the UI treats them as not-yet-processed.
            if state.progress.state != "cancelled":
                state.progress.state = "done"
            state.progress.current_file = None
            state.progress.finished_at = datetime.now(UTC)
            self.db.upsert_job(state.progress)
            self._persist_queue_state()

    def _process_one(self, state: _JobState, pdf: Path, index: int) -> None:
        entry = state.file_entries[index] if 0 <= index < len(state.file_entries) else None
        content_hash = sha256_of_file(pdf)
        existing = self.db.get_by_hash(content_hash)
        if existing and existing.status == "done" and not state.force:
            state.progress.skipped += 1
            self.db.mark_skipped(existing.id)
            if entry is not None:
                entry.state = "skipped"
                entry.document_id = existing.id
            return

        document_id = self.db.upsert_pending(content_hash, str(pdf), pdf.name)
        if entry is not None:
            entry.document_id = document_id

        try:
            # Use a temp output name first so a crash doesn't leak a final-named file.
            temp_out = state.output_folder / f"ocr_{content_hash[:12]}.pdf.tmp"
            ocr_result = run_ocr(pdf, temp_out, language=state.ocr_language)

            stem_seed = pdf.stem
            if state.rename_with_llm:
                stem_seed = self.ollama.generate_filename(
                    ocr_result.text,
                    model=state.model,
                    fallback_stem=pdf.stem,
                )
            stem_seed = sanitize_filename(stem_seed, fallback=sanitize_filename(pdf.stem))
            desired = with_ocr_prefix(stem_seed)

            existing_names = {p.name for p in state.output_folder.iterdir() if p.is_file()}
            final_stem = resolve_collision(existing_names, desired)
            final_path = state.output_folder / f"{final_stem}.pdf"
            # Defence in depth: confirm the final path is still inside the
            # validated output folder. sanitize_filename strips path separators
            # so this should always hold, but a regression there must not let
            # the OCR write outside the user's chosen folder.
            resolved_final = final_path.resolve()
            if state.output_folder not in resolved_final.parents:
                raise RuntimeError(
                    f"Refusing to write {resolved_final} outside output folder {state.output_folder}"
                )
            temp_out.replace(final_path)

            self.db.mark_done(
                document_id,
                output_path=str(final_path),
                ai_name=final_stem,
                page_count=ocr_result.page_count,
                text=ocr_result.text,
                title=ocr_result.title,
                author=ocr_result.author,
                source_created_at=ocr_result.source_created_at,
            )
            state.progress.processed += 1
            if entry is not None:
                entry.state = "done"
        except Exception as exc:  # noqa: BLE001
            category, retryable = _classify_failure(exc)
            self.db.mark_failed(document_id, repr(exc), category=category, retryable=retryable)
            if entry is not None:
                entry.error = repr(exc)
            raise

    def _apply_runtime_concurrency_limit(self, requested: int) -> None:
        safe = max(1, min(4, int(requested)))
        if safe == self._max_concurrent_jobs:
            return
        self._max_concurrent_jobs = safe
        self._semaphore = asyncio.Semaphore(safe)

    def _persist_queue_state(self) -> None:
        pending = []
        for state in self._jobs.values():
            if state.progress.state not in ("queued", "running"):
                continue
            pending.append(
                {
                    "job_id": state.job_id,
                    "files": [str(path) for path in state.files],
                    "force": state.force,
                    "rename_with_llm": state.rename_with_llm,
                    "ocr_language": state.ocr_language,
                    "output_folder": str(state.output_folder),
                    "model": state.model,
                    "progress": state.progress.model_dump(mode="json"),
                }
            )
        self.db.set_settings([(self._queue_settings_key, json.dumps(pending))])


def reconcile_on_startup(db: Database) -> int:
    """Mark any 'processing' rows as failed since the previous run crashed."""
    return db.reconcile_interrupted()


__all__ = ["JobManager", "reconcile_on_startup", "list_pdfs"]


def _classify_failure(exc: Exception) -> tuple[str, bool]:
    text = f"{type(exc).__name__}: {exc}".lower()
    if isinstance(exc, (FileNotFoundError, subprocess.SubprocessError)) and (
        "tesseract" in text or "ghostscript" in text or "ocrmypdf" in text
    ):
        return "ocr_missing_dependency", False
    if isinstance(exc, PermissionError):
        return "file_locked", True
    if "pdf" in text and ("parse" in text or "invalid" in text):
        return "pdf_parse_error", False
    if "ollama" in text or "httpx" in text or "connection refused" in text or "timed out" in text:
        return "model_unavailable", True
    if isinstance(exc, OSError):
        return "filesystem_error", True
    return "unknown", True
