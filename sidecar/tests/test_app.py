"""Tests for HTTP API surface."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pdf_parser_sidecar.app import create_app
from pdf_parser_sidecar.config import Config


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    config = Config.load(app_data_override=str(tmp_path / "appdata"))
    app = create_app(config)
    with TestClient(app) as c:
        yield c


def test_health(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "version" in body


def test_documents_empty(client: TestClient) -> None:
    r = client.get("/documents")
    assert r.status_code == 200
    assert r.json() == {"items": [], "total": 0}


def test_documents_accepts_status_sort_and_returns_filtered_total(client: TestClient) -> None:
    first_id = client.app.state.db.upsert_pending("hash-a", "C:/in/a.pdf", "a.pdf")
    client.app.state.db.mark_done(
        first_id,
        output_path="C:/out/a.pdf",
        ai_name="Alpha",
        page_count=2,
        text="alpha",
    )
    second_id = client.app.state.db.upsert_pending("hash-b", "C:/in/b.pdf", "b.pdf")
    client.app.state.db.mark_done(
        second_id,
        output_path="C:/out/b.pdf",
        ai_name="Beta",
        page_count=7,
        text="beta",
    )
    failed_id = client.app.state.db.upsert_pending("hash-failed", "C:/in/c.pdf", "c.pdf")
    client.app.state.db.mark_failed(failed_id, "boom")

    r = client.get("/documents", params={"status": "done", "sort": "pages_desc"})

    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert [item["id"] for item in body["items"]] == [second_id, first_id]


def test_failed_documents_list_returns_recent_failed_only(client: TestClient) -> None:
    done_id = client.app.state.db.upsert_pending("hash-done", "C:/in/a.pdf", "a.pdf")
    client.app.state.db.mark_done(
        done_id,
        output_path="C:/out/a.pdf",
        ai_name="Alpha",
        page_count=2,
        text="alpha",
    )
    older_failed = client.app.state.db.upsert_pending("hash-failed-a", "C:/in/b.pdf", "b.pdf")
    client.app.state.db.mark_failed(older_failed, "older")
    newer_failed = client.app.state.db.upsert_pending("hash-failed-b", "C:/in/c.pdf", "c.pdf")
    client.app.state.db.mark_failed(newer_failed, "newer")

    r = client.get(
        "/documents",
        params={"status": "failed", "sort": "processed_desc", "limit": 20},
    )

    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert [item["id"] for item in body["items"]] == [newer_failed, older_failed]
    assert all(item["status"] == "failed" for item in body["items"])


def test_search_requires_query(client: TestClient) -> None:
    r = client.get("/search", params={"q": ""})
    assert r.status_code == 422  # min_length=1


def test_search_returns_total_and_offset(client: TestClient, tmp_path: Path) -> None:
    for idx in range(3):
        doc_id = client.app.state.db.upsert_pending(f"hash-{idx}", f"C:/in/{idx}.pdf", f"{idx}.pdf")
        client.app.state.db.mark_done(
            doc_id,
            output_path=f"C:/out/{idx}.pdf",
            ai_name=f"doc-{idx}",
            page_count=1,
            text="invoice number 42",
        )

    r = client.get("/search", params={"q": "invoice", "limit": 2, "offset": 1})
    assert r.status_code == 200
    body = r.json()
    assert body["query"] == "invoice"
    assert body["total"] == 3
    assert body["limit"] == 2
    assert body["offset"] == 1
    assert len(body["hits"]) == 2


def test_settings_roundtrip(client: TestClient) -> None:
    r = client.get("/settings")
    assert r.status_code == 200
    body = r.json()
    body["model"] = "qwen2.5:3b"
    body["input_folder"] = "C:/Users/me/in"
    body["ocr_language"] = "deu+eng"
    body["max_concurrent_jobs"] = 2
    r2 = client.put("/settings", json=body)
    assert r2.status_code == 200
    r3 = client.get("/settings")
    assert r3.json()["model"] == "qwen2.5:3b"
    assert r3.json()["input_folder"] == "C:/Users/me/in"
    assert r3.json()["ocr_language"] == "deu+eng"
    assert r3.json()["max_concurrent_jobs"] == 2


def test_process_rejects_missing_folder(client: TestClient, tmp_path: Path) -> None:
    r = client.post(
        "/process",
        json={
            "input_folder": str(tmp_path / "does-not-exist"),
            "output_folder": str(tmp_path / "out"),
            "force": False,
            "rename_with_llm": False,
        },
    )
    assert r.status_code == 400


def test_retry_failed_document_returns_job_and_clears_error(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def noop_run_job(state: object) -> None:
        _ = state

    monkeypatch.setattr(client.app.state.jobs, "_run_job", noop_run_job)
    source = tmp_path / "source.pdf"
    source.write_bytes(b"%PDF-1.1\n")
    output = tmp_path / "out"
    client.app.state.db.set_settings([("output_folder", str(output))])
    doc_id = client.app.state.db.upsert_pending("hash-retry", str(source), source.name)
    client.app.state.db.mark_failed(doc_id, "ocr failed")

    r = client.post(f"/documents/{doc_id}/retry")

    assert r.status_code == 200
    assert isinstance(r.json()["job_id"], str)
    row = client.app.state.db.get_document(doc_id)
    assert row is not None
    assert row.status == "pending"
    assert row.error is None


def test_retry_done_document_returns_conflict(client: TestClient) -> None:
    doc_id = client.app.state.db.upsert_pending("hash-done-retry", "C:/in/a.pdf", "a.pdf")
    client.app.state.db.mark_done(
        doc_id,
        output_path="C:/out/a.pdf",
        ai_name="Alpha",
        page_count=2,
        text="alpha",
    )

    r = client.post(f"/documents/{doc_id}/retry")

    assert r.status_code == 409


def test_retry_non_retryable_document_returns_conflict(client: TestClient) -> None:
    doc_id = client.app.state.db.upsert_pending("hash-non-retry", "C:/in/a.pdf", "a.pdf")
    client.app.state.db.mark_failed(doc_id, "missing dependency", category="ocr_missing_dependency", retryable=False)

    r = client.post(f"/documents/{doc_id}/retry")

    assert r.status_code == 409
    assert "non-retryable" in r.json()["detail"]


def test_ollama_status_does_not_explode(client: TestClient) -> None:
    r = client.get("/ollama/status")
    assert r.status_code == 200
    assert "available" in r.json()


def test_index_health_rebuild_and_optimize(client: TestClient) -> None:
    doc_id = client.app.state.db.upsert_pending("hash-index", "C:/in/a.pdf", "a.pdf")
    client.app.state.db.mark_done(
        doc_id,
        output_path="C:/out/a.pdf",
        ai_name="Alpha",
        page_count=2,
        text="alpha",
    )

    health = client.get("/index/health")
    assert health.status_code == 200
    assert health.json()["done_total"] == 1
    assert "missing_in_fts" in health.json()

    rebuild = client.post("/index/rebuild")
    assert rebuild.status_code == 200
    assert rebuild.json()["rebuilt_rows"] >= 1

    optimize = client.post("/maintenance/optimize")
    assert optimize.status_code == 200
    assert optimize.json()["optimized"] is True
