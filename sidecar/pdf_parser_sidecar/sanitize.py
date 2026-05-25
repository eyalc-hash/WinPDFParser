"""Filename sanitization for the AI-suggested name.

Windows filesystem rules are the tightest, so we apply them universally:
- No path separators (`/`, `\\`)
- No reserved characters: ``<>:"/\\|?*``
- No control characters (ord < 32)
- No reserved device names: CON, PRN, AUX, NUL, COM1..9, LPT1..9
- No trailing dots / spaces
- Length cap (default 80 chars) to keep total path under MAX_PATH-ish budgets
"""

from __future__ import annotations

import re
import unicodedata

_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}

_FORBIDDEN_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WHITESPACE = re.compile(r"\s+")


def sanitize_filename(name: str, *, max_length: int = 80, fallback: str = "document") -> str:
    """Return a filesystem-safe filename **stem** (no extension).

    The result is guaranteed non-empty, ≤ ``max_length`` chars, contains only
    safe characters, and is not a Windows reserved device name.
    """
    if not name:
        return fallback

    # Normalise unicode (NFKC collapses fullwidth/compatibility forms)
    cleaned = unicodedata.normalize("NFKC", name)

    # Strip extension if the model included one
    if "." in cleaned:
        cleaned = cleaned.rsplit(".", 1)[0]

    cleaned = _FORBIDDEN_CHARS.sub(" ", cleaned)
    cleaned = _WHITESPACE.sub(" ", cleaned).strip()

    # Replace inner spaces with underscores for cross-tool friendliness
    cleaned = cleaned.replace(" ", "_")

    # Strip trailing dots/underscores
    cleaned = cleaned.rstrip("._")

    if not cleaned:
        return fallback

    if cleaned.upper() in _RESERVED_NAMES:
        cleaned = f"_{cleaned}"

    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length].rstrip("._") or fallback

    return cleaned


def with_ocr_prefix(stem: str) -> str:
    """Always namespace processed outputs with the mandated `ocr_` prefix."""
    if stem.startswith("ocr_"):
        return stem
    return f"ocr_{stem}"


def resolve_collision(directory_listing: set[str], desired_stem: str, ext: str = ".pdf") -> str:
    """Return a stem that does not collide with ``directory_listing``.

    Appends ` (2)`, ` (3)`, ... to the stem until a free slot is found. The
    directory listing is a snapshot of existing filenames (with extension) in
    the target folder; callers are responsible for refreshing it on retry.
    """
    candidate = f"{desired_stem}{ext}"
    if candidate not in directory_listing:
        return desired_stem
    n = 2
    while True:
        candidate = f"{desired_stem} ({n}){ext}"
        if candidate not in directory_listing:
            return f"{desired_stem} ({n})"
        n += 1
