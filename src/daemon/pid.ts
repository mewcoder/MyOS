/** PID-file based daemon — fallback for platforms without launchd/systemd.
 *
 * Uses detached spawn + PID file for process tracking.
 * This is the simplest backend: no crash recovery, no autostart on boot.
 */

import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { openSync, closeSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { isMyosProcess } from "../single-instance.js";
import { DAEMON_PID_PATH as PID_PATH, TEXT_LOG_PATH as LOG_PATH, RUN_DIR } from "../paths.js";
import type { DaemonConfig, DaemonManager } from "./types.js";

async function readPid(): Promise<number | null> {
  try {
    const data = await readFile(PID_PATH, "utf8");
    const pid = parseInt(data.trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class PidManager implements DaemonManager {
  readonly backend = "pid" as const;
  private config: DaemonConfig;

  constructor(config: DaemonConfig) {
    this.config = config;
  }

  async install(): Promise<void> {
    // For pid backend, install == start
    await this.start();
  }

  async uninstall(): Promise<void> {
    await this.stop();
  }

  async start(): Promise<void> {
    const existingPid = await readPid();
    if (existingPid && isProcessAlive(existingPid)) {
      process.stderr.write(`[myos] daemon already running (PID ${existingPid})\n`);
      return;
    }

    // Clean stale PID file
    if (existingPid) {
      await unlink(PID_PATH).catch(() => {});
    }

    await mkdir(RUN_DIR, { recursive: true, mode: 0o700 });
    await mkdir(dirname(this.config.logPath), { recursive: true, mode: 0o700 });

    // Open log file in append mode
    const logFd = openSync(this.config.logPath, "a");

    // Build child args — strip daemon flags to avoid infinite spawning
    const childArgs = this.config.programArguments.slice(1).filter(
      (a) => a !== "--daemon" && a !== "-d",
    );

    const child = spawn(this.config.programArguments[0]!, childArgs, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, ...this.config.environment, MYOS_DAEMON: "1" },
      cwd: this.config.workingDirectory,
    });

    child.unref();
    closeSync(logFd);

    await writeFile(PID_PATH, String(child.pid), "utf8");

    process.stdout.write(`[myos] daemon started (PID ${child.pid})\n`);
    process.stdout.write(`[myos] Logs: ${this.config.logPath}\n`);
    process.stdout.write(`[myos] Use 'myos --stop' to stop, 'myos --status' to check\n`);
  }

  async stop(): Promise<void> {
    const pid = await readPid();
    if (!pid) {
      process.stderr.write(`[myos] no daemon running (PID file not found)\n`);
      return;
    }

    if (!isProcessAlive(pid)) {
      process.stderr.write(`[myos] daemon not running (stale PID file, cleaned up)\n`);
      await unlink(PID_PATH).catch(() => {});
      return;
    }

    // Guard against PID reuse — never signal an unrelated process
    if (!(await isMyosProcess(pid))) {
      process.stderr.write(`[myos] PID ${pid} is not a myos process (stale PID file, cleaned up)\n`);
      await unlink(PID_PATH).catch(() => {});
      return;
    }

    process.stdout.write(`[myos] stopping daemon (PID ${pid})...\n`);
    process.kill(pid, "SIGTERM");

    // Wait for process to exit (max 10 seconds)
    for (let i = 0; i < 100; i++) {
      if (!isProcessAlive(pid)) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    if (isProcessAlive(pid)) {
      process.stderr.write(`[myos] daemon did not stop gracefully, sending SIGKILL\n`);
      process.kill(pid, "SIGKILL");
    }

    await unlink(PID_PATH).catch(() => {});
    process.stdout.write(`[myos] daemon stopped\n`);
  }

  async restart(): Promise<void> {
    await this.stop().catch(() => {});
    await this.start();
  }

  async status(): Promise<void> {
    const pid = await readPid();
    if (!pid) {
      process.stdout.write(`[myos] daemon not running\n`);
      return;
    }

    if (isProcessAlive(pid)) {
      process.stdout.write(`[myos] daemon running (PID ${pid})\n`);
      process.stdout.write(`[myos] Logs: ${this.config.logPath}\n`);
    } else {
      process.stdout.write(`[myos] daemon not running (stale PID file)\n`);
    }
  }

  async isInstalled(): Promise<boolean> {
    const pid = await readPid();
    return pid !== null;
  }

  async isRunning(): Promise<boolean> {
    const pid = await readPid();
    return pid !== null && isProcessAlive(pid);
  }
}

export const PID_PATHS = {
  pidPath: PID_PATH,
  logPath: LOG_PATH,
};

/** Register PID file cleanup for daemon child processes. */
export function registerPidCleanup(): void {
  if (process.env.MYOS_DAEMON === "1") {
    process.on("exit", () => {
      try {
        unlinkSync(PID_PATH);
      } catch {
        // already cleaned
      }
    });
  }
}
