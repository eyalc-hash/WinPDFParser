import { useEffect, useState } from "react";
import { Library } from "./components/Library";
import { Search } from "./components/Search";
import { SettingsDrawer } from "./components/Settings";
import { Processor } from "./components/Processor";
import { Button } from "./components/ui/Button";

type Tab = "library" | "search";

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>("library");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    window.api.sidecar
      .health()
      .then((h) => setVersion(h.version))
      .catch(() => setVersion(null));
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
          {version ? <span>sidecar v{version}</span> : <span className="text-destructive">sidecar offline</span>}
          <Button variant="ghost" onClick={() => setSettingsOpen(true)}>
            Settings
          </Button>
        </div>
      </header>

      <Processor onFinished={onJobFinished} />

      <main className="flex-1 overflow-hidden">
        {tab === "library" ? (
          <Library refreshKey={refreshKey} />
        ) : (
          <Search />
        )}
      </main>

      {settingsOpen ? <SettingsDrawer onClose={() => setSettingsOpen(false)} /> : null}
    </div>
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
