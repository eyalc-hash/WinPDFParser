"""Runtime configuration: where to put the DB, logs, default model, etc."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _default_app_data() -> Path:
    """Return the per-user app-data directory.

    On Windows we honour %APPDATA% (Roaming). On other OSes we fall back to
    ``~/.local/share/PDF-Parser`` so the code path can be exercised in CI/dev
    on macOS and Linux even though we don't ship those platforms.
    """
    if os.name == "nt":
        base_env = os.environ.get("APPDATA")
        base = Path(base_env) if base_env else Path.home() / "AppData" / "Roaming"
        return base / "PDF-Parser"
    xdg = os.environ.get("XDG_DATA_HOME")
    base = Path(xdg) if xdg else Path.home() / ".local" / "share"
    return base / "PDF-Parser"


@dataclass(frozen=True)
class Config:
    app_data: Path
    db_path: Path
    logs_dir: Path
    ollama_url: str = "http://127.0.0.1:11434"
    default_model: str = "llama3.2:3b"
    max_concurrent_jobs: int = 1

    @classmethod
    def load(cls, app_data_override: str | None = None) -> Config:
        root = Path(app_data_override) if app_data_override else _default_app_data()
        root.mkdir(parents=True, exist_ok=True)
        logs = root / "logs"
        logs.mkdir(parents=True, exist_ok=True)
        return cls(app_data=root, db_path=root / "app.db", logs_dir=logs)
