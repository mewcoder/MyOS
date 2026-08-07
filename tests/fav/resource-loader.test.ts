import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { createPiResourceLoader } from "../../src/agent/pi-adapter.js";

const temporary: string[] = [];

afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

describe("Pi skill loading", () => {
  it("discovers built-in MyFav skills through DefaultResourceLoader and diagnoses missing custom paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "myos-resource-test-"));
    temporary.push(root);
    const cwd = join(root, "workspace");
    const agentDir = join(root, "agent");
    await mkdir(cwd, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    const missing = join(root, "missing-skills");
    const loader = await createPiResourceLoader({
      cwd,
      agentDir,
      settingsManager: SettingsManager.inMemory(),
      systemPrompt: "test",
      skillDir: missing,
    });
    expect(loader.getSkills().skills.some((skill) => skill.name === "fav")).toBe(true);
    expect(loader.getSkills().skills.some((skill) => skill.name === "fav-search")).toBe(true);
    expect(loader.getSkills().diagnostics.some((diagnostic) => diagnostic.path === missing)).toBe(true);
  });
});
