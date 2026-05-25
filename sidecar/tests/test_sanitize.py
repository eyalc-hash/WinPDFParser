"""Tests for the filename sanitizer."""

from __future__ import annotations

import pytest

from pdf_parser_sidecar.sanitize import resolve_collision, sanitize_filename, with_ocr_prefix


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Invoice #2024-03", "Invoice_#2024-03"),
        ("a/b\\c:d|e?f*g", "a_b_c_d_e_f_g"),
        ("   leading and trailing   ", "leading_and_trailing"),
        ("end with dot...", "end_with_dot"),
        ("hello.pdf", "hello"),
        ("", "document"),
        ("\x00\x01control", "control"),
    ],
)
def test_sanitize_basic(raw: str, expected: str) -> None:
    assert sanitize_filename(raw) == expected


def test_sanitize_reserved_windows_name() -> None:
    assert sanitize_filename("CON") == "_CON"
    assert sanitize_filename("com1") == "_com1"
    assert sanitize_filename("nul") == "_nul"


def test_sanitize_length_cap() -> None:
    out = sanitize_filename("x" * 500, max_length=10)
    assert len(out) <= 10
    assert out == "x" * 10


def test_sanitize_falls_back_when_only_garbage() -> None:
    assert sanitize_filename("///\\\\:::", fallback="oops") == "oops"


def test_with_ocr_prefix_is_idempotent() -> None:
    assert with_ocr_prefix("foo") == "ocr_foo"
    assert with_ocr_prefix("ocr_foo") == "ocr_foo"


def test_resolve_collision_no_conflict() -> None:
    assert resolve_collision({"other.pdf"}, "doc") == "doc"


def test_resolve_collision_picks_next_free_slot() -> None:
    listing = {"doc.pdf", "doc (2).pdf", "doc (3).pdf"}
    assert resolve_collision(listing, "doc") == "doc (4)"
