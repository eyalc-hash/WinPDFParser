"""End-to-end-ish pipeline test using the stub OCR path.

We synthesise a one-page PDF with reportlab... actually, pypdf can read but not
easily write. Instead we use a minimal hand-crafted PDF byte sequence to avoid
adding a heavy dep.
"""

from __future__ import annotations

import asyncio
import contextlib
from pathlib import Path

import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from pdf_parser_sidecar.config import Config
from pdf_parser_sidecar.db import Database
from pdf_parser_sidecar.llm import OllamaClient
from pdf_parser_sidecar.queue import JobManager

# Minimal valid PDF (no text content; pypdf will report 1 page).
_MINIMAL_PDF = (
    b"%PDF-1.1\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n"
    b"xref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n"
    b"0000000053 00000 n \n0000000098 00000 n \n"
    b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n150\n%%EOF\n"
)


def _write_text_pdf(path: Path, text: str) -> None:
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=300)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    font_ref = writer._add_object(font)  # noqa: SLF001 - test fixture generation
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font_ref})}
    )
    content = DecodedStreamObject()
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    content.set_data(f"BT /F1 18 Tf 40 250 Td ({escaped}) Tj ET".encode("utf-8"))
    page[NameObject("/Contents")] = writer._add_object(content)  # noqa: SLF001
    with path.open("wb") as handle:
        writer.write(handle)


@pytest.fixture
def env(tmp_path: Path) -> tuple[Config, Database, JobManager, Path, Path]:
    app_data = tmp_path / "appdata"
    config = Config.load(app_data_override=str(app_data))
    db = Database(config.db_path)
    ollama = OllamaClient(base_url="http://127.0.0.1:1")  # guaranteed-unreachable
    jobs = JobManager(config, db, ollama)
    in_folder = tmp_path / "in"
    out_folder = tmp_path / "out"
    in_folder.mkdir()
    (in_folder / "a.pdf").write_bytes(_MINIMAL_PDF)
    (in_folder / "b.pdf").write_bytes(_MINIMAL_PDF + b"\n%trailer-2")  # different hash
    try:
        yield config, db, jobs, in_folder, out_folder
    finally:
        db.close()


async def _await_job(jobs: JobManager, job_id: str) -> None:
    for _ in range(100):
        snap = jobs.snapshot(job_id)
        if snap and snap.state in ("done", "failed", "cancelled"):
            return
        await asyncio.sleep(0.05)
    raise AssertionError("job did not finish in time")


@pytest.mark.asyncio
async def test_end_to_end_stub_pipeline(
    env: tuple[Config, Database, JobManager, Path, Path],
) -> None:
    _, db, jobs, in_folder, out_folder = env

    job_id, count = await jobs.submit(
        input_folder=in_folder,
        output_folder=out_folder,
        force=False,
        rename_with_llm=True,  # Ollama unreachable → falls back to original stem
        ocr_language="eng",
        max_concurrent_jobs=1,
        model="dummy",
    )
    assert count == 2
    await _await_job(jobs, job_id)

    snap = jobs.snapshot(job_id)
    assert snap is not None and snap.state == "done"
    assert snap.processed == 2 and snap.failed == 0 and snap.skipped == 0

    # Both outputs exist with the mandated `ocr_` prefix.
    outs = sorted(p.name for p in out_folder.iterdir())
    assert all(name.startswith("ocr_") for name in outs)
    assert all(name.endswith(".pdf") for name in outs)
    assert len(outs) == 2

    # DB reflects state.
    docs, total = db.list_documents()
    assert total == 2
    assert all(d.status == "done" for d in docs)


