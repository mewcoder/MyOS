import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFavArgs, runFavCli } from "../../src/fav/cli.js";
import { FavService } from "../../src/fav/service.js";
import { DEFAULT_MYFAV_REMOTE, readCollections } from "../../src/fav/store.js";

const temporary: string[] = [];

async function tempPath(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "myos-fav-test-"));
  temporary.push(path);
  return path;
}

async function createMyFav(): Promise<string> {
  const root = await tempPath();
  await mkdir(join(root, "public", "data"), { recursive: true });
  await Promise.all([
    writeFile(join(root, "public", "data", "sites.json"), "[]\n"),
    writeFile(join(root, "public", "data", "repos.json"), "[]\n"),
    writeFile(join(root, "public", "data", "articles.json"), "[]\n"),
  ]);
  return root;
}

afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

const pageHtml = `<!doctype html><html><head><title>收藏文章</title><meta name="author" content="作者">
  <meta property="article:published_time" content="2026-08-01T12:00:00Z"></head><body><article>
  <h1>收藏文章</h1><p>${"有价值的文章正文。".repeat(50)}</p>
  <img alt="one" src="https://img.test/one.png"><img alt="two" src="https://img.test/two.png">
  </article></body></html>`;

describe("FavService", () => {
  it("binds normal usage to ~/.myos/myfav without a directory argument", () => {
    expect(parseFavArgs(["https://example.com"], {}).repoDir).toBe(join(homedir(), ".myos", "myfav"));
  });

  it("exposes machine-readable myos fav dry-run output", async () => {
    const parent = await tempPath();
    const repoDir = join(parent, "missing-myfav");
    let stdout = "";
    let stderr = "";
    const exitCode = await runFavCli([
      "https://example.com/article",
      "--repo-dir", repoDir,
      "--dry-run",
      "--json",
      "--tag", "Skill",
    ], {
      stdout: (text) => { stdout += text; },
      stderr: (text) => { stderr += text; },
    }, {
      fetchHttp: async (url) => ({ html: pageHtml, finalUrl: url, via: "http" }),
      fetchDefuddle: vi.fn(),
      fetchBrowser: vi.fn(),
    });
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({ status: "preview", type: "article", tags: ["Agent Skill"] });
    expect(existsSync(repoDir)).toBe(false);
  });

  it("keeps dry-run free of filesystem and Git mutations", async () => {
    const parent = await tempPath();
    const repoDir = join(parent, "missing-myfav");
    const runGit = vi.fn();
    const result = await new FavService({
      fetchHttp: async (url) => ({ html: pageHtml, finalUrl: url, via: "http" }),
      fetchDefuddle: vi.fn(),
      fetchBrowser: vi.fn(),
      runGit,
    }).capture({ url: "https://example.com/article", repoDir, dryRun: true });
    expect(result.status).toBe("preview");
    expect(existsSync(repoDir)).toBe(false);
    expect(runGit).not.toHaveBeenCalled();
  });

  it("automatically clones the bound MyFav repository into the default-style directory", async () => {
    const parent = await tempPath();
    const repoDir = join(parent, "myfav");
    const runGit = vi.fn(async (cwd: string, args: string[]) => {
      if (args[0] === "clone") {
        expect(cwd).toBe(parent);
        expect(args).toEqual(["clone", "--origin", "origin", DEFAULT_MYFAV_REMOTE, repoDir]);
        await mkdir(join(repoDir, "public", "data"), { recursive: true });
        await Promise.all([
          writeFile(join(repoDir, "public", "data", "sites.json"), "[]\n"),
          writeFile(join(repoDir, "public", "data", "repos.json"), "[]\n"),
          writeFile(join(repoDir, "public", "data", "articles.json"), "[]\n"),
        ]);
      }
      return { ok: true, output: "ok" };
    });
    const result = await new FavService({
      now: () => new Date(2026, 7, 6),
      fetchHttp: async (url) => ({ html: pageHtml, finalUrl: url, via: "http" }),
      fetchDefuddle: vi.fn(),
      fetchBrowser: vi.fn(),
      runGit,
    }).capture({ url: "https://example.com", type: "site", repoDir, noCommit: true });

    expect(result).toMatchObject({ status: "saved", committed: false, pushed: false });
    expect(runGit).toHaveBeenCalledTimes(1);
    expect(existsSync(join(repoDir, "public", "data", "sites.json"))).toBe(true);
  });

  it("upgrades an existing legacy MyFav clone before saving its first article", async () => {
    const repoDir = await tempPath();
    await mkdir(join(repoDir, ".git"), { recursive: true });
    await mkdir(join(repoDir, "public", "data"), { recursive: true });
    await Promise.all([
      writeFile(join(repoDir, "public", "data", "sites.json"), JSON.stringify([{
        title: "Legacy Site",
        url: "https://legacy.example.com",
        description: "旧网站数据",
        category: "工具",
        saveTime: "2026-01-01",
      }])),
      writeFile(join(repoDir, "public", "data", "repos.json"), JSON.stringify([{
        name: "example/legacy",
        url: "https://github.com/example/legacy",
        description: "旧仓库数据",
        tags: ["Agent"],
        stars: 10,
        saveTime: "2026-01-01",
      }])),
    ]);

    const result = await new FavService({
      now: () => new Date(2026, 7, 7),
      fetchHttp: async (url) => ({ html: pageHtml, finalUrl: url, via: "http" }),
      fetchDefuddle: vi.fn(),
      fetchBrowser: vi.fn(),
    }).capture({
      url: "https://example.com/first-article",
      type: "article",
      repoDir,
      noCommit: true,
    });

    expect(result).toMatchObject({ status: "saved", type: "article", committed: false });
    const collections = await readCollections(repoDir);
    expect(collections.sites[0]?.tags).toEqual([]);
    expect(collections.repos[0]?.category).toBe("开发");
    expect(collections.articles).toHaveLength(1);
  });

  it("writes article body and localizes successful images without frontmatter", async () => {
    const repoDir = await createMyFav();
    const result = await new FavService({
      now: () => new Date(2026, 7, 6),
      fetchHttp: async (url) => ({ html: pageHtml, finalUrl: url, via: "http" }),
      fetchDefuddle: vi.fn(),
      fetchBrowser: vi.fn(),
      fetchImage: async (url) => {
        if (url.includes("two.png")) return new Response("missing", { status: 404 });
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      },
    }).capture({
      url: "https://example.com/article",
      repoDir,
      noCommit: true,
      category: "知识",
      tags: ["Skill", "skills", "阅读"],
    });

    expect(result.status).toBe("saved");
    if (result.status !== "saved") return;
    expect(result.path).toBe("articles/2026-08/收藏文章.md");
    expect(result.committed).toBe(false);
    expect(result.tags).toEqual(["Agent Skill", "阅读"]);
    expect(result.warnings?.some((warning) => warning.includes("two.png"))).toBe(true);
    const markdown = await readFile(join(repoDir, result.path!), "utf8");
    expect(markdown.startsWith("---")).toBe(false);
    expect(markdown).toContain("./收藏文章/01.png");
    expect(markdown).toContain("https://img.test/two.png");
    expect(existsSync(join(repoDir, "articles", "2026-08", "收藏文章", "01.png"))).toBe(true);
    const articles = JSON.parse(await readFile(join(repoDir, "public", "data", "articles.json"), "utf8"));
    expect(articles[0]).toMatchObject({
      title: "收藏文章",
      url: "https://example.com/article",
      category: "知识",
      author: "作者",
      published: "2026-08-01",
      path: result.path,
    });
    await expect(readCollections(repoDir)).resolves.toMatchObject({ articles: [{ path: result.path }] });
  });

  it("rejects duplicate article paths across different records", async () => {
    const repoDir = await createMyFav();
    const path = "articles/2026-08/shared.md";
    await mkdir(join(repoDir, "articles", "2026-08"), { recursive: true });
    await writeFile(join(repoDir, path), "正文\n");
    await writeFile(join(repoDir, "public", "data", "articles.json"), JSON.stringify([
      {
        title: "One", url: "https://example.com/one", description: "One", category: "知识",
        tags: [], saveTime: "2026-08-01", path,
      },
      {
        title: "Two", url: "https://example.com/two", description: "Two", category: "知识",
        tags: [], saveTime: "2026-08-01", path,
      },
    ]));
    await expect(readCollections(repoDir)).rejects.toMatchObject({
      code: "repo_invalid",
      message: expect.stringContaining("重复 path"),
    });
  });

  it("rejects an article Markdown file whose local image is missing", async () => {
    const repoDir = await createMyFav();
    const path = "articles/2026-08/missing-image.md";
    await mkdir(join(repoDir, "articles", "2026-08"), { recursive: true });
    await writeFile(join(repoDir, path), "正文\n\n![missing](./missing-image/01.png)\n");
    await writeFile(join(repoDir, "public", "data", "articles.json"), JSON.stringify([{
      title: "Missing image",
      url: "https://example.com/missing-image",
      description: "Missing image",
      category: "知识",
      tags: [],
      saveTime: "2026-08-01",
      path,
    }]));
    await expect(readCollections(repoDir)).rejects.toMatchObject({
      code: "repo_invalid",
      message: expect.stringContaining("本地图片不存在"),
    });
  });

  it("returns duplicate before doing network work", async () => {
    const repoDir = await createMyFav();
    await writeFile(join(repoDir, "public", "data", "sites.json"), JSON.stringify([{
      title: "Example",
      url: "https://example.com",
      description: "Example",
      category: "工具",
      tags: [],
      saveTime: "2026-08-01",
    }], null, 2));
    const fetchHttp = vi.fn();
    const result = await new FavService({ fetchHttp }).capture({
      url: "https://example.com/?utm_source=test#x",
      repoDir,
      noCommit: true,
    });
    expect(result).toMatchObject({ status: "duplicate", type: "site", title: "Example" });
    expect(fetchHttp).not.toHaveBeenCalled();
  });

  it("writes the exact GitHub repository record contract", async () => {
    const repoDir = await createMyFav();
    const result = await new FavService({
      now: () => new Date(2026, 7, 6),
      fetchGithub: async () => new Response(JSON.stringify({
        full_name: "cloudflare/skills",
        html_url: "https://github.com/cloudflare/skills",
        description: "Skills for Cloudflare",
        stargazers_count: 1600,
      }), { status: 200 }),
    }).capture({
      url: "https://github.com/cloudflare/skills",
      repoDir,
      noCommit: true,
      category: "AI",
      tags: ["skill"],
    });
    expect(result).toMatchObject({ status: "saved", type: "repo", committed: false });
    const repos = JSON.parse(await readFile(join(repoDir, "public", "data", "repos.json"), "utf8"));
    expect(repos).toEqual([{
      name: "cloudflare/skills",
      url: "https://github.com/cloudflare/skills",
      description: "Skills for Cloudflare",
      category: "AI",
      tags: ["Agent Skill", "GitHub"],
      stars: 1600,
      saveTime: "2026-08-06",
    }]);
  });

  it("pulls, stages explicit paths, commits, and pushes a website", async () => {
    const repoDir = await createMyFav();
    const runGit = vi.fn(async (_repoDir: string, args: string[]) => ({ ok: true, output: args.join(" ") }));
    const result = await new FavService({
      now: () => new Date(2026, 7, 6),
      fetchHttp: async (url) => ({ html: pageHtml, finalUrl: url, via: "http" }),
      fetchDefuddle: vi.fn(),
      fetchBrowser: vi.fn(),
      runGit,
    }).capture({ url: "https://example.com", type: "site", repoDir });
    expect(result).toMatchObject({ status: "saved", committed: true, pushed: true, type: "site" });
    expect(runGit).toHaveBeenNthCalledWith(1, repoDir, ["pull", "--ff-only"]);
    expect(runGit).toHaveBeenNthCalledWith(
      2,
      repoDir,
      ["add", "--", "public/data/sites.json"],
    );
    expect(runGit).toHaveBeenNthCalledWith(
      3,
      repoDir,
      ["commit", "-m", "fav: 收藏文章", "--", "public/data/sites.json"],
    );
    expect(runGit).toHaveBeenNthCalledWith(4, repoDir, ["push", "origin", "HEAD"]);
    expect(runGit.mock.calls.flat().flat()).not.toContain("-A");
  });
});
