#!/usr/bin/env node
/** MyOS v0.1 — Pi Agent Host with Gateway */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Gateway } from "./gateway/server.js";
import { WeChatAdapter, type WeChatConfig } from "./channels/wechat/adapter.js";
import type { GatewayConfig } from "./types.js";
import { createDaemonManager, registerPidCleanup, detectBackend } from "./daemon/index.js";
import { resolveConfigEnvVars, MissingEnvVarError } from "./config/env-substitution.js";
import { validateConfig } from "./config/schema.js";
import { acquireSingleInstance, forceAcquireSingleInstance, getLockHolderPid } from "./single-instance.js";
import { logger } from "./log.js";
import { MYOS_DIR, CONFIG_PATH, channelDataDir, ensureLayout } from "./paths.js";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const MYOS_API_KEY_ENV = "MYOS_API_KEY";

/** Build the default config object written on first run.
 *
 *  The apiKey uses ${MYOS_API_KEY} env var substitution so the generated
 *  config.json doesn't contain a placeholder empty string that would fail
 *  validation — it clearly tells the user to set the env var.
 */
function buildDefaultConfig(): Record<string, unknown> {
  return {
    channels: {
      wechat: {},
    },
    providers: {
      "xfyun-astron": {
        baseUrl: "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2",
        api: "openai-completions",
        apiKey: `\${${MYOS_API_KEY_ENV}}`,
        authHeader: true,
        models: [
          {
            id: "astron-code-latest",
            name: "Astron Code (讯飞)",
            contextWindow: 200000,
            maxTokens: 16384,
          },
        ],
      },
    },
    defaultModel: "xfyun-astron/astron-code-latest",
  };
}

/** Load and validate config from ~/.myos/config.json.
 *
 * 1. Read JSON file
 * 2. Substitute ${ENV_VAR} references
 * 3. Validate with zod schema — precise errors with field paths
 * 4. Generate default config on first run if file doesn't exist
 */
async function loadConfig(): Promise<GatewayConfig> {
  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, "utf8");
  } catch {
    // File doesn't exist — generate default config and exit.
    // 0600/0700: the CLI explicitly invites putting the API key in this file.
    const defaultConfig = buildDefaultConfig();
    await mkdir(MYOS_DIR, { recursive: true, mode: 0o700 });
    await writeFile(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), { mode: 0o600 });
    process.stdout.write(`[myos] created default config at ${CONFIG_PATH}\n`);
    process.stdout.write(`\n[myos] next steps:\n`);
    process.stdout.write(`  1. Set env var: export ${MYOS_API_KEY_ENV}="your-api-key"\n`);
    process.stdout.write(`     (or edit config.json to fill apiKey directly)\n`);
    process.stdout.write(`  2. Run: myos\n`);
    process.exit(0);
  }

  // Config errors exit with 78 (EX_CONFIG) — systemd's
  // RestartPreventExitStatus=78 then stops the crash-restart loop.

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`[myos] config.json is not valid JSON: ${err}\n`);
    process.exit(78);
  }

  // Substitute ${ENV_VAR} references
  try {
    parsed = resolveConfigEnvVars(parsed);
  } catch (err) {
    if (err instanceof MissingEnvVarError) {
      process.stderr.write(`[myos] ${err.message}\n`);
      process.stderr.write(`[myos] set the env var or use a literal value in config.json\n`);
      process.exit(78);
    }
    throw err;
  }

  // Validate with zod
  try {
    return validateConfig(parsed);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(78);
  }
}

interface ParsedArgs {
  login: boolean;
  daemon: boolean;
  stop: boolean;
  restart: boolean;
  status: boolean;
  install: boolean;
  uninstall: boolean;
  force: boolean;
  help: boolean;
}

const KNOWN_FLAGS = new Set([
  "--login", "-l",
  "--daemon", "-d",
  "--stop",
  "--restart",
  "--status",
  "--install",
  "--uninstall",
  "--force", "-f",
  "--help", "-h",
]);

