"""Tests for the sidecar executable entry point."""

from __future__ import annotations

import subprocess
import sys


def test_entrypoint_script_can_be_invoked_directly_for_pyinstaller() -> None:
    result = subprocess.run(
        [sys.executable, "pdf_parser_sidecar/__main__.py", "--help"],
        cwd=".",
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
    assert "pdf_parser_sidecar" in result.stdout
