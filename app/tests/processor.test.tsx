import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronApi, SettingsModel } from "../src/shared/types";
import { Processor } from "../src/renderer/components/Processor";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pickFolder = vi.fn();
const getSettings = vi.fn();
const putSettings = vi.fn();

const baseSettings: SettingsModel = {
  input_folder: null,
  output_folder: null,
  model: "llama3.2:3b",
  auto_update: false,
  ollama_url: "http://127.0.0.1:11434",
  rename_with_llm: true,
  ocr_language: "eng",
  max_concurrent_jobs: 1,
  watch_enabled: true,
  watch_interval_seconds: 60,
};

beforeEach(() => {
  pickFolder.mockResolvedValue("C:/docs/invoices");
  getSettings.mockResolvedValue(baseSettings);
  putSettings.mockResolvedValue(baseSettings);
  window.api = {
    pickFolder,
    openPath: vi.fn(),
    openPdfAtPage: vi.fn(),
    revealInFolder: vi.fn(),
    openAppDataFolder: vi.fn(),
    exportDiagnostics: vi.fn(),
    getSidecarDiagnostics: vi.fn(),
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
      listDocuments: vi.fn(),
      listFailedDocuments: vi.fn(),
      retryDocument: vi.fn(),
      deleteDocument: vi.fn(),
      search: vi.fn(),
      getSettings,
      putSettings,
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

async function renderProcessor(): Promise<Root> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<Processor onFinished={vi.fn()} />);
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

describe("Processor default output folder", () => {
  it("auto-fills output from input when the user picks input first", async () => {
    const root = await renderProcessor();

    const chooseButtons = Array.from(document.querySelectorAll("button")).filter(
      (button) => button.textContent === "Choose…",
    );
    await act(async () => {
      chooseButtons[0].click();
    });
    await flushEffects();

    expect(document.body.textContent).toContain("C:/docs/invoices/ocr_output");
    expect(document.body.textContent).toContain("Default output folder set from input.");
    expect(putSettings).toHaveBeenCalled();
    expect(putSettings.mock.calls.at(-1)?.[0]?.output_folder).toBe("C:/docs/invoices/ocr_output");

    await act(async () => root.unmount());
  });
});