const USAGE = `Usage: myos [options]

  (no options)     start the gateway in the foreground
  --login, -l      QR code login for the wechat channel
  --install        install as a system service (autostart + crash restart)
  --uninstall      uninstall the system service
  --daemon, -d     run in the background (same as --install)
  --status         show service status
  --stop           stop the service
  --restart        restart the service
  --force, -f      take over from a running instance without asking
  --help, -h       show this help
`;

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);

  // Reject typos and unsupported flags instead of silently starting the
  // foreground gateway (e.g. `myos --stpo` must not boot the full stack)
  const unknown = args.filter((a) => !KNOWN_FLAGS.has(a));
  if (unknown.length > 0) {
    process.stderr.write(`[myos] unknown option: ${unknown.join(", ")}\n\n${USAGE}`);
    process.exit(1);
  }

  return {
    login: args.includes("--login") || args.includes("-l"),
    daemon: args.includes("--daemon") || args.includes("-d"),
    stop: args.includes("--stop"),
    restart: args.includes("--restart"),
    status: args.includes("--status"),
    install: args.includes("--install"),
    uninstall: args.includes("--uninstall"),
    force: args.includes("--force") || args.includes("-f"),
    help: args.includes("--help") || args.includes("-h"),
  };
}

/** QR login for the wechat channel — reads config leniently: login must work
 *  on a fresh machine where the agent config (API key) isn't set up yet. */
async function runLogin(): Promise<void> {
  let channelConfig: Record<string, unknown> = { type: "wechat" };
  try {
    const parsed = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    let resolved: unknown = parsed;
    try {
      resolved = resolveConfigEnvVars(parsed);
    } catch {
      // Missing env vars are fine here — wechat config rarely references any
    }
    const channels = (resolved as { channels?: Record<string, Record<string, unknown>> }).channels;
    if (channels?.wechat) channelConfig = { type: "wechat", ...channels.wechat };
  } catch {
    // No config yet — defaults are fine for login
  }

  process.stdout.write("[myos] login mode — starting QR code login...\n");
  const dataDir = channelDataDir("wechat");
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const adapter = new WeChatAdapter(channelConfig as unknown as WeChatConfig, dataDir);
  await adapter.login();

  if (await createDaemonManager().isRunning()) {
    process.stdout.write("[myos] 守护进程正在运行 — 请执行 'myos --restart' 使其使用新 token\n");
  } else {
    process.stdout.write("[myos] use 'myos' to start the gateway.\n");
  }
}

