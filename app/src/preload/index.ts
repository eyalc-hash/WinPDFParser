/**
 * Context-isolated bridge. The renderer can only call these typed methods —
 * it cannot reach into Node, the filesystem, or the sidecar directly.
 */
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type SidecarRequest, type SidecarResponse } from "@shared/ipc";
import type {
  DocumentList,
  ElectronApi,
  HealthResponse,
  HealthDetails,
  JobList,
  JobProgress,
  OllamaStatus,
  ProcessAccepted,
  ProcessRequest,
  RetryAccepted,
  SearchResponse,
  SettingsModel,
  DocumentListOptions,
  SearchOptions,
  IndexHealth,
  UpdateStatus,
} from "@shared/types";

async function callSidecar<T>(req: SidecarRequest): Promise<T> {
  const res = (await ipcRenderer.invoke(IPC.Sidecar, req)) as SidecarResponse<T>;
  if (!res.ok) {
    const detail =
      res.data && typeof res.data === "object" && res.data !== null && "detail" in res.data
        ? String((res.data as { detail?: unknown }).detail)
        : res.error ?? "Sidecar request failed";
    throw new Error(detail);
  }
  return res.data as T;
}

const api: ElectronApi = {
  pickFolder: (kind) => ipcRenderer.invoke(IPC.PickFolder, kind),
  openPath: (path) => ipcRenderer.invoke(IPC.OpenPath, path),
  revealInFolder: (path) => ipcRenderer.invoke(IPC.RevealInFolder, path),
  openAppDataFolder: () => ipcRenderer.invoke(IPC.OpenAppData),
  exportDiagnostics: () => ipcRenderer.invoke(IPC.ExportDiagnostics),
  viewer: {
    loadPdf: (path) => ipcRenderer.invoke(IPC.ViewerLoadPdf, path),
    clear: () => ipcRenderer.invoke(IPC.ViewerClear),
  },
  updater: {
    setEnabled: (enabled) => ipcRenderer.invoke(IPC.UpdaterSetEnabled, enabled),
    checkNow: () => ipcRenderer.invoke(IPC.UpdaterCheckNow),
    quitAndInstall: () => ipcRenderer.invoke(IPC.UpdaterQuitAndInstall),
    onStatus: (cb) => {
      const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void =>
        cb(status);
      ipcRenderer.on(IPC.UpdaterStatus, listener);
      // Ask main for the current snapshot so the UI doesn't have to wait for
      // the next state change.
      ipcRenderer.send(IPC.UpdaterStatus);
      return () => ipcRenderer.removeListener(IPC.UpdaterStatus, listener);
    },
  },
  sidecar: {
    health: () => callSidecar<HealthResponse>({ method: "GET", path: "/health" }),
    process: (body: ProcessRequest) =>
      callSidecar<ProcessAccepted>({ method: "POST", path: "/process", body }),
    listJobs: () => callSidecar<JobList>({ method: "GET", path: "/jobs" }),
    getJob: (id) => callSidecar<JobProgress>({ method: "GET", path: `/jobs/${id}` }),
    cancelJob: (id) =>
      callSidecar<{ cancelled: boolean }>({ method: "POST", path: `/jobs/${id}/cancel` }),
    listDocuments: ({ limit = 200, offset = 0, status, sort }: DocumentListOptions = {}) =>
      callSidecar<DocumentList>({
        method: "GET",
        path: "/documents",
        query: { limit, offset, status, sort },
      }),
    listFailedDocuments: (limit = 20) =>
      callSidecar<DocumentList>({
        method: "GET",
        path: "/documents",
        query: { limit, status: "failed", sort: "processed_desc" },
      }),
    retryDocument: (id) =>
      callSidecar<RetryAccepted>({ method: "POST", path: `/documents/${id}/retry` }),
    deleteDocument: (id) =>
      callSidecar<{ deleted: boolean }>({ method: "DELETE", path: `/documents/${id}` }),
    search: (q, limit = 50, offset = 0, options: SearchOptions = {}) =>
      callSidecar<SearchResponse>({
        method: "GET",
        path: "/search",
        query: { q, limit, offset, ...options },
      }),
    getSettings: () => callSidecar<SettingsModel>({ method: "GET", path: "/settings" }),
    putSettings: (s) =>
      callSidecar<SettingsModel>({ method: "PUT", path: "/settings", body: s }),
    ollamaStatus: () => callSidecar<OllamaStatus>({ method: "GET", path: "/ollama/status" }),
    healthDetails: () => callSidecar<HealthDetails>({ method: "GET", path: "/health/details" }),
    getIndexHealth: () => callSidecar<IndexHealth>({ method: "GET", path: "/index/health" }),
    rebuildIndex: () =>
      callSidecar<{ rebuilt_rows: number }>({ method: "POST", path: "/index/rebuild" }),
    optimizeIndex: () =>
      callSidecar<{ optimized: boolean }>({ method: "POST", path: "/maintenance/optimize" }),
    clearTempFiles: () =>
      callSidecar<{ output_folder: string | null; cleared: number }>({
        method: "POST",
        path: "/recovery/clear-temp",
      }),
    retryFailedBatch: (limit = 200) =>
      callSidecar<{
        queued: number;
        skipped_non_retryable: number;
        skipped_retry_limit: number;
        job_ids: string[];
      }>({
        method: "POST",
        path: "/recovery/retry-failed",
        query: { limit },
      }),
  },
};

contextBridge.exposeInMainWorld("api", api);
