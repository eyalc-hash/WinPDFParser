import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WatchBanner } from "../src/renderer/components/WatchBanner";
import type {
  ElectronApi,
  JobList,
  JobProgress,
  WatchStatusResponse,
} from "../src/shared/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseStatus: WatchStatusResponse = {
  enabled: true,
  interval_seconds: 60,
  input_folder: "C:/users/me/Inbox",
  output_folder: "C:/users/me/Indexed",
  last_scan_at: new Date().toISOString(),
  last_scan_new_files: 0,
  last_scan_error: null,
  next_scan_at: new Date(Date.now() + 30_000).toISOString(),
  active_jobs: 0,
  active_batch_ids: [],
};

let watchStatus: ReturnType<typeof vi.fn>;
let watchScanNow: ReturnType<typeof vi.fn>;
let listJobs: ReturnType<typeof vi.fn>;
let getJob: ReturnType<typeof vi.fn>;
let putSettings: ReturnType<typeof vi.fn>;
let getSettings: ReturnType<typeof vi.fn>;
let retryDocument: ReturnType<typeof vi.fn>;

beforeEach(() => {
  watchStatus = vi.fn().mockResolvedValue(baseStatus);
  watchScanNow = vi.fn().mockResolvedValue({
    triggered: false,
    detected: 0,
    job_ids: [],
    batch_id: null,
    reason: null,
  });
  listJobs = vi.fn().mockResolvedValue({ items: [] } satisfies JobList);
  getJob = vi.fn();
  putSettings = vi.fn().mockImplementation((s) => Promise.resolve(s));
  getSettings = vi.fn().mockResolvedValue({
    input_folder: "C:/users/me/Inbox",
    output_folder: "C:/users/me/Indexed",
    model: "llama3.2:3b",
    auto_update: false,
    ollama_url: "http://127.0.0.1:11434",
    rename_with_llm: false,
    ocr_language: "eng",
    max_concurrent_jobs: 1,
    watch_enabled: true,
    watch_interval_seconds: 60,
  });
  retryDocument = vi.fn().mockResolvedValue({ job_id: "retry" });

  window.api = {
    sidecar: {
      watchStatus,
      watchScanNow,
      listJobs,
      getJob,
      putSettings,
      getSettings,
      retryDocument,
    },
  } as unknown as ElectronApi;
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function render(): Promise<Root> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<WatchBanner onJobFinished={() => undefined} />);
  });
  await flush();
  return root;
}

describe("WatchBanner", () => {
  it("renders nothing while monitoring is disabled and idle", async () => {
    watchStatus.mockResolvedValue({ ...baseStatus, enabled: false, last_scan_new_files: 0 });
    const root = await render();
    expect(document.querySelector("[aria-label='Folder monitoring']")).toBeNull();
    await act(async () => root.unmount());
  });

  it("shows the collapsed summary with folder and detected counts", async () => {
    watchStatus.mockResolvedValue({
      ...baseStatus,
      last_scan_new_files: 42,
    });
    const root = await render();
    const section = document.querySelector("[aria-label='Folder monitoring']");
    expect(section).not.toBeNull();
    const text = section?.textContent ?? "";
    expect(text).toContain("Monitoring");
    expect(text).toContain("42 new PDFs detected");
    // Collapsed: no batch panel yet.
    expect(document.body.textContent).not.toContain("Batch 1");
    await act(async () => root.unmount());
  });

  it("expands to show batch breakdown grouped by batch_id", async () => {
    const jobs: JobProgress[] = [
      {
        job_id: "j1",
        total: 5,
        processed: 5,
        skipped: 0,
        failed: 0,
        current_file: null,
        state: "done",
        started_at: new Date(Date.now() - 5000).toISOString(),
        finished_at: new Date().toISOString(),
        trigger: "watch",
        batch_id: "batch-A",
        files: null,
      },
      {
        job_id: "j2",
        total: 5,
        processed: 2,
        skipped: 0,
        failed: 1,
        current_file: "x.pdf",
        state: "running",
        started_at: new Date().toISOString(),
        finished_at: null,
        trigger: "watch",
        batch_id: "batch-A",
        files: null,
      },
    ];
    listJobs.mockResolvedValue({ items: jobs });
    watchStatus.mockResolvedValue({
      ...baseStatus,
      last_scan_new_files: 10,
      active_batch_ids: ["batch-A"],
    });

    const root = await render();
    const toggle = document.querySelector(
      "button[aria-expanded='false']",
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    await act(async () => toggle!.click());
    await flush();

    expect(document.body.textContent).toContain("Batch 1");
    expect(document.body.textContent).toContain("7 done");
    expect(document.body.textContent).toContain("1 failed");
    expect(document.body.textContent).toContain("10 total");

    await act(async () => root.unmount());
  });

  it("calls scanNow on demand", async () => {
    const root = await render();
    const button = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Scan now",
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
    await flush();
    expect(watchScanNow).toHaveBeenCalledTimes(1);
    expect(watchStatus).toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("toggles monitoring via the pause button", async () => {
    const root = await render();
    const pauseButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Pause monitoring",
    );
    expect(pauseButton).toBeDefined();
    await act(async () => pauseButton!.click());
    await flush();
    expect(putSettings).toHaveBeenCalledTimes(1);
    const [arg] = putSettings.mock.calls[0];
    expect(arg.watch_enabled).toBe(false);
    await act(async () => root.unmount());
  });
});
