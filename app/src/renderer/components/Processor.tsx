import { useEffect, useRef, useState } from "react";
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
  const [force, setForce] = useState(false);
  const [rename, setRename] = useState(true);
  const [job, setJob] = useState<JobProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // Hydrate persisted folders from settings.
  useEffect(() => {
    window.api.sidecar
      .getSettings()
      .then((s) => {
        setInput(s.input_folder ?? null);
        setOutput(s.output_folder ?? null);
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
    if (kind === "input") setInput(folder);
    else setOutput(folder);
    // Persist to settings.
    try {
      const s = await window.api.sidecar.getSettings();
      await window.api.sidecar.putSettings({
        ...s,
        input_folder: kind === "input" ? folder : s.input_folder,
        output_folder: kind === "output" ? folder : s.output_folder,
      });
    } catch {
      /* ignore: not fatal */
    }
  };

  const run = async (): Promise<void> => {
    setError(null);
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
    <section className="border-b border-border bg-card/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <FolderPicker label="Input" value={input} onPick={() => pick("input")} />
        <FolderPicker label="Output" value={output} onPick={() => pick("output")} />

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

      {job ? <Progress job={job} /> : null}
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </section>
  );
}

function FolderPicker({
  label,
  value,
  onPick,
}: {
  label: string;
  value: string | null;
  onPick: () => void;
}): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}:</span>
      <button
        type="button"
        onClick={onPick}
        title={value ?? "Choose a folder"}
        className="max-w-[28ch] truncate rounded-md border border-border bg-background px-2 py-1 text-xs hover:bg-muted/50"
      >
        {value ?? "Choose…"}
      </button>
    </div>
  );
}

function Progress({ job }: { job: JobProgress }): JSX.Element {
  const pct = job.total > 0 ? Math.round(((job.processed + job.skipped + job.failed) / job.total) * 100) : 0;
  return (
    <div className="mt-3">
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
