/** Unit tests for PiAdapter — SDK-based Pi agent runtime. */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Pi SDK — classes must use function/class syntax for `new`
vi.mock("@earendil-works/pi-coding-agent", () => {
  return {
    createAgentSession: vi.fn(),
    ModelRuntime: class {
      static create = vi.fn();
    },
    SessionManager: class {
      static inMemory = vi.fn();
    },
    DefaultResourceLoader: class {
      reload = vi.fn(async () => {});
    },
    getAgentDir: vi.fn(() => "/mock/.pi/agent"),
    resolveCliModel: vi.fn(),
  };
});

import { PiAdapter } from "../src/agent/pi-adapter.js";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  DefaultResourceLoader,
  resolveCliModel,
} from "@earendil-works/pi-coding-agent";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

function mockSession(responses: string[] = ["Hello!"]): AgentSession {
  let promptIndex = 0;
  const subscribers: Array<(event: AgentSessionEvent) => void> = [];

  return {
    subscribe: vi.fn((listener: (event: AgentSessionEvent) => void) => {
      subscribers.push(listener);
      return () => {
        const idx = subscribers.indexOf(listener);
        if (idx >= 0) subscribers.splice(idx, 1);
      };
    }),
    prompt: vi.fn(async (_text: string) => {
      const response = responses[promptIndex++] ?? "default response";
      for (const sub of [...subscribers]) {
        sub({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: response },
        } as unknown as AgentSessionEvent);
      }
      for (const sub of [...subscribers]) {
        sub({ type: "agent_end" } as unknown as AgentSessionEvent);
      }
    }),
    abort: vi.fn(async () => {}),
    dispose: vi.fn(),
  } as unknown as AgentSession;
}

describe("PiAdapter", () => {
  let adapter: PiAdapter;

  beforeEach(() => {
    vi.clearAllMocks();

    const mockModelRuntime = {
      getModel: vi.fn(),
      getAvailable: vi.fn(async () => []),
    } as unknown as InstanceType<typeof ModelRuntime>;

    vi.mocked(ModelRuntime.create).mockResolvedValue(mockModelRuntime);
    vi.mocked(SessionManager.inMemory).mockReturnValue({} as never);
    vi.mocked(resolveCliModel).mockReturnValue({
      model: { id: "test-model", provider: "test-provider" },
      error: undefined,
      warning: undefined,
    });

    adapter = new PiAdapter({
      provider: "xfyun-astron",
      model: "astron-code-latest",
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

    const result = await adapter.run({ sessionId: "s1", message: "hi" });

    expect(createAgentSession).toHaveBeenCalledOnce();
    expect(session.prompt).toHaveBeenCalledWith("hi");
    expect(result.text).toBe("Response text");
  });

  it("reuses session for the same sessionId", async () => {
    const session = mockSession(["First", "Second"]);
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    await adapter.run({ sessionId: "s1", message: "first" });
    await adapter.run({ sessionId: "s1", message: "second" });

    expect(createAgentSession).toHaveBeenCalledOnce();
  });

  it("resolves model from provider/model config", async () => {
    const session = mockSession();
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    await adapter.run({ sessionId: "s1", message: "hi" });

    expect(resolveCliModel).toHaveBeenCalledWith(
      expect.objectContaining({
        cliModel: "xfyun-astron/astron-code-latest",
      }),
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

    await adapter.run({ sessionId: "s1", message: "hi" });
    adapter.abort("s1");

    expect(session.abort).toHaveBeenCalled();
  });

  it("isRunning tracks active runs", async () => {
    // Create a session where prompt hangs until we resolve it
    let resolvePrompt!: () => void;
    const promptPromise = new Promise<void>((r) => { resolvePrompt = r; });

    const subscribers: Array<(event: AgentSessionEvent) => void> = [];
    const session = {
      subscribe: vi.fn((listener: (event: AgentSessionEvent) => void) => {
        subscribers.push(listener);
        return () => {
          const idx = subscribers.indexOf(listener);
          if (idx >= 0) subscribers.splice(idx, 1);
        };
      }),
      prompt: vi.fn(async () => { await promptPromise; }),
      abort: vi.fn(async () => {
        for (const sub of [...subscribers]) {
          sub({ type: "agent_end" } as unknown as AgentSessionEvent);
        }
        resolvePrompt();
      }),
      dispose: vi.fn(),
    } as unknown as AgentSession;

    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    // Init first so run() doesn't need to await init()
    await adapter.init();

    const runPromise = adapter.run({ sessionId: "s1", message: "hi" });

    // Give it a tick to enter the async flow
    await new Promise((r) => setTimeout(r, 10));
    expect(adapter.isRunning("s1")).toBe(true);

    // Abort to let it finish
    adapter.abort("s1");
    await runPromise;

    expect(adapter.isRunning("s1")).toBe(false);
  });

  it("shutdown disposes all sessions", async () => {
    const session1 = mockSession();
    const session2 = mockSession();
    let callCount = 0;
    vi.mocked(createAgentSession).mockImplementation(async () => ({
      session: callCount++ === 0 ? session1 : session2,
    }) as never);

    await adapter.run({ sessionId: "s1", message: "hi" });
    await adapter.run({ sessionId: "s2", message: "hi" });

    await adapter.shutdown();

    expect(session1.dispose).toHaveBeenCalled();
    expect(session2.dispose).toHaveBeenCalled();
  });
});
