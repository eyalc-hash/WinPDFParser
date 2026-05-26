"""Pydantic request/response models. Mirrored by app/src/shared/types.ts."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

DocumentStatus = Literal["pending", "processing", "done", "failed", "skipped"]
DocumentSort = Literal["processed_desc", "processed_asc", "name_asc", "pages_desc"]
SearchRank = Literal["relevance", "recent"]
FailureCategory = Literal[
    "ocr_missing_dependency",
    "file_locked",
    "pdf_parse_error",
    "model_unavailable",
    "filesystem_error",
    "unknown",
]


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
    error_category: FailureCategory | None = None
    retryable: bool = True
    retry_count: int = 0
    title: str | None = None
    author: str | None = None
    source_created_at: datetime | None = None


class DocumentList(BaseModel):
    items: list[DocumentRow]
    total: int


class SearchHit(BaseModel):
    document_id: int
    original_name: str
    original_path: str
    ai_name: str | None
    output_path: str | None
    snippet: str
    score: float
    page_number: int | None = None
    processed_at: datetime | None = None
    title: str | None = None
    author: str | None = None
    source_created_at: datetime | None = None


class SearchResponse(BaseModel):
    query: str
    total: int
    limit: int
    offset: int
    hits: list[SearchHit]
    rank: SearchRank = "relevance"


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


class IndexHealthResponse(BaseModel):
    documents_total: int
    indexed_total: int
    done_total: int
    missing_in_fts: int
    orphaned_fts_rows: int


class IndexRebuildResponse(BaseModel):
    rebuilt_rows: int


class MaintenanceResponse(BaseModel):
    optimized: bool


class OcrToolsStatus(BaseModel):
    has_ocrmypdf_package: bool
    tesseract_available: bool
    ghostscript_available: bool
    real_ocr_ready: bool


class HealthDetailsResponse(BaseModel):
    status: Literal["ok"]
    version: str
    ollama_available: bool
    active_jobs: int
    recent_jobs: int
    ocr: OcrToolsStatus


class ClearTempResponse(BaseModel):
    output_folder: str | None
    cleared: int


class RetryFailedBatchResponse(BaseModel):
    queued: int
    skipped_non_retryable: int
    skipped_retry_limit: int
    job_ids: list[str]


class AgentAskRequest(BaseModel):
    question: str = Field(min_length=1)


class AgentCitation(BaseModel):
    document_id: int
    original_name: str
    ai_name: str | None = None
    output_path: str | None = None
    passage: str


class AgentAnswer(BaseModel):
    question: str
    answer: str
    queries: list[str]
    citations: list[AgentCitation]
    model_available: bool
