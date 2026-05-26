import { useEffect, useState } from "react";
import type { UpdateStatus } from "@shared/types";
import { Button } from "./ui/Button";

/**
 * Surfaces auto-update progress. Renders nothing unless the user has opted in
 * AND something interesting is happening (a check is running, an update is
 * being downloaded, an update is ready to install, or the last check errored).
 *
 * When an update has been downloaded, shows a "Restart to install" button
 * that triggers `quitAndInstall()` in the main process.
 */
export function UpdateBanner(): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    const unsubscribe = window.api.updater.onStatus(setStatus);
    return unsubscribe;
  }, []);

  if (!status || !status.enabled) return null;
  if (status.kind === "idle" || status.kind === "not-available") return null;

  const restart = async (): Promise<void> => {
    setRestarting(true);
    try {
      await window.api.updater.quitAndInstall();
    } catch {
      setRestarting(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "flex items-center justify-between gap-3 border-b border-border px-4 py-2 text-sm " +
        (status.kind === "error"
          ? "bg-destructive/15 text-destructive"
          : status.kind === "downloaded"
          ? "bg-emerald-500/15 text-emerald-300"
          : "bg-muted text-foreground")
      }
    >
      <span className="truncate">{renderMessage(status)}</span>
      {status.kind === "downloaded" ? (
        <Button variant="primary" disabled={restarting} onClick={() => void restart()}>
          {restarting ? "Restarting…" : `Restart to install v${status.version ?? ""}`.trim()}
        </Button>
      ) : null}
    </div>
  );
}

function renderMessage(status: UpdateStatus): string {
  switch (status.kind) {
    case "checking":
      return "Checking for updates…";
    case "available":
      return `Downloading update${status.version ? ` v${status.version}` : ""}…`;
    case "downloading": {
      const pct = typeof status.percent === "number" ? `${status.percent}%` : "…";
      return `Downloading update${status.version ? ` v${status.version}` : ""} (${pct})`;
    }
    case "downloaded":
      return `Update${status.version ? ` v${status.version}` : ""} ready to install.`;
    case "error":
      return `Update check failed: ${status.message ?? "unknown error"}`;
    default:
      return "";
  }
}
