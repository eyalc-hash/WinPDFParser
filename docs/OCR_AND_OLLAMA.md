# Optional OCR and Ollama setup

PDF-Parser is local-first. These optional tools also run on your computer.

## Real OCR (optional)

Real OCR lets PDF-Parser create searchable output for scanned PDFs. Without it, the app uses a stub
OCR engine that copies the file and extracts text with the built-in fallback path so the rest of the
library and search workflow still works.

You need three tools on Windows: Tesseract OCR, Ghostscript, and OCRmyPDF.

### Install with winget

1. Open **PowerShell** from the Start Menu.
2. Install Tesseract OCR:

   ```powershell
   winget install --id UB-Mannheim.TesseractOCR
   ```

3. Install Ghostscript:

   ```powershell
   winget install --id ArtifexSoftware.GhostScript
   ```

4. Install Python 3.11 or newer if you do not already have it.
5. Install OCRmyPDF:

   ```powershell
   pip install ocrmypdf
   ```

All three tools must be on `PATH`, which means Windows can find them from PowerShell and from the
app.

Check the install with:

```powershell
ocrmypdf --version; tesseract --version; gswin64c --version
```

### Manual installer fallback

If `winget` is not available, download installers manually:

- Tesseract OCR: use the UB Mannheim Windows installer.
- Ghostscript: use the official Ghostscript Windows installer.
- Python 3.11+: download from <https://www.python.org/downloads/windows/> and enable
  **Add python.exe to PATH** during setup.

After installing Python, open PowerShell and run:

```powershell
pip install ocrmypdf
```

## AI rename via Ollama (optional)

AI rename lets PDF-Parser ask a local Ollama model for better filenames. Without Ollama, or when
Ollama is unreachable, rename falls back to the original filename stem.

### Install with winget

1. Open **PowerShell** from the Start Menu.
2. Install Ollama:

   ```powershell
   winget install --id Ollama.Ollama
   ```

3. Start Ollama from the Start Menu if it is not already running.
4. Download a model, for example:

   ```powershell
   ollama pull llama3.2:3b
   ```

   If you chose a different model in PDF-Parser Settings, pull that model instead.

5. Verify that Ollama is running:

   ```powershell
   curl http://127.0.0.1:11434/api/tags
   ```

In PDF-Parser, the **Settings** tab lets you change the Ollama URL and model name. The default URL is
`http://127.0.0.1:11434`.

### Manual download fallback

If `winget` is not available, download Ollama for Windows from <https://ollama.com>, run the
installer, and start Ollama from the Start Menu.

## Troubleshooting

- **Port conflicts:** PDF-Parser chooses an ephemeral local port for its helper, so another app using
  a fixed port should not block startup.
- **Ollama unreachable:** AI rename falls back silently to the original filename stem.
- **OCR missing:** PDF-Parser uses the stub OCR engine so the library workflow can still run.
- **Logs:** App logs live in `%APPDATA%\PDF-Parser\logs\`.
