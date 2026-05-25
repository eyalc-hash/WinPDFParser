/**
 * Manages the Python sidecar subprocess lifecycle.
 *
 * Responsibilities:
 *  - Locate the sidecar executable (packaged or dev)
 *  - Spawn it on app start, read the JSON port-handshake from stdout
 *  - Poll /health until ready (with timeout)
 *  - Provide a `fetch`-style proxy for the main process to use
 *  - Kill it cleanly on shutdown (taskkill /T /F on Windows to nuke children)
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { app } from "electron";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

type SidecarChild = ChildProcessByStdio<null, Readable, Readable>;

export interface SidecarHandle {
  port: number;
  pid: number;
  kill: () => Promise<void>;
}

const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_INTERVAL_MS = 250;

function resolveSidecarCommand(): { cmd: string; args: string[]; cwd: string } {
  // 1. Packaged: extraResources path
  if (app.isPackaged) {
    const exe = process.platform === "win32" ? "pdf_parser_sidecar.exe" : "pdf_parser_sidecar";
    const packaged = join(process.resourcesPath, "sidecar", exe);
    if (existsSync(packaged)) {
      return { cmd: packaged, args: [], cwd: join(process.resourcesPath, "sidecar") };
    }
  }
  // 2. Dev: invoke python directly from the sidecar folder
  const repoRoot = resolve(app.getAppPath(), "..");
  const sidecarDir = join(repoRoot, "sidecar");
  const py = process.env.PDF_PARSER_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  return { cmd: py, args: ["-m", "pdf_parser_sidecar"], cwd: sidecarDir };
}

export class SidecarManager {
  private proc: SidecarChild | null = null;
  private handle: SidecarHandle | null = null;

  get baseUrl(): string {
    if (!this.handle) throw new Error("Sidecar not started");
    return `http://127.0.0.1:${this.handle.port}`;
  }

  async start(): Promise<SidecarHandle> {
    if (this.handle) return this.handle;

    const { cmd, args, cwd } = resolveSidecarCommand();
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      // Detach so we can taskkill the entire tree on shutdown.
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    this.proc = child;

    const handshake = await this.readHandshake(child);

    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(`[sidecar] ${chunk.toString()}`);
    });
    child.on("exit", (code, signal) => {
      process.stderr.write(`[sidecar] exited code=${code} signal=${signal}\n`);
      this.proc = null;
      this.handle = null;
    });

    this.handle = {
      port: handshake.port,
      pid: handshake.pid,
      kill: () => this.kill(),
    };

    await this.waitForHealth(handshake.port);
    return this.handle;
  }

  private async readHandshake(
    child: SidecarChild,
  ): Promise<{ port: number; pid: number }> {
    return new Promise((resolveP, rejectP) => {
      let buf = "";
      const timer = setTimeout(() => {
        rejectP(new Error("Timed out waiting for sidecar port handshake"));
      }, HEALTH_TIMEOUT_MS);
      const onData = (chunk: Buffer): void => {
        buf += chunk.toString();
        const nl = buf.indexOf("\n");
        if (nl === -1) return;
        const line = buf.slice(0, nl);
        try {
          const parsed = JSON.parse(line) as { port: number; pid: number };
          if (typeof parsed.port !== "number") throw new Error("invalid handshake");
          clearTimeout(timer);
          child.stdout.off("data", onData);
          resolveP(parsed);
        } catch (err) {
          clearTimeout(timer);
          child.stdout.off("data", onData);
          rejectP(new Error(`Sidecar handshake parse error: ${(err as Error).message} :: ${line}`));
        }
      };
      child.stdout.on("data", onData);
      child.on("error", (err) => {
        clearTimeout(timer);
        rejectP(err);
      });
    });
  }

  private async waitForHealth(port: number): Promise<void> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;
    let lastErr: unknown = null;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`);
        if (r.ok) return;
        lastErr = new Error(`status ${r.status}`);
      } catch (err) {
        lastErr = err;
      }
      await delay(HEALTH_POLL_INTERVAL_MS);
    }
    throw new Error(`Sidecar /health never returned OK: ${String(lastErr)}`);
  }

  async kill(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    this.proc = null;
    this.handle = null;
    try {
      if (process.platform === "win32" && proc.pid !== undefined) {
        // taskkill /T /F kills the whole process tree, defeating any uvicorn workers.
        spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { windowsHide: true });
      } else {
        proc.kill("SIGTERM");
        // Best-effort SIGKILL after a beat.
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 2_000);
      }
    } catch (err) {
      process.stderr.write(`[sidecar] kill error: ${String(err)}\n`);
    }
  }
}
