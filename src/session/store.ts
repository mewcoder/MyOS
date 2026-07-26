/** Session store — simple file-based persistence. */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Session } from "../types.js";

export class SessionStore {
  private sessions = new Map<string, Session>(); // key: `${channel}:${userId}`
  private dirty = false;
  private filePath: string;
  private flushChain: Promise<void> = Promise.resolve();

  private constructor(dir: string) {
    this.filePath = join(dir, "sessions.json");
  }

  static async create(dir: string): Promise<SessionStore> {
    await mkdir(dir, { recursive: true });
    const store = new SessionStore(dir);
    await store.load();
    return store;
  }

  /** Get or create a session for a channel+user pair. */
  async getOrCreate(channel: string, userId: string): Promise<Session> {
    const key = `${channel}:${userId}`;
    const existing = this.sessions.get(key);
    if (existing) {
      existing.updatedAt = Date.now();
      this.dirty = true;
      await this.flush();
      return existing;
    }

    const session: Session = {
      id: randomUUID(),
      channel,
      userId,
      agentSessionId: `pi-${randomUUID()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions.set(key, session);
    this.dirty = true;
    await this.flush();
    return session;
  }

  /** Get an existing session, if any. */
  get(channel: string, userId: string): Session | undefined {
    return this.sessions.get(`${channel}:${userId}`);
  }

  /** Replace the session with a fresh one (new agent session, empty context). */
  async reset(channel: string, userId: string): Promise<Session> {
    const session: Session = {
      id: randomUUID(),
      channel,
      userId,
      agentSessionId: `pi-${randomUUID()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions.set(`${channel}:${userId}`, session);
    this.dirty = true;
    await this.flush();
    return session;
  }

  private async load(): Promise<void> {
    try {
      const data = await readFile(this.filePath, "utf8");
      const entries: Session[] = JSON.parse(data);
      for (const session of entries) {
        this.sessions.set(`${session.channel}:${session.userId}`, session);
      }
    } catch {
      // File doesn't exist yet — start empty.
    }
  }

  /** Serialized: concurrent flushes would interleave writes to the same tmp file. */
  private flush(): Promise<void> {
    const run = this.flushChain.then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      const entries = [...this.sessions.values()];
      // Atomic write: a crash mid-write must not corrupt sessions.json
      const tmpPath = `${this.filePath}.tmp`;
      await writeFile(tmpPath, JSON.stringify(entries, null, 2), "utf8");
      await rename(tmpPath, this.filePath);
    });
    // Callers see the error, but the chain itself stays usable after a failure
    this.flushChain = run.catch(() => {});
    return run;
  }
}
