"""Periodic folder monitor that auto-enqueues new PDFs as they appear.

The watcher is owned by the sidecar (not the renderer) so monitoring keeps
running whether or not the Electron window is focused or even open. It uses a
simple ``asyncio.sleep`` loop rather than a native filesystem-event binding so
we don't pull in a new PyInstaller dependency.

For very large drops the watcher splits the new files into smart batches so
the user gets finer-grained progress and can cancel individual chunks.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .config import Config
from .db import Database
from .models import SettingsModel
from .queue import JobManager, list_pdfs

logger = logging.getLogger(__name__)

# Tunables. Kept module-level so tests can monkey-patch them cheaply.
BATCH_THRESHOLD = 25
BATCH_SIZE = 25
# Files whose mtime is newer than this are assumed to still be copying.
PARTIAL_WRITE_DEBOUNCE_SECONDS = 5.0


@dataclass
class WatcherStatus:
    enabled: bool = False
    interval_seconds: int = 60
    input_folder: str | None = None
    output_folder: str | None = None
    last_scan_at: datetime | None = None
    last_scan_new_files: int = 0
    last_scan_error: str | None = None
    next_scan_at: datetime | None = None
    last_batch_id: str | None = None
    active_batch_ids: list[str] = field(default_factory=list)
    active_jobs: int = 0


SettingsLoader = Callable[[], Awaitable[SettingsModel]]


class FolderWatcher:
    """Async polling watcher for the configured input folder."""

    def __init__(
        self,
        config: Config,
        db: Database,
        jobs: JobManager,
        settings_loader: SettingsLoader,
    ) -> None:
        self._config = config
        self._db = db
        self._jobs = jobs
        self._load_settings = settings_loader
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()
        self._wake = asyncio.Event()
        self._scan_lock = asyncio.Lock()
        self._seen_paths: set[str] = set()
        self._status = WatcherStatus()

    # -- lifecycle ----------------------------------------------------------

    async def start(self) -> None:
        if self._task is not None:
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="folder-watcher")

    async def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task
            self._task = None

    # -- status -------------------------------------------------------------

    def status(self) -> WatcherStatus:
        # Surface "currently active" batches so the UI can show them even
        # after individual jobs in the batch finish.
        active = {
            j.batch_id
            for j in self._jobs.list_active()
            if j.batch_id and j.state in ("queued", "running")
        }
        self._status.active_batch_ids = sorted(active)
        self._status.active_jobs = sum(
            1 for j in self._jobs.list_active() if j.state in ("queued", "running")
        )
        return self._status

    # -- manual trigger -----------------------------------------------------

    async def scan_now(self) -> tuple[int, list[str], str | None, str | None]:
        """Run an immediate scan tick and return (detected, job_ids, batch_id, reason)."""
        return await self._scan_once()

    # -- internals ----------------------------------------------------------

    async def _run(self) -> None:
        # Kick once on startup so PDFs dropped while the app was closed get
        # picked up promptly.
        try:
            await self._scan_once()
        except Exception:  # noqa: BLE001
            logger.exception("initial folder scan failed")

        while not self._stop.is_set():
            settings = await self._safe_load_settings()
            interval = max(10, int(getattr(settings, "watch_interval_seconds", 60) or 60))
            self._status.interval_seconds = interval
            self._status.next_scan_at = datetime.now(UTC) + timedelta(seconds=interval)
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=interval)
            self._wake.clear()
            if self._stop.is_set():
                break
            try:
                await self._scan_once()
            except Exception:  # noqa: BLE001
                logger.exception("folder scan failed")

    async def _safe_load_settings(self) -> SettingsModel:
        try:
            return await self._load_settings()
        except Exception:  # noqa: BLE001
            logger.exception("failed to load settings; falling back to defaults")
            return SettingsModel(
                ollama_url=self._config.ollama_url,
                model=self._config.default_model,
                max_concurrent_jobs=self._config.max_concurrent_jobs,
            )

    async def _scan_once(self) -> tuple[int, list[str], str | None, str | None]:
        async with self._scan_lock:
            settings = await self._safe_load_settings()
            self._status.enabled = bool(settings.watch_enabled)
            self._status.input_folder = settings.input_folder
            self._status.output_folder = settings.output_folder
            self._status.last_scan_at = datetime.now(UTC)
            self._status.last_scan_error = None

            if not settings.watch_enabled:
                self._status.last_scan_new_files = 0
                return 0, [], None, "watch disabled"
            if not settings.input_folder or not settings.output_folder:
                self._status.last_scan_new_files = 0
                return 0, [], None, "input or output folder not configured"

            input_folder = Path(settings.input_folder)
            try:
                discovered = list_pdfs(input_folder)
            except (FileNotFoundError, ValueError) as exc:
                self._status.last_scan_error = str(exc)
                self._status.last_scan_new_files = 0
                return 0, [], None, str(exc)

            now = time.time()
            new_files: list[Path] = []
            known_in_jobs = self._jobs.known_paths()

            for pdf in discovered:
                resolved = str(pdf.resolve(strict=False))
                if resolved in self._seen_paths or resolved in known_in_jobs:
                    continue
                try:
                    mtime = pdf.stat().st_mtime
                except OSError:
                    continue
                # Debounce partial writes: file is probably still being copied.
                if (now - mtime) < PARTIAL_WRITE_DEBOUNCE_SECONDS:
                    continue
                # The DB layer also stores documents by content hash; the
                # per-file SHA-256 check inside the job pipeline is the
                # authoritative dedupe. Here we just avoid resubmitting paths
                # we already know about.
                new_files.append(pdf)

            if not new_files:
                self._status.last_scan_new_files = 0
                return 0, [], None, None

            batch_id = uuid.uuid4().hex[:12]
            job_ids: list[str] = []
            model = self._db.get_setting("model") or self._config.default_model

            chunks: list[list[Path]]
            if len(new_files) > BATCH_THRESHOLD:
                chunks = [
                    new_files[i : i + BATCH_SIZE] for i in range(0, len(new_files), BATCH_SIZE)
                ]
            else:
                chunks = [new_files]

            for chunk in chunks:
                try:
                    job_id, _ = await self._jobs.submit(
                        input_folder=input_folder,
                        output_folder=Path(settings.output_folder),
                        force=False,
                        rename_with_llm=settings.rename_with_llm,
                        ocr_language=settings.ocr_language,
                        max_concurrent_jobs=settings.max_concurrent_jobs,
                        model=model,
                        trigger="watch",
                        batch_id=batch_id,
                        files_override=chunk,
                    )
                except (FileNotFoundError, ValueError) as exc:
                    self._status.last_scan_error = str(exc)
                    logger.warning("watcher submit failed: %s", exc)
                    break
                job_ids.append(job_id)
                for pdf in chunk:
                    self._seen_paths.add(str(pdf.resolve(strict=False)))

            self._status.last_scan_new_files = len(new_files)
            self._status.last_batch_id = batch_id if job_ids else None
            return len(new_files), job_ids, batch_id if job_ids else None, None


def settings_loader_from_db(db: Database, defaults: SettingsModel) -> SettingsLoader:
    """Build a coroutine that returns the persisted settings, falling back to defaults."""

    async def _load() -> SettingsModel:
        raw = db.get_setting("__all__")
        if raw:
            try:
                payload = json.loads(raw)
            except (ValueError, TypeError):
                payload = None
            if isinstance(payload, dict):
                try:
                    return SettingsModel(**payload)
                except Exception:  # noqa: BLE001
                    pass
        return defaults

    return _load


__all__ = [
    "FolderWatcher",
    "WatcherStatus",
    "settings_loader_from_db",
    "BATCH_SIZE",
    "BATCH_THRESHOLD",
    "PARTIAL_WRITE_DEBOUNCE_SECONDS",
]
