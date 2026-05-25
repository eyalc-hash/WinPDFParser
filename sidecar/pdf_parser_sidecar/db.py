"""SQLite + FTS5 storage layer with a tiny numbered-migration runner.

The DB lives at ``%APPDATA%/PDF-Parser/app.db``. Migrations are plain ``.sql``
files in ``pdf_parser_sidecar/migrations/`` named ``NNN_*.sql``. They are
applied in lexicographic order and recorded in a ``schema_migrations`` table so
each runs exactly once.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from importlib import resources
from pathlib import Path
from typing import Any

from .models import DocumentRow, DocumentSort, DocumentStatus, JobProgress, SearchHit, SearchRank


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class Database:
    """Thread-safe wrapper around an FTS5-enabled SQLite database.

    SQLite connections aren't safe to share across threads by default, but a
    single connection with a per-operation lock is fine for our single-user
    workload and avoids the complexity of a pool.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(
            str(path),
            check_same_thread=False,
            isolation_level=None,  # autocommit; we BEGIN explicitly when needed
        )
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL;")
        self._conn.execute("PRAGMA foreign_keys=ON;")
        self._ensure_fts_support()
        self._migrate()

    # -- lifecycle ----------------------------------------------------------

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def _ensure_fts_support(self) -> None:
        try:
            self._conn.execute("CREATE VIRTUAL TABLE IF NOT EXISTS _fts_probe USING fts5(x);")
            self._conn.execute("DROP TABLE IF EXISTS _fts_probe;")
        except sqlite3.OperationalError as exc:  # pragma: no cover - env-dependent
            raise RuntimeError(
                "This build of SQLite was compiled without FTS5 support. "
                "Install Python from python.org (which bundles a modern SQLite)."
            ) from exc

    def _migrate(self) -> None:
        with self._lock:
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                "  name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
            )
            applied: set[str] = {
                row["name"] for row in self._conn.execute("SELECT name FROM schema_migrations")
            }
            migrations_pkg = resources.files(__package__) / "migrations"
            for entry in sorted(
                p.name for p in migrations_pkg.iterdir() if p.name.endswith(".sql")
            ):
                if entry in applied:
                    continue
                sql = (migrations_pkg / entry).read_text(encoding="utf-8")
                self._conn.executescript(sql)
                self._conn.execute(
                    "INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)",
                    (entry, _utcnow_iso()),
                )

    # -- documents ----------------------------------------------------------

    def get_by_hash(self, content_hash: str) -> DocumentRow | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM documents WHERE content_hash = ?", (content_hash,)
            ).fetchone()
        return _row_to_document(row) if row else None

    def get_document(self, document_id: int) -> DocumentRow | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM documents WHERE id = ?", (document_id,)
            ).fetchone()
        return _row_to_document(row) if row else None

    def upsert_pending(self, content_hash: str, original_path: str, original_name: str) -> int:
        with self._lock:
            existing = self._conn.execute(
                "SELECT id FROM documents WHERE content_hash = ?", (content_hash,)
            ).fetchone()
            if existing:
                self._conn.execute(
                    "UPDATE documents SET original_path = ?, original_name = ?, "
                    "status = 'processing', error = NULL WHERE id = ?",
                    (original_path, original_name, existing["id"]),
                )
                return int(existing["id"])
            cur = self._conn.execute(
                "INSERT INTO documents(content_hash, original_path, original_name, status) "
                "VALUES (?, ?, ?, 'processing')",
                (content_hash, original_path, original_name),
            )
            last = cur.lastrowid
            assert last is not None
            return int(last)

    def mark_done(
        self,
        document_id: int,
        *,
        output_path: str,
        ai_name: str | None,
        page_count: int | None,
        text: str,
        title: str | None = None,
        author: str | None = None,
        source_created_at: str | None = None,
    ) -> None:
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                self._conn.execute(
                    "UPDATE documents SET output_path = ?, ai_name = ?, page_count = ?, "
                    "title = ?, author = ?, source_created_at = ?, processed_at = ?, "
                    "status = 'done', error = NULL, error_category = NULL, retryable = 1 WHERE id = ?",
                    (
                        output_path,
                        ai_name,
                        page_count,
                        title,
                        author,
                        source_created_at,
                        _utcnow_iso(),
                        document_id,
                    ),
                )
                self._conn.execute("DELETE FROM documents_fts WHERE rowid = ?", (document_id,))
                self._conn.execute(
                    "INSERT INTO documents_fts(rowid, body) VALUES (?, ?)",
                    (document_id, text),
                )
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def mark_failed(
        self,
        document_id: int,
        error: str,
        *,
        category: str = "unknown",
        retryable: bool = True,
    ) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE documents SET status = 'failed', error = ?, error_category = ?, "
                "retryable = ?, processed_at = ? WHERE id = ?",
                (error, category, 1 if retryable else 0, _utcnow_iso(), document_id),
            )

    def mark_retry_pending(self, document_id: int) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE documents SET status = 'pending', error = NULL, error_category = NULL, "
                "retry_count = retry_count + 1 WHERE id = ?",
                (document_id,),
            )

    def mark_skipped(self, document_id: int) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE documents SET status = 'skipped', processed_at = ? WHERE id = ?",
                (_utcnow_iso(), document_id),
            )

    def list_documents(
        self,
        limit: int = 200,
        offset: int = 0,
        *,
        status: DocumentStatus | None = None,
        sort: DocumentSort = "processed_desc",
    ) -> tuple[list[DocumentRow], int]:
        order_by = {
            "processed_desc": "processed_at IS NULL ASC, processed_at DESC, id DESC",
            "processed_asc": "processed_at IS NULL ASC, processed_at ASC, id ASC",
            "name_asc": "LOWER(COALESCE(NULLIF(ai_name, ''), original_name)) ASC, id ASC",
            "pages_desc": "page_count IS NULL ASC, page_count DESC, id DESC",
        }.get(sort)
        if order_by is None:
            raise ValueError(f"unsupported document sort: {sort}")

        where = " WHERE status = ?" if status else ""
        count_params: tuple[str, ...] = (status,) if status else ()
        list_params: tuple[object, ...] = (*count_params, limit, offset)

        with self._lock:
            total = int(
                self._conn.execute(
                    f"SELECT COUNT(*) AS c FROM documents{where}", count_params
                ).fetchone()["c"]
            )
            rows = self._conn.execute(
                f"SELECT * FROM documents{where} ORDER BY {order_by} LIMIT ? OFFSET ?",
                list_params,
            ).fetchall()
        return [_row_to_document(r) for r in rows], total

    def delete_document(self, document_id: int) -> None:
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                self._conn.execute("DELETE FROM documents_fts WHERE rowid = ?", (document_id,))
                self._conn.execute("DELETE FROM documents WHERE id = ?", (document_id,))
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise

    def reconcile_interrupted(self) -> int:
        """Move any documents stuck in ``processing`` to ``failed (interrupted)``."""
        with self._lock:
            cur = self._conn.execute(
                "UPDATE documents SET status = 'failed', error = 'interrupted' "
                "WHERE status = 'processing'"
            )
            return cur.rowcount or 0

    # -- search -------------------------------------------------------------

    def search(
        self,
        query: str,
        limit: int = 50,
        offset: int = 0,
        *,
        status: DocumentStatus | None = None,
        name: str | None = None,
        processed_after: str | None = None,
        processed_before: str | None = None,
        rank: SearchRank = "relevance",
    ) -> tuple[list[SearchHit], int]:
        if not query.strip():
            return [], 0
        filters = ["documents_fts MATCH ?"]
        params: list[object] = [query]
        if status:
            filters.append("d.status = ?")
            params.append(status)
        if name:
            filters.append("LOWER(COALESCE(NULLIF(d.ai_name, ''), d.original_name)) LIKE ?")
            params.append(f"%{name.lower()}%")
        if processed_after:
            filters.append("d.processed_at >= ?")
            params.append(processed_after)
        if processed_before:
            filters.append("d.processed_at <= ?")
            params.append(processed_before)
        where = " AND ".join(filters)
        order_by = (
            "d.processed_at IS NULL ASC, d.processed_at DESC, d.id DESC"
            if rank == "recent"
            else "score, d.id DESC"
        )
        with self._lock:
            total = int(
                self._conn.execute(
                    "SELECT COUNT(*) AS c FROM documents_fts "
                    "JOIN documents d ON d.id = documents_fts.rowid "
                    f"WHERE {where}",
                    tuple(params),
                ).fetchone()["c"]
            )
            rows = self._conn.execute(
                "SELECT d.id AS document_id, d.original_name, d.ai_name, d.output_path, "
                "snippet(documents_fts, 0, '[[', ']]', '…', 12) AS snippet, "
                "bm25(documents_fts) AS score, d.processed_at, d.title, d.author, d.source_created_at "
                "FROM documents_fts "
                "JOIN documents d ON d.id = documents_fts.rowid "
                f"WHERE {where} "
                f"ORDER BY {order_by} "
                "LIMIT ? OFFSET ?",
                (*params, limit, offset),
            ).fetchall()
        return (
            [
                SearchHit(
                    document_id=r["document_id"],
                    original_name=r["original_name"],
                    ai_name=r["ai_name"],
                    output_path=r["output_path"],
                    snippet=r["snippet"],
                    # bm25 returns a lower-is-better score; invert for UX
                    score=-float(r["score"]),
                    processed_at=datetime.fromisoformat(r["processed_at"]) if r["processed_at"] else None,
                    title=r["title"],
                    author=r["author"],
                    source_created_at=(
                        datetime.fromisoformat(r["source_created_at"]) if r["source_created_at"] else None
                    ),
                )
                for r in rows
            ],
            total,
        )

    def index_health(self) -> dict[str, int]:
        with self._lock:
            documents_total = int(self._conn.execute("SELECT COUNT(*) AS c FROM documents").fetchone()["c"])
            done_total = int(
                self._conn.execute("SELECT COUNT(*) AS c FROM documents WHERE status = 'done'").fetchone()["c"]
            )
            indexed_total = int(
                self._conn.execute("SELECT COUNT(*) AS c FROM documents_fts").fetchone()["c"]
            )
            missing_in_fts = int(
                self._conn.execute(
                    "SELECT COUNT(*) AS c FROM documents d "
                    "WHERE d.status='done' AND NOT EXISTS("
                    "SELECT 1 FROM documents_fts f WHERE f.rowid=d.id)"
                ).fetchone()["c"]
            )
            orphaned_fts_rows = int(
                self._conn.execute(
                    "SELECT COUNT(*) AS c FROM documents_fts f "
                    "LEFT JOIN documents d ON d.id=f.rowid "
                    "WHERE d.id IS NULL"
                ).fetchone()["c"]
            )
        return {
            "documents_total": documents_total,
            "done_total": done_total,
            "indexed_total": indexed_total,
            "missing_in_fts": missing_in_fts,
            "orphaned_fts_rows": orphaned_fts_rows,
        }

    def rebuild_index(self) -> int:
        with self._lock:
            rows = self._conn.execute(
                "SELECT d.id, f.body FROM documents d "
                "JOIN documents_fts f ON f.rowid = d.id "
                "WHERE d.status = 'done'"
            ).fetchall()
            self._conn.execute("DELETE FROM documents_fts")
            self._conn.executemany(
                "INSERT INTO documents_fts(rowid, body) VALUES (?, ?)",
                [(r["id"], r["body"]) for r in rows],
            )
        return len(rows)

    def optimize(self) -> None:
        with self._lock:
            self._conn.execute("ANALYZE")
            self._conn.execute("REINDEX")
            self._conn.execute("VACUUM")

    # -- settings -----------------------------------------------------------

    def get_setting(self, key: str) -> str | None:
        with self._lock:
            row = self._conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    def set_settings(self, items: Iterable[tuple[str, str]]) -> None:
        with self._lock:
            self._conn.executemany(
                "INSERT INTO settings(key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                list(items),
            )

    # -- jobs ---------------------------------------------------------------

    def upsert_job(self, job: JobProgress) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO jobs(id, state, total, processed, skipped, failed, "
                "current_file, started_at, finished_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET state=excluded.state, total=excluded.total, "
                "processed=excluded.processed, skipped=excluded.skipped, "
                "failed=excluded.failed, current_file=excluded.current_file, "
                "started_at=excluded.started_at, finished_at=excluded.finished_at",
                (
                    job.job_id,
                    job.state,
                    job.total,
                    job.processed,
                    job.skipped,
                    job.failed,
                    job.current_file,
                    job.started_at.isoformat() if job.started_at else None,
                    job.finished_at.isoformat() if job.finished_at else None,
                ),
            )

    def list_jobs(self, limit: int = 20) -> list[JobProgress]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM jobs ORDER BY COALESCE(started_at, '') DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [_row_to_job(r) for r in rows]

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._conn.execute("BEGIN")
            try:
                yield self._conn
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise


