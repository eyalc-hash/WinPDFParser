"""Tests for the periodic FolderWatcher."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from pdf_parser_sidecar import watcher as watcher_mod
from pdf_parser_sidecar.config import Config
from pdf_parser_sidecar.db import Database
from pdf_parser_sidecar.llm import OllamaClient
from pdf_parser_sidecar.models import SettingsModel
from pdf_parser_sidecar.queue import JobManager
from pdf_parser_sidecar.watcher import FolderWatcher

# Minimal valid PDF — same shape as tests/test_pipeline.py.
_MINIMAL_PDF = (
    b"%PDF-1.1\n"
    b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n"
    b"xref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n"
    b"0000000053 00000 n \n0000000098 00000 n \n"
    b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n150\n%%EOF\n"
)


def _write_pdf(folder: Path, name: str, *, suffix: bytes = b"") -> Path:
    pdf = folder / name
    pdf.write_bytes(_MINIMAL_PDF + suffix)
    # Backdate so it's outside the debounce window by default.
    past = time.time() - 60
    os.utime(pdf, (past, past))
    return pdf


@pytest.fixture
def env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # Make the debounce window short and the batch boundary small for tests.
    monkeypatch.setattr(watcher_mod, "PARTIAL_WRITE_DEBOUNCE_SECONDS", 0.5)
    monkeypatch.setattr(watcher_mod, "BATCH_THRESHOLD", 5)
    monkeypatch.setattr(watcher_mod, "BATCH_SIZE", 5)

    app_data = tmp_path / "appdata"
    config = Config.load(app_data_override=str(app_data))
    db = Database(config.db_path)
    ollama = OllamaClient(base_url="http://127.0.0.1:1")
    jobs = JobManager(config, db, ollama)
    in_folder = tmp_path / "in"
    out_folder = tmp_path / "out"
    in_folder.mkdir()
    out_folder.mkdir()

    settings = SettingsModel(
        input_folder=str(in_folder),
        output_folder=str(out_folder),
        watch_enabled=True,
        watch_interval_seconds=10,
    )

    async def loader() -> SettingsModel:
        return settings

    watcher = FolderWatcher(config=config, db=db, jobs=jobs, settings_loader=loader)
    try:
        yield watcher, jobs, db, in_folder, out_folder, settings
    finally:
        db.close()


@pytest.mark.asyncio
async def test_scan_detects_new_pdfs(env) -> None:
    watcher, jobs, _, in_folder, _, _ = env
    _write_pdf(in_folder, "a.pdf")
    _write_pdf(in_folder, "b.pdf", suffix=b"\n%2")

    detected, job_ids, batch_id, reason = await watcher.scan_now()

    assert detected == 2
    assert len(job_ids) == 1  # below the threshold → single job
    assert batch_id is not None
    assert reason is None

    # And the watcher won't re-enqueue the same paths on the next tick.
    detected2, job_ids2, _, _ = await watcher.scan_now()
    assert detected2 == 0
    assert job_ids2 == []


@pytest.mark.asyncio
async def test_scan_respects_debounce_window(env) -> None:
    watcher, _, _, in_folder, _, _ = env
    pdf = in_folder / "fresh.pdf"
    pdf.write_bytes(_MINIMAL_PDF)  # no backdating → mtime is "now"

    detected, job_ids, _, _ = await watcher.scan_now()
    assert detected == 0
    assert job_ids == []


@pytest.mark.asyncio
async def test_scan_respects_disabled_flag(env) -> None:
    watcher, _, _, in_folder, _, settings = env
    _write_pdf(in_folder, "a.pdf")
    settings.watch_enabled = False

    detected, job_ids, _, reason = await watcher.scan_now()
    assert detected == 0
    assert job_ids == []
    assert reason == "watch disabled"


@pytest.mark.asyncio
async def test_scan_skips_files_currently_in_jobs(env) -> None:
    watcher, jobs, _, in_folder, out_folder, _ = env
    pdf = _write_pdf(in_folder, "a.pdf")

    # Pre-enqueue the file via a manual submit; the watcher must skip it.
    await jobs.submit(
        input_folder=in_folder,
        output_folder=out_folder,
        force=False,
        rename_with_llm=False,
        ocr_language="eng",
        max_concurrent_jobs=1,
        model="dummy",
        files_override=[pdf],
        trigger="manual",
    )

    detected, job_ids, _, _ = await watcher.scan_now()
    assert detected == 0
    assert job_ids == []


@pytest.mark.asyncio
async def test_scan_splits_large_drops_into_batches(env) -> None:
    watcher, jobs, _, in_folder, _, _ = env
    # 12 files with BATCH_SIZE=5 → 3 jobs (5, 5, 2) sharing batch_id.
    for i in range(12):
        _write_pdf(in_folder, f"f{i:02d}.pdf", suffix=str(i).encode())

    detected, job_ids, batch_id, _ = await watcher.scan_now()
    assert detected == 12
    assert len(job_ids) == 3
    assert batch_id is not None

    snapshots = [jobs.snapshot(jid) for jid in job_ids]
    assert all(s is not None for s in snapshots)
    assert {s.batch_id for s in snapshots} == {batch_id}
    assert all(s.trigger == "watch" for s in snapshots)
    totals = sorted(s.total for s in snapshots)
    assert totals == [2, 5, 5]


@pytest.mark.asyncio
async def test_scan_reports_missing_input_folder(env) -> None:
    watcher, _, _, in_folder, _, settings = env
    settings.input_folder = str(in_folder / "does-not-exist")

    detected, job_ids, _, reason = await watcher.scan_now()
    assert detected == 0
    assert job_ids == []
    assert reason and "does not exist" in reason.lower()


@pytest.mark.asyncio
async def test_status_reflects_last_scan(env) -> None:
    watcher, _, _, in_folder, _, _ = env
    _write_pdf(in_folder, "a.pdf")
    await watcher.scan_now()
    status = watcher.status()
    assert status.enabled is True
    assert status.last_scan_at is not None
    assert status.last_scan_new_files == 1
    assert status.input_folder == str(in_folder)
