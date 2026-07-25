/** MyOS v0.1 — Pi Agent Host with Gateway */

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Gateway } from "./gateway/server.js";
import type { GatewayConfig } from "./types.js";

const CONFIG_PATH = join(homedir(), ".myos", "config.json");

async function loadConfig(): Promise<GatewayConfig> {
  try {
    const data = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(data) as GatewayConfig;
  } catch {
    // Generate default config
    const defaultConfig: GatewayConfig = {
      channels: [
        {
          type: "wechat",
          enabled: false,
          token: "",
        },
      ],
      agent: {
        type: "pi",
        provider: undefined,
        model: undefined,
        workspaceDir: join(homedir(), ".myos", "workspace"),
      },
      session: {
        dir: join(homedir(), ".myos", "sessions"),
      },
    };

    await mkdir(join(homedir(), ".myos"), { recursive: true });
    await writeFile(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), "utf8");
    process.stdout.write(`[myos] created default config at ${CONFIG_PATH}\n`);
    process.stdout.write(`[myos] edit config to enable channels, then restart\n`);
    return defaultConfig;
  }
}

async function main(): Promise<void> {
  process.stdout.write("MyOS v0.1 — Pi Agent Host\n");

  const config = await loadConfig();
  const gateway = await Gateway.create(config);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    process.stdout.write(`\n[myos] received ${signal}, shutting down...\n`);
    await gateway.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await gateway.start();
  process.stdout.write("[myos] running — press Ctrl+C to stop\n");
}

main().catch((err) => {
  process.stderr.write(`[myos] fatal: ${err}\n`);
  process.exit(1);
});
