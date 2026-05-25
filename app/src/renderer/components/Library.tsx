import { useEffect, useState } from "react";
import type { DocumentRow } from "@shared/types";
import { Button } from "./ui/Button";

interface Props {
  refreshKey: number;
}

export function Library({ refreshKey }: Props): JSX.Element {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = async (): Promise<void> => {
    setLoading(true);
    try {
      const list = await window.api.sidecar.listDocuments(200, 0);
      setDocs(list.items);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [refreshKey]);

  return (
    <div className="h-full overflow-auto px-4 py-3">
      {error ? <p className="mb-2 text-sm text-destructive">{error}</p> : null}
      {loading && docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {!loading && docs.length === 0 ? (
        <EmptyState />
      ) : (
        <table className="w-full table-fixed text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr className="border-b border-border">
              <th className="w-1/3 px-2 py-2 text-left">Original</th>
              <th className="w-1/3 px-2 py-2 text-left">AI name</th>
              <th className="w-16 px-2 py-2 text-left">Pages</th>
              <th className="w-24 px-2 py-2 text-left">Status</th>
              <th className="w-40 px-2 py-2 text-left">Processed</th>
              <th className="w-40 px-2 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <Row key={d.id} doc={d} onChanged={reload} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="mt-16 flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <p className="text-lg">No documents yet.</p>
      <p className="text-sm">Choose an input + output folder above and click <strong>Run OCR</strong>.</p>
    </div>
  );
}

function Row({ doc, onChanged }: { doc: DocumentRow; onChanged: () => void }): JSX.Element {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30">
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
