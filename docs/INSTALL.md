# Install PDF-Parser on Windows

This guide is for Windows users who want the normal installer. You do not need to use a terminal.

## Quick start

1. Open the latest release page: <https://github.com/eyalc-hash/WinPDFParser/releases/latest>.
2. Download `PDF-Parser-Setup-<version>.exe`.
3. Double-click the downloaded file.
4. If Windows SmartScreen appears, choose **More info** → **Run anyway**.
5. Follow the installer, then open **PDF-Parser** from the desktop or Start Menu.

## Download the installer

1. Go to <https://github.com/eyalc-hash/WinPDFParser/releases/latest>.
2. Find **Assets** on the release page.
3. Click the file named `PDF-Parser-Setup-<version>.exe`.
4. Save it somewhere easy to find, such as **Downloads**.

> Tip: In most browsers, the Downloads button looks like a downward arrow near the top-right corner.

## Run the installer

1. Open **File Explorer**.
2. Go to **Downloads**.
3. Double-click `PDF-Parser-Setup-<version>.exe`.

Because this installer is unsigned by default, Windows may show a SmartScreen warning.

1. Click **More info**.
2. Click **Run anyway**.

> Tip: SmartScreen is Windows asking you to confirm that you trust a new app. This can happen for
> unsigned open-source apps even when the download is expected.

## Choose install options

The installer is a normal Windows setup wizard.

- It installs for your Windows user by default, not for every user on the computer.
- If the installer offers a machine-wide option, choose it only if you manage this PC and have
  administrator permission.
- You can change the install folder when the installer asks.
- The default folder is in your Windows user profile, similar to
  `%LOCALAPPDATA%\Programs\PDF-Parser`.
- The installer creates a desktop shortcut and a Start Menu shortcut.

> Tip: If you are not sure what to pick, keep the defaults and click **Next**.

## First launch

1. Double-click the **PDF-Parser** desktop icon, or open **Start** and search for **PDF-Parser**.
2. On first launch, the app starts its local helper in the background.
3. Choose your PDF input folder and output folder in the app.
4. Processed files are written to the output folder. Originals are not modified.

The app stores its library database, settings, and logs under:

```text
%APPDATA%\PDF-Parser\
```

## Optional pieces

PDF-Parser works without optional tools, but real OCR and AI rename need extra local apps.
See [OCR and Ollama setup](./OCR_AND_OLLAMA.md) for friendly instructions.

## Uninstall

1. Open **Settings**.
2. Go to **Apps** → **Apps & features**.
3. Find **PDF-Parser**.
4. Choose **Uninstall** and follow the prompts.

The uninstaller leaves your app data in place so you do not lose the library database or logs.

## Fully remove leftover data

Only do this if you are sure you no longer need the app data.

1. Press **Windows key + R**.
2. Type `%APPDATA%` and press **Enter**.
3. Delete the folder named **PDF-Parser**.

> Tip: This removes PDF-Parser settings, logs, and the local library database. It does not delete
> your original PDF folders.
