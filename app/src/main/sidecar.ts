/**
 * Manages the Python sidecar subprocess lifecycle.
 *
 * Responsibilities:
 *  - Locate the sidecar executable (packaged or dev)
 *  - Spawn it on app start, read the JSON port-handshake from stdout
 *  - Poll /health until ready (with timeout)
 *  - Provide a `fetch`-style proxy for the main process to use
 *  - Kill it cleanly on shutdown (taskkill /T /F on Windows to nuke children)
 *  - Capture startup errors + a ring buffer of recent stderr lines so the
 *    renderer can surface them to the user without needing a terminal.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { app } from "electron";
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

type SidecarChild = ChildProcessByStdio<null, Readable, Readable>;

export interface SidecarHandle {
  port: number;
  pid: number;
  kill: () => Promise<void>;
}

export interface SidecarDiagnostics {
  /** True while a sidecar child process is alive. */
  running: boolean;
  /** Resolved command (path or interpreter) and args used to spawn the sidecar. */
  command: string | null;
  /** Last error encountered during spawn / handshake / health probe, if any. */
  startError: string | null;
  /** Most recent exit code/signal, or null if the sidecar is still running / never started. */
  lastExit: { code: number | null; signal: NodeJS.Signals | null } | null;
  /** Ring buffer of the most recent stderr lines from the sidecar. */
  stderrTail: string[];
  /** Absolute path of the file the manager mirrors sidecar stderr to (if any). */
  logFile: string | null;
}

const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_INTERVAL_MS = 250;
const STDERR_BUFFER_LINES = 200;

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
  private command: string | null = null;
  private startError: string | null = null;
  private lastExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  private stderrTail: string[] = [];
  private stderrCarry = "";
  private logStream: WriteStream | null = null;
  private logFile: string | null = null;

  get baseUrl(): string {
    if (!this.handle) throw new Error("Sidecar not started");
    return `http://127.0.0.1:${this.handle.port}`;
  }

  getDiagnostics(): SidecarDiagnostics {
    return {
      running: this.proc !== null,
      command: this.command,
      startError: this.startError,
      lastExit: this.lastExit,
      stderrTail: [...this.stderrTail],
      logFile: this.logFile,
    };
  }

  async start(): Promise<SidecarHandle> {
    if (this.handle) return this.handle;

    const { cmd, args, cwd } = resolveSidecarCommand();
    this.command = [cmd, ...args].join(" ");
    this.startError = null;
    this.ensureLogStream();

    let child: SidecarChild;
    try {
      child = spawn(cmd, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        // Detach so we can taskkill the entire tree on shutdown.
        windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.recordStartError(`spawn failed: ${msg}`);
      throw err;
    }
    this.proc = child;

    // Attach stderr capture *before* awaiting the handshake so we don't lose
    // early failure output (e.g. ModuleNotFoundError that prints to stderr
    // before the child exits).
    child.stderr.on("data", (chunk: Buffer) => {
      this.captureStderr(chunk.toString());
    });
    child.on("exit", (code, signal) => {
      this.lastExit = { code, signal: signal as NodeJS.Signals | null };
      this.appendStderrLine(`[sidecar] exited code=${code} signal=${signal ?? "null"}`);
      this.proc = null;
      this.handle = null;
    });
    child.on("error", (err) => {
      this.appendStderrLine(`[sidecar] child error: ${err.message}`);
    });

    try {
      const handshake = await this.readHandshake(child);
      this.handle = {
        port: handshake.port,
        pid: handshake.pid,
        kill: () => this.kill(),
      };
      await this.waitForHealth(handshake.port);
      return this.handle;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.recordStartError(msg);
      throw err;
    }
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
      this.appendStderrLine(`[sidecar] kill error: ${String(err)}`);
    }
  }

  private recordStartError(message: string): void {
    this.startError = message;
    this.appendStderrLine(`[sidecar] start error: ${message}`);
  }

  private captureStderr(text: string): void {
    // Mirror raw stderr to stdout (terminal) and the log file, then split into
    // lines for the ring buffer so the UI can show a clean tail.
    process.stderr.write(`[sidecar] ${text}`);
    this.logStream?.write(text);

    const combined = this.stderrCarry + text;
    const parts = combined.split(/\r?\n/);
    this.stderrCarry = parts.pop() ?? "";
    for (const line of parts) {
      if (line.length > 0) this.pushTail(line);
    }
  }

  private appendStderrLine(line: string): void {
    process.stderr.write(`${line}\n`);
    this.logStream?.write(`${line}\n`);
    this.pushTail(line);
  }

  private pushTail(line: string): void {
    // Cap line length to keep payloads small over IPC.
    const trimmed = line.length > 2000 ? `${line.slice(0, 2000)}…` : line;
    this.stderrTail.push(trimmed);
    if (this.stderrTail.length > STDERR_BUFFER_LINES) {
      this.stderrTail.splice(0, this.stderrTail.length - STDERR_BUFFER_LINES);
    }
  }

  private ensureLogStream(): void {
    if (this.logStream) return;
    try {
      const logsDir = join(app.getPath("userData"), "logs");
      mkdirSync(logsDir, { recursive: true });
      this.logFile = join(logsDir, "sidecar.log");
      this.logStream = createWriteStream(this.logFile, { flags: "a" });
      this.logStream.on("error", (err) => {
        // Disable file logging on any I/O error so we don't spam.
        process.stderr.write(`[sidecar] log stream error: ${err.message}\n`);
        this.logStream = null;
      });
    } catch (err) {
      process.stderr.write(`[sidecar] could not open log file: ${String(err)}\n`);
      this.logStream = null;
      this.logFile = null;
    }
  }
}
