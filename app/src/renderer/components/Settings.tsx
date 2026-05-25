import { useEffect, useState } from "react";
import type { OllamaStatus, SettingsModel } from "@shared/types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface Props {
  onClose: () => void;
}

export function SettingsDrawer({ onClose }: Props): JSX.Element {
  const [settings, setSettings] = useState<SettingsModel | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void Promise.all([
      window.api.sidecar.getSettings().then(setSettings).catch((e) => setError((e as Error).message)),
      window.api.sidecar.ollamaStatus().then(setOllama).catch(() => setOllama(null)),
    ]);
  }, []);

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

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.auto_update}
                onChange={(e) => setSettings({ ...settings, auto_update: e.target.checked })}
              />
              Enable auto-update checks (off by default — no telemetry, no network calls)
            </label>

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
