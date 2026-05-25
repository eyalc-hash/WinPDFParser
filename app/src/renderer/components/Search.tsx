import { useState } from "react";
import type { SearchHit, SearchResponse } from "@shared/types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

const PAGE_SIZE = 25;

export function Search(): JSX.Element {
  const [q, setQ] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const executeSearch = async (query: string, offset = 0): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const trimmed = query.trim();
      const res = await window.api.sidecar.search(trimmed, PAGE_SIZE, offset);
      setActiveQuery(trimmed);
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!q.trim()) return;
    await executeSearch(q, 0);
  };

  const showingFrom = result && result.total > 0 ? result.offset + 1 : 0;
  const showingTo = result ? Math.min(result.offset + result.hits.length, result.total) : 0;
  const canGoBack = Boolean(result && result.offset > 0 && !loading);
  const canGoForward = Boolean(result && result.offset + result.hits.length < result.total && !loading);

  return (
    <div className="flex h-full flex-col">
      <form onSubmit={onSubmit} className="flex gap-2 border-b border-border px-4 py-3">
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search OCR text (FTS5 syntax supported, e.g. invoice AND 2024)"
        />
        <Button variant="primary" type="submit" disabled={loading}>
          {loading ? "…" : "Search"}
        </Button>
      </form>

      <div className="flex-1 overflow-auto px-4 py-3">
        {result ? (
          <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              {result.total === 0
                ? `No matches for “${result.query}”.`
                : `Showing ${showingFrom}–${showingTo} of ${result.total} matches for “${result.query}”.`}
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={!canGoBack}
                onClick={() => void executeSearch(activeQuery, Math.max(result.offset - PAGE_SIZE, 0))}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                disabled={!canGoForward}
                onClick={() => void executeSearch(activeQuery, result.offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {result && result.total === 0 ? (
          <p className="text-sm text-muted-foreground">No matches.</p>
        ) : null}
        {result?.hits.map((h) => <Hit key={h.document_id} hit={h} />)}
      </div>
    </div>
  );
}

function Hit({ hit }: { hit: SearchHit }): JSX.Element {
  // FTS5 snippet markup uses `[[ ]]` brackets — render them as <mark>.
  const segments = hit.snippet.split(/(\[\[[^\]]*\]\])/g).map((seg, i) => {
    const m = seg.match(/^\[\[(.*)\]\]$/);
    return m ? (
      <mark key={i} className="rounded bg-primary/40 px-0.5 text-foreground">
        {m[1]}
      </mark>
    ) : (
      <span key={i}>{seg}</span>
    );
  });

  return (
    <article className="mb-3 rounded-md border border-border bg-card/40 p-3">
      <header className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-medium">{hit.ai_name ?? hit.original_name}</h3>
        <div className="flex gap-2">
          {hit.output_path ? (
            <Button variant="ghost" onClick={() => window.api.openPath(hit.output_path!)}>
              Open
            </Button>
          ) : null}
          {hit.output_path ? (
            <Button variant="ghost" onClick={() => window.api.revealInFolder(hit.output_path!)}>
              Reveal
            </Button>
          ) : null}
        </div>
      </header>
      <p className="text-xs text-muted-foreground">{hit.original_name}</p>
      <p className="mt-2 text-sm leading-relaxed">{segments}</p>
    </article>
  );
}
