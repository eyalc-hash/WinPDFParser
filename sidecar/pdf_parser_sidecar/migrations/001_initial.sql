-- Initial schema for PDF-Parser.
--
-- Documents track every PDF the user has ever tried to process. Dedupe is by
-- SHA-256 of the input file's bytes.
CREATE TABLE IF NOT EXISTS documents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    content_hash    TEXT NOT NULL UNIQUE,
    original_path   TEXT NOT NULL,
    output_path     TEXT,
    original_name   TEXT NOT NULL,
    ai_name         TEXT,
    page_count      INTEGER,
    processed_at    TEXT,        -- ISO 8601 UTC
    status          TEXT NOT NULL CHECK (status IN ('pending','processing','done','failed','skipped')),
    error           TEXT
);

CREATE INDEX IF NOT EXISTS documents_status_idx ON documents(status);
CREATE INDEX IF NOT EXISTS documents_processed_at_idx ON documents(processed_at);

-- Full text search over the extracted OCR text. We keep the body out of the
-- main table to avoid pulling huge text blobs on a simple list query.
-- We use a regular (non-contentless) FTS5 table so snippet() and DELETE work.
-- The OCR body is duplicated in FTS shadow tables; acceptable for our scale.
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(body);

-- Single-row key/value settings store.
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Job ledger: lets us reconcile interrupted runs on startup.
CREATE TABLE IF NOT EXISTS jobs (
    id           TEXT PRIMARY KEY,
    state        TEXT NOT NULL,
    total        INTEGER NOT NULL DEFAULT 0,
    processed    INTEGER NOT NULL DEFAULT 0,
    skipped      INTEGER NOT NULL DEFAULT 0,
    failed       INTEGER NOT NULL DEFAULT 0,
    current_file TEXT,
    started_at   TEXT,
    finished_at  TEXT
);
