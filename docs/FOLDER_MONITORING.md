# Background folder monitoring

The PDF-Parser sidecar periodically rescans the **Input folder** while the app
is running and auto-enqueues any PDFs you drop into it. All work happens
locally — the watcher uses the same OCR + (optional) AI-rename pipeline as the
manual **Run OCR** button.

## How it works

- The watcher is owned by the Python sidecar, so monitoring keeps running
  whether the window is focused or not. There is no native filesystem-event
  binding — we use a simple periodic poll for portability and predictability.
- Every tick the watcher enumerates `*.pdf` recursively under the configured
  input folder and submits any **new** paths to the existing job queue.
- Files are deduplicated three ways:
  1. Paths already tracked by an in-flight job are skipped.
  2. Paths the watcher already submitted in this session are remembered.
  3. The job pipeline still hashes each file with SHA-256 and skips
     previously-indexed content (the authoritative dedupe).

## Settings

Open **Settings → Folder monitoring**:

| Setting             | Default | Range      | Notes                                       |
| ------------------- | ------- | ---------- | ------------------------------------------- |
| Watch the folder    | on      | on / off   | Pausable at any time from the banner too.   |
| Scan interval (sec) | 60      | 10 – 3600  | Lower = sooner detection, slightly more CPU |

The banner that appears below the top bar shows progress for any
watcher-triggered work and lets you trigger an immediate **Scan now** or pause
monitoring without opening Settings.

## Smart batching

When a large drop is detected (currently more than 25 files), the watcher
splits the new files into chunks of up to 25 and submits each chunk as its
own job. All chunks share a `batch_id` so the UI groups them together. The
benefits:

- Finer-grained progress: you see "17 / 42 indexed" updating live.
- Cancellation works per chunk; a failing chunk doesn't poison the rest.
- The existing `max_concurrent_jobs` setting still bounds CPU/RAM usage.

## Partial-write debounce

A file whose `mtime` is newer than 5 seconds is assumed to still be copying
and is skipped on the current tick — it gets picked up on the next one. This
avoids OCR'ing half-written PDFs from large file copies.

## Behavior at startup

On sidecar start, the watcher runs an immediate scan so any PDFs you dropped
into the folder while the app was closed get indexed right away.

## Privacy

Like the rest of PDF-Parser, the watcher makes **no** network requests. The
only outbound traffic is to `127.0.0.1` (the sidecar itself and, optionally,
your local Ollama instance).
