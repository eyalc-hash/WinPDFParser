import { useCallback, useEffect, useState } from "react";
import type {
  DocumentRow,
  HealthDetails,
  IndexHealth,
  OllamaStatus,
  SettingsModel,
} from "@shared/types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface Props {
  onClose: () => void;
}

export function SettingsDrawer({ onClose }: Props): JSX.Element {
  const [settings, setSettings] = useState<SettingsModel | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [failures, setFailures] = useState<DocumentRow[]>([]);
  const [healthDetails, setHealthDetails] = useState<HealthDetails | null>(null);
  const [indexHealth, setIndexHealth] = useState<IndexHealth | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [diagnosticsPath, setDiagnosticsPath] = useState<string | null>(null);
  const [failuresLoading, setFailuresLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadFailures = useCallback(async (): Promise<void> => {
    setFailuresLoading(true);
    try {
      const list = await window.api.sidecar.listFailedDocuments(10);
      setFailures(list.items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFailuresLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      window.api.sidecar.getSettings().then(setSettings).catch((e) => setError((e as Error).message)),
      window.api.sidecar.ollamaStatus().then(setOllama).catch(() => setOllama(null)),
      window.api.sidecar.healthDetails().then(setHealthDetails).catch(() => setHealthDetails(null)),
      loadFailures(),
      window.api.sidecar.getIndexHealth().then(setIndexHealth).catch(() => setIndexHealth(null)),
    ]);
  }, [loadFailures]);

  const retryFailure = async (documentId: number): Promise<void> => {
    setRetryingId(documentId);
    setError(null);
    try {
      await window.api.sidecar.retryDocument(documentId);
      await loadFailures();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRetryingId(null);
    }
  };

  const save = async (): Promise<void> => {
    if (!settings) return;
    try {
      const s = await window.api.sidecar.putSettings(settings);
      setSettings(s);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60" onClick={onClose} />
      <aside className="flex w-[28rem] max-w-full flex-col border-l border-border bg-card p-4">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </header>

        {!settings ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4 overflow-auto">
            <Field label="LLM model (Ollama)">
              <Input
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Default: <code>llama3.2:3b</code>. Pull with <code>ollama pull &lt;model&gt;</code>.
              </p>
            </Field>

            <Field label="Ollama URL">
              <Input
                value={settings.ollama_url}
                onChange={(e) => setSettings({ ...settings, ollama_url: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Status:{" "}
                {ollama
                  ? ollama.available
                    ? <span className="text-emerald-400">reachable</span>
                    : <span className="text-destructive">unreachable</span>
                  : "checking…"}
              </p>
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.rename_with_llm}
                onChange={(e) =>
                  setSettings({ ...settings, rename_with_llm: e.target.checked })
                }
              />
              Use LLM to rename files
            </label>

            <Field label="OCR language(s)">
              <Input
                value={settings.ocr_language}
                onChange={(e) => setSettings({ ...settings, ocr_language: e.target.value })}
                placeholder="eng"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Tesseract language code(s), e.g. <code>eng</code> or <code>eng+deu</code>. Used
                only when real OCR is installed.
              </p>
            </Field>

            <Field label="Max concurrent jobs">
              <Input
                type="number"
                min={1}
                max={4}
                value={settings.max_concurrent_jobs}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    max_concurrent_jobs: Math.max(1, Math.min(4, Number(e.target.value || 1))),
                  })
                }
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Safe range <code>1-4</code>. Higher values can increase CPU/RAM usage.
              </p>
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.auto_update}
                onChange={(e) => setSettings({ ...settings, auto_update: e.target.checked })}
              />
              Enable auto-update checks (off by default — no telemetry, no network calls)
            </label>

            <RecentFailures
              failures={failures}
              loading={failuresLoading}
              retryingId={retryingId}
              onRefresh={loadFailures}
              onRetry={retryFailure}
            />

            <section className="border-t border-border pt-3">
              <h3 className="mb-2 text-sm font-semibold">Index maintenance</h3>
              {indexHealth ? (
                <p className="mb-2 text-xs text-muted-foreground">
                  done: {indexHealth.done_total}, indexed: {indexHealth.indexed_total}, missing:{" "}
                  {indexHealth.missing_in_fts}, orphaned: {indexHealth.orphaned_fts_rows}
                </p>
              ) : (
                <p className="mb-2 text-xs text-muted-foreground">Index health unavailable.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  disabled={maintenanceBusy}
                  onClick={async () => {
                    setMaintenanceBusy(true);
                    setError(null);
                    try {
                      await window.api.sidecar.rebuildIndex();
                      setIndexHealth(await window.api.sidecar.getIndexHealth());
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setMaintenanceBusy(false);
                    }
                  }}
                >
                  Rebuild index
                </Button>
                <Button
                  variant="ghost"
                  disabled={maintenanceBusy}
                  onClick={async () => {
                    setMaintenanceBusy(true);
                    setError(null);
                    try {
                      await window.api.sidecar.optimizeIndex();
                      setIndexHealth(await window.api.sidecar.getIndexHealth());
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setMaintenanceBusy(false);
                    }
                  }}
                >
                  Optimize index
                </Button>
              </div>
            </section>

            <section className="border-t border-border pt-3">
              <h3 className="mb-2 text-sm font-semibold">Diagnostics</h3>
              {healthDetails ? (
                <div className="mb-2 rounded-md border border-border p-2 text-xs text-muted-foreground">
                  <p>
                    Sidecar v{healthDetails.version} · jobs: {healthDetails.active_jobs} active /{" "}
                    {healthDetails.recent_jobs} recent
                  </p>
                  <p>
                    OCR tools: package {healthDetails.ocr.has_ocrmypdf_package ? "✓" : "✗"}, tesseract{" "}
                    {healthDetails.ocr.tesseract_available ? "✓" : "✗"}, ghostscript{" "}
                    {healthDetails.ocr.ghostscript_available ? "✓" : "✗"}
                  </p>
                  <p>Real OCR ready: {healthDetails.ocr.real_ocr_ready ? "yes" : "no (stub fallback)"}</p>
                </div>
              ) : (
                <p className="mb-2 text-xs text-muted-foreground">Health details unavailable.</p>
              )}
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={async () => {
                    setError(null);
                    try {
                      const path = await window.api.exportDiagnostics();
                      setDiagnosticsPath(path);
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                >
                  Export diagnostics bundle
                </Button>
                <Button
                  variant="ghost"
                  disabled={recoveryBusy}
                  onClick={async () => {
                    setRecoveryBusy(true);
                    setRecoveryNotice(null);
                    setError(null);
                    try {
                      const result = await window.api.sidecar.clearTempFiles();
                      setRecoveryNotice(
                        `Cleared ${result.cleared} temp file(s)${
                          result.output_folder ? ` in ${result.output_folder}` : ""
                        }.`,
                      );
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setRecoveryBusy(false);
                    }
                  }}
                >
                  Clear temp files
                </Button>
                <Button
                  variant="ghost"
                  disabled={recoveryBusy}
                  onClick={async () => {
                    setRecoveryBusy(true);
                    setRecoveryNotice(null);
                    setError(null);
                    try {
                      const result = await window.api.sidecar.retryFailedBatch(200);
                      setRecoveryNotice(
                        `Queued ${result.queued} retry job(s); skipped ${result.skipped_non_retryable} non-retryable and ${result.skipped_retry_limit} over limit.`,
                      );
                      await loadFailures();
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setRecoveryBusy(false);
                    }
                  }}
                >
                  Re-run failed batch
                </Button>
              </div>
              {diagnosticsPath ? (
                <p className="mt-1 text-xs text-muted-foreground" title={diagnosticsPath}>
                  Saved: {diagnosticsPath}
                </p>
              ) : null}
              {recoveryNotice ? <p className="mt-1 text-xs text-muted-foreground">{recoveryNotice}</p> : null}
            </section>

            <div className="border-t border-border pt-3">
              <Button variant="ghost" onClick={() => window.api.openAppDataFolder()}>
                Open app data folder
              </Button>
            </div>

            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            <div className="mt-auto flex justify-end gap-2 pt-3">
              {saved ? <span className="self-center text-xs text-emerald-400">Saved</span> : null}
              <Button variant="primary" onClick={save}>
                Save
              </Button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function RecentFailures({
  failures,
  loading,
  retryingId,
  onRefresh,
  onRetry,
}: {
  failures: DocumentRow[];
  loading: boolean;
  retryingId: number | null;
  onRefresh: () => Promise<void>;
  onRetry: (documentId: number) => Promise<void>;
}): JSX.Element {
  return (
    <section className="border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Recent failures</h3>
        <Button variant="ghost" disabled={loading} onClick={() => void onRefresh()}>
          Refresh
        </Button>
      </div>
      {loading && failures.length === 0 ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : null}
      {!loading && failures.length === 0 ? (
        <p className="text-xs text-muted-foreground">No recent failures.</p>
      ) : null}
      {failures.length > 0 ? (
        <div className="flex flex-col gap-2">
          {failures.map((failure) => {
            const message = failure.error?.trim() ?? "";
            const truncated = message.length > 120 ? `${message.slice(0, 120)}…` : message;
            return (
              <div key={failure.id} className="rounded-md border border-border p-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium" title={failure.original_path}>
                      {failure.original_name}
                    </p>
                    <p className="text-muted-foreground">
                      {failure.processed_at ? new Date(failure.processed_at).toLocaleString() : "—"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    disabled={retryingId === failure.id || !failure.retryable}
                    onClick={() => void onRetry(failure.id)}
                  >
                    {retryingId === failure.id ? "Retrying…" : "Retry"}
                  </Button>
                </div>
                {truncated ? (
                  <p className="mt-1 truncate text-destructive" title={message}>
                    {failure.error_category ? `[${failure.error_category}] ` : ""}
                    {truncated}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
