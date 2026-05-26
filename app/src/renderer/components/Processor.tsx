import { useEffect, useRef, useState, type DragEvent } from "react";
import type { JobProgress, ProcessRequest } from "@shared/types";
import { Button } from "./ui/Button";

interface Props {
  onFinished: () => void;
}

/**
 * Top "Processor" bar: input/output folder pickers + run/cancel + live progress.
 *
 * Polls /jobs/{id} every 750ms while a job is active. We avoid SSE here to keep
 * the IPC surface tiny — polling over an already-open HTTP socket is cheap.
 */
export function Processor({ onFinished }: Props): JSX.Element {
  const [input, setInput] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [outputAutoDerived, setOutputAutoDerived] = useState(false);
  const [force, setForce] = useState(false);
  const [rename, setRename] = useState(true);
  const [job, setJob] = useState<JobProgress | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // Hydrate persisted folders from settings.
  useEffect(() => {
    window.api.sidecar
      .getSettings()
      .then((s) => {
        const hydratedInput = s.input_folder ?? null;
        const defaultOutput = hydratedInput ? deriveDefaultOutputFolder(hydratedInput) : null;
        const hydratedOutput = s.output_folder ?? defaultOutput;
        setInput(hydratedInput);
        setOutput(hydratedOutput);
        setOutputAutoDerived(Boolean(hydratedInput && hydratedOutput && hydratedOutput === defaultOutput));
        setRename(s.rename_with_llm);
      })
      .catch(() => {
        /* ok — settings not yet written */
      });
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, []);

  const pick = async (kind: "input" | "output"): Promise<void> => {
    const folder = await window.api.pickFolder(kind);
    if (!folder) return;
    if (kind === "input") {
      setInput(folder);
      const derivedOutput = deriveDefaultOutputFolder(folder);
      const nextOutput = !output || outputAutoDerived ? derivedOutput : output;
      setOutput(nextOutput);
      setOutputAutoDerived(nextOutput === derivedOutput);
    } else {
      setOutput(folder);
      setOutputAutoDerived(false);
    }
    // Persist to settings.
    try {
      const s = await window.api.sidecar.getSettings();
      const nextInput = kind === "input" ? folder : s.input_folder;
      const nextOutput =
        kind === "output"
          ? folder
          : !output || outputAutoDerived
            ? deriveDefaultOutputFolder(folder)
            : output ?? s.output_folder;
      await window.api.sidecar.putSettings({
        ...s,
        input_folder: nextInput,
        output_folder: nextOutput,
      });
    } catch {
      /* ignore: not fatal */
    }
  };

  const dropFolder = async (kind: "input" | "output", droppedPath: string): Promise<void> => {
    if (!droppedPath) return;
    if (kind === "input") {
      setInput(droppedPath);
      const derivedOutput = deriveDefaultOutputFolder(droppedPath);
      const nextOutput = !output || outputAutoDerived ? derivedOutput : output;
      setOutput(nextOutput);
      setOutputAutoDerived(nextOutput === derivedOutput);
    } else {
      setOutput(droppedPath);
      setOutputAutoDerived(false);
    }
    try {
      const s = await window.api.sidecar.getSettings();
      const nextInput = kind === "input" ? droppedPath : s.input_folder;
      const nextOutput =
        kind === "output"
          ? droppedPath
          : !output || outputAutoDerived
            ? deriveDefaultOutputFolder(droppedPath)
            : output ?? s.output_folder;
      await window.api.sidecar.putSettings({
        ...s,
        input_folder: nextInput,
        output_folder: nextOutput,
      });
    } catch {
      /* ignore */
    }
  };

  const run = async (): Promise<void> => {
    setError(null);
    setNotice(null);
    if (!input || !output) {
      setError("Pick both an input and an output folder first.");
      return;
    }
    const req: ProcessRequest = {
      input_folder: input,
      output_folder: output,
      force,
      rename_with_llm: rename,
    };
    try {
      const accepted = await window.api.sidecar.process(req);
      const snap = await window.api.sidecar.getJob(accepted.job_id);
      setJob(snap);
      pollRef.current = window.setInterval(async () => {
        try {
          const j = await window.api.sidecar.getJob(accepted.job_id);
          setJob(j);
          if (j.state === "done" || j.state === "failed" || j.state === "cancelled") {
            if (pollRef.current !== null) window.clearInterval(pollRef.current);
            pollRef.current = null;
            if (j.state === "done") {
              setNotice({
                tone: j.failed > 0 ? "warn" : "ok",
                text:
                  j.failed > 0
                    ? `Finished with ${j.failed} failure(s). ${j.processed} processed, ${j.skipped} skipped.`
                    : `Finished successfully. ${j.processed} processed, ${j.skipped} skipped.`,
              });
            } else if (j.state === "cancelled") {
              setNotice({
                tone: "warn",
                text: `Cancelled. ${j.processed} processed, ${j.skipped} skipped, ${j.failed} failed.`,
              });
            } else {
              setNotice({ tone: "error", text: "Job failed. Check Library/Settings for details." });
            }
            onFinished();
          }
        } catch (err) {
          setError((err as Error).message);
        }
      }, 750);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const cancel = async (): Promise<void> => {
    if (!job) return;
    await window.api.sidecar.cancelJob(job.job_id);
  };

  const running = job?.state === "running" || job?.state === "queued";

  return (
    <section className="border-b border-border/70 bg-background px-4 py-4">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Run OCR</h2>
            <p className="text-xs text-muted-foreground">Pick a source folder and start indexing.</p>
          </div>
          {running ? (
            <Button variant="destructive" onClick={cancel}>
              Cancel
            </Button>
          ) : (
            <Button variant="primary" onClick={run} disabled={!input || !output}>
              Run OCR
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
        <FolderPicker
          label="Input"
          value={input}
          onPick={() => pick("input")}
          onDropPath={(path) => void dropFolder("input", path)}
        />
        <FolderPicker
          label="Output"
          value={output}
          onPick={() => pick("output")}
          onDropPath={(path) => void dropFolder("output", path)}
        />
        {outputAutoDerived && output ? (
          <span className="text-[11px] text-muted-foreground">Default output folder set from input.</span>
        ) : null}

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            disabled={running}
          />
          Force re-process
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={rename}
            onChange={(e) => setRename(e.target.checked)}
            disabled={running}
          />
          AI rename (Ollama)
        </label>
        </div>
        {job ? <Progress job={job} /> : null}
        {notice ? (
          <p
            role="status"
            aria-live="polite"
            className={
              "mt-2 text-xs " +
              (notice.tone === "ok"
                ? "text-emerald-400"
                : notice.tone === "warn"
                  ? "text-amber-300"
                  : "text-destructive")
            }
          >
            {notice.text}
          </p>
        ) : null}
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>
    </section>
  );
}

function FolderPicker({
  label,
  value,
  onPick,
  onDropPath,
}: {
  label: string;
  value: string | null;
  onPick: () => void;
  onDropPath: (path: string) => void;
}): JSX.Element {
  const [dragOver, setDragOver] = useState(false);
  const onDrop = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
    const rawPath = file?.path?.trim();
    if (!rawPath) return;
    const normalized = rawPath.replace(/\\/g, "/");
    if (normalized.toLowerCase().endsWith(".pdf")) {
      const idx = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
      if (idx > 0) onDropPath(rawPath.slice(0, idx));
      return;
    }
    onDropPath(rawPath);
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={onPick}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        title={value ?? "Choose a folder"}
        className={
          "max-w-[32ch] truncate rounded-lg border bg-background px-3 py-1.5 text-xs hover:bg-muted/50 " +
          (dragOver ? "border-primary ring-1 ring-primary" : "border-border")
        }
      >
        {value ?? "Choose…"}
      </button>
    </div>
  );
}

function deriveDefaultOutputFolder(inputFolder: string): string {
  const normalized = inputFolder.replace(/[\\/]+$/, "");
  const separator = normalized.includes("\\") ? "\\" : "/";
  return `${normalized}${separator}ocr_output`;
}

function Progress({ job }: { job: JobProgress }): JSX.Element {
  const pct = job.total > 0 ? Math.round(((job.processed + job.skipped + job.failed) / job.total) * 100) : 0;
  return (
    <div className="mt-3" role="status" aria-live="polite">
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>
          {job.state} — {job.processed} done · {job.skipped} skipped · {job.failed} failed · {job.total} total
        </span>
        {job.current_file ? <span className="truncate">{job.current_file}</span> : null}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
