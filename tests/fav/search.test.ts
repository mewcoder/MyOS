import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { parseFavSearchArgs, runFavSearchCli } from "../../src/fav/search-cli.js";
import { searchFav } from "../../src/fav/search.js";

const temporary: string[] = [];

async function createMyFav(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "myos-fav-search-test-"));
  temporary.push(root);
  await mkdir(join(root, "public", "data"), { recursive: true });
  await mkdir(join(root, "articles", "2026-08"), { recursive: true });
  await Promise.all([
    writeFile(join(root, "public", "data", "sites.json"), JSON.stringify([{
      title: "Linear",
      url: "https://linear.app",
      description: "项目管理工具",
      category: "工具",
      tags: ["项目管理", "效率"],
      saveTime: "2026-08-01",
    }])),
    writeFile(join(root, "public", "data", "repos.json"), JSON.stringify([{
      name: "cloudflare/skills",
      url: "https://github.com/cloudflare/skills",
      description: "Cloudflare Agent Skills 集合",
      category: "开发",
      tags: ["Cloudflare", "Agent Skill"],
      stars: 1234,
      saveTime: "2026-08-02",
    }])),
    writeFile(join(root, "public", "data", "articles.json"), JSON.stringify([{
      title: "如何设计可靠的 Skill",
      url: "https://example.com/skill-design",
      description: "讲解可验证的 Agent 工作流",
      category: "知识",
      tags: ["Agent", "工作流"],
      saveTime: "2026-08-03",
      path: "articles/2026-08/skill-design.md",
    }])),
    writeFile(join(root, "articles", "2026-08", "skill-design.md"), "# 如何设计可靠的 Skill\n\n失败后需要设计浏览器降级路径。\n"),
  ]);
  return root;
}

afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

describe("fav-search", () => {
  it("parses a natural-language query and an explicit collection type", () => {
    expect(parseFavSearchArgs(["Cloudflare", "Skill", "--type", "repo"], {})).toMatchObject({
      query: "Cloudflare Skill",
      type: "repo",
      limit: 5,
    });
  });

  it("ranks saved metadata and filters by type", async () => {
    const repoDir = await createMyFav();
    const result = await searchFav({ query: "Cloudflare", type: "repo", repoDir });
    expect(result).toMatchObject({
      status: "found",
      count: 1,
      results: [{ type: "repo", title: "cloudflare/skills" }],
    });
    expect(result.results[0]?.matchedIn).toEqual(expect.arrayContaining(["标题", "标签"]));
  });

  it("searches archived article Markdown body text", async () => {
    const repoDir = await createMyFav();
    const result = await searchFav({ query: "浏览器降级", type: "article", repoDir });
    expect(result.results[0]).toMatchObject({
      type: "article",
      title: "如何设计可靠的 Skill",
      matchedIn: ["正文"],
    });
  });

  it("returns machine-readable empty results without treating them as an error", async () => {
    const repoDir = await createMyFav();
    let stdout = "";
    const exitCode = await runFavSearchCli([
      "不存在的关键词", "--repo-dir", repoDir, "--json",
    ], {
      stdout: (text) => { stdout += text; },
      stderr: () => {},
    });
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ status: "empty", count: 0 });
  });
});
