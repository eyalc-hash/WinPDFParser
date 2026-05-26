"""Retrieval-augmented question answering over the FTS5 index.

Pipeline (kept intentionally small and deterministic where possible):

    user question
        → derive_queries()      — LLM-suggested FTS5 queries (+ fallback)
        → gather_passages()     — FTS5 search, dedup by document
        → compose_answer()      — LLM summary grounded in the passages

Each step degrades gracefully when the local model (Ollama) is unreachable
so the endpoint always returns *something* useful: at minimum, the matching
passages with a note that the LLM was offline.
"""

from __future__ import annotations

import logging
import re
from typing import Protocol

from .db import Database
from .models import AgentCitation

logger = logging.getLogger(__name__)

# Conservative defaults — small enough to keep prompt size reasonable for
# typical 3B local models, large enough to give the answer real grounding.
DEFAULT_PER_QUERY = 5
DEFAULT_MAX_PASSAGES = 6
DEFAULT_MAX_QUERIES = 3
DEFAULT_PASSAGE_CHAR_BUDGET = 1200

_FTS_RESERVED = re.compile(r"[\"\\^*()+\-:]")
# Words that add no signal to an FTS5 keyword search.
_STOPWORDS = frozenset(
    [
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "been",
        "but",
        "by",
        "for",
        "from",
        "has",
        "have",
        "how",
        "i",
        "if",
        "in",
        "is",
        "it",
        "its",
        "of",
        "on",
        "or",
        "that",
        "the",
        "their",
        "them",
        "they",
        "this",
        "to",
        "was",
        "were",
        "what",
        "when",
        "where",
        "which",
        "who",
        "why",
        "with",
        "would",
        "you",
        "your",
        "please",
        "tell",
        "me",
        "about",
        "give",
        "summary",
        "summarize",
        "summarise",
        "question",
        "answer",
        "my",
        "our",
        "we",
        "us",
        "do",
        "does",
        "did",
        "can",
        "could",
        "should",
    ]
)

_QUERY_PROMPT = """You help search a local document index that uses SQLite FTS5.

Given a user question, produce 1 to {max_queries} short FTS5 search queries that
would surface relevant passages. Each query should be 1-4 plain keywords (no
operators, no quotes, no punctuation). Use only words likely to appear verbatim
in the documents. Output one query per line, no numbering, no commentary.

Question: {question}

Queries:""".strip()


_ANSWER_PROMPT = """You are answering a user's question using ONLY the document
passages provided below. If the passages do not contain the answer, say so
plainly — do not invent facts. Keep the answer concise (a short paragraph or
a few bullet points) and cite documents by their name in parentheses when you
use them.

Question:
{question}

Passages:
{passages}

Answer:""".strip()


class _LLM(Protocol):
    """Minimal interface we need from :class:`OllamaClient`.

    Declared here so tests can pass a tiny fake without importing httpx.
    """

    def complete(self, prompt: str, *, model: str) -> str | None: ...

    def is_available(self) -> bool: ...


def _sanitize_query_term(term: str) -> str:
    """Strip FTS5-meaningful punctuation from a single keyword."""
    cleaned = _FTS_RESERVED.sub(" ", term).strip()
    return " ".join(cleaned.split())


def _fallback_queries(question: str, *, max_queries: int) -> list[str]:
    """Pull keywords out of the question when the LLM isn't available.

    We tokenize on word boundaries, drop stopwords, keep order, and emit one
    multi-word query plus up to ``max_queries - 1`` single-word fallbacks.
    """
    tokens = [t.lower() for t in re.findall(r"\w+", question)]
    keywords = [t for t in tokens if t not in _STOPWORDS and len(t) > 1]
    if not keywords:
        # Last resort: use the raw question, sanitized.
        sanitized = _sanitize_query_term(question)
        return [sanitized] if sanitized else []
    queries: list[str] = []
    primary = " ".join(keywords[:4])
    queries.append(primary)
    for word in keywords[1:]:
        if len(queries) >= max_queries:
            break
        if word != primary:
            queries.append(word)
    # Deduplicate while preserving order.
    seen: set[str] = set()
    unique: list[str] = []
    for q in queries:
        if q and q not in seen:
            seen.add(q)
            unique.append(q)
    return unique[:max_queries]


