# Build and release notes

These notes are for developers building the Windows installer.

## Prerequisites

- Node.js 20.
- Python 3.11.
- Python dependencies for the sidecar, including PyInstaller.
- Visual Studio Build Tools only if a native dependency requires compilation on your machine.

## Build the Windows installer

From the repository root:

```bash
cd sidecar
pyinstaller pyinstaller.spec

cd ../app
npm run dist
```

The installer is emitted to:

```text
app/release/PDF-Parser-Setup-<version>.exe
```

`npm run dist` runs the Electron/Vite build and then `electron-builder --win --x64 --publish never`.
The PyInstaller sidecar must already exist at `sidecar/dist/pdf_parser_sidecar/` so electron-builder
can copy it into the app resources.

## Code signing

Unsigned builds are supported and are the default. To sign release builds, provide the standard
electron-builder environment variables before running `npm run dist`:

```bash
export CSC_LINK="path-or-base64-certificate"
export CSC_KEY_PASSWORD="certificate-password"
```

The Windows config already uses SHA-256 signing when signing credentials are present.
