"""Local LLM rename via Ollama.

This module is deliberately defensive: any network/parse/timeout error falls
back to the original file stem, because Ollama may be unreachable, the user
may not have pulled the model yet, or the model may return junk.
"""

from __future__ import annotations

import logging

import httpx

from .sanitize import sanitize_filename

logger = logging.getLogger(__name__)

_PROMPT_TEMPLATE = """You are naming a document for a filesystem.

Read the following extracted text and respond with ONLY a short, descriptive,
filesystem-safe English filename. No path. No extension. No quotes. No commentary.
Use underscores or spaces between words. Maximum 80 characters.

----- BEGIN DOCUMENT -----
{text}
----- END DOCUMENT -----

Filename:""".strip()


def _truncate_for_model(text: str, char_budget: int = 4000) -> str:
    """Crude token budgeter: take the head of the doc up to ``char_budget`` chars.

    Most useful signal (title, header, date) is on page 1 of a typical PDF.
    """
    cleaned = " ".join(text.split())
    if len(cleaned) <= char_budget:
        return cleaned
    return cleaned[:char_budget]


class OllamaClient:
    """Thin sync wrapper around the local Ollama HTTP API."""

    def __init__(self, base_url: str = "http://127.0.0.1:11434", timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def is_available(self) -> bool:
        try:
            r = httpx.get(f"{self.base_url}/api/tags", timeout=2.0)
            return r.status_code == 200
        except httpx.HTTPError:
            return False

    def complete(self, prompt: str, *, model: str) -> str | None:
        """Generic text-completion call against Ollama's ``/api/generate``.

        Returns the raw model response string on success, or ``None`` if the
        model/server is unavailable or returned malformed output. Callers are
        expected to degrade gracefully — e.g. the agent endpoint falls back to
        a deterministic answer when the LLM is offline.
        """
        if not prompt.strip():
            return None
        try:
            r = httpx.post(
                f"{self.base_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
                timeout=self.timeout,
            )
            r.raise_for_status()
            payload = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            logger.info("Ollama complete() failed (%s)", exc)
            return None
        response = payload.get("response") if isinstance(payload, dict) else None
        if not isinstance(response, str):
            return None
        text = response.strip()
        return text or None

    def generate_filename(
        self,
        text: str,
        *,
        model: str,
        fallback_stem: str,
    ) -> str:
        """Ask the local model for a filename. Always returns a sanitized stem."""
        truncated = _truncate_for_model(text)
        if not truncated:
            return sanitize_filename(fallback_stem, fallback=fallback_stem or "document")

        prompt = _PROMPT_TEMPLATE.format(text=truncated)
        try:
            r = httpx.post(
                f"{self.base_url}/api/generate",
                json={"model": model, "prompt": prompt, "stream": False},
                timeout=self.timeout,
            )
            r.raise_for_status()
            payload = r.json()
            suggestion = (payload.get("response") or "").strip().splitlines()[0] if payload else ""
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            logger.info("Ollama rename failed (%s); using fallback stem", exc)
            suggestion = ""

        return sanitize_filename(
            suggestion or fallback_stem,
            fallback=sanitize_filename(fallback_stem, fallback="document"),
        )
