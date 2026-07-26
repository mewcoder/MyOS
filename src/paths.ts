/** Canonical ~/.myos directory layout — the single source of truth for every
 * runtime path. Import from here; never join(homedir(), ".myos", ...) elsewhere.
 *
 *   ~/.myos/
 *   ├── config.json      user configuration (the only hand-edited file)
 *   ├── run/             volatile runtime state (safe to delete when stopped)
 *   │   ├── gateway.pid    single-instance lock
 *   │   └── daemon.pid     pid-backend daemon PID
 *   ├── logs/
 *   │   ├── myos.log             text log (daemon stdout/stderr)
 *   │   └── myos-<date>.jsonl    structured event log
 *   ├── data/            durable gateway state
 *   │   ├── sessions.json        channel:user → agent session mapping
 *   │   └── <channel>/           per-channel runtime data (tokens, cursors)
 *   ├── pi/              Pi agent artifacts
 *   │   ├── models.json          generated from config providers (0600)
 *   │   ├── auth.json            generated from config providers (0600)
 *   │   └── sessions/            full session transcripts (JSONL)
 *   ├── service/         system-service support files
 *   │   ├── gateway.env          env vars incl. secrets (0600)
 *   │   └── wrapper.sh           launchd startup wrapper (0700)
 *   └── workspace/       agent working directories
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir } from "node:fs/promises";

export const MYOS_DIR = join(homedir(), ".myos");
export const CONFIG_PATH = join(MYOS_DIR, "config.json");

export const RUN_DIR = join(MYOS_DIR, "run");
export const GATEWAY_LOCK_PATH = join(RUN_DIR, "gateway.pid");
export const DAEMON_PID_PATH = join(RUN_DIR, "daemon.pid");

export const LOGS_DIR = join(MYOS_DIR, "logs");
export const TEXT_LOG_PATH = join(LOGS_DIR, "myos.log");

export const DATA_DIR = join(MYOS_DIR, "data");
/** Default dir holding sessions.json (the mapping store appends the filename). */
export const SESSION_STORE_DIR = DATA_DIR;

export const PI_DIR = join(MYOS_DIR, "pi");
export const PI_SESSIONS_DIR = join(PI_DIR, "sessions");

export const SERVICE_DIR = join(MYOS_DIR, "service");
export const WORKSPACE_DIR = join(MYOS_DIR, "workspace");

/** Inbox archive — a git repo that doubles as the VitePress site source. */
export const INBOX_DIR = join(MYOS_DIR, "inbox");
export const INBOX_ITEMS_DIR = join(INBOX_DIR, "items");
export const INBOX_INDEX_PATH = join(INBOX_DIR, "data", "index.jsonl");
export const INBOX_ASSETS_DIR = join(INBOX_DIR, "public", "assets");

/** Per-channel runtime data directory (tokens, sync cursors). */
export function channelDataDir(type: string): string {
  return join(DATA_DIR, type);
}

/** Create the base tree. 0700 throughout — it holds keys, tokens, transcripts. */
export async function ensureLayout(base: string = MYOS_DIR): Promise<void> {
  for (const dir of ["run", "logs", "data"]) {
    await mkdir(join(base, dir), { recursive: true, mode: 0o700 });
  }
}