// ─── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  await ensureLayout();

  // ─── Daemon management commands ────────────────────────────────
  if (args.status) {
    const manager = createDaemonManager();
    await manager.status();
    return;
  }

  if (args.stop) {
    const manager = createDaemonManager();
    await manager.stop();
    return;
  }

  if (args.restart) {
    const manager = createDaemonManager();
    await manager.restart();
    return;
  }

  if (args.install || args.daemon) {
    if (args.login) {
      process.stderr.write(`[myos] --login cannot be used with --install/--daemon (login requires interactive mode)\n`);
      process.exit(1);
    }
    // Validate config BEFORE installing: on a fresh machine this creates the
    // default config and exits with instructions; with an unset ${ENV_VAR} it
    // fails loudly here instead of installing a crash-looping service that
    // reported success.
    await loadConfig();

    // A foreground instance holding the lock would make the new daemon child
    // fail its lock acquisition and crash-loop behind a success message.
    const manager = createDaemonManager();
    const holder = await getLockHolderPid();
    if (holder && !(await manager.isRunning())) {
      process.stderr.write(`[myos] a foreground instance is running (PID ${holder})\n`);
      process.stderr.write(`[myos] stop it first (Ctrl+C in its terminal), then run 'myos --install'\n`);
      process.exit(1);
    }

    await manager.install();
    return;
  }

  if (args.uninstall) {
    const manager = createDaemonManager();
    await manager.uninstall();
    return;
  }

  // ─── QR login ──────────────────────────────────────────────────
  // Runs BEFORE the single-instance lock and full config validation:
  // login must work on a fresh machine (no API key yet) and while a
  // managed daemon is running (token recovery).
  if (args.login) {
    await runLogin();
    return;
  }

  // ─── Foreground mode ───────────────────────────────────────────
  // Acquire single-instance lock — prevents multiple gateway instances
  // from competing for the same long-poll connection (causes duplicate replies).
  //
  // If an existing instance is found:
  //   1. If managed by launchd/systemd → use `myos --restart` (KeepAlive would
  //      otherwise fight the foreground process).
  //   2. --force flag: silently kill it and take over (only for pid backend).
  //   3. Interactive (TTY): ask the user whether to take over or abort.
  //   4. Non-interactive: print error and exit.
  let lockResult = await acquireSingleInstance();
  if (!lockResult.acquired) {
    const existingPid = lockResult.existingPid;

    // Check if the existing instance is managed by a service manager.
    // isRunning (not isInstalled): an installed-but-stopped service means the
    // lock holder is a foreground process, which the service manager can't stop.
    const backend = detectBackend();
    const manager = createDaemonManager(backend);
    const serviceRunning = await manager.isRunning();

    if (serviceRunning && backend !== "pid") {
      // launchd/systemd is managing the daemon — killing the process directly
      // would trigger KeepAlive to restart it, conflicting with foreground mode.
      if (args.force) {
        // Use the service manager to restart instead of foreground takeover
        process.stdout.write(`[myos] restarting managed daemon (PID ${existingPid})...\n`);
        await manager.restart();
        process.stdout.write(`[myos] daemon restarted — use 'myos --status' to check\n`);
        process.exit(0);
      } else if (process.stdin.isTTY) {
        process.stdout.write(`\n[myos] another instance is already running (PID ${existingPid})\n`);
        process.stdout.write(`[myos] it's managed by ${backend} — restart it instead?\n`);
        const rl = readline.createInterface({ input, output });
        const answer = await rl.question("  Restart via service manager? [Y/n] ");
        rl.close();

        const choice = answer.trim().toLowerCase();
        if (choice === "" || choice === "y" || choice === "yes") {
          await manager.restart();
          process.stdout.write(`[myos] daemon restarted — use 'myos --status' to check\n`);
          process.exit(0);
        } else {
          process.stdout.write("[myos] aborted — keeping existing instance\n");
          process.exit(0);
        }
      } else {
        process.stderr.write(`[myos] another instance is already running (PID ${existingPid})\n`);
        process.stderr.write(`[myos] managed by ${backend} — use 'myos --restart' to restart\n`);
        process.exit(1);
      }
    }

    // Standalone (pid backend) — safe to kill and take over
    if (args.force) {
      process.stdout.write(`[myos] force: stopping existing instance (PID ${existingPid})...\n`);
      const ok = await forceAcquireSingleInstance(existingPid);
      if (!ok) {
        process.stderr.write(`[myos] failed to stop PID ${existingPid}, aborting\n`);
        process.exit(1);
      }
      process.stdout.write(`[myos] takeover complete\n`);
    } else if (process.stdin.isTTY) {
      process.stdout.write(`\n[myos] another instance is already running (PID ${existingPid})\n`);
      const rl = readline.createInterface({ input, output });
      const answer = await rl.question("  Take over (stop existing instance and start)? [Y/n] ");
      rl.close();

      const choice = answer.trim().toLowerCase();
      if (choice === "" || choice === "y" || choice === "yes") {
        process.stdout.write(`[myos] stopping existing instance (PID ${existingPid})...\n`);
        const ok = await forceAcquireSingleInstance(existingPid);
        if (!ok) {
          process.stderr.write(`[myos] failed to stop PID ${existingPid}, aborting\n`);
          process.exit(1);
        }
        process.stdout.write(`[myos] takeover complete\n`);
      } else {
        process.stdout.write("[myos] aborted — keeping existing instance\n");
        process.exit(0);
      }
    } else {
      process.stderr.write(`[myos] another instance is already running (PID ${existingPid})\n`);
      process.stderr.write(`[myos] use 'myos --force' to take over\n`);
      process.exit(1);
    }
  }

  process.stdout.write("MyOS v0.1 — Pi Agent Host\n\n");
  process.stdout.write(`[myos] daemon backend: ${detectBackend()}\n`);
  logger.log("startup", { pid: process.pid, daemon: process.env.MYOS_DAEMON === "1" });

  const config = await loadConfig();

  const gateway = await Gateway.create(config);

  // PID file cleanup for daemon child processes
  registerPidCleanup();

  // Graceful shutdown — second signal forces immediate exit
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      process.stderr.write(`\n[myos] received ${signal} again, forcing exit\n`);
      process.exit(1);
    }
    shuttingDown = true;
    process.stdout.write(`\n[myos] received ${signal}, shutting down...\n`);
    logger.log("shutdown", { signal });
    try {
      await gateway.stop();
    } catch (err) {
      process.stderr.write(`[myos] error during shutdown: ${err}\n`);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await gateway.start();

  const isDaemonChild = process.env.MYOS_DAEMON === "1";
  if (isDaemonChild) {
    process.stdout.write(`\n[myos] daemon running (PID ${process.pid})\n`);
  } else {
    process.stdout.write("\n[myos] running — press Ctrl+C to stop\n");
    process.stdout.write("[myos] tip: use 'myos --daemon' to run in background\n");
  }
}

main().catch((err) => {
  process.stderr.write(`[myos] fatal: ${err}\n`);
  logger.log("fatal", { error: String(err) });
  process.exit(1);
});
