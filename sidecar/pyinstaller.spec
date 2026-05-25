# PyInstaller spec — one-folder bundle of the sidecar.
# Build with:    pyinstaller pyinstaller.spec
# Output goes to ./dist/pdf_parser_sidecar/ and is consumed by electron-builder
# via app/electron-builder.yml -> extraResources.

# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None

hiddenimports = [
    *collect_submodules("uvicorn"),
    *collect_submodules("fastapi"),
    *collect_submodules("pydantic"),
    "pdf_parser_sidecar",
]

datas = collect_data_files("pdf_parser_sidecar", includes=["migrations/*.sql"])

a = Analysis(
    ["pdf_parser_sidecar/__main__.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter"],
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="pdf_parser_sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,  # Required so Electron can capture stdout for the port handshake.
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="pdf_parser_sidecar",
)
