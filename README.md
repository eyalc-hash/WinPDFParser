# WinPDFParser (PDF-Parser)

A **local-first Windows desktop app** that OCRs PDFs, AI-renames them with a local
LLM, and provides full-text search — all without ever touching the network.

> **Status:** v0.1 scaffolding. The vertical slice (folder pickers → sidecar → SQLite
> → UI list) is in place; OCR uses a stub when OCRmyPDF/Tesseract are not present,
> and renaming gracefully falls back to the original stem when Ollama is unreachable.

## Hard guarantees

- 100% local processing. No cloud calls. No login. No telemetry.
- Originals are **never modified** — outputs go to a separate folder.
- Processed files are prefixed with `ocr_`.
- Duplicate PDFs (by SHA-256 content hash) are skipped unless `force` is set.

## Architecture

| Layer            | Tech                                                            |
| ---------------- | --------------------------------------------------------------- |
| Shell            | Electron + TypeScript                                           |
| UI (renderer)    | React + Vite + Tailwind CSS + shadcn-style components (dark)    |
| Main process     | Node.js / TypeScript — filesystem, spawns sidecar, IPC          |
| Heavy lifting    | Python sidecar — FastAPI on `127.0.0.1:<ephemeral port>`        |
| Database + search| SQLite + FTS5 in `%APPDATA%/PDF-Parser/`                        |
| Packaging        | electron-builder + NSIS (x64), PyInstaller (one-folder)         |
| Auto-update      | electron-updater wired up, **disabled by default**              |

The renderer runs with `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, and only talks to the sidecar through the typed `window.api`
surface exposed by `preload`.

## Repo layout

```
.
├── app/                     # Electron + React + TypeScript
│   ├── src/main/            # Electron main process (sidecar lifecycle, IPC)
│   ├── src/preload/         # Context-isolated bridge
│   ├── src/renderer/        # React UI
│   └── src/shared/          # Types shared with the sidecar contract
├── sidecar/                 # Python FastAPI sidecar
│   ├── pdf_parser_sidecar/  # Package source
│   └── tests/               # pytest suite
├── .github/workflows/       # CI: lint + tests on Windows
└── PRIVACY.md
```

## Development setup

### Prerequisites
- Node.js ≥ 20 (`node --version`)
- Python ≥ 3.11 (`python --version`)
- (Optional) [Ollama](https://ollama.com) running on `127.0.0.1:11434` for AI rename
- (Optional) OCRmyPDF + Tesseract + Ghostscript on `PATH` for real OCR
  - Without these, the sidecar uses a stub OCR engine that copies the file and
    extracts text via `pypdf` so the rest of the pipeline can be exercised.

### First-time install

```bash
# Node side
npm install

# Python side
cd sidecar
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -e ".[dev]"
```

### Run the dev loop

```bash
# Terminal 1 — sidecar (auto-reload on save)
cd sidecar && python -m pdf_parser_sidecar --dev

# Terminal 2 — Electron + Vite renderer
cd app && npm run dev
```

In production, Electron spawns the bundled PyInstaller sidecar automatically; the
two-terminal workflow above is dev-only.

### Lint, typecheck, test

```bash
# Node
npm run lint
npm run typecheck
npm run test

# Python
cd sidecar
ruff check .
black --check .
mypy pdf_parser_sidecar
pytest
```

### Build the Windows installer

```bash
# 1. Bundle the sidecar with PyInstaller (one-folder)
cd sidecar && pyinstaller pyinstaller.spec

# 2. Build the Electron app + NSIS installer
cd ../app && npm run build && npm run dist
```

The installer is emitted to `app/release/PDF-Parser-Setup-<version>.exe`.

## Privacy

See [PRIVACY.md](./PRIVACY.md). Short version: nothing leaves the machine. The
only outbound network requests are to `127.0.0.1` (the sidecar and, optionally,
Ollama). `electron-updater` is wired up but disabled by default and makes no
calls at runtime unless the user opts in.

## License

TBD.
