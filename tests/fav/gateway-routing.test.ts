import { describe, expect, it, vi } from "vitest";
import { Gateway } from "../../src/gateway/server.js";
import type { ChannelAdapter, MessageEvent } from "../../src/types.js";

function event(content: string): MessageEvent {
  return { id: "message-1", channel: "wechat", userId: "user-1", content, timestamp: Date.now() };
}

function channel(): ChannelAdapter {
  return {
    name: "wechat",
    start: async () => {},
    stop: async () => {},
    send: async () => {},
  };
}

function gatewayHarness() {
  const gateway = Object.create(Gateway.prototype) as Gateway & Record<string, unknown>;
  const processMessage = vi.fn(async () => {});
  Object.assign(gateway, {
    queues: new Map<string, Promise<void>>(),
    processMessage,
  });
  return { gateway, processMessage };
}

describe("Gateway fav routing", () => {
  it("routes a bare link through the agent instead of the legacy Inbox", async () => {
    const { gateway, processMessage } = gatewayHarness();
    await (gateway as any).handleMessage(event("https://example.com/article"), channel());
    expect(processMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "https://example.com/article" }),
      expect.objectContaining({ name: "wechat" }),
    );
  });

  it("translates /fav into the same queued $fav agent workflow", async () => {
    const { gateway, processMessage } = gatewayHarness();
    await (gateway as any).handleMessage(event("/fav https://example.com/article 技术"), channel());
    expect(processMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: "$fav https://example.com/article\n技术" }),
      expect.objectContaining({ name: "wechat" }),
    );
  });
});
