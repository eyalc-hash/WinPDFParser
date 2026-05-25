# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2025-XX-XX

### Added

- Initial local-first Electron, React, and TypeScript desktop app scaffold for Windows.
- Python FastAPI sidecar handshake on `127.0.0.1` with an ephemeral port selected by the app.
- Folder-based processing vertical slice from input/output selection through sidecar work and UI list.
- SQLite database with FTS5 search stored under `%APPDATA%/PDF-Parser/`.
- Library and Settings screens for managing processed PDFs and local integration settings.
- NSIS installer configuration for a Windows x64 installer.
- `electron-updater` wiring, disabled by default at runtime.
- Stub OCR behavior when OCRmyPDF, Tesseract, or Ghostscript are unavailable.
- Local Ollama rename integration with fallback to the original filename stem when Ollama is unreachable.

### Known limitations

- Windows installer builds are unsigned by default, so SmartScreen may warn during install.
- Real OCR requires OCRmyPDF, Tesseract, and Ghostscript to be installed separately and available on `PATH`.
- AI rename requires a local Ollama service and model; without it, filenames fall back locally.
- Auto-update support is present in the codebase but intentionally disabled unless explicitly enabled later.
