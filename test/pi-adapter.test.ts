/** Unit tests for PiAdapter — SDK-based Pi agent runtime with Pi-native provider config. */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Keep unit tests from writing to the real ~/.myos/logs
vi.mock("../src/log.js", () => ({
  logger: { log: vi.fn() },
  preview: (text: string) => text,
}));

// Mock the Pi SDK
vi.mock("@earendil-works/pi-coding-agent", () => {
  return {
    createAgentSession: vi.fn(),
    createExtensionRuntime: vi.fn(() => ({})),
    ModelRuntime: class {
      static create = vi.fn();
    },
    SessionManager: class {
      static create = vi.fn();
      static inMemory = vi.fn();
    },
    SettingsManager: class {
      static inMemory = vi.fn(() => ({}));
    },
    resolveCliModel: vi.fn(),
  };
});

import { PiAdapter } from "../src/agent/pi-adapter.js";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  resolveCliModel,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

/** Events matching the real SDK contract: text is committed via message_end
 *  (with stopReason) and the run completes with agent_settled. */
function assistantEnd(text: string, stopReason = "stop", errorMessage?: string): AgentSessionEvent {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      stopReason,
      errorMessage,
      content: text ? [{ type: "text", text }] : [],
    },
  } as unknown as AgentSessionEvent;
}

const SETTLED = { type: "agent_settled" } as unknown as AgentSessionEvent;

/** Session whose prompt() emits a scripted event sequence per call. */
function mockScriptedSession(scripts: AgentSessionEvent[][]): AgentSession {
  let promptIndex = 0;
  const subscribers: Array<(event: AgentSessionEvent) => void> = [];

  return {
    subscribe: vi.fn((handler: (event: AgentSessionEvent) => void) => {
      subscribers.push(handler);
      return vi.fn();
    }),
    prompt: vi.fn(async () => {
      const events = scripts[promptIndex++] ?? scripts[scripts.length - 1] ?? [];
      for (const event of events) {
        for (const handler of [...subscribers]) {
          handler(event);
        }
      }
    }),
    abort: vi.fn(async () => {}),
    dispose: vi.fn(),
    agent: { waitForIdle: vi.fn(async () => {}) },
  } as unknown as AgentSession;
}

function mockSession(responses: string[] = ["Hello!"]): AgentSession {
  return mockScriptedSession(responses.map((r) => [assistantEnd(r), SETTLED]));
}

