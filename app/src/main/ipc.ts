/**
 * IPC handlers for the main process. The renderer is sandboxed and never
 * touches the filesystem or the sidecar directly — every request flows
 * through this thin proxy.
 */
import { BrowserWindow, dialog, ipcMain, shell, app } from "electron";
import { IPC, type SidecarRequest, type SidecarResponse } from "@shared/ipc";
import type { SidecarManager } from "./sidecar";

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

  ipcMain.handle(IPC.Sidecar, async (_e, req: SidecarRequest): Promise<SidecarResponse> => {
    return proxyToSidecar(sidecar, req);
  });
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
