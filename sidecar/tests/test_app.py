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


def test_search_requires_query(client: TestClient) -> None:
    r = client.get("/search", params={"q": ""})
    assert r.status_code == 422  # min_length=1


def test_settings_roundtrip(client: TestClient) -> None:
    r = client.get("/settings")
    assert r.status_code == 200
    body = r.json()
    body["model"] = "qwen2.5:3b"
    body["input_folder"] = "C:/Users/me/in"
    r2 = client.put("/settings", json=body)
    assert r2.status_code == 200
    r3 = client.get("/settings")
    assert r3.json()["model"] == "qwen2.5:3b"
    assert r3.json()["input_folder"] == "C:/Users/me/in"


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


def test_ollama_status_does_not_explode(client: TestClient) -> None:
    r = client.get("/ollama/status")
    assert r.status_code == 200
    assert "available" in r.json()
