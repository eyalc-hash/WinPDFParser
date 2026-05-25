# Privacy

PDF-Parser is a **local-first** application. We designed it so that your PDFs,
their contents, and any metadata derived from them **never leave your machine**.

## What we do

- Read PDFs you explicitly select from an **input folder** of your choosing.
- Write OCR'd copies (prefixed `ocr_`) to an **output folder** of your choosing.
- Store metadata (file path, SHA-256 hash, extracted text, AI-generated name) in
  a SQLite database at `%APPDATA%/PDF-Parser/app.db`.
- Talk to a Python sidecar process bound to `127.0.0.1` on an ephemeral port.
- Optionally talk to a locally running [Ollama](https://ollama.com) server on
  `127.0.0.1:11434` to generate human-readable filenames.

## What we never do

- Send your documents, their text, or any derived metadata to any remote server.
- Phone home with telemetry, crash reports, or analytics.
- Require a login, account, or API key.
- Modify the original PDFs in your input folder.

## Auto-update

The app ships with `electron-updater` wired up but **disabled by default**. No
update checks are performed unless you explicitly opt in via the Settings panel.

## Logs

The sidecar writes structured logs to `%APPDATA%/PDF-Parser/logs/sidecar.log`
(rotated). These logs stay on disk and are never transmitted anywhere. You can
open the folder at any time from **Settings → Open app data folder**.

## Removing your data

To wipe everything:
1. Quit PDF-Parser.
2. Delete `%APPDATA%/PDF-Parser/`.
3. Delete any OCR'd output files you no longer want.

Originals in the input folder are untouched by the app and can be deleted at any
time.
