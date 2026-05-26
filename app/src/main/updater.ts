/**
 * electron-updater wiring.
 *
 * **Opt-in only.** No update checks happen at runtime unless the user has
 * enabled `auto_update` in Settings. When enabled, this module:
 *   1. Performs an immediate `checkForUpdates()` call.
 *   2. Re-checks every `RECHECK_INTERVAL_MS` while the app is running.
 *   3. Downloads any available update in the background.
 *   4. Broadcasts every state change to the renderer over `IPC.UpdaterStatus`,
 *      so the UI can show a banner with a "Restart to install" button that
 *      calls `quitAndInstall()`.
 *
 * Privacy: when `enabled === false`, no `electron-updater` method is invoked
 * and no network request is made — see PRIVACY.md.
 */
import { autoUpdater } from "electron-updater";
import { app, BrowserWindow } from "electron";
import { IPC } from "@shared/ipc";
import type { UpdateStatus } from "@shared/types";

const RECHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let enabled = false;
let configured = false;
let lastStatus: UpdateStatus = { kind: "idle", enabled: false };
let recheckTimer: NodeJS.Timeout | null = null;

function broadcast(next: Partial<UpdateStatus> & { kind: UpdateStatus["kind"] }): void {
  lastStatus = { ...lastStatus, ...next, enabled };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC.UpdaterStatus, lastStatus);
    }
  }
}

function configureOnce(): void {
  if (configured) return;
  configured = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => broadcast({ kind: "checking" }));
  autoUpdater.on("update-available", (info) =>
    broadcast({ kind: "available", version: info?.version }),
  );
  autoUpdater.on("update-not-available", () =>
    broadcast({ kind: "not-available", version: app.getVersion() }),
  );
  autoUpdater.on("download-progress", (progress) =>
    broadcast({
      kind: "downloading",
      percent: typeof progress?.percent === "number" ? Math.round(progress.percent) : 0,
      bytesPerSecond:
        typeof progress?.bytesPerSecond === "number" ? progress.bytesPerSecond : undefined,
    }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    broadcast({ kind: "downloaded", version: info?.version }),
  );
  autoUpdater.on("error", (err) =>
    broadcast({ kind: "error", message: err?.message ?? String(err) }),
  );
}

export function configureAutoUpdater(): void {
  configureOnce();
  broadcast({ ...lastStatus, kind: lastStatus.kind });
}

/**
 * Enable / disable auto-update at runtime. Idempotent. When enabling, performs
 * an immediate check and schedules periodic re-checks. When disabling, cancels
 * the schedule (but does NOT cancel an in-flight download — it will finish and
 * the user can still choose to install it).
 */
export async function setAutoUpdateEnabled(next: boolean): Promise<void> {
  configureOnce();
  enabled = next;
  if (!next) {
    if (recheckTimer) {
      clearInterval(recheckTimer);
      recheckTimer = null;
    }
    broadcast({ ...lastStatus, kind: lastStatus.kind });
    return;
  }
  broadcast({ ...lastStatus, kind: lastStatus.kind });
  await safeCheck();
  if (!recheckTimer) {
    recheckTimer = setInterval(() => {
      void safeCheck();
    }, RECHECK_INTERVAL_MS);
    // Don't keep the event loop alive just for update checks.
    if (typeof recheckTimer.unref === "function") recheckTimer.unref();
  }
}

/** Trigger an immediate check. No-op when disabled. */
export async function checkForUpdatesNow(): Promise<void> {
  if (!enabled) return;
  await safeCheck();
}

/** Restart the app and install the staged update. */
export function quitAndInstall(): void {
  // `isSilent=false, isForceRunAfter=true`: show the installer UI, then relaunch.
  autoUpdater.quitAndInstall(false, true);
}

/** For tests/diagnostics. */
export function getLastUpdateStatus(): UpdateStatus {
  return lastStatus;
}

async function safeCheck(): Promise<void> {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    // Swallow at the network/feed level — surface to the UI as an error state
    // but never crash the app (e.g. offline, bad feed URL, dev build).
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[updater] check failed: ${message}\n`);
    broadcast({ kind: "error", message });
  }
}

/** Back-compat shim retained for callers that haven't migrated yet. */
export async function checkForUpdatesIfEnabled(enabledFlag: boolean): Promise<void> {
  await setAutoUpdateEnabled(enabledFlag);
}

