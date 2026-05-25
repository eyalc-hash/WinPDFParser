-- Add richer document metadata and failure/retry tracking.

ALTER TABLE documents ADD COLUMN error_category TEXT;
ALTER TABLE documents ADD COLUMN retryable INTEGER NOT NULL DEFAULT 1;
ALTER TABLE documents ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN title TEXT;
ALTER TABLE documents ADD COLUMN author TEXT;
ALTER TABLE documents ADD COLUMN source_created_at TEXT;
