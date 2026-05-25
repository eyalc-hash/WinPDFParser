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
  JobList,
  JobProgress,
  OllamaStatus,
  ProcessAccepted,
  ProcessRequest,
  RetryAccepted,
  SearchResponse,
  SettingsModel,
  DocumentListOptions,
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
  viewer: {
    loadPdf: (path) => ipcRenderer.invoke(IPC.ViewerLoadPdf, path),
    clear: () => ipcRenderer.invoke(IPC.ViewerClear),
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
    search: (q, limit = 50, offset = 0) =>
      callSidecar<SearchResponse>({
        method: "GET",
        path: "/search",
        query: { q, limit, offset },
      }),
    getSettings: () => callSidecar<SettingsModel>({ method: "GET", path: "/settings" }),
    putSettings: (s) =>
      callSidecar<SettingsModel>({ method: "PUT", path: "/settings", body: s }),
    ollamaStatus: () => callSidecar<OllamaStatus>({ method: "GET", path: "/ollama/status" }),
  },
};

contextBridge.exposeInMainWorld("api", api);
