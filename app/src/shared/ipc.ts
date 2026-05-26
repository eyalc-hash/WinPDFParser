/** Channel names shared by main + preload. */
export const IPC = {
  PickFolder: "dialog:pick-folder",
  OpenPath: "shell:open-path",
  OpenPdfAtPage: "shell:open-pdf-at-page",
  RevealInFolder: "shell:reveal",
  OpenAppData: "shell:open-app-data",
  ExportDiagnostics: "app:export-diagnostics",
  Sidecar: "sidecar:request",
  SidecarDiagnostics: "sidecar:diagnostics",
  ViewerLoadPdf: "viewer:load-pdf",
  ViewerClear: "viewer:clear",
  UpdaterSetEnabled: "updater:set-enabled",
  UpdaterCheckNow: "updater:check-now",
  UpdaterQuitAndInstall: "updater:quit-and-install",
  /** Channel used by main → renderer to push UpdateStatus events. */
  UpdaterStatus: "updater:status",
} as const;

export type SidecarMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface SidecarRequest {
  method: SidecarMethod;
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

export interface SidecarResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}
