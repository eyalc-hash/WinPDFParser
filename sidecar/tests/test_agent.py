"""Tests for the local-LLM agent (retrieval + answer composition)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pdf_parser_sidecar.agent import (
    compose_answer,
    derive_queries,
    gather_passages,
)
from pdf_parser_sidecar.app import create_app
from pdf_parser_sidecar.config import Config


class FakeLLM:
    """Tiny stand-in for :class:`OllamaClient` so tests stay hermetic."""

    def __init__(
        self,
        *,
        available: bool = True,
        response: str | None = "stub answer",
    ) -> None:
        self._available = available
        self._response = response
        self.prompts: list[str] = []

    def is_available(self) -> bool:
        return self._available

    def complete(self, prompt: str, *, model: str) -> str | None:
        _ = model
        self.prompts.append(prompt)
        return self._response


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    config = Config.load(app_data_override=str(tmp_path / "appdata"))
    app = create_app(config)
    with TestClient(app) as c:
        yield c


def _seed_documents(client: TestClient) -> None:
    db = client.app.state.db
    invoice = db.upsert_pending("hash-invoice", "C:/in/invoice.pdf", "invoice.pdf")
    db.mark_done(
        invoice,
        output_path="C:/out/invoice.pdf",
        ai_name="Invoice 2024 Acme",
        page_count=1,
        text="This invoice from Acme Corp totals $1234 for consulting in March 2024.",
    )
    contract = db.upsert_pending("hash-contract", "C:/in/contract.pdf", "contract.pdf")
    db.mark_done(
        contract,
        output_path="C:/out/contract.pdf",
        ai_name="Acme Consulting Contract",
        page_count=3,
        text="Acme Corp agrees to provide consulting services with a monthly retainer.",
    )


def test_derive_queries_uses_llm_when_available() -> None:
    llm = FakeLLM(response="invoice total\nacme corp\nmarch 2024")
    queries = derive_queries(
        "What was the invoice total from Acme Corp in March 2024?",
        ollama=llm,
        model="test-model",
    )
    assert queries == ["invoice total", "acme corp", "march 2024"]
    assert llm.prompts, "LLM should have been called"


def test_derive_queries_falls_back_to_keywords_when_llm_offline() -> None:
    llm = FakeLLM(available=False, response=None)
    queries = derive_queries(
        "What was the invoice total from Acme Corp?",
        ollama=llm,
        model="test-model",
    )
    assert queries, "fallback must produce at least one query"
    # Stopwords ('what', 'was', 'the', 'from') should be stripped.
    assert all("the" not in q.split() for q in queries)
    # Should contain salient keywords from the question.
    joined = " ".join(queries).lower()
    assert "invoice" in joined
    assert "acme" in joined


def test_derive_queries_sanitizes_fts_punctuation() -> None:
    llm = FakeLLM(response='"acme" AND -invoice:2024\n(march OR april)')
    queries = derive_queries("anything", ollama=llm, model="m")
    # No quotes, colons, parens, leading dashes, or other FTS5 reserved chars.
    for q in queries:
        assert not any(c in q for c in '"():-^*+\\')


def test_gather_passages_dedupes_by_document(client: TestClient) -> None:
    _seed_documents(client)
    db = client.app.state.db
    citations = gather_passages(db, ["acme", "invoice", "consulting"], per_query=5, max_passages=5)
    ids = [c.document_id for c in citations]
    assert len(ids) == len(set(ids)), "should not return duplicate documents"
    # Both seeded docs match these queries.
    assert len(citations) == 2


def test_gather_passages_ignores_bad_fts_syntax(client: TestClient) -> None:
    _seed_documents(client)
    db = client.app.state.db
    # An empty / whitespace query plus a normal one should still succeed.
    citations = gather_passages(db, ["", "  ", "acme"], per_query=5, max_passages=5)
    assert any(
        c.original_name == "invoice.pdf" or c.original_name == "contract.pdf" for c in citations
    )


def test_compose_answer_returns_llm_text_when_available(client: TestClient) -> None:
    _seed_documents(client)
    db = client.app.state.db
    citations = gather_passages(db, ["acme"], per_query=5, max_passages=5)
    llm = FakeLLM(response="Acme Corp invoiced $1234 in March 2024.")
    answer, available = compose_answer("What is the total?", citations, ollama=llm, model="m")
    assert "Acme" in answer
    assert available is True


def test_compose_answer_falls_back_when_llm_offline(client: TestClient) -> None:
    _seed_documents(client)
    db = client.app.state.db
    citations = gather_passages(db, ["acme"], per_query=5, max_passages=5)
    llm = FakeLLM(available=False, response=None)
    answer, available = compose_answer("What is the total?", citations, ollama=llm, model="m")
    assert available is False
    assert "unavailable" in answer.lower()
    # Falls back to naming the matched documents.
    assert "Invoice 2024 Acme" in answer or "Acme Consulting Contract" in answer


def test_compose_answer_when_no_passages_does_not_call_llm() -> None:
    llm = FakeLLM(response="should not be used")
    answer, available = compose_answer("anything", [], ollama=llm, model="m")
    assert "couldn't find" in answer.lower() or "could not find" in answer.lower()
    assert llm.prompts == []
    assert available is True  # LLM was reachable, we just had nothing to ground on


def test_agent_ask_endpoint_returns_answer_and_citations(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _seed_documents(client)

    # Monkeypatch the bound OllamaClient so the endpoint is deterministic.
    def fake_complete(self: object, prompt: str, *, model: str) -> str | None:
        _ = (self, model)
        if "Queries:" in prompt:
            return "acme"
        return "Stubbed agent answer mentioning Acme."

    def fake_is_available(self: object) -> bool:
        _ = self
        return True

    from pdf_parser_sidecar import llm as llm_module

    monkeypatch.setattr(llm_module.OllamaClient, "complete", fake_complete)
    monkeypatch.setattr(llm_module.OllamaClient, "is_available", fake_is_available)

    r = client.post("/agent/ask", json={"question": "Tell me about Acme"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["question"] == "Tell me about Acme"
    assert body["answer"] == "Stubbed agent answer mentioning Acme."
    assert body["queries"] == ["acme"]
    assert body["model_available"] is True
    assert len(body["citations"]) >= 1
    citation = body["citations"][0]
    assert {"document_id", "original_name", "passage"}.issubset(citation.keys())


def test_agent_ask_endpoint_rejects_empty_question(client: TestClient) -> None:
    r = client.post("/agent/ask", json={"question": ""})
    assert r.status_code == 422


def test_openapi_includes_agent_contract(client: TestClient) -> None:
    r = client.get("/openapi.json")
    assert r.status_code == 200
    spec = r.json()
    assert "/agent/ask" in spec.get("paths", {})
    schemas = spec.get("components", {}).get("schemas", {})
    assert "AgentAskRequest" in schemas
    assert "AgentAnswer" in schemas
    assert "AgentCitation" in schemas