const mockProviders = {
  "xfyun-astron": {
    baseUrl: "https://example.com/v2",
    api: "openai-completions",
    apiKey: "test-key",
    authHeader: true,
    models: [
      {
        id: "astron-code-latest",
        name: "Astron Code",
        input: ["text"],
        contextWindow: 200000,
        maxTokens: 16384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  },
};

describe("PiAdapter", () => {
  let adapter: PiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();

    const mockModelRuntime = {
      getModel: vi.fn(),
      getAvailable: vi.fn(async () => []),
    } as unknown as InstanceType<typeof ModelRuntime>;

    vi.mocked(ModelRuntime.create).mockResolvedValue(mockModelRuntime);
    vi.mocked(SessionManager.create).mockReturnValue({} as never);
    vi.mocked(resolveCliModel).mockReturnValue({
      model: { id: "astron-code-latest", provider: "xfyun-astron" },
      error: undefined,
      warning: undefined,
    });

    adapter = new PiAdapter({
      providers: mockProviders,
      defaultModel: "xfyun-astron/astron-code-latest",
      workspaceDir: "/tmp/myos-test-workspace",
    });
  });

  it("initializes ModelRuntime on first run", async () => {
    const session = mockSession();
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    await adapter.run({ sessionId: "s1", message: "hi" });

    expect(ModelRuntime.create).toHaveBeenCalledOnce();
  });

  it("does not re-initialize ModelRuntime on subsequent runs", async () => {
    const session = mockSession();
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    await adapter.run({ sessionId: "s1", message: "hi" });
    await adapter.run({ sessionId: "s1", message: "hello" });

    expect(ModelRuntime.create).toHaveBeenCalledOnce();
  });

  it("creates a session and sends a prompt", async () => {
    const session = mockSession(["Response text"]);
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    const result = await adapter.run({ sessionId: "s1", message: "test" });

    expect(session.prompt).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({ streamingBehavior: "followUp" }),
    );
    expect(result.text).toBe("Response text");
  });

  it("reuses session for the same sessionId", async () => {
    const session = mockSession();
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    await adapter.run({ sessionId: "s1", message: "first" });
    await adapter.run({ sessionId: "s1", message: "second" });

    expect(createAgentSession).toHaveBeenCalledOnce();
  });

  it("resolves model from defaultModel config", async () => {
    const session = mockSession();
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    await adapter.run({ sessionId: "s1", message: "hi" });

    expect(resolveCliModel).toHaveBeenCalledWith(
      expect.objectContaining({ cliModel: "xfyun-astron/astron-code-latest" }),
    );
  });

  it("returns [no response] when agent produces no text", async () => {
    const session = mockSession([""]);
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    const result = await adapter.run({ sessionId: "s1", message: "hi" });

    expect(result.text).toBe("[no response]");
  });

  it("abort calls session.abort", async () => {
    const session = mockSession();
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    // Init the adapter so session is created
    await adapter.run({ sessionId: "s1", message: "hi" });
    adapter.abort("s1");

    expect(session.abort).toHaveBeenCalled();
  });

  it("isRunning returns false when no runs active", async () => {
    const session = mockSession();
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    await adapter.run({ sessionId: "s1", message: "hi" });

    expect(adapter.isRunning("s1")).toBe(false);
  });

  it("drops errored message text — only the regenerated reply is returned", async () => {
    // SDK auto-retry: errored assistant message is removed and regenerated;
    // committing its partial text would duplicate content
    const session = mockScriptedSession([
      [
        assistantEnd("partial gar", "error", "connection reset"),
        assistantEnd("Final answer"),
        SETTLED,
      ],
    ]);
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    const result = await adapter.run({ sessionId: "s1", message: "hi" });

    expect(result.text).toBe("Final answer");
  });

  it("rejects with the agent error when no text was produced", async () => {
    const session = mockScriptedSession([
      [assistantEnd("", "error", "invalid api key"), SETTLED],
    ]);
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    await expect(adapter.run({ sessionId: "s1", message: "hi" })).rejects.toThrow(
      "invalid api key",
    );
  });

  it("does not settle on agent_end — waits for agent_settled", async () => {
    const subscribers: Array<(event: AgentSessionEvent) => void> = [];
    const session = {
      subscribe: vi.fn((handler: (event: AgentSessionEvent) => void) => {
        subscribers.push(handler);
        return vi.fn();
      }),
      prompt: vi.fn(async () => {
        for (const handler of [...subscribers]) {
          handler(assistantEnd("Reply"));
          handler({ type: "agent_end", willRetry: false, messages: [] } as unknown as AgentSessionEvent);
          // No agent_settled yet — the SDK may still be compacting
        }
      }),
      abort: vi.fn(async () => {}),
      dispose: vi.fn(),
    } as unknown as AgentSession;
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    const run = adapter.run({ sessionId: "s1", message: "hi" });
    const raced = await Promise.race([
      run.then(() => "settled"),
      new Promise((r) => setTimeout(() => r("pending"), 50)),
    ]);
    expect(raced).toBe("pending");

    // Compaction finishes — run settles now
    for (const handler of [...subscribers]) handler(SETTLED);
    const result = await run;
    expect(result.text).toBe("Reply");
  });

  it("shutdown disposes all sessions", async () => {
    const session1 = mockSession();
    const session2 = mockSession();
    vi.mocked(createAgentSession)
      .mockResolvedValueOnce({ session: session1 } as never)
      .mockResolvedValueOnce({ session: session2 } as never);

    await adapter.run({ sessionId: "s1", message: "hi" });
    await adapter.run({ sessionId: "s2", message: "hi" });

    await adapter.shutdown();

    expect(session1.dispose).toHaveBeenCalled();
    expect(session2.dispose).toHaveBeenCalled();
  });
});
