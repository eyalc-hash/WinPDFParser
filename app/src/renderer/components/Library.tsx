import { useEffect, useState } from "react";
import type { DocumentRow, DocumentSort, DocumentStatus } from "@shared/types";
import { Button } from "./ui/Button";

interface Props {
  refreshKey: number;
}

const PAGE_SIZE = 50;
const DEFAULT_SORT: DocumentSort = "processed_desc";
type StatusFilter = "all" | DocumentStatus;

const statusOptions: Array<{ label: string; value: StatusFilter }> = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Processing", value: "processing" },
  { label: "Done", value: "done" },
  { label: "Failed", value: "failed" },
  { label: "Skipped", value: "skipped" },
];

const sortOptions: Array<{ label: string; value: DocumentSort }> = [
  { label: "Newest processed", value: "processed_desc" },
  { label: "Oldest processed", value: "processed_asc" },
  { label: "Name A→Z", value: "name_asc" },
  { label: "Pages high→low", value: "pages_desc" },
];

export function Library({ refreshKey }: Props): JSX.Element {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [pageSize] = useState(PAGE_SIZE);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<DocumentSort>(DEFAULT_SORT);
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const statusParam = status === "all" ? undefined : status;
  const filterActive = status !== "all" || sort !== DEFAULT_SORT;

  useEffect(() => {
    let cancelled = false;

    const reload = async (): Promise<void> => {
      setLoading(true);
      try {
        const list = await window.api.sidecar.listDocuments({
          limit: pageSize,
          offset,
          status: statusParam,
          sort,
        });
        if (cancelled) return;
        setDocs(list.items);
        setSelectedIds((current) => {
          const next = new Set<number>();
          for (const id of current) {
            if (list.items.some((item) => item.id === id)) next.add(id);
          }
          return next;
        });
        setTotal(list.total);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void reload();
    return () => {
      cancelled = true;
    };
  }, [refreshKey, reloadToken, offset, pageSize, statusParam, sort]);

  const reloadCurrentPage = (): void => {
    setReloadToken((current) => current + 1);
  };

  const clearFilters = (): void => {
    setStatus("all");
    setSort(DEFAULT_SORT);
    setOffset(0);
  };

  const showingFrom = total > 0 ? offset + 1 : 0;
  const showingTo = Math.min(offset + docs.length, total);
  const canGoBack = offset > 0 && !loading;
  const canGoForward = offset + docs.length < total && !loading;
  const showFilteredEmpty = !loading && docs.length === 0 && filterActive;
  const showLibraryEmpty = !loading && docs.length === 0 && !filterActive && total === 0;
  const pageSummary = `Showing ${showingFrom}–${showingTo} of ${total}`;
  const selectedDocs = docs.filter((doc) => selectedIds.has(doc.id));
  const hasSelection = selectedDocs.length > 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) {
        return;
      }
      if ((event.key === "ArrowLeft" || event.key.toLowerCase() === "p") && canGoBack) {
        event.preventDefault();
        setOffset((current) => Math.max(current - pageSize, 0));
      } else if ((event.key === "ArrowRight" || event.key.toLowerCase() === "n") && canGoForward) {
        event.preventDefault();
        setOffset((current) => current + pageSize);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canGoBack, canGoForward, pageSize]);

  return (
    <div className="h-full overflow-auto px-4 py-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Status
            <select
              aria-label="Filter documents by status"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as StatusFilter);
                setOffset(0);
              }}
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Sort
            <select
              aria-label="Sort documents"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as DocumentSort);
                setOffset(0);
              }}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span role="status" aria-live="polite">{pageSummary}</span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={!canGoBack}
              onClick={() => setOffset(Math.max(offset - pageSize, 0))}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              disabled={!canGoForward}
              onClick={() => setOffset(offset + pageSize)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
      {hasSelection ? (
        <BulkActions
          selected={selectedDocs}
          onClear={() => setSelectedIds(new Set())}
          onChanged={reloadCurrentPage}
        />
      ) : null}

      {error ? <p className="mb-2 text-sm text-destructive">{error}</p> : null}
      {loading && docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {showFilteredEmpty ? <FilteredEmptyState onClear={clearFilters} /> : null}
      {showLibraryEmpty ? <EmptyState /> : null}
      {docs.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Indexed documents table</caption>
          <thead className="text-xs uppercase text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="w-10 px-2 py-2 text-left">
                <input
                  type="checkbox"
                  aria-label="Select all documents on page"
                  checked={docs.length > 0 && selectedIds.size === docs.length}
                  onChange={(event) => {
                    if (event.target.checked) setSelectedIds(new Set(docs.map((d) => d.id)));
                    else setSelectedIds(new Set());
                  }}
                />
              </th>
              <th scope="col" className="w-1/3 px-2 py-2 text-left">Original</th>
              <th scope="col" className="w-1/3 px-2 py-2 text-left">AI name</th>
              <th scope="col" className="w-16 px-2 py-2 text-left">Pages</th>
              <th scope="col" className="w-24 px-2 py-2 text-left">Status</th>
              <th scope="col" className="w-40 px-2 py-2 text-left">Processed</th>
              <th scope="col" className="w-40 px-2 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <Row
                key={d.id}
                doc={d}
                selected={selectedIds.has(d.id)}
                onToggleSelected={(checked) => {
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    if (checked) next.add(d.id);
                    else next.delete(d.id);
                    return next;
                  });
                }}
                onChanged={reloadCurrentPage}
              />
            ))}
          </tbody>
        </table>
        </div>
      ) : null}
    </div>
  );
}

