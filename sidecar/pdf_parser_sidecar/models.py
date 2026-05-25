"""Pydantic request/response models. Mirrored by app/src/shared/types.ts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

DocumentStatus = Literal["pending", "processing", "done", "failed", "skipped"]
DocumentSort = Literal["processed_desc", "processed_asc", "name_asc", "pages_desc"]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str


class ProcessRequest(BaseModel):
    input_folder: str
    output_folder: str
    force: bool = False
    rename_with_llm: bool = True


class ProcessAccepted(BaseModel):
    job_id: str
    file_count: int


class RetryAccepted(BaseModel):
    job_id: str


class DocumentRow(BaseModel):
    id: int
    content_hash: str
    original_path: str
    output_path: str | None
    original_name: str
    ai_name: str | None
    page_count: int | None
    processed_at: datetime | None
    status: DocumentStatus
    error: str | None = None


class DocumentList(BaseModel):
    items: list[DocumentRow]
    total: int


class SearchHit(BaseModel):
    document_id: int
    original_name: str
    ai_name: str | None
    output_path: str | None
    snippet: str
    score: float


class SearchResponse(BaseModel):
    query: str
    total: int
    limit: int
    offset: int
    hits: list[SearchHit]


class JobProgress(BaseModel):
    job_id: str
    total: int
    processed: int
    skipped: int
    failed: int
    current_file: str | None = None
    state: Literal["queued", "running", "done", "cancelled", "failed"]
    started_at: datetime | None = None
    finished_at: datetime | None = None


class JobList(BaseModel):
    items: list[JobProgress]


class SettingsModel(BaseModel):
    input_folder: str | None = None
    output_folder: str | None = None
    model: str = "llama3.2:3b"
    auto_update: bool = False
    ollama_url: str = "http://127.0.0.1:11434"
    rename_with_llm: bool = True
    ocr_language: str = "eng"
    max_concurrent_jobs: int = Field(default=1, ge=1, le=4)


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = Field(default=None)
