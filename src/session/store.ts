/** Session store — simple file-based persistence. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Session } from "../types.js";

export class SessionStore {
  private sessions = new Map<string, Session>(); // key: `${channel}:${userId}`
  private dirty = false;
  private filePath: string;

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
      existing.lastActiveAt = Date.now();
      this.dirty = true;
      return existing;
    }

    const session: Session = {
      id: randomUUID(),
      channel,
      userId,
      piSessionId: `pi-${randomUUID()}`,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
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

  /** Update a session's Pi session ID (e.g. after Pi creates a new session). */
  async updatePiSessionId(channel: string, userId: string, piSessionId: string): Promise<void> {
    const key = `${channel}:${userId}`;
    const session = this.sessions.get(key);
    if (session) {
      session.piSessionId = piSessionId;
      session.lastActiveAt = Date.now();
      this.dirty = true;
      await this.flush();
    }
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

  private async flush(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;
    const entries = [...this.sessions.values()];
    await writeFile(this.filePath, JSON.stringify(entries, null, 2), "utf8");
  }
}
