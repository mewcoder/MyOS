/** Linux systemd user service — unit file generation + systemctl controls.
 *
 * References OpenClaw's systemd.ts design: Restart=always for crash recovery,
 * StartLimitBurst for crash-loop protection, KillMode=control-group for
 * clean child cleanup, and WantedBy=default.target for user autostart.
 */

import { mkdir, writeFile, unlink, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SERVICE_DIR, TEXT_LOG_PATH as LOG_PATH } from "../paths.js";
import type { DaemonConfig, DaemonManager } from "./types.js";

const execFileAsync = promisify(execFile);

const SERVICE_NAME = "myos-gateway";
const UNIT_PATH = join(homedir(), ".config", "systemd", "user", `${SERVICE_NAME}.service`);
const ENV_FILE = join(SERVICE_DIR, "gateway.env");

// ─── Unit file generation ────────────────────────────────────────

function systemdEscapeArg(value: string): string {
  if (!/[\s"\\]/.test(value)) return value;
  return `"${value.replaceAll(/\\/g, "\\\\").replaceAll('"', '\\"')}"`;
}

function buildUnitFile(config: DaemonConfig, envFilePath?: string): string {
  const execStart = config.programArguments.map(systemdEscapeArg).join(" ");
  const workingDirLine = config.workingDirectory
    ? `WorkingDirectory=${systemdEscapeArg(config.workingDirectory)}`
    : null;

  // Secrets go ONLY into the 0600 env file — inline Environment= lines would
  // duplicate them into this world-readable unit file (and systemctl cat/show)
  const envFileLine = envFilePath ? `EnvironmentFile=-${systemdEscapeArg(envFilePath)}` : null;

  return [
    "[Unit]",
    `Description=${config.description}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "StartLimitBurst=5",
    "StartLimitIntervalSec=60",
    "",
    "[Service]",
    `ExecStart=${execStart}`,
    "Restart=on-failure",
    "RestartSec=5",
    "RestartPreventExitStatus=78",
    "TimeoutStopSec=30",
    "TimeoutStartSec=30",
    "SuccessExitStatus=0 143",
    "KillMode=control-group",
    workingDirLine,
    envFileLine,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

// ─── systemctl helpers ───────────────────────────────────────────

async function systemctlUser(
  args: string[],
  timeoutMs = 15_000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("systemctl", ["--user", ...args], {
      timeout: timeoutMs,
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      code: e.code ?? 1,
    };
  }
}

function isUnitMissing(detail: string): boolean {
  const lower = detail.toLowerCase();
  return (
    lower.includes("not-found") ||
    lower.includes("could not be found") ||
    lower.includes("unit file") && lower.includes("does not exist") ||
    lower.includes("no such unit")
  );
}

// ─── Environment file ────────────────────────────────────────────

function buildEnvFile(environment: Record<string, string>): string {
  return Object.entries(environment)
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `${k}=${systemdEscapeArg(v.trim())}`)
    .join("\n");
}

// ─── Manager ─────────────────────────────────────────────────────

export class SystemdManager implements DaemonManager {
  readonly backend = "systemd" as const;
  private config: DaemonConfig;

  constructor(config: DaemonConfig) {
    this.config = config;
  }

  /** Write the 0600 secrets env file from the current environment/config.
   *  Called on install AND start/restart so a rotated key takes effect
   *  without requiring a re-install. */
  private async writeEnvFile(): Promise<boolean> {
    const envEntries = this.config.environment ?? {};
    if (Object.keys(envEntries).length === 0) return false;
    const content = `${buildEnvFile(envEntries)}\n`;
    await mkdir(SERVICE_DIR, { recursive: true, mode: 0o700 });
    await writeFile(ENV_FILE, content, { mode: 0o600 });
    return true;
  }

  async install(): Promise<void> {
    // Write env file (0600) for secrets
    const envEntries = this.config.environment ?? {};
    await this.writeEnvFile();

    // Write unit file
    await mkdir(dirname(UNIT_PATH), { recursive: true });
    const unit = buildUnitFile(this.config, Object.keys(envEntries).length > 0 ? ENV_FILE : undefined);
    await writeFile(UNIT_PATH, unit, "utf8");

    // Ensure log directory exists
    await mkdir(dirname(this.config.logPath), { recursive: true });

    // daemon-reload + enable + restart
    await systemctlUser(["daemon-reload"]);
    const enable = await systemctlUser(["enable", SERVICE_NAME]);
    if (enable.code !== 0) {
      throw new Error(`systemctl enable failed: ${enable.stderr || enable.stdout}`);
    }
    const restart = await systemctlUser(["restart", SERVICE_NAME]);
    if (restart.code !== 0) {
      throw new Error(`systemctl restart failed: ${restart.stderr || restart.stdout}`);
    }

    process.stdout.write(`[myos] systemd service installed: ${UNIT_PATH}\n`);
    process.stdout.write(`[myos] Logs: journalctl --user -u ${SERVICE_NAME} -f\n`);
  }

  async uninstall(): Promise<void> {
    await systemctlUser(["disable", "--now", SERVICE_NAME]);
    await unlink(UNIT_PATH).catch(() => {});
    await unlink(ENV_FILE).catch(() => {});
    await systemctlUser(["daemon-reload"]);

    process.stdout.write(`[myos] systemd service uninstalled\n`);
  }

  async start(): Promise<void> {
    // Refresh secrets so a rotated key takes effect
    await this.writeEnvFile().catch(() => {});
    // Clear any failed state before starting
    await systemctlUser(["reset-failed", SERVICE_NAME]);
    const result = await systemctlUser(["start", SERVICE_NAME]);
    if (result.code !== 0) {
      throw new Error(`systemctl start failed: ${result.stderr || result.stdout}`);
    }
    process.stdout.write(`[myos] systemd service started: ${SERVICE_NAME}\n`);
  }

  async stop(): Promise<void> {
    const result = await systemctlUser(["stop", SERVICE_NAME]);
    if (result.code !== 0 && !isUnitMissing(result.stderr || result.stdout)) {
      throw new Error(`systemctl stop failed: ${result.stderr || result.stdout}`);
    }
    process.stdout.write(`[myos] systemd service stopped: ${SERVICE_NAME}\n`);
  }

  async restart(): Promise<void> {
    // Refresh secrets so a rotated key takes effect
    await this.writeEnvFile().catch(() => {});
    await systemctlUser(["reset-failed", SERVICE_NAME]);
    const result = await systemctlUser(["restart", SERVICE_NAME]);
    if (result.code !== 0) {
      throw new Error(`systemctl restart failed: ${result.stderr || result.stdout}`);
    }
    process.stdout.write(`[myos] systemd service restarted: ${SERVICE_NAME}\n`);
  }

  async status(): Promise<void> {
    const result = await systemctlUser(["show", SERVICE_NAME, "--no-page", "--property=Id,ActiveState,SubState,MainPID,ExecMainStatus,NRestarts"]);
    if (result.code !== 0) {
      const detail = result.stderr || result.stdout;
      if (isUnitMissing(detail)) {
        process.stdout.write(`[myos] systemd service not installed\n`);
      } else {
        process.stdout.write(`[myos] systemd service status unknown: ${detail}\n`);
      }
      return;
    }

    const entries: Record<string, string> = {};
    for (const line of result.stdout.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) {
        entries[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }

    const activeState = entries.ActiveState?.toLowerCase() ?? "unknown";
    const pid = entries.MainPID && entries.MainPID !== "0" ? entries.MainPID : undefined;

    if (activeState === "active") {
      process.stdout.write(`[myos] systemd service running (PID ${pid ?? "?"})\n`);
    } else {
      process.stdout.write(`[myos] systemd service stopped (state: ${activeState})\n`);
    }
    process.stdout.write(`[myos] Unit: ${UNIT_PATH}\n`);
    process.stdout.write(`[myos] Logs: journalctl --user -u ${SERVICE_NAME} -f\n`);
  }

  async isInstalled(): Promise<boolean> {
    try {
      await access(UNIT_PATH);
      return true;
    } catch {
      return false;
    }
  }

  async isRunning(): Promise<boolean> {
    const result = await systemctlUser(["is-active", "--quiet", SERVICE_NAME]);
    return result.code === 0;
  }
}

export const SYSTEMD_PATHS = {
  unitPath: UNIT_PATH,
  envFile: ENV_FILE,
  logPath: LOG_PATH,
  serviceName: SERVICE_NAME,
};
