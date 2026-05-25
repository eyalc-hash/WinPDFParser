"""Entry point: ``python -m pdf_parser_sidecar``.

Binds to 127.0.0.1 on an ephemeral port (port 0 → OS-assigned) and prints a
single JSON line ``{"port": <int>, "pid": <int>}`` to stdout so the Electron
main process can parse it and start polling /health. All other logging goes to
stderr / log files to keep stdout machine-readable.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys

import uvicorn

from .app import create_app
from .config import Config


def _pick_port() -> int:
    """Reserve an ephemeral port from the OS and return it."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pdf_parser_sidecar")
    parser.add_argument("--port", type=int, default=0, help="Port (0 = ephemeral)")
    parser.add_argument("--dev", action="store_true", help="Enable auto-reload")
    parser.add_argument("--app-data", type=str, default=None, help="Override APPDATA path")
    args = parser.parse_args(argv)

    config = Config.load(app_data_override=args.app_data)
    port = args.port or _pick_port()

    # Machine-readable handshake. Electron's main process reads this line.
    sys.stdout.write(json.dumps({"port": port, "pid": os.getpid()}) + "\n")
    sys.stdout.flush()

    app = create_app(config)
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="info" if args.dev else "warning",
        access_log=args.dev,
    )
    return 0


if __name__ == "__main__":  # pragma: no cover - exec entry point
    raise SystemExit(main())
