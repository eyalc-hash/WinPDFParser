"""Database / dedupe / FTS smoke tests."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from pdf_parser_sidecar.db import Database


@pytest.fixture
def db(tmp_path: Path) -> Database:
    d = Database(tmp_path / "app.db")
    yield d
    d.close()


def test_migrations_applied(db: Database, tmp_path: Path) -> None:
    # Second open should be a no-op (idempotent).
    db.close()
    again = Database(tmp_path / "app.db")
    again.close()


def test_dedupe_by_hash(db: Database) -> None:
    h = hashlib.sha256(b"hello").hexdigest()
    doc_id = db.upsert_pending(h, "C:/in/a.pdf", "a.pdf")
    assert doc_id > 0
    again = db.upsert_pending(h, "C:/in/a.pdf", "a.pdf")
    assert again == doc_id

    row = db.get_by_hash(h)
    assert row is not None
    assert row.original_name == "a.pdf"
    assert row.status == "processing"


def test_mark_done_and_search(db: Database) -> None:
    h = hashlib.sha256(b"x").hexdigest()
    doc_id = db.upsert_pending(h, "C:/in/contract.pdf", "contract.pdf")
    db.mark_done(
        doc_id,
        output_path="C:/out/ocr_contract.pdf",
        ai_name="ocr_contract",
        page_count=3,
        text="This is a software license agreement effective 2024.",
    )

    hits = db.search("license")
    assert len(hits) == 1
    assert hits[0].document_id == doc_id
    assert "[[license]]" in hits[0].snippet

    listed, total = db.list_documents()
    assert total == 1
    assert listed[0].status == "done"


def test_search_empty_query_returns_nothing(db: Database) -> None:
    assert db.search("") == []
    assert db.search("   ") == []


def test_reconcile_interrupted(db: Database) -> None:
    h = hashlib.sha256(b"y").hexdigest()
    db.upsert_pending(h, "C:/in/y.pdf", "y.pdf")
    count = db.reconcile_interrupted()
    assert count == 1
    row = db.get_by_hash(h)
    assert row is not None and row.status == "failed" and row.error == "interrupted"


def test_settings_roundtrip(db: Database) -> None:
    db.set_settings([("model", "llama3.2:3b"), ("input_folder", "C:/in")])
    assert db.get_setting("model") == "llama3.2:3b"
    assert db.get_setting("input_folder") == "C:/in"
    assert db.get_setting("missing") is None
