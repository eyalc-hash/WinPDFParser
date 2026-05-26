import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronApi } from "../src/shared/types";
import { Search } from "../src/renderer/components/Search";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const search = vi.fn<
  Parameters<ElectronApi["sidecar"]["search"]>,
  ReturnType<ElectronApi["sidecar"]["search"]>
>();
const openPdfAtPage = vi.fn();
const viewerLoadPdf = vi.fn();

beforeEach(() => {
  search.mockResolvedValue({
    query: "invoice",
    total: 1,
    limit: 25,
    offset: 0,
    rank: "relevance",
    hits: [
      {
        document_id: 1,
        original_name: "invoice.pdf",
        original_path: "C:/source/invoice.pdf",
        ai_name: "invoice",
        output_path: "C:/out/ocr_invoice.pdf",
        snippet: "…[[invoice]] number 42…",
        score: 1.2,
        page_number: 3,
        processed_at: null,
        title: null,
        author: null,
        source_created_at: null,
      },
    ],
  });
  viewerLoadPdf.mockResolvedValue("pdfparser-doc://current?v=1");
  window.api = {
    pickFolder: vi.fn(),
    openPath: vi.fn(),
    openPdfAtPage,
    revealInFolder: vi.fn(),
    openAppDataFolder: vi.fn(),
    exportDiagnostics: vi.fn(),
    getSidecarDiagnostics: vi.fn(),
    viewer: {
      loadPdf: viewerLoadPdf,
      clear: vi.fn(),
    },
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
      search,
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

async function renderSearch(): Promise<Root> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<Search />);
  });
  return root;
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Search results actions", () => {
  it("opens original PDF at the matched page and loads original path in viewer", async () => {
    const root = await renderSearch();

    const input = document.querySelector("input[aria-label='Search OCR text']") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "invoice");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      buttonNamed("Search").click();
    });
    await flushEffects();
    expect(search).toHaveBeenCalled();

    expect(document.body.textContent).toContain("Page 3");
    expect(document.body.textContent).toContain("invoice number 42");

    await act(async () => {
      buttonNamed("Open original").click();
    });
    expect(openPdfAtPage).toHaveBeenCalledWith("C:/source/invoice.pdf", 3);

    await act(async () => {
      buttonNamed("View match").click();
    });
    await flushEffects();
    expect(viewerLoadPdf).toHaveBeenCalledWith("C:/source/invoice.pdf");

    await act(async () => root.unmount());
  });
});

function buttonNamed(name: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === name,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${name}`);
  return button;
}
