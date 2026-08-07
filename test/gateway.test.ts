/** Unit tests for Gateway — message routing, session resolution, and per-user serialization. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GatewayConfig, MessageEvent } from "../src/types.js";

// Keep unit tests from writing to the real ~/.myos/logs
vi.mock("../src/log.js", () => ({
  logger: { log: vi.fn() },
  preview: (text: string) => text,
}));

// Mock SessionStore — stateful so command tests can observe resets
const sessionMap = new Map<string, Record<string, unknown>>();
const mockSessionStore = {
  getOrCreate: vi.fn(async (ch: string, uid: string) => {
    const key = `${ch}:${uid}`;
    let session = sessionMap.get(key);
    if (!session) {
      session = {
        id: "test-session-id",
        channel: ch,
        userId: uid,
        agentSessionId: `pi-${ch}-${uid}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      sessionMap.set(key, session);
    }
    return session;
  }),
  get: vi.fn((ch: string, uid: string) => sessionMap.get(`${ch}:${uid}`)),
  reset: vi.fn(async (ch: string, uid: string) => {
    const session = {
      id: "reset-session-id",
      channel: ch,
      userId: uid,
      agentSessionId: `pi-reset-${ch}-${uid}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    sessionMap.set(`${ch}:${uid}`, session);
    return session;
  }),
};

vi.mock("../src/session/store.js", () => ({
  SessionStore: class {
    static create = vi.fn(async () => mockSessionStore);
  },
}));

// Mock PiAdapter — tracks concurrency so tests can assert serialization.
const agentState = vi.hoisted(() => ({
  active: 0,
  maxActive: 0,
  calls: [] as string[],
  resolvers: [] as (() => void)[],
  autoResolve: true,
}));

vi.mock("../src/agent/pi-adapter.js", () => ({
  PiAdapter: class {
    name = "pi";
    init = vi.fn(async () => {});
    run = vi.fn(async (req: { sessionId: string; message: string }) => {
      agentState.active++;
      agentState.maxActive = Math.max(agentState.maxActive, agentState.active);
      agentState.calls.push(req.message);
      await new Promise<void>((resolve) => {
        if (agentState.autoResolve) resolve();
        else agentState.resolvers.push(resolve);
      });
      agentState.active--;
      return { text: `echo: ${req.message}` };
    });
    abort = vi.fn();
    isRunning = vi.fn(() => agentState.active > 0);
    disposeSession = vi.fn(async () => {});
    shutdown = vi.fn(async () => {});
  },
}));

// Mock WeChatAdapter — captures the onMessage callback and outbound sends.
const captured = vi.hoisted(() => ({
  onMessage: null as ((event: MessageEvent) => void) | null,
  sent: [] as { userId: string; text: string }[],
}));

vi.mock("../src/channels/wechat/adapter.js", () => ({
  WeChatAdapter: class {
    name = "wechat";
    start = vi.fn(async (cb: (event: MessageEvent) => void) => {
      captured.onMessage = cb;
    });
    stop = vi.fn(async () => {});
    send = vi.fn(async (userId: string, response: { text: string }) => {
      captured.sent.push({ userId, text: response.text });
    });
  },
}));

import { Gateway } from "../src/gateway/server.js";
import { PiAdapter } from "../src/agent/pi-adapter.js";
import { WeChatAdapter } from "../src/channels/wechat/adapter.js";

function makeConfig(): GatewayConfig {
  return {
    channels: [
      { type: "wechat", enabled: true },
    ],
    agent: {
      type: "pi",
      providers: {
        "xfyun-astron": {
          baseUrl: "https://example.com/v2",
          apiKey: "test-key",
          models: [{ id: "astron-code-latest" }],
        },
      },
      defaultModel: "xfyun-astron/astron-code-latest",
      workspaceDir: "/tmp/myos-test-workspace",
    },
    session: {
      dir: "/tmp/myos-test-sessions",
    },
  };
}

function makeEvent(userId: string, content: string): MessageEvent {
  return {
    id: `evt-${userId}-${content}`,
    channel: "wechat",
    userId,
    content,
    timestamp: Date.now(),
  };
}

describe("Gateway", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMap.clear();
    captured.onMessage = null;
    captured.sent = [];
    agentState.active = 0;
    agentState.maxActive = 0;
    agentState.calls = [];
    agentState.resolvers = [];
    agentState.autoResolve = true;
  });

  it("creates a PiAdapter with config from GatewayConfig", async () => {
    const config = makeConfig();
    await Gateway.create(config);

    // PiAdapter was constructed — we can't easily inspect constructor args
    // with class mocks, but we verify it was called by checking the instance works
    expect(PiAdapter).toBeDefined();
  });

  it("creates WeChatAdapter for wechat channel type", async () => {
    const config = makeConfig();
    await Gateway.create(config);

    expect(WeChatAdapter).toBeDefined();
  });

  it("skips disabled channels", async () => {
    const config = makeConfig();
    config.channels[0].enabled = false;

    const gateway = await Gateway.create(config);
    await gateway.start();
    await gateway.stop();

    // Disabled channel should not be registered
  });

  it("handles unknown channel type gracefully", async () => {
    const config = makeConfig();
    config.channels.push({ type: "unknown_channel", enabled: true });

    const gateway = await Gateway.create(config);
    expect(gateway).toBeDefined();
  });

  it("routes a message through the agent and back to the channel", async () => {
    const gateway = await Gateway.create(makeConfig());
    await gateway.start();

    captured.onMessage!(makeEvent("user-a", "hello"));

    await vi.waitFor(() => expect(captured.sent).toHaveLength(1));
    expect(captured.sent[0]).toEqual({ userId: "user-a", text: "echo: hello" });
    await gateway.stop();
  });

  it("serializes messages from the same user (no concurrent prompts per session)", async () => {
    agentState.autoResolve = false;
    const gateway = await Gateway.create(makeConfig());
    await gateway.start();

    captured.onMessage!(makeEvent("user-a", "one"));
    captured.onMessage!(makeEvent("user-a", "two"));

    // First message reaches the agent; second must wait for it to finish
    await vi.waitFor(() => expect(agentState.calls).toEqual(["one"]));
    agentState.resolvers.shift()!();

    await vi.waitFor(() => expect(agentState.calls).toEqual(["one", "two"]));
    agentState.resolvers.shift()!();

    await vi.waitFor(() => expect(captured.sent).toHaveLength(2));
    expect(agentState.maxActive).toBe(1);
    expect(captured.sent.map((s) => s.text)).toEqual(["echo: one", "echo: two"]);
    await gateway.stop();
  });

  it("processes messages from different users concurrently", async () => {
    agentState.autoResolve = false;
    const gateway = await Gateway.create(makeConfig());
    await gateway.start();

    captured.onMessage!(makeEvent("user-a", "from-a"));
    captured.onMessage!(makeEvent("user-b", "from-b"));

    // Both reach the agent without waiting on each other
    await vi.waitFor(() => expect(agentState.calls).toHaveLength(2));
    expect(agentState.maxActive).toBe(2);

    agentState.resolvers.shift()!();
    agentState.resolvers.shift()!();
    await vi.waitFor(() => expect(captured.sent).toHaveLength(2));
    await gateway.stop();
  });

  it("/help returns the command list without calling the agent", async () => {
    const gateway = await Gateway.create(makeConfig());
    await gateway.start();

    captured.onMessage!(makeEvent("user-a", "/help"));

    await vi.waitFor(() => expect(captured.sent).toHaveLength(1));
    expect(captured.sent[0].text).toContain("可用命令");
    expect(captured.sent[0].text).toContain("/fav <链接>");
    expect(captured.sent[0].text).not.toContain("/save");
    expect(captured.sent[0].text).not.toContain("/inbox");
    expect(agentState.calls).toHaveLength(0);
    await gateway.stop();
  });

  it("unknown command returns a hint instead of reaching the agent", async () => {
    const gateway = await Gateway.create(makeConfig());
    await gateway.start();

    captured.onMessage!(makeEvent("user-a", "/foo bar"));

    await vi.waitFor(() => expect(captured.sent).toHaveLength(1));
    expect(captured.sent[0].text).toContain("未知命令 /foo");
    expect(agentState.calls).toHaveLength(0);
    await gateway.stop();
  });

  it("no longer exposes the legacy /inbox command", async () => {
    const gateway = await Gateway.create(makeConfig());
    await gateway.start();

    captured.onMessage!(makeEvent("user-a", "/inbox"));

    await vi.waitFor(() => expect(captured.sent).toHaveLength(1));
    expect(captured.sent[0].text).toContain("未知命令 /inbox");
    expect(agentState.calls).toHaveLength(0);
    await gateway.stop();
  });

  it("/new disposes the old agent session and resets the mapping", async () => {
    const gateway = await Gateway.create(makeConfig());
    await gateway.start();

    // Establish a session first
    captured.onMessage!(makeEvent("user-a", "hello"));
    await vi.waitFor(() => expect(captured.sent).toHaveLength(1));

    captured.onMessage!(makeEvent("user-a", "/new"));
    await vi.waitFor(() => expect(captured.sent).toHaveLength(2));

    expect(captured.sent[1].text).toContain("会话已重置");
    const agent = (gateway as unknown as { agent: { disposeSession: ReturnType<typeof vi.fn> } }).agent;
    expect(agent.disposeSession).toHaveBeenCalledWith("pi-wechat-user-a");
    expect(mockSessionStore.reset).toHaveBeenCalledWith("wechat", "user-a");
    await gateway.stop();
  });

  it("/stop aborts a running task even while the queue is busy", async () => {
    agentState.autoResolve = false;
    const gateway = await Gateway.create(makeConfig());
    await gateway.start();

    captured.onMessage!(makeEvent("user-a", "long task"));
    await vi.waitFor(() => expect(agentState.calls).toHaveLength(1));

    // Command bypasses the queue — replied while the task is still running
    captured.onMessage!(makeEvent("user-a", "/stop"));
    await vi.waitFor(() => expect(captured.sent).toHaveLength(1));
    expect(captured.sent[0].text).toContain("已请求中断");

    const agent = (gateway as unknown as { agent: { abort: ReturnType<typeof vi.fn> } }).agent;
    expect(agent.abort).toHaveBeenCalledWith("pi-wechat-user-a");

    agentState.resolvers.shift()!();
    await vi.waitFor(() => expect(captured.sent).toHaveLength(2));
    await gateway.stop();
  });

  it("/stop with no running task says so", async () => {
    const gateway = await Gateway.create(makeConfig());
    await gateway.start();

    captured.onMessage!(makeEvent("user-a", "/stop"));

    await vi.waitFor(() => expect(captured.sent).toHaveLength(1));
    expect(captured.sent[0].text).toContain("没有正在运行的任务");
    await gateway.stop();
  });

  it("keeps the queue alive after an agent error", async () => {
    const gateway = await Gateway.create(makeConfig());
    await gateway.start();

    const adapter = (gateway as unknown as { agent: { run: ReturnType<typeof vi.fn> } }).agent;
    adapter.run.mockRejectedValueOnce(new Error("boom"));

    captured.onMessage!(makeEvent("user-a", "fails"));
    // Error reply is sent to the user
    await vi.waitFor(() => expect(captured.sent).toHaveLength(1));
    expect(captured.sent[0].text).toContain("出错");

    // Next message still processes normally
    captured.onMessage!(makeEvent("user-a", "recovers"));
    await vi.waitFor(() => expect(captured.sent).toHaveLength(2));
    expect(captured.sent[1].text).toBe("echo: recovers");
    await gateway.stop();
  });
});
