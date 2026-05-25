/**
 * electron-updater wiring — INTENTIONALLY DISABLED BY DEFAULT.
 *
 * No update checks are performed at runtime unless `enableAutoUpdate()` is
 * called, which only happens when the user opts in via Settings.
 */
import { autoUpdater } from "electron-updater";

export function configureAutoUpdater(): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  // No call to checkForUpdates() here — see file header.
}

export async function checkForUpdatesIfEnabled(enabled: boolean): Promise<void> {
  if (!enabled) return;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    // Swallow: a missing feed URL or offline machine should not crash the app.
    process.stderr.write(`[updater] check skipped: ${String(err)}\n`);
  }
}
