import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronApi, SearchHit } from "../src/shared/types";
import { Viewer } from "../src/renderer/components/Viewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hit: SearchHit = {
  document_id: 1,
  original_name: "invoice.pdf",
  ai_name: "Invoice",
  output_path: "C:/docs/invoice.pdf",
  snippet: "[[invoice]]",
  score: 1,
  processed_at: null,
  title: null,
  author: null,
  source_created_at: null,
};

const viewerApi = {
  loadPdf: vi.fn(),
  clear: vi.fn(),
};

beforeEach(() => {
  viewerApi.loadPdf.mockResolvedValue("pdfparser-doc://current?v=1");
  viewerApi.clear.mockResolvedValue(undefined);
  window.api = {
    pickFolder: vi.fn(),
    openPath: vi.fn(),
    revealInFolder: vi.fn(),
    openAppDataFolder: vi.fn(),
    exportDiagnostics: vi.fn(),
    getSidecarDiagnostics: vi.fn(),
    submitFeedback: vi.fn().mockResolvedValue({ success: true }),
    viewer: viewerApi,
    updater: {
      setEnabled: vi.fn().mockResolvedValue(undefined),
      checkNow: vi.fn().mockResolvedValue(undefined),
      quitAndInstall: vi.fn().mockResolvedValue(undefined),
      onStatus: vi.fn().mockReturnValue(() => undefined),
    },
    sidecar: {
      health: vi.fn(),
      process: vi.fn(),
      listJobs: vi.fn(),
      getJob: vi.fn(),
      cancelJob: vi.fn(),
      listDocuments: vi.fn(),
      listFailedDocuments: vi.fn(),
      retryDocument: vi.fn(),
      deleteDocument: vi.fn(),
      search: vi.fn(),
      getSettings: vi.fn(),
      putSettings: vi.fn(),
      ollamaStatus: vi.fn(),
      healthDetails: vi.fn(),
      getIndexHealth: vi.fn(),
      rebuildIndex: vi.fn(),
      optimizeIndex: vi.fn(),
      clearTempFiles: vi.fn(),
      retryFailedBatch: vi.fn(),
    },
  } as unknown as ElectronApi;
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

async function renderViewer(props: Partial<ComponentProps<typeof Viewer>> = {}): Promise<Root> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <Viewer
        hit={hit}
        index={0}
        offset={0}
        total={1}
        canPrevious={false}
        canNext={false}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onClose={vi.fn()}
        {...props}
      />,
    );
  });
  return root;
}

describe("Viewer keyboard navigation", () => {
  it("calls next and previous shortcuts when navigation is available", async () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const root = await renderViewer({ canNext: true, canPrevious: true, onNext, onPrevious });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });

    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onPrevious).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
  });

  it("honors index bounds and still allows Escape to close", async () => {
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const onClose = vi.fn();
    const root = await renderViewer({
      canNext: false,
      canPrevious: false,
      onNext,
      onPrevious,
      onClose,
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(onNext).not.toHaveBeenCalled();
    expect(onPrevious).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });
});
