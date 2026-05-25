import { useEffect, useRef, useState } from "react";
import type { DocumentStatus, SearchHit, SearchRank, SearchResponse } from "@shared/types";
import { Viewer } from "./Viewer";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

const PAGE_SIZE = 25;

export function Search(): JSX.Element {
  const [q, setQ] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [activeResultIndex, setActiveResultIndex] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewerPaging, setViewerPaging] = useState(false);
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | "all">("all");
  const [nameFilter, setNameFilter] = useState("");
  const [processedAfter, setProcessedAfter] = useState("");
  const [processedBefore, setProcessedBefore] = useState("");
  const [rank, setRank] = useState<SearchRank>("relevance");
  const [savedSearches, setSavedSearches] = useState<Array<{ id: string; label: string; query: string }>>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const fetchSearch = async (query: string, offset = 0): Promise<SearchResponse> => {
    const trimmed = query.trim();
    const res = await window.api.sidecar.search(trimmed, PAGE_SIZE, offset, {
      status: statusFilter === "all" ? undefined : statusFilter,
      name: nameFilter.trim() || undefined,
      processed_after: processedAfter || undefined,
      processed_before: processedBefore || undefined,
      rank,
    });
    setActiveQuery(trimmed);
    return res;
  };

  const executeSearch = async (query: string, offset = 0): Promise<void> => {
    setLoading(true);
    setError(null);
    setViewerIndex(null);
    try {
      setResult(await fetchSearch(query, offset));
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

  const saveSearch = (): void => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const id = `${Date.now()}`;
    const next = [{ id, label: trimmed, query: trimmed }, ...savedSearches].slice(0, 10);
    setSavedSearches(next);
    window.localStorage.setItem("saved-searches", JSON.stringify(next));
  };

  useEffect(() => {
    if (!result || result.hits.length === 0) {
      setActiveResultIndex(0);
      return;
    }
    setActiveResultIndex((current) => Math.min(current, result.hits.length - 1));
  }, [result]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("saved-searches");
      if (raw) setSavedSearches(JSON.parse(raw) as Array<{ id: string; label: string; query: string }>);
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) {
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (!result || result.hits.length === 0 || viewerIndex !== null) return;
      if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") {
        event.preventDefault();
        setActiveResultIndex((current) => Math.min(current + 1, result.hits.length - 1));
      } else if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") {
        event.preventDefault();
        setActiveResultIndex((current) => Math.max(current - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        setViewerIndex(activeResultIndex);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeResultIndex, result, viewerIndex]);

  const navigateViewer = async (direction: "previous" | "next"): Promise<void> => {
    if (!result || viewerIndex === null || viewerPaging) return;

    if (direction === "next") {
      if (viewerIndex < result.hits.length - 1) {
        setViewerIndex(viewerIndex + 1);
        return;
      }
      if (result.offset + result.hits.length >= result.total) return;

      setViewerPaging(true);
      setError(null);
      try {
        const nextPage = await fetchSearch(activeQuery, result.offset + result.hits.length);
        setResult(nextPage);
        setViewerIndex(nextPage.hits.length > 0 ? 0 : null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setViewerPaging(false);
      }
      return;
    }

    if (viewerIndex > 0) {
      setViewerIndex(viewerIndex - 1);
      return;
    }
    if (result.offset === 0) return;

    setViewerPaging(true);
    setError(null);
    try {
      const previousPage = await fetchSearch(activeQuery, Math.max(result.offset - PAGE_SIZE, 0));
      setResult(previousPage);
      setViewerIndex(previousPage.hits.length > 0 ? previousPage.hits.length - 1 : null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setViewerPaging(false);
    }
  };

  const closeViewer = (): void => setViewerIndex(null);

  const showingFrom = result && result.total > 0 ? result.offset + 1 : 0;
  const showingTo = result ? Math.min(result.offset + result.hits.length, result.total) : 0;
  const canGoBack = Boolean(result && result.offset > 0 && !loading);
  const canGoForward = Boolean(result && result.offset + result.hits.length < result.total && !loading);
  const activeHit = result && viewerIndex !== null ? result.hits[viewerIndex] : null;
  const canViewPrevious = Boolean(
    result && viewerIndex !== null && (viewerIndex > 0 || result.offset > 0),
  );
  const canViewNext = Boolean(
    result &&
      viewerIndex !== null &&
      (viewerIndex < result.hits.length - 1 || result.offset + result.hits.length < result.total),
  );

  return (
    <div className="relative flex h-full flex-col">
      <form onSubmit={onSubmit} className="flex gap-2 border-b border-border px-4 py-3">
        <Input
          ref={searchInputRef}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search OCR text (FTS5 syntax supported, e.g. invoice AND 2024)"
          aria-label="Search OCR text"
        />
        <Button variant="primary" type="submit" disabled={loading}>
          {loading ? "…" : "Search"}
        </Button>
        <Button variant="ghost" type="button" onClick={saveSearch}>
          Save search
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
        <select
          aria-label="Filter search by document status"
          className="h-8 rounded-md border border-border bg-background px-2"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as DocumentStatus | "all")}
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="done">Done</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </select>
        <Input
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          placeholder="Name contains"
          aria-label="Filter by document name"
          className="h-8 w-40"
        />
        <Input
          type="date"
          value={processedAfter}
          onChange={(e) => setProcessedAfter(e.target.value)}
          aria-label="Processed after"
          className="h-8 w-36"
        />
        <Input
          type="date"
          value={processedBefore}
          onChange={(e) => setProcessedBefore(e.target.value)}
          aria-label="Processed before"
          className="h-8 w-36"
        />
        <select
          aria-label="Search ranking"
          className="h-8 rounded-md border border-border bg-background px-2"
          value={rank}
          onChange={(e) => setRank(e.target.value as SearchRank)}
        >
          <option value="relevance">Relevance</option>
          <option value="recent">Recent</option>
        </select>
        {savedSearches.length > 0 ? (
          <div className="ml-auto flex items-center gap-1">
            <span className="text-muted-foreground">Saved:</span>
            {savedSearches.map((saved) => (
              <button
                key={saved.id}
                type="button"
                className="rounded border border-border px-2 py-1 hover:bg-muted/40"
                onClick={() => {
                  setQ(saved.query);
                  void executeSearch(saved.query, 0);
                }}
              >
                {saved.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-auto px-4 py-3">
        {result ? (
          <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              {result.total === 0
                ? `No matches for “${result.query}”.`
                : `Showing ${showingFrom}–${showingTo} of ${result.total} matches for “${result.query}” (${result.rank}).`}
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
        {result?.hits.map((h, index) => (
          <Hit
            key={h.document_id}
            hit={h}
            active={activeResultIndex === index}
            onFocus={() => setActiveResultIndex(index)}
            onView={() => setViewerIndex(index)}
          />
        ))}
      </div>

      {activeHit && result ? (
        <Viewer
          hit={activeHit}
          index={viewerIndex ?? 0}
          offset={result.offset}
          total={result.total}
          canPrevious={canViewPrevious}
          canNext={canViewNext}
          navigationDisabled={viewerPaging}
          onPrevious={() => navigateViewer("previous")}
          onNext={() => navigateViewer("next")}
          onClose={closeViewer}
        />
      ) : null}
    </div>
  );
}

function Hit({
  hit,
  active,
  onFocus,
  onView,
}: {
  hit: SearchHit;
  active: boolean;
  onFocus: () => void;
  onView: () => void;
}): JSX.Element {
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
  const title = hit.ai_name ?? hit.original_name;

  return (
    <article
      tabIndex={0}
      aria-selected={active}
      onFocus={onFocus}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && hit.output_path) {
          event.preventDefault();
          onView();
        }
      }}
      className={
        "mb-3 rounded-md border bg-card/40 p-3 outline-none transition-colors " +
        (active ? "border-primary" : "border-border") +
        " focus:border-primary focus:ring-1 focus:ring-primary"
      }
    >
      <header className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-medium">
          <button
            type="button"
            className="text-left hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!hit.output_path}
            aria-label={`View ${title} in app`}
            onClick={onView}
          >
            {title}
          </button>
        </h3>
        <div className="flex gap-2">
          {hit.output_path ? (
            <Button variant="ghost" onClick={onView} aria-label={`View ${title} in app`}>
              View
            </Button>
          ) : null}
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
      {hit.title || hit.author || hit.source_created_at ? (
        <p className="text-[11px] text-muted-foreground">
          {[hit.title ? `Title: ${hit.title}` : null, hit.author ? `Author: ${hit.author}` : null, hit.source_created_at ? `Created: ${hit.source_created_at}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
      <p className="mt-2 text-sm leading-relaxed">{segments}</p>
    </article>
  );
}
