/**
 * IPC handlers for the main process. The renderer is sandboxed and never
 * touches the filesystem or the sidecar directly — every request flows
 * through this thin proxy.
 */
import { stat } from "node:fs/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserWindow, dialog, ipcMain, shell, app, protocol, net } from "electron";
import { IPC, type SidecarRequest, type SidecarResponse } from "@shared/ipc";
import type { SidecarManager } from "./sidecar";

const VIEWER_SCHEME = "pdfparser-doc";
const VIEWER_URL_BASE = `${VIEWER_SCHEME}://current`;
const DOCUMENT_PAGE_SIZE = 500;

let currentViewerPdfPath: string | null = null;
let viewerProtocolRegistered = false;

interface IndexedDocumentList {
  items: Array<{ output_path: string | null }>;
  total: number;
}

export function registerViewerProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: VIEWER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}

export function registerViewerProtocolHandler(): void {
  if (viewerProtocolRegistered) return;
  protocol.handle(VIEWER_SCHEME, async () => {
    if (!currentViewerPdfPath) return new Response("No PDF registered", { status: 404 });
    return net.fetch(pathToFileURL(currentViewerPdfPath).toString());
  });
  viewerProtocolRegistered = true;
}

export function registerIpcHandlers(sidecar: SidecarManager): void {
  ipcMain.handle(IPC.PickFolder, async (event, kind: "input" | "output") => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: kind === "input" ? "Choose input folder (PDFs)" : "Choose output folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(IPC.OpenPath, async (_e, path: string) => {
    await shell.openPath(path);
  });

  ipcMain.handle(IPC.RevealInFolder, async (_e, path: string) => {
    shell.showItemInFolder(path);
  });

  ipcMain.handle(IPC.OpenAppData, async () => {
    await shell.openPath(app.getPath("userData"));
  });

  ipcMain.handle(IPC.ExportDiagnostics, async () => {
    const filePath = await exportDiagnostics(sidecar);
    return filePath;
  });

  ipcMain.handle(IPC.ViewerLoadPdf, async (_e, rawPath: string): Promise<string | null> => {
    const safePath = await validateViewerPdfPath(sidecar, rawPath);
    if (!safePath) {
      currentViewerPdfPath = null;
      return null;
    }
    currentViewerPdfPath = safePath;
    return `${VIEWER_URL_BASE}?v=${Date.now()}`;
  });

  ipcMain.handle(IPC.ViewerClear, () => {
    currentViewerPdfPath = null;
  });

  ipcMain.handle(IPC.Sidecar, async (_e, req: SidecarRequest): Promise<SidecarResponse> => {
    return proxyToSidecar(sidecar, req);
  });
}

async function exportDiagnostics(sidecar: SidecarManager): Promise<string> {
  const userData = app.getPath("userData");
  const logsDir = path.join(userData, "logs");
  await mkdir(logsDir, { recursive: true });
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(logsDir, `diagnostics-${now}.json`);

  let sidecarHealth: SidecarResponse | null = null;
  try {
    sidecarHealth = await proxyToSidecar(sidecar, { method: "GET", path: "/health" });
  } catch {
    sidecarHealth = null;
  }

  const lastLogPath = path.join(logsDir, "sidecar.log");
  let tailLog: string | null = null;
  try {
    const content = await readFile(lastLogPath, "utf8");
    tailLog = content.split("\n").slice(-200).join("\n");
  } catch {
    tailLog = null;
  }

  const payload = {
    generated_at: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    os_release: os.release(),
    app_version: app.getVersion(),
    electron_version: process.versions.electron,
    chrome_version: process.versions.chrome,
    node_version: process.version,
    user_data: userData,
    sidecar_base_url: (() => {
      try {
        return sidecar.baseUrl;
      } catch {
        return null;
      }
    })(),
    sidecar_health: sidecarHealth,
    sidecar_log_tail: tailLog,
  };
  await writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  return outPath;
}

async function validateViewerPdfPath(
  sidecar: SidecarManager,
  rawPath: string,
): Promise<string | null> {
  const safePath = resolveSafePdfPath(rawPath);
  if (!safePath) {
    logViewerReject("invalid path", rawPath);
    return null;
  }

  try {
    const fileStat = await stat(safePath);
    if (!fileStat.isFile()) {
      logViewerReject("not a file", safePath);
      return null;
    }
  } catch {
    logViewerReject("file does not exist", safePath);
    return null;
  }

  if (!(await isIndexedPdfPath(sidecar, safePath))) {
    logViewerReject("file is not indexed", safePath);
    return null;
  }

  return safePath;
}

function resolveSafePdfPath(rawPath: string): string | null {
  if (typeof rawPath !== "string" || rawPath.trim() === "" || rawPath.includes("\0")) return null;
  if (rawPath.split(/[\\/]+/).includes("..")) return null;
  if (!path.isAbsolute(rawPath) && !path.win32.isAbsolute(rawPath)) return null;

  const resolved = path.win32.isAbsolute(rawPath) ? path.win32.resolve(rawPath) : path.resolve(rawPath);
  if (resolved.split(/[\\/]+/).includes("..")) return null;
  if (path.extname(resolved).toLowerCase() !== ".pdf") return null;
  return resolved;
}

async function isIndexedPdfPath(sidecar: SidecarManager, safePath: string): Promise<boolean> {
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const res = await proxyToSidecar(sidecar, {
      method: "GET",
      path: "/documents",
      query: { limit: DOCUMENT_PAGE_SIZE, offset },
    });
    if (!res.ok || !isIndexedDocumentList(res.data)) return false;

    total = res.data.total;
    if (
      res.data.items.some((document) => {
        if (!document.output_path) return false;
        const indexedPath = resolveSafePdfPath(document.output_path);
        return indexedPath !== null && samePath(indexedPath, safePath);
      })
    ) {
      return true;
    }

    if (res.data.items.length === 0) break;
    offset += res.data.items.length;
  }

  return false;
}

function isIndexedDocumentList(data: unknown): data is IndexedDocumentList {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as { items?: unknown; total?: unknown };
  return Array.isArray(candidate.items) && typeof candidate.total === "number";
}

function samePath(left: string, right: string): boolean {
  if (process.platform === "win32") return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function logViewerReject(reason: string, value: string): void {
  process.stderr.write(`[main] viewer rejected PDF (${reason}): ${value}\n`);
}

async function proxyToSidecar(
  sidecar: SidecarManager,
  req: SidecarRequest,
): Promise<SidecarResponse> {
  try {
    const url = new URL(req.path, sidecar.baseUrl);
    if (req.query) {
      for (const [k, v] of Object.entries(req.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const init: RequestInit = {
      method: req.method,
      headers: req.body ? { "Content-Type": "application/json" } : undefined,
      body: req.body ? JSON.stringify(req.body) : undefined,
    };
    const r = await fetch(url, init);
    const text = await r.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: r.ok, status: r.status, data, error: r.ok ? undefined : `HTTP ${r.status}` };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: (err as Error).message };
  }
}
