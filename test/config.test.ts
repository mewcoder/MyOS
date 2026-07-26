/** Unit tests for the flat config schema and its mapping to the internal shape. */

import { describe, it, expect } from "vitest";
import { validateConfig } from "../src/config/schema.js";

function makeFlatConfig(): Record<string, unknown> {
  return {
    channels: { wechat: {} },
    providers: {
      "xfyun-astron": {
        baseUrl: "https://example.com/v2",
        apiKey: "test-key",
        models: [{ id: "astron-code-latest" }],
      },
    },
    defaultModel: "xfyun-astron/astron-code-latest",
  };
}

describe("validateConfig (flat structure)", () => {
  it("accepts a minimal config and maps it to the internal shape", () => {
    const config = validateConfig(makeFlatConfig());

    expect(config.channels).toEqual([{ type: "wechat", enabled: true }]);
    expect(config.agent.type).toBe("pi");
    expect(config.agent.defaultModel).toBe("xfyun-astron/astron-code-latest");
    expect(config.agent.providers["xfyun-astron"].apiKey).toBe("test-key");
    expect(config.session.dir).toBeUndefined();
  });

  it("defaults channels to enabled and preserves extra channel fields", () => {
    const raw = makeFlatConfig();
    raw.channels = { wechat: { baseUrl: "https://custom.example.com" } };

    const config = validateConfig(raw);

    expect(config.channels[0]).toEqual({
      type: "wechat",
      enabled: true,
      baseUrl: "https://custom.example.com",
    });
  });

  it("respects enabled: false", () => {
    const raw = makeFlatConfig();
    raw.channels = { wechat: { enabled: false } };

    expect(validateConfig(raw).channels[0].enabled).toBe(false);
  });

  it("maps optional top-level fields", () => {
    const raw = makeFlatConfig();
    raw.workspaceDir = "~/work";
    raw.thinkingLevel = "high";
    raw.sessionDir = "~/sess";

    const config = validateConfig(raw);

    expect(config.agent.workspaceDir).toBe("~/work");
    expect(config.agent.thinkingLevel).toBe("high");
    expect(config.session.dir).toBe("~/sess");
  });

  it("rejects empty channels/providers with field paths", () => {
    const raw = makeFlatConfig();
    raw.channels = {};
    expect(() => validateConfig(raw)).toThrow(/at least one channel/);

    const raw2 = makeFlatConfig();
    raw2.providers = {};
    expect(() => validateConfig(raw2)).toThrow(/at least one provider/);
  });

  it("rejects defaultModel without provider prefix", () => {
    const raw = makeFlatConfig();
    raw.defaultModel = "astron-code-latest";
    expect(() => validateConfig(raw)).toThrow(/provider\/model-id/);
  });

  it("rejects a provider without apiKey", () => {
    const raw = makeFlatConfig();
    (raw.providers as Record<string, Record<string, unknown>>)["xfyun-astron"].apiKey = "";
    expect(() => validateConfig(raw)).toThrow(/apiKey/);
  });
});
