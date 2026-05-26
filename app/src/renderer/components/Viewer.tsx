import { useEffect, useRef, useState } from "react";
import type { SearchHit } from "@shared/types";
import { Button } from "./ui/Button";

interface ViewerProps {
  hit: SearchHit;
  index: number;
  offset: number;
  total: number;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void | Promise<void>;
  onNext: () => void | Promise<void>;
  onClose: () => void;
  navigationDisabled?: boolean;
  preferredPath?: "original" | "output";
}

export function Viewer({
  hit,
  index,
  offset,
  total,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  onClose,
  navigationDisabled = false,
  preferredPath = "output",
}: ViewerProps): JSX.Element {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const title = hit.ai_name ?? hit.original_name;
  const titleId = "pdf-viewer-title";
  const currentPosition = offset + index + 1;

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const pdfPath = preferredPath === "original" ? hit.original_path : (hit.output_path ?? hit.original_path);

  useEffect(() => {
    let cancelled = false;
    setPdfUrl(null);
    setLoadError(null);

    if (!pdfPath) {
      setLoadError("This search hit does not have a PDF to display.");
      return;
    }

    setLoading(true);
    window.api.viewer
      .loadPdf(pdfPath)
      .then((url) => {
        if (cancelled) return;
        if (url) {
          setPdfUrl(hit.page_number && hit.page_number > 0 ? `${url}#page=${hit.page_number}` : url);
        } else {
          setLoadError("The PDF could not be loaded in the app.");
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hit.document_id, pdfPath, hit.page_number]);

  useEffect(() => {
    return () => {
      void window.api.viewer.clear();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      const key = event.key.toLowerCase();
      if ((key === "j" || event.key === "ArrowRight") && canNext && !navigationDisabled) {
        event.preventDefault();
        void onNext();
      } else if ((key === "k" || event.key === "ArrowLeft") && canPrevious && !navigationDisabled) {
        event.preventDefault();
        void onPrevious();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canNext, canPrevious, navigationDisabled, onClose, onNext, onPrevious]);

  return (
    <section
      className="absolute inset-0 z-20 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-sm font-semibold">
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">
            Hit {currentPosition} of {total}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            aria-label="Previous search hit"
            disabled={!canPrevious || navigationDisabled}
            onClick={() => void onPrevious()}
          >
            Previous hit
          </Button>
          <Button
            variant="ghost"
            aria-label="Next search hit"
            disabled={!canNext || navigationDisabled}
            onClick={() => void onNext()}
          >
            Next hit
          </Button>
          {pdfPath ? (
            <Button
              variant="ghost"
              aria-label="Reveal PDF in folder"
              onClick={() => window.api.revealInFolder(pdfPath)}
            >
              Reveal in folder
            </Button>
          ) : null}
          {pdfPath ? (
            <Button
              variant="ghost"
              aria-label="Open PDF externally"
              onClick={() => window.api.openPdfAtPage(pdfPath, hit.page_number)}
            >
              Open externally
            </Button>
          ) : null}
          <Button ref={closeButtonRef} variant="ghost" aria-label="Close viewer" onClick={onClose}>
            ×
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 bg-black/20">
        {loading ? (
          <div className="m-auto text-sm text-muted-foreground">Loading PDF…</div>
        ) : loadError ? (
          <div className="m-auto max-w-md rounded-md border border-border bg-card p-4 text-sm text-destructive">
            {loadError}
          </div>
        ) : pdfUrl ? (
          <iframe
            key={`${hit.document_id}-${index}-${pdfUrl}`}
            title={`PDF viewer for ${title}`}
            className="h-full w-full border-0 bg-background"
            src={pdfUrl}
          />
        ) : null}
      </div>
    </section>
  );
}
