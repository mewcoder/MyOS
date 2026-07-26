/** Daemon platform dispatcher — selects the native backend for the current OS.
 *
 * Architecture inspired by OpenClaw:
 *   macOS  → launchd (LaunchAgent plist + launchctl)
 *   Linux  → systemd (user service + systemctl)
 *   Other  → pid (detached spawn + PID file)
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { collectReferencedEnvVars } from "../config/env-substitution.js";
import { MYOS_DIR, CONFIG_PATH, TEXT_LOG_PATH, DAEMON_PID_PATH } from "../paths.js";
import { LaunchdManager, LAUNCH_AGENT_PATHS } from "./launchd.js";
import { SystemdManager, SYSTEMD_PATHS } from "./systemd.js";
import { PidManager, PID_PATHS, registerPidCleanup } from "./pid.js";
import type { DaemonBackend, DaemonConfig, DaemonManager } from "./types.js";

export type { DaemonManager, DaemonConfig, DaemonBackend } from "./types.js";
export { registerPidCleanup } from "./pid.js";

/** Detect the best available daemon backend for the current platform. */
export function detectBackend(): DaemonBackend {
  switch (process.platform) {
    case "darwin":
      return "launchd";
    case "linux":
      return "systemd";
    default:
      return "pid";
  }
}

/** Env vars the daemon needs: everything config.json references via ${VAR}
 *  that is set in the current shell. Without this, a launchd/systemd daemon
 *  starts with a clean environment, config substitution fails, and the
 *  service crash-loops. */
function collectDaemonEnvironment(): Record<string, string> {
  const environment: Record<string, string> = { MYOS_DAEMON: "1" };
  // launchd/systemd give services a minimal PATH — without the installing
  // shell's PATH the Pi agent's bash tool can't find user-installed tools.
  // Version managers (fnm/nvm) expose node via a per-shell directory that is
  // gone by the next boot, so prepend the running node's own directory.
  const nodeDir = dirname(process.execPath);
  const entries = (process.env.PATH ?? "").split(":").filter(Boolean);
  if (!entries.includes(nodeDir)) entries.unshift(nodeDir);
  environment.PATH = entries.join(":");
  try {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    for (const name of collectReferencedEnvVars(JSON.parse(raw))) {
      const value = process.env[name];
      if (value) environment[name] = value;
    }
  } catch {
    // Config missing or invalid — the install path validates config first
    // and reports it there; nothing useful to collect here
  }
  return environment;
}

/** Build the daemon config from MyOS runtime paths. */
export function buildDaemonConfig(): DaemonConfig {
  const nodeBin = process.execPath;
  const entryScript = process.argv[1]!;

  return {
    label: "ai.myos.gateway",
    description: "MyOS Gateway — Pi Agent Host",
    programArguments: [nodeBin, entryScript],
    workingDirectory: MYOS_DIR,
    environment: collectDaemonEnvironment(),
    logPath: TEXT_LOG_PATH,
    pidPath: DAEMON_PID_PATH,
  };
}

/** Create the appropriate DaemonManager for the current platform. */
export function createDaemonManager(backend?: DaemonBackend): DaemonManager {
  const resolved = backend ?? detectBackend();
  const config = buildDaemonConfig();

  switch (resolved) {
    case "launchd":
      return new LaunchdManager(config);
    case "systemd":
      return new SystemdManager(config);
    case "pid":
      return new PidManager(config);
  }
}

export { LAUNCH_AGENT_PATHS, SYSTEMD_PATHS, PID_PATHS };