def _row_to_document(row: sqlite3.Row) -> DocumentRow:
    processed_at_raw: Any = row["processed_at"]
    processed_at = datetime.fromisoformat(processed_at_raw) if processed_at_raw else None
    source_created_at_raw: Any = row["source_created_at"] if "source_created_at" in row.keys() else None
    source_created_at = (
        datetime.fromisoformat(source_created_at_raw) if source_created_at_raw else None
    )
    return DocumentRow(
        id=row["id"],
        content_hash=row["content_hash"],
        original_path=row["original_path"],
        output_path=row["output_path"],
        original_name=row["original_name"],
        ai_name=row["ai_name"],
        page_count=row["page_count"],
        processed_at=processed_at,
        status=row["status"],
        error=row["error"],
        error_category=row["error_category"] if "error_category" in row.keys() else None,
        retryable=bool(row["retryable"]) if "retryable" in row.keys() else True,
        retry_count=int(row["retry_count"]) if "retry_count" in row.keys() else 0,
        title=row["title"] if "title" in row.keys() else None,
        author=row["author"] if "author" in row.keys() else None,
        source_created_at=source_created_at,
    )


def _row_to_job(row: sqlite3.Row) -> JobProgress:
    return JobProgress(
        job_id=row["id"],
        state=row["state"],
        total=row["total"],
        processed=row["processed"],
        skipped=row["skipped"],
        failed=row["failed"],
        current_file=row["current_file"],
        started_at=datetime.fromisoformat(row["started_at"]) if row["started_at"] else None,
        finished_at=datetime.fromisoformat(row["finished_at"]) if row["finished_at"] else None,
    )


__all__ = ["Database", "DocumentStatus"]
