import { useEffect, useState } from "react";
import { Library } from "./components/Library";
import { Search } from "./components/Search";
import { SettingsDrawer } from "./components/Settings";
import { Processor } from "./components/Processor";
import { UpdateBanner } from "./components/UpdateBanner";
import { FeedbackDialog } from "./components/FeedbackDialog";
import { Button } from "./components/ui/Button";
import type { SidecarDiagnostics } from "../shared/types";

type Tab = "library" | "search";

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>("library");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [sidecarOnline, setSidecarOnline] = useState<boolean | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [diagnostics, setDiagnostics] = useState<SidecarDiagnostics | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async (): Promise<void> => {
      try {
        const h = await window.api.sidecar.health();
        if (cancelled) return;
        setVersion(h.version);
        setSidecarOnline(true);
        setDiagnostics(null);
      } catch {
        if (cancelled) return;
        setVersion(null);
        setSidecarOnline(false);
        try {
          const diag = await window.api.getSidecarDiagnostics();
          if (!cancelled) setDiagnostics(diag);
        } catch {
          // Ignore — diagnostics are best-effort.
        }
      }
    };
    void check();
    const timer = window.setInterval(() => {
      void check();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const onJobFinished = (): void => setRefreshKey((k) => k + 1);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold">PDF-Parser</h1>
          <nav className="flex gap-1">
            <TabButton active={tab === "library"} onClick={() => setTab("library")}>
              Library
            </TabButton>
            <TabButton active={tab === "search"} onClick={() => setTab("search")}>
              Search
            </TabButton>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {sidecarOnline === null ? <span>sidecar checking…</span> : null}
          {sidecarOnline === true && version ? <span>sidecar v{version} online</span> : null}
          {sidecarOnline === false ? (
            <span className="text-destructive">sidecar offline — processing/search unavailable</span>
          ) : null}
          <Button variant="ghost" onClick={() => setFeedbackOpen(true)}>
            Send feedback
          </Button>
          <Button variant="ghost" onClick={() => setSettingsOpen(true)}>
            Settings
          </Button>
        </div>
      </header>

      <UpdateBanner />

      {sidecarOnline === false ? (
        <SidecarErrorBanner
          diagnostics={diagnostics}
          open={diagnosticsOpen}
          onToggle={() => setDiagnosticsOpen((v) => !v)}
        />
      ) : null}

      <Processor onFinished={onJobFinished} />

      <main className="flex-1 overflow-hidden">
        {tab === "library" ? (
          <Library refreshKey={refreshKey} />
        ) : (
          <Search />
        )}
      </main>

      {settingsOpen ? <SettingsDrawer onClose={() => setSettingsOpen(false)} /> : null}
      {feedbackOpen ? <FeedbackDialog onClose={() => setFeedbackOpen(false)} /> : null}
    </div>
  );
}

function SidecarErrorBanner({
  diagnostics,
  open,
  onToggle,
}: {
  diagnostics: SidecarDiagnostics | null;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  const startError = diagnostics?.startError ?? null;
  const tail = diagnostics?.stderrTail ?? [];
  const lastExit = diagnostics?.lastExit ?? null;
  const hasDetails = Boolean(startError) || tail.length > 0 || lastExit !== null;

  return (
    <section
      role="alert"
      aria-label="Sidecar error"
      className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-semibold">
            The Python sidecar is not responding.
          </span>
          <span className="text-destructive/80">
            {startError ?? "No connection to the local backend — see details for the recent log."}
          </span>
        </div>
        {hasDetails ? (
          <Button variant="ghost" onClick={onToggle}>
            {open ? "Hide details" : "Show details"}
          </Button>
        ) : null}
      </div>
      {open && hasDetails ? (
        <div className="mt-2 space-y-2">
          {diagnostics?.command ? (
            <div>
              <span className="font-semibold">Command:</span>{" "}
              <code className="break-all">{diagnostics.command}</code>
            </div>
          ) : null}
          {lastExit ? (
            <div>
              <span className="font-semibold">Last exit:</span> code={String(lastExit.code)}{" "}
              signal={lastExit.signal ?? "null"}
            </div>
          ) : null}
          {diagnostics?.logFile ? (
            <div>
              <span className="font-semibold">Log file:</span>{" "}
              <code className="break-all">{diagnostics.logFile}</code>
            </div>
          ) : null}
          {tail.length > 0 ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-background/60 p-2 font-mono text-[11px] text-foreground">
              {tail.join("\n")}
            </pre>
          ) : (
            <div className="text-destructive/80">No stderr captured yet.</div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-md px-3 py-1 text-sm transition-colors " +
        (active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}
