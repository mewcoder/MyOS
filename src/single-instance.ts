/**
 * Single-instance lock via PID file.
 *
 * Prevents multiple MyOS gateway processes from running simultaneously.
 * If a previous PID file exists, checks whether that process is still alive
 * before deciding to steal the lock.
 *
 * On macOS, the launchd-managed daemon and manual foreground runs share the
 * same lock, so they are mutually exclusive.
 */

import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RUN_DIR, GATEWAY_LOCK_PATH } from "./paths.js";

const execFileAsync = promisify(execFile);

export type LockResult =
  | { acquired: true }
  | { acquired: false; existingPid: number };

/** Check whether a process with the given PID is alive. */
function isProcessAlive(pid: number): boolean {
  try {
    // signal 0 = check existence without actually sending a signal
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Check whether the PID belongs to a MyOS process — guards against PID reuse
 *  (the lock holder died, the OS gave its PID to an unrelated process).
 *  Requires a node executable AND a myos marker: a bare "myos" substring would
 *  bless e.g. `tail -f ~/.myos/myos.log` for SIGKILL, and the gateway may run
 *  as `node dist/index.js` with no "myos" in the command at all.
 *  Conservative: if `ps` is unavailable, assume it IS MyOS, so we never bypass
 *  the lock. */
export async function isMyosProcess(pid: number): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "command=", "-p", String(pid)], {
      timeout: 5_000,
    });
    const cmd = stdout.trim();
    return /(^|\/)node(\s|$)/.test(cmd) && (cmd.includes("myos") || cmd.includes("dist/index.js"));
  } catch {
    return true;
  }
}

/** PID of a live MyOS instance holding the lock, or null. */
export async function getLockHolderPid(): Promise<number | null> {
  try {
    const pid = parseInt((await readFile(GATEWAY_LOCK_PATH, "utf8")).trim(), 10);
    if (Number.isNaN(pid) || pid <= 0) return null;
    if (!isProcessAlive(pid)) return null;
    if (!(await isMyosProcess(pid))) return null;
    return pid;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquire the single-instance lock.
 *
 * Returns `{ acquired: true }` on success, or `{ acquired: false, existingPid }`
 * if another live instance is already running.
 *
 * If the PID file points to a dead process, the stale lock is stolen.
 */
export async function acquireSingleInstance(): Promise<LockResult> {
  await mkdir(RUN_DIR, { recursive: true, mode: 0o700 });

  // Atomic acquisition: exclusive create (wx) so two simultaneous starts
  // can't both write their PID. On conflict, inspect the holder; remove
  // stale/corrupt locks and retry.
  let acquired = false;
  for (let attempt = 0; attempt < 3 && !acquired; attempt++) {
    try {
      await writeFile(GATEWAY_LOCK_PATH, String(process.pid), { flag: "wx" });
      acquired = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

      let existingPid = NaN;
      try {
        existingPid = parseInt((await readFile(GATEWAY_LOCK_PATH, "utf8")).trim(), 10);
      } catch {
        // Holder vanished between our write attempt and read — retry
        continue;
      }

      if (Number.isNaN(existingPid) || existingPid <= 0) {
        // Corrupt PID file — remove and retry
        await unlink(GATEWAY_LOCK_PATH).catch(() => {});
      } else if (isProcessAlive(existingPid) && (await isMyosProcess(existingPid))) {
        // Another instance is genuinely running
        return { acquired: false, existingPid };
      } else {
        // Dead process, or the PID was reused by an unrelated process —
        // the lock is stale either way
        process.stdout.write(`[myos] stale lock from PID ${existingPid}, acquiring...\n`);
        await unlink(GATEWAY_LOCK_PATH).catch(() => {});
      }
    }
  }

  if (!acquired) {
    // Lost every retry race — report the current holder
    try {
      const existingPid = parseInt((await readFile(GATEWAY_LOCK_PATH, "utf8")).trim(), 10);
      if (!Number.isNaN(existingPid) && existingPid > 0) {
        return { acquired: false, existingPid };
      }
    } catch {
      // fall through
    }
    throw new Error("[myos] failed to acquire single-instance lock");
  }

  // Cleanup on exit. Signal handling (SIGINT/SIGTERM) is owned by index.ts —
  // registering exiting handlers here would race the gateway's graceful
  // shutdown. The 'exit' event fires on any process.exit(), so cleanup
  // still runs for every controlled shutdown path.
  process.on("exit", () => {
    try {
      // Only remove if it's still our PID (don't clobber a newer instance)
      const data = readFileSync(GATEWAY_LOCK_PATH, "utf8");
      if (parseInt(data.trim(), 10) === process.pid) {
        unlinkSync(GATEWAY_LOCK_PATH);
      }
    } catch {
      // Best-effort
    }
  });

  return { acquired: true };
}

/**
 * Kill the process with the given PID.
 *
 * Sends SIGTERM first (graceful), then SIGKILL after 3s if still alive.
 * Returns true if the process was killed (or already dead), false if it
 * couldn't be killed (e.g. permission denied).
 */
export async function killProcess(pid: number): Promise<boolean> {
  if (!isProcessAlive(pid)) return true;

  // Graceful SIGTERM
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }

  // Wait up to 3s for graceful exit
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    if (!isProcessAlive(pid)) return true;
  }

  // Force SIGKILL
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return false;
  }

  await sleep(200);
  return !isProcessAlive(pid);
}

/**
 * Force-acquire the single-instance lock by killing any existing instance.
 *
 * Used when the user explicitly chooses to take over (e.g. via interactive
 * prompt or --force flag).
 */
export async function forceAcquireSingleInstance(existingPid: number): Promise<boolean> {
  // Never SIGKILL a PID that provably belongs to something else (PID reuse)
  if (isProcessAlive(existingPid) && !(await isMyosProcess(existingPid))) {
    process.stderr.write(
      `[myos] PID ${existingPid} is not a myos process (PID reuse?) — refusing to kill it\n`,
    );
    await unlink(GATEWAY_LOCK_PATH).catch(() => {});
    const result = await acquireSingleInstance();
    return result.acquired;
  }

  const killed = await killProcess(existingPid);
  if (!killed) return false;

  // Remove stale PID file
  await unlink(GATEWAY_LOCK_PATH).catch(() => {});

  // Now acquire normally
  const result = await acquireSingleInstance();
  return result.acquired;
}
