import { useState } from "react";
import type { SearchHit } from "@shared/types";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

export function Search(): JSX.Element {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await window.api.sidecar.search(q.trim(), 50);
      setHits(res.hits);
    } catch (err) {
      setError((err as Error).message);
      setHits([]);
    } finally {
      setLoading(false);
    }
  };

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
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {hits && hits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches.</p>
        ) : null}
        {hits?.map((h) => <Hit key={h.document_id} hit={h} />)}
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