@pytest.mark.asyncio
async def test_second_run_skips_duplicates(
    env: tuple[Config, Database, JobManager, Path, Path],
) -> None:
    _, db, jobs, in_folder, out_folder = env
    job_id, _ = await jobs.submit(
        input_folder=in_folder,
        output_folder=out_folder,
        force=False,
        rename_with_llm=False,
        ocr_language="eng",
        max_concurrent_jobs=1,
        model="dummy",
    )
    await _await_job(jobs, job_id)

    job_id2, _ = await jobs.submit(
        input_folder=in_folder,
        output_folder=out_folder,
        force=False,
        rename_with_llm=False,
        ocr_language="eng",
        max_concurrent_jobs=1,
        model="dummy",
    )
    await _await_job(jobs, job_id2)
    snap = jobs.snapshot(job_id2)
    assert snap is not None
    assert snap.skipped == 2 and snap.processed == 0


@pytest.mark.asyncio
async def test_force_reprocesses(
    env: tuple[Config, Database, JobManager, Path, Path],
) -> None:
    _, _, jobs, in_folder, out_folder = env
    j1, _ = await jobs.submit(
        input_folder=in_folder,
        output_folder=out_folder,
        force=False,
        rename_with_llm=False,
        ocr_language="eng",
        max_concurrent_jobs=1,
        model="dummy",
    )
    await _await_job(jobs, j1)
    j2, _ = await jobs.submit(
        input_folder=in_folder,
        output_folder=out_folder,
        force=True,
        rename_with_llm=False,
        ocr_language="eng",
        max_concurrent_jobs=1,
        model="dummy",
    )
    await _await_job(jobs, j2)
    snap = jobs.snapshot(j2)
    assert snap is not None and snap.processed == 2 and snap.skipped == 0


@pytest.mark.asyncio
async def test_sample_pdf_ocr_and_search_include_location(
    env: tuple[Config, Database, JobManager, Path, Path],
) -> None:
    _, db, jobs, in_folder, out_folder = env
    target = in_folder / "invoice.pdf"
    _write_text_pdf(target, "Invoice 2026 payment due")

    job_id, count = await jobs.submit(
        input_folder=in_folder,
        output_folder=out_folder,
        force=False,
        rename_with_llm=False,
        ocr_language="eng",
        max_concurrent_jobs=1,
        model="dummy",
    )
    assert count == 3
    await _await_job(jobs, job_id)

    hits, total = db.search("invoice")
    assert total >= 1
    hit = next((candidate for candidate in hits if candidate.original_name == "invoice.pdf"), None)
    assert hit is not None
    assert "[[invoice]]" in hit.snippet.lower()
    assert hit.original_path.endswith("invoice.pdf")
    assert hit.page_number == 1


@pytest.mark.asyncio
async def test_restore_pending_jobs_after_restart(tmp_path: Path) -> None:
    app_data = tmp_path / "appdata"
    config = Config.load(app_data_override=str(app_data))
    db = Database(config.db_path)
    ollama = OllamaClient(base_url="http://127.0.0.1:1")
    jobs = JobManager(config, db, ollama)
    in_folder = tmp_path / "in"
    out_folder = tmp_path / "out"
    in_folder.mkdir()
    (in_folder / "restore.pdf").write_bytes(_MINIMAL_PDF)

    blocker = asyncio.Event()

    async def blocked_run_job(state: object) -> None:
        _ = state
        await blocker.wait()

    jobs._run_job = blocked_run_job  # type: ignore[method-assign]
    job_id, _ = await jobs.submit(
        input_folder=in_folder,
        output_folder=out_folder,
        force=False,
        rename_with_llm=False,
        ocr_language="eng",
        max_concurrent_jobs=1,
        model="dummy",
    )

    raw_queue_state = db.get_setting("__queue_state__")
    assert raw_queue_state is not None and job_id in raw_queue_state

    restored = JobManager(config, db, ollama)

    async def restored_noop(state: object) -> None:
        _ = state
        return

    restored._run_job = restored_noop  # type: ignore[method-assign]
    restored_count = await restored.restore_pending()
    assert restored_count == 1
    snap = restored.snapshot(job_id)
    assert snap is not None and snap.state == "queued"

    blocker.set()
    await jobs.shutdown()
    await restored.shutdown()
    db.close()
    with contextlib.suppress(asyncio.CancelledError):
        await asyncio.sleep(0)
