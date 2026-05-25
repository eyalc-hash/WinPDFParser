# PDF-Parser sidecar

Python FastAPI service that performs OCR, dedupe, AI rename (via Ollama) and
full-text search for the Electron shell. See the top-level
[README](../README.md) for the bigger picture.

Run locally:

```bash
python -m venv .venv && source .venv/bin/activate  # or .venv\Scripts\activate
pip install -e ".[dev]"
python -m pdf_parser_sidecar --dev
```

Tests:

```bash
pytest
```
