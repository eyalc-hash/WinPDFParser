"""OCR pipeline.

Real OCR uses ``ocrmypdf`` (which wraps Tesseract + Ghostscript) when available.
When the binaries / Python package aren't installed (e.g. CI, sandbox, dev),
we transparently fall back to a stub that copies the file and tries to pull
any embedded text out with ``pypdf``. The rest of the pipeline (hashing,
dedupe, indexing, renaming) is identical in both modes so it can be tested
without the heavy native deps.
"""

from __future__ import annotations

import contextlib
import hashlib
import logging
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

try:  # pragma: no cover - optional dep
    import ocrmypdf  # type: ignore[import-untyped,unused-ignore]

    _HAS_OCRMYPDF = True
except Exception:  # noqa: BLE001
    _HAS_OCRMYPDF = False

try:
    from pypdf import PdfReader

    _HAS_PYPDF = True
except Exception:  # pragma: no cover - listed in install_requires
    _HAS_PYPDF = False


@dataclass(frozen=True)
class OcrResult:
    output_path: Path
    text: str
    page_count: int
    used_real_ocr: bool


def sha256_of_file(path: Path, *, chunk: int = 1 << 20) -> str:
    """Streaming SHA-256 so we don't load multi-GB PDFs into RAM."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            block = f.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def _extract_text_pypdf(pdf: Path) -> tuple[str, int]:
    if not _HAS_PYPDF:
        return "", 0
    try:
        reader = PdfReader(str(pdf))
        pages = [(p.extract_text() or "") for p in reader.pages]
        return "\n\n".join(pages), len(reader.pages)
    except Exception as exc:  # noqa: BLE001
        logger.warning("pypdf text extraction failed for %s: %s", pdf, exc)
        return "", 0


def run_ocr(input_pdf: Path, output_pdf: Path, *, language: str = "eng") -> OcrResult:
    """Produce a searchable PDF/A copy of ``input_pdf`` at ``output_pdf``.

    Returns the extracted text plus page count so the caller can index and
    rename without re-reading the file.
    """
    output_pdf.parent.mkdir(parents=True, exist_ok=True)

    if _HAS_OCRMYPDF:
        sidecar_txt = output_pdf.with_suffix(".txt")
        try:
            ocrmypdf.ocr(
                input_file=str(input_pdf),
                output_file=str(output_pdf),
                language=language,
                output_type="pdfa",
                sidecar=str(sidecar_txt),
                skip_text=True,
                progress_bar=False,
            )
            text = (
                sidecar_txt.read_text(encoding="utf-8", errors="replace")
                if sidecar_txt.exists()
                else ""
            )
            _, page_count = _extract_text_pypdf(output_pdf)
            return OcrResult(output_pdf, text, page_count, used_real_ocr=True)
        except (FileNotFoundError, subprocess.SubprocessError) as exc:
            logger.warning("ocrmypdf invocation failed (%s); falling back to stub", exc)
        finally:
            if sidecar_txt.exists():
                with contextlib.suppress(OSError):
                    sidecar_txt.unlink()

    # Stub path: copy + best-effort text extraction.
    shutil.copyfile(input_pdf, output_pdf)
    text, pages = _extract_text_pypdf(output_pdf)
    return OcrResult(output_pdf, text, pages, used_real_ocr=False)
