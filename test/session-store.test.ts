/** Unit tests for SessionStore — file-based session persistence. */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "../src/session/store.js";

describe("SessionStore", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "myos-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("creates a new session for a new channel+user", async () => {
    const store = await SessionStore.create(testDir);
    const session = await store.getOrCreate("wechat", "user1");

    expect(session.channel).toBe("wechat");
    expect(session.userId).toBe("user1");
    expect(session.piSessionId).toMatch(/^pi-/);
    expect(session.createdAt).toBeGreaterThan(0);
  });

  it("returns the same session for the same channel+user", async () => {
    const store = await SessionStore.create(testDir);
    const s1 = await store.getOrCreate("wechat", "user1");
    const s2 = await store.getOrCreate("wechat", "user1");

    expect(s1.id).toBe(s2.id);
    expect(s1.piSessionId).toBe(s2.piSessionId);
  });

  it("creates different sessions for different users", async () => {
    const store = await SessionStore.create(testDir);
    const s1 = await store.getOrCreate("wechat", "user1");
    const s2 = await store.getOrCreate("wechat", "user2");

    expect(s1.id).not.toBe(s2.id);
  });

  it("creates different sessions for different channels", async () => {
    const store = await SessionStore.create(testDir);
    const s1 = await store.getOrCreate("wechat", "user1");
    const s2 = await store.getOrCreate("telegram", "user1");

    expect(s1.id).not.toBe(s2.id);
  });

  it("persists sessions to disk and reloads them", async () => {
    const store1 = await SessionStore.create(testDir);
    const created = await store1.getOrCreate("wechat", "user1");

    // Create a new store from the same dir — should load persisted data
    const store2 = await SessionStore.create(testDir);
    const loaded = store2.get("wechat", "user1");

    expect(loaded).toBeDefined();
    expect(loaded!.id).toBe(created.id);
    expect(loaded!.piSessionId).toBe(created.piSessionId);
  });

  it("updates piSessionId", async () => {
    const store = await SessionStore.create(testDir);
    const session = await store.getOrCreate("wechat", "user1");
    const oldPiId = session.piSessionId;

    await store.updatePiSessionId("wechat", "user1", "pi-new-session-id");
    const updated = store.get("wechat", "user1");

    expect(updated!.piSessionId).toBe("pi-new-session-id");
    expect(updated!.piSessionId).not.toBe(oldPiId);
  });

  it("get returns undefined for unknown user", async () => {
    const store = await SessionStore.create(testDir);
    expect(store.get("wechat", "unknown")).toBeUndefined();
  });

  it("updatePiSessionId is a no-op for unknown user", async () => {
    const store = await SessionStore.create(testDir);
    // Should not throw
    await store.updatePiSessionId("wechat", "unknown", "pi-xxx");
  });
});
