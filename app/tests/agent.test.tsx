import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAnswer, ElectronApi } from "../src/shared/types";
import { Agent } from "../src/renderer/components/Agent";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ask = vi.fn<ElectronApi["sidecar"]["agent"]["ask"]>();
const openPath = vi.fn();

beforeEach(() => {
  ask.mockReset();
  openPath.mockReset();
  window.api = {
    pickFolder: vi.fn(),
    openPath,
    revealInFolder: vi.fn(),
    openAppDataFolder: vi.fn(),
    exportDiagnostics: vi.fn(),
    getSidecarDiagnostics: vi.fn(),
    viewer: { loadPdf: vi.fn(), clear: vi.fn() },
    updater: {
      setEnabled: vi.fn(),
      checkNow: vi.fn(),
      quitAndInstall: vi.fn(),
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
      agent: { ask },
    },
  } as unknown as ElectronApi;
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

async function renderAgent(): Promise<Root> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<Agent />);
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

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButton(label: string): HTMLButtonElement {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  );
  const match = buttons.find((b) => b.textContent?.trim() === label);
  if (!match) throw new Error(`button "${label}" not found`);
  return match;
}

describe("Agent tab", () => {
  it("renders an empty state before any questions", async () => {
    const root = await renderAgent();
    expect(document.body.textContent).toContain("Ask the Agent");
    await act(async () => root.unmount());
  });

  it("submits a question, renders the answer with citations and queries", async () => {
    const answer: AgentAnswer = {
      question: "What does Acme do?",
      answer: "Acme Corp provides consulting services.",
      queries: ["acme", "consulting"],
      citations: [
        {
          document_id: 1,
          original_name: "contract.pdf",
          ai_name: "Acme Consulting Contract",
          output_path: "C:/out/contract.pdf",
          passage: "Acme Corp agrees to provide consulting services…",
        },
      ],
      model_available: true,
    };
    ask.mockResolvedValueOnce(answer);

    const root = await renderAgent();
    const input = document.querySelector("input") as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "What does Acme do?");
    });
    await act(async () => {
      findButton("Ask").click();
    });
    await flushEffects();

    expect(ask).toHaveBeenCalledWith("What does Acme do?");
    expect(document.body.textContent).toContain("Acme Corp provides consulting services.");
    expect(document.body.textContent).toContain("Acme Consulting Contract");
    expect(document.body.textContent).toContain("acme");
    expect(document.body.textContent).toContain("consulting");
    await act(async () => root.unmount());
  });

  it("shows a warning when the local model is unavailable", async () => {
    ask.mockResolvedValueOnce({
      question: "anything",
      answer: "Matching passages from contract.pdf.",
      queries: ["anything"],
      citations: [
        {
          document_id: 1,
          original_name: "contract.pdf",
          ai_name: null,
          output_path: null,
          passage: "snippet",
        },
      ],
      model_available: false,
    });
    const root = await renderAgent();
    const input = document.querySelector("input") as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "anything");
    });
    await act(async () => {
      findButton("Ask").click();
    });
    await flushEffects();

    expect(document.body.textContent).toContain("local model is unavailable");
    await act(async () => root.unmount());
  });

  it("surfaces sidecar errors instead of crashing", async () => {
    ask.mockRejectedValueOnce(new Error("sidecar offline"));
    const root = await renderAgent();
    const input = document.querySelector("input") as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "Will this fail?");
    });
    await act(async () => {
      findButton("Ask").click();
    });
    await flushEffects();

    expect(document.body.textContent).toContain("sidecar offline");
    await act(async () => root.unmount());
  });
});
