import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRow, ElectronApi, SettingsModel } from "../src/shared/types";
import { SettingsDrawer } from "../src/renderer/components/Settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settings: SettingsModel = {
  input_folder: "C:/in",
  output_folder: "C:/out",
  model: "llama3.2:3b",
  auto_update: false,
  ollama_url: "http://127.0.0.1:11434",
  rename_with_llm: true,
  ocr_language: "eng",
  max_concurrent_jobs: 1,
};

const listFailedDocuments = vi.fn<
  Parameters<ElectronApi["sidecar"]["listFailedDocuments"]>,
  ReturnType<ElectronApi["sidecar"]["listFailedDocuments"]>
>();
const retryDocument = vi.fn<
  Parameters<ElectronApi["sidecar"]["retryDocument"]>,
  ReturnType<ElectronApi["sidecar"]["retryDocument"]>
>();

beforeEach(() => {
  listFailedDocuments.mockResolvedValue({ items: makeFailures(), total: 2 });
  retryDocument.mockResolvedValue({ job_id: "retry-job" });
  window.api = {
    pickFolder: vi.fn(),
    openPath: vi.fn(),
    revealInFolder: vi.fn(),
    openAppDataFolder: vi.fn(),
    viewer: {
      loadPdf: vi.fn(),
      clear: vi.fn(),
    },
    sidecar: {
      health: vi.fn(),
      process: vi.fn(),
      listJobs: vi.fn(),
      getJob: vi.fn(),
      cancelJob: vi.fn(),
      listDocuments: vi.fn(),
      listFailedDocuments,
      retryDocument,
      deleteDocument: vi.fn(),
      search: vi.fn(),
      getSettings: vi.fn().mockResolvedValue(settings),
      putSettings: vi.fn().mockResolvedValue(settings),
      ollamaStatus: vi.fn().mockResolvedValue({ available: true, url: settings.ollama_url }),
    },
  } as unknown as ElectronApi;
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

async function renderSettings(): Promise<Root> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<SettingsDrawer onClose={vi.fn()} />);
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

function makeFailures(): DocumentRow[] {
  return [
    {
      id: 11,
      content_hash: "hash-11",
      original_path: "C:/in/failed-a.pdf",
      output_path: null,
      original_name: "failed-a.pdf",
      ai_name: null,
      page_count: null,
      processed_at: "2024-01-02T00:00:00Z",
      status: "failed",
      error: "OCR failed on page 1",
    },
    {
      id: 10,
      content_hash: "hash-10",
      original_path: "C:/in/failed-b.pdf",
      output_path: null,
      original_name: "failed-b.pdf",
      ai_name: null,
      page_count: null,
      processed_at: "2024-01-01T00:00:00Z",
      status: "failed",
      error: "Rename failed",
    },
  ];
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll("button")).filter(
    (candidate): candidate is HTMLButtonElement =>
      candidate instanceof HTMLButtonElement && candidate.textContent === name,
  );
}

describe("Settings recent failures", () => {
  it("renders recent failures and retries a failed document", async () => {
    const root = await renderSettings();

    expect(document.body.textContent).toContain("Recent failures");
    expect(document.body.textContent).toContain("failed-a.pdf");
    expect(document.body.textContent).toContain("failed-b.pdf");
    expect(document.body.textContent).toContain("OCR failed on page 1");

    await act(async () => {
      buttonsNamed("Retry")[0].click();
    });
    await flushEffects();

    expect(retryDocument).toHaveBeenCalledWith(11);

    await act(async () => root.unmount());
  });
});