function FilteredEmptyState({ onClear }: { onClear: () => void }): JSX.Element {
  return (
    <div className="mt-16 flex flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <p className="text-lg">No documents match this filter.</p>
      <Button variant="ghost" onClick={onClear}>Clear filters</Button>
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="mt-16 flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <p className="text-lg">No documents yet.</p>
      <p className="text-sm">Choose an input folder above and click <strong>Run OCR</strong>.</p>
    </div>
  );
}

function Row({
  doc,
  selected,
  onToggleSelected,
  onChanged,
}: {
  doc: DocumentRow;
  selected: boolean;
  onToggleSelected: (checked: boolean) => void;
  onChanged: () => void;
}): JSX.Element {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const failureMessage = doc.status === "failed" ? doc.error?.trim() : "";
  const truncatedFailure = failureMessage
    ? failureMessage.length > 200
      ? `${failureMessage.slice(0, 200)}…`
      : failureMessage
    : null;

  const retry = async (): Promise<void> => {
    setRetrying(true);
    setRetryError(null);
    try {
      await window.api.sidecar.retryDocument(doc.id);
      onChanged();
    } catch (err) {
      setRetryError((err as Error).message);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <>
      <tr className="border-b border-border/50 hover:bg-muted/30">
        <td className="px-2 py-2">
          <input
            type="checkbox"
            checked={selected}
            aria-label={`Select ${doc.original_name}`}
            onChange={(event) => onToggleSelected(event.target.checked)}
          />
        </td>
        <td className="truncate px-2 py-2" title={doc.original_path}>
          {doc.original_name}
        </td>
        <td className="truncate px-2 py-2" title={doc.ai_name ?? ""}>
          {doc.ai_name ?? "—"}
        </td>
        <td className="px-2 py-2">{doc.page_count ?? "—"}</td>
        <td className="px-2 py-2">
          <StatusBadge status={doc.status} />
        </td>
        <td className="px-2 py-2 text-xs text-muted-foreground">
          {doc.processed_at ? new Date(doc.processed_at).toLocaleString() : "—"}
        </td>
        <td className="px-2 py-2 text-right">
          <div className="inline-flex gap-1">
            {doc.status === "failed" ? (
              <Button variant="ghost" disabled={retrying || !doc.retryable} onClick={retry}>
                {retrying ? "Retrying…" : "Retry"}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              disabled={!doc.output_path}
              onClick={() => doc.output_path && window.api.openPath(doc.output_path)}
            >
              Open
            </Button>
            <Button
              variant="ghost"
              disabled={!doc.output_path}
              onClick={() => doc.output_path && window.api.revealInFolder(doc.output_path)}
            >
              Reveal
            </Button>
            <Button
              variant="ghost"
              onClick={async () => {
                await window.api.sidecar.deleteDocument(doc.id);
                onChanged();
              }}
            >
              Remove
            </Button>
          </div>
        </td>
      </tr>
      {truncatedFailure || retryError ? (
        <tr className="border-b border-border/50">
          <td colSpan={7} className="px-2 pb-2 text-xs text-destructive">
            {truncatedFailure ? (
              <span title={failureMessage}>
                Failure{doc.error_category ? ` (${doc.error_category})` : ""}: {truncatedFailure}
              </span>
            ) : null}
            {retryError ? <span className="ml-2">Retry failed: {retryError}</span> : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function BulkActions({
  selected,
  onClear,
  onChanged,
}: {
  selected: DocumentRow[];
  onClear: () => void;
  onChanged: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const selectedWithOutput = selected.filter((doc) => doc.output_path);
  const failedRetryable = selected.filter((doc) => doc.status === "failed" && doc.retryable);

  const run = async (fn: (doc: DocumentRow) => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      for (const doc of selected) {
        await fn(doc);
      }
      onChanged();
      onClear();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card/40 p-2 text-xs">
      <span className="text-muted-foreground">{selected.length} selected</span>
      <Button variant="ghost" disabled={busy || failedRetryable.length === 0} onClick={() => void run(async (doc) => {
        if (doc.status === "failed" && doc.retryable) await window.api.sidecar.retryDocument(doc.id);
      })}>
        Retry failed
      </Button>
      <Button variant="ghost" disabled={busy || selectedWithOutput.length === 0} onClick={() => {
        for (const doc of selectedWithOutput) {
          if (doc.output_path) void window.api.openPath(doc.output_path);
        }
      }}>
        Open all
      </Button>
      <Button variant="ghost" disabled={busy || selectedWithOutput.length === 0} onClick={() => {
        for (const doc of selectedWithOutput) {
          if (doc.output_path) void window.api.revealInFolder(doc.output_path);
        }
      }}>
        Reveal all
      </Button>
      <Button variant="destructive" disabled={busy} onClick={() => void run(async (doc) => {
        await window.api.sidecar.deleteDocument(doc.id);
      })}>
        Remove selected
      </Button>
      <Button variant="ghost" disabled={busy} onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

function StatusBadge({ status }: { status: DocumentRow["status"] }): JSX.Element {
  const cls: Record<DocumentRow["status"], string> = {
    pending: "bg-muted text-muted-foreground",
    processing: "bg-primary/20 text-primary",
    done: "bg-emerald-500/20 text-emerald-400",
    failed: "bg-destructive/20 text-destructive",
    skipped: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${cls[status]}`}>{status}</span>
  );
}
