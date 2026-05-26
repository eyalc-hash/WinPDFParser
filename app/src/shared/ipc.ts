/** Channel names shared by main + preload. */
export const IPC = {
  PickFolder: "dialog:pick-folder",
  OpenPath: "shell:open-path",
  RevealInFolder: "shell:reveal",
  OpenAppData: "shell:open-app-data",
  ExportDiagnostics: "app:export-diagnostics",
  Sidecar: "sidecar:request",
  SidecarDiagnostics: "sidecar:diagnostics",
  ViewerLoadPdf: "viewer:load-pdf",
  ViewerClear: "viewer:clear",
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
