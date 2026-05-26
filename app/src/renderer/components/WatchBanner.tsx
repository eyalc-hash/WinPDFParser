import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  JobFileEntry,
  JobFileState,
  JobProgress,
  WatchStatusResponse,
} from "@shared/types";
import { Button } from "./ui/Button";

const POLL_STATUS_MS = 5000;
const POLL_JOBS_MS = 750;
const PER_BATCH_FILE_LIMIT = 200;

interface Props {
  onJobFinished: () => void;
}

interface BatchView {
  batchId: string;
  jobs: JobProgress[];
  total: number;
  processed: number;
  skipped: number;
  failed: number;
  active: boolean;
}

/**
 * Surfaces the periodic folder-monitor's state to the user.
 *
 * Collapsed: one-line summary ("Monitoring X · N new PDFs detected · …").
 * Expanded: per-batch breakdown with a real-time list of files showing their
 * individual state badges (queued / processing / done / skipped / failed).
 *
 * Hidden entirely when monitoring is disabled and there is nothing to report.
 */
export function WatchBanner({ onJobFinished }: Props): JSX.Element | null {
  const [status, setStatus] = useState<WatchStatusResponse | null>(null);
  const [watchJobs, setWatchJobs] = useState<JobProgress[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [tickTrigger, setTickTrigger] = useState(0); // ticks "next scan in Ns"
  const [error, setError] = useState<string | null>(null);
  const finishedJobsRef = useRef<Set<string>>(new Set());

  // Poll /watch/status on the slow cadence.
  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const s = await window.api.sidecar.watchStatus();
        if (!cancelled) {
          setStatus(s);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), POLL_STATUS_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  // Poll /jobs on the fast cadence to track watch-triggered jobs.
  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const list = await window.api.sidecar.listJobs();
        if (cancelled) return;
        const watch = list.items.filter((j) => j.trigger === "watch");
        setWatchJobs(watch);
        // Notify the rest of the UI when a watch job transitions to a terminal
        // state, so the Library tab refreshes.
        for (const j of watch) {
          if (
            (j.state === "done" || j.state === "failed" || j.state === "cancelled") &&
            !finishedJobsRef.current.has(j.job_id)
          ) {
            finishedJobsRef.current.add(j.job_id);
            onJobFinished();
          }
        }
      } catch {
        /* transient — swallow */
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), POLL_JOBS_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [onJobFinished]);

  // Local 1Hz tick so "next scan in N seconds" actually counts down.
  useEffect(() => {
    const t = window.setInterval(() => setTickTrigger((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const scanNow = useCallback(async (): Promise<void> => {
    setScanning(true);
    setError(null);
    try {
      await window.api.sidecar.watchScanNow();
      const s = await window.api.sidecar.watchStatus();
      setStatus(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
    }
  }, []);

  const togglePause = useCallback(async (): Promise<void> => {
    if (!status) return;
    setPausing(true);
    setError(null);
    try {
      const current = await window.api.sidecar.getSettings();
      await window.api.sidecar.putSettings({
        ...current,
        watch_enabled: !status.enabled,
      });
      const s = await window.api.sidecar.watchStatus();
      setStatus(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPausing(false);
    }
  }, [status]);

  const batches = useMemo<BatchView[]>(() => {
    const byId = new Map<string, JobProgress[]>();
    for (const j of watchJobs) {
      const id = j.batch_id ?? j.job_id;
      const list = byId.get(id) ?? [];
      list.push(j);
      byId.set(id, list);
    }
    const views: BatchView[] = [];
    for (const [batchId, jobs] of byId.entries()) {
      let total = 0;
      let processed = 0;
      let skipped = 0;
      let failed = 0;
      let active = false;
      for (const j of jobs) {
        total += j.total;
        processed += j.processed;
        skipped += j.skipped;
        failed += j.failed;
        if (j.state === "queued" || j.state === "running") active = true;
      }
      views.push({ batchId, jobs, total, processed, skipped, failed, active });
    }
    // Active batches first, then most-recent (by max started_at) first.
    views.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const ax = Math.max(...a.jobs.map((j) => Date.parse(j.started_at ?? "") || 0));
      const bx = Math.max(...b.jobs.map((j) => Date.parse(j.started_at ?? "") || 0));
      return bx - ax;
    });
    return views;
  }, [watchJobs]);

  const summary = useMemo(() => {
    if (!status) return null;
    const aggregateTotal = batches.reduce((sum, b) => sum + b.total, 0);
    const aggregateDone = batches.reduce((sum, b) => sum + b.processed + b.skipped, 0);
    const aggregateFailed = batches.reduce((sum, b) => sum + b.failed, 0);
    const newDetected = aggregateTotal || status.last_scan_new_files;
    const nextScanMs = status.next_scan_at ? Date.parse(status.next_scan_at) : null;
    let nextLabel: string | null = null;
    if (nextScanMs !== null && Number.isFinite(nextScanMs)) {
      const delta = Math.max(0, Math.round((nextScanMs - Date.now()) / 1000));
      nextLabel = `next scan in ${delta}s`;
    }
    return { aggregateTotal, aggregateDone, aggregateFailed, newDetected, nextLabel };
    // tickTrigger is intentionally included so the "next scan in Ns" label
    // recomputes once per second even though it isn't read directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, status, tickTrigger]);

  if (!status) return null;
  const anyActivity = batches.some((b) => b.active) || status.last_scan_new_files > 0;
  if (!status.enabled && !anyActivity) {
    // Nothing to show: monitoring off and no recent scan results.
    return null;
  }

  const folderLabel = status.input_folder ? shortenPath(status.input_folder) : "(no folder)";

  return (
    <section
      role="status"
      aria-live="polite"
      aria-label="Folder monitoring"
      className="border-b border-border bg-card/60 px-4 py-2 text-xs"
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 rounded-md px-1 py-0.5 text-foreground hover:bg-muted/50"
          aria-expanded={expanded}
        >
          <span aria-hidden className="inline-block w-3 text-muted-foreground">
            {expanded ? "▾" : "▸"}
          </span>
          <span className="font-medium">
            {status.enabled ? "Monitoring" : "Monitoring paused"}
          </span>
          <code className="max-w-[28ch] truncate text-muted-foreground" title={status.input_folder ?? ""}>
            {folderLabel}
          </code>
        </button>

        {summary ? (
          <span className="text-muted-foreground">
            {summary.newDetected > 0 ? (
              <>
                {summary.newDetected} new PDF{summary.newDetected === 1 ? "" : "s"} detected ·{" "}
                {summary.aggregateDone} / {summary.aggregateTotal} indexed
                {summary.aggregateFailed > 0 ? ` · ${summary.aggregateFailed} failed` : null}
              </>
            ) : (
              <>up to date</>
            )}
            {summary.nextLabel && status.enabled ? ` · ${summary.nextLabel}` : null}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            disabled={scanning || !status.enabled}
            onClick={() => void scanNow()}
          >
            {scanning ? "Scanning…" : "Scan now"}
          </Button>
          <Button variant="ghost" disabled={pausing} onClick={() => void togglePause()}>
            {status.enabled ? "Pause monitoring" : "Resume monitoring"}
          </Button>
        </div>
      </div>

      {status.last_scan_error ? (
        <p className="mt-1 text-destructive">Last scan error: {status.last_scan_error}</p>
      ) : null}
      {error ? <p className="mt-1 text-destructive">{error}</p> : null}

      {expanded ? (
        <div className="mt-2 flex flex-col gap-2">
          {batches.length === 0 ? (
            <p className="text-muted-foreground">No watch jobs in flight.</p>
          ) : (
            batches.map((b, idx) => (
              <BatchPanel
                key={b.batchId}
                index={idx + 1}
                batch={b}
                onJobFinished={onJobFinished}
              />
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}

function BatchPanel({
  index,
  batch,
  onJobFinished,
}: {
  index: number;
  batch: BatchView;
  onJobFinished: () => void;
}): JSX.Element {
  const [files, setFiles] = useState<JobFileEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  // Fetch files for each job in the batch, but only when expanded.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const results = await Promise.all(
          batch.jobs.map((j) =>
            window.api.sidecar.getJob(j.job_id, {
              includeFiles: true,
              filesOffset: 0,
              filesLimit: PER_BATCH_FILE_LIMIT,
            }),
          ),
        );
        if (cancelled) return;
        const merged: JobFileEntry[] = [];
        for (const j of results) {
          if (j.files) merged.push(...j.files);
        }
        setFiles(merged);
      } catch {
        /* transient */
      }
    };
    void tick();
    const t = window.setInterval(() => void tick(), POLL_JOBS_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [open, batch.jobs]);

  const retry = useCallback(
    async (documentId: number): Promise<void> => {
      setRetryingId(documentId);
      try {
        await window.api.sidecar.retryDocument(documentId);
        onJobFinished();
      } catch {
        /* surfaced elsewhere */
      } finally {
        setRetryingId(null);
      }
    },
    [onJobFinished],
  );

  return (
    <div className="rounded-md border border-border bg-background/40 p-2">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="font-medium">
          Batch {index} {batch.active ? <em className="not-italic text-amber-300">· running</em> : null}
        </span>
        <span className="text-muted-foreground">
          {batch.processed} done · {batch.skipped} skipped · {batch.failed} failed · {batch.total} total
        </span>
      </button>
      {open ? (
        <ul className="mt-2 max-h-64 divide-y divide-border overflow-auto rounded-md border border-border bg-card/40">
          {files.length === 0 ? (
            <li className="px-2 py-1 text-muted-foreground">Loading file list…</li>
          ) : (
            files.map((f) => (
              <li
                key={f.path}
                className="flex items-center justify-between gap-2 px-2 py-1"
              >
                <span className="min-w-0 truncate" title={f.path}>
                  {f.name}
                </span>
                <span className="flex items-center gap-2">
                  <StateBadge state={f.state} />
                  {f.state === "failed" && f.document_id !== null ? (
                    <Button
                      variant="ghost"
                      disabled={retryingId === f.document_id}
                      onClick={() => void retry(f.document_id as number)}
                    >
                      {retryingId === f.document_id ? "Retrying…" : "Retry"}
                    </Button>
                  ) : null}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

function StateBadge({ state }: { state: JobFileState }): JSX.Element {
  const classes: Record<JobFileState, string> = {
    queued: "bg-muted text-muted-foreground",
    processing: "bg-amber-500/20 text-amber-300",
    done: "bg-emerald-500/20 text-emerald-400",
    skipped: "bg-muted text-muted-foreground",
    failed: "bg-destructive/20 text-destructive",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${classes[state]}`}>
      {state === "processing" ? "processing…" : state}
    </span>
  );
}

function shortenPath(path: string): string {
  // Keep the trailing two components, like ".../Inbox/2024".
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}