def derive_queries(
    question: str,
    *,
    ollama: _LLM,
    model: str,
    max_queries: int = DEFAULT_MAX_QUERIES,
) -> list[str]:
    """Ask the LLM for FTS5 queries; fall back to keyword extraction.

    The returned list is always non-empty when the question itself contains
    any indexable word — so callers don't have to special-case "LLM offline".
    """
    fallback = _fallback_queries(question, max_queries=max_queries)
    response = ollama.complete(
        _QUERY_PROMPT.format(question=question.strip(), max_queries=max_queries),
        model=model,
    )
    if not response:
        return fallback

    candidates: list[str] = []
    for raw in response.splitlines():
        line = raw.strip().lstrip("-*0123456789. )").strip()
        if not line:
            continue
        sanitized = _sanitize_query_term(line)
        if sanitized:
            candidates.append(sanitized)

    seen: set[str] = set()
    unique: list[str] = []
    for q in candidates:
        if q not in seen:
            seen.add(q)
            unique.append(q)
        if len(unique) >= max_queries:
            break

    return unique or fallback


def gather_passages(
    db: Database,
    queries: list[str],
    *,
    per_query: int = DEFAULT_PER_QUERY,
    max_passages: int = DEFAULT_MAX_PASSAGES,
) -> list[AgentCitation]:
    """Run each query, dedup by ``document_id``, keep the top ``max_passages``.

    Queries that hit FTS5 syntax errors (e.g. a token the LLM hallucinated)
    are skipped silently — we prefer fewer good passages over a 500.
    """
    seen: dict[int, AgentCitation] = {}
    for query in queries:
        if not query.strip():
            continue
        try:
            rows = db.search_passages(query, limit=per_query)
        except Exception as exc:  # noqa: BLE001
            logger.info("agent: skipping bad query %r (%s)", query, exc)
            continue
        for row in rows:
            doc_id_value = row["document_id"]
            doc_id = doc_id_value if isinstance(doc_id_value, int) else int(str(doc_id_value))
            if doc_id in seen:
                continue
            seen[doc_id] = AgentCitation(
                document_id=doc_id,
                original_name=str(row["original_name"]),
                ai_name=(str(row["ai_name"]) if row["ai_name"] is not None else None),
                output_path=(str(row["output_path"]) if row["output_path"] is not None else None),
                passage=str(row["passage"]),
            )
            if len(seen) >= max_passages:
                return list(seen.values())
    return list(seen.values())


def _format_passages(
    citations: list[AgentCitation], *, char_budget: int = DEFAULT_PASSAGE_CHAR_BUDGET
) -> str:
    """Render passages for the LLM, truncating per-passage to fit the budget."""
    if not citations:
        return "(no passages found)"
    if char_budget <= 0:
        return "(no passages available)"
    per = max(120, char_budget // max(len(citations), 1))
    lines: list[str] = []
    for idx, c in enumerate(citations, start=1):
        name = c.ai_name or c.original_name
        text = " ".join((c.passage or "").split())
        if len(text) > per:
            text = text[: per - 1].rstrip() + "…"
        lines.append(f"[{idx}] {name}: {text}")
    return "\n".join(lines)


def compose_answer(
    question: str,
    citations: list[AgentCitation],
    *,
    ollama: _LLM,
    model: str,
) -> tuple[str, bool]:
    """Produce a final answer string.

    Returns ``(answer, model_available)``. When the LLM is unreachable we
    return a deterministic message that names the matching documents so the
    user still gets value out of the call.
    """
    if not citations:
        return (
            "I couldn't find any passages in your indexed PDFs that match this "
            "question. Try indexing more documents or rephrasing the question.",
            ollama.is_available(),
        )

    prompt = _ANSWER_PROMPT.format(
        question=question.strip(),
        passages=_format_passages(citations),
    )
    response = ollama.complete(prompt, model=model)
    if response:
        return response, True

    names = ", ".join(sorted({(c.ai_name or c.original_name) for c in citations}))
    fallback = (
        "The local model is unavailable, so I can't summarize. "
        f"Matching passages came from: {names}. "
        "See the citations below for the raw text."
    )
    return fallback, False
