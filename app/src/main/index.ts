/**
 * Electron main process entry point.
 *
 * Lifecycle:
 *   app.whenReady -> start sidecar -> create BrowserWindow
 *   before-quit / window-all-closed / uncaughtException -> kill sidecar
 */
import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { SidecarManager } from "./sidecar";
import { registerIpcHandlers } from "./ipc";
import { configureAutoUpdater } from "./updater";

const sidecar = new SidecarManager();
let mainWindow: BrowserWindow | null = null;
let isShuttingDown = false;

async function shutdown(reason: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  process.stderr.write(`[main] shutting down (${reason})\n`);
  await sidecar.kill();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#0b0b0f",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());

  // electron-vite injects ELECTRON_RENDERER_URL during dev.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Disallow new-window / external navigation — defence in depth.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (devUrl && url.startsWith(devUrl)) return;
    event.preventDefault();
  });
}

async function bootstrap(): Promise<void> {
  configureAutoUpdater();
  try {
    await sidecar.start();
  } catch (err) {
    process.stderr.write(`[main] sidecar failed to start: ${String(err)}\n`);
    // Still open the window so the user sees an error rather than a black screen.
  }
  registerIpcHandlers(sidecar);
  createWindow();
}

app.whenReady().then(bootstrap).catch((err) => {
  process.stderr.write(`[main] bootstrap error: ${String(err)}\n`);
});

app.on("window-all-closed", () => {
  void shutdown("window-all-closed").finally(() => {
    if (process.platform !== "darwin") app.quit();
  });
});

app.on("before-quit", () => {
  void shutdown("before-quit");
});

process.on("uncaughtException", (err) => {
  process.stderr.write(`[main] uncaught: ${err.stack ?? String(err)}\n`);
  void shutdown("uncaughtException").finally(() => app.exit(1));
});

process.on("SIGINT", () => void shutdown("SIGINT").finally(() => app.exit(0)));
process.on("SIGTERM", () => void shutdown("SIGTERM").finally(() => app.exit(0)));
