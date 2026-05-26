import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRow, ElectronApi } from "../src/shared/types";
import { Library } from "../src/renderer/components/Library";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const listDocuments = vi.fn<
  Parameters<ElectronApi["sidecar"]["listDocuments"]>,
  ReturnType<ElectronApi["sidecar"]["listDocuments"]>
>();
const retryDocument = vi.fn<
  Parameters<ElectronApi["sidecar"]["retryDocument"]>,
  ReturnType<ElectronApi["sidecar"]["retryDocument"]>
>();

beforeEach(() => {
  listDocuments.mockImplementation(async () => ({ items: makeDocs(50), total: 137 }));
  retryDocument.mockResolvedValue({ job_id: "retry-job" });
  window.api = {
    pickFolder: vi.fn(),
    openPath: vi.fn(),
    revealInFolder: vi.fn(),
    openAppDataFolder: vi.fn(),
    exportDiagnostics: vi.fn(),
    viewer: {
      loadPdf: vi.fn(),
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
      listDocuments,
      listFailedDocuments: vi.fn(),
      retryDocument,
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

async function renderLibrary(): Promise<Root> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<Library refreshKey={0} />);
  });
  await flushEffects();
  return root;
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function makeDocs(count: number): DocumentRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    content_hash: `hash-${index}`,
    original_path: `C:/in/${index}.pdf`,
    output_path: `C:/out/${index}.pdf`,
    original_name: `${index}.pdf`,
    ai_name: `doc-${index}`,
    page_count: 10,
    processed_at: "2024-01-01T00:00:00Z",
    status: "done",
    error: null,
    error_category: null,
    retryable: true,
    retry_count: 0,
    title: null,
    author: null,
    source_created_at: null,
  }));
}

describe("Library pagination and filtering", () => {
  it("renders failure reasons and retries failed documents", async () => {
    const failed = makeDocs(1)[0];
    failed.status = "failed";
    failed.error = "OCR engine timed out while reading page 3";
    listDocuments.mockResolvedValueOnce({ items: [failed], total: 1 });
    const root = await renderLibrary();

    expect(document.body.textContent).toContain("OCR engine timed out while reading page 3");

    await act(async () => {
      buttonNamed("Retry").click();
    });
    await flushEffects();

    expect(retryDocument).toHaveBeenCalledWith(failed.id);

    await act(async () => root.unmount());
  });

  it("renders the page indicator", async () => {
    const root = await renderLibrary();

    expect(document.body.textContent).toContain("Showing 1–50 of 137");

    await act(async () => root.unmount());
  });

  it("requests the next page with offset 50", async () => {
    const root = await renderLibrary();

    const next = buttonNamed("Next");
    await act(async () => {
      next.click();
    });
    await flushEffects();

    expect(listDocuments).toHaveBeenLastCalledWith({
      limit: 50,
      offset: 50,
      status: undefined,
      sort: "processed_desc",
    });

    await act(async () => root.unmount());
  });

  it("resets offset and sends status when the status filter changes", async () => {
    const root = await renderLibrary();

    await act(async () => {
      buttonNamed("Next").click();
    });
    await flushEffects();

    const [statusSelect] = document.querySelectorAll("select");
    await act(async () => {
      statusSelect.value = "failed";
      statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushEffects();

    expect(listDocuments).toHaveBeenLastCalledWith({
      limit: 50,
      offset: 0,
      status: "failed",
      sort: "processed_desc",
    });

    await act(async () => root.unmount());
  });

  it("resets offset and sends sort when the sort option changes", async () => {
    const root = await renderLibrary();

    await act(async () => {
      buttonNamed("Next").click();
    });
    await flushEffects();

    const [, sortSelect] = document.querySelectorAll("select");
    await act(async () => {
      sortSelect.value = "name_asc";
      sortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flushEffects();

    expect(listDocuments).toHaveBeenLastCalledWith({
      limit: 50,
      offset: 0,
      status: undefined,
      sort: "name_asc",
    });

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
