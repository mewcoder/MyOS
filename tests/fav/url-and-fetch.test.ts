import { describe, expect, it, vi } from "vitest";
import { fetchFav } from "../../src/fav/fetch.js";
import { FavError } from "../../src/fav/types.js";
import { classifyKnownUrl, normalizeUrl, parseGitHubRepo } from "../../src/fav/url.js";
import { HttpError } from "../../src/inbox/fetch.js";

const articleHtml = (title = "测试文章") => `<!doctype html><html><head><title>${title}</title>
  <meta name="description" content="页面介绍"></head><body><article><h1>${title}</h1>
  <p>${"这是足够长的正文内容。".repeat(40)}</p></article></body></html>`;

describe("fav URL contract", () => {
  it("normalizes tracking params, fragments and GitHub repository roots", () => {
    expect(normalizeUrl("https://Example.com/post/?utm_source=x&a=1#part"))
      .toBe("https://example.com/post?a=1");
    expect(normalizeUrl("https://github.com/Cloudflare/skills.git/?utm_source=x"))
      .toBe("https://github.com/Cloudflare/skills");
    expect(parseGitHubRepo("https://github.com/cloudflare/skills/issues/1")).toBeNull();
  });

  it("classifies only repository roots and known article hosts without fetching", () => {
    expect(classifyKnownUrl("https://github.com/cloudflare/skills")).toBe("repo");
    expect(classifyKnownUrl("https://github.com/cloudflare/skills/tree/main")).toBeUndefined();
    expect(classifyKnownUrl("https://x.com/jack/status/20")).toBe("article");
    expect(classifyKnownUrl("https://mp.weixin.qq.com/s/example")).toBe("article");
  });
});

describe("fav fetch fallback", () => {
  it("returns a complete HTTP article without invoking later tiers", async () => {
    const defuddle = vi.fn();
    const browser = vi.fn();
    const result = await fetchFav("https://example.com/post", undefined, {
      fetchHttp: async (url) => ({ html: articleHtml(), finalUrl: url, via: "http" }),
      fetchDefuddle: defuddle,
      fetchBrowser: browser,
    });
    expect(result.type).toBe("article");
    expect(result.via).toBe("http");
    expect(result.description).toBe("页面介绍");
    expect(defuddle).not.toHaveBeenCalled();
    expect(browser).not.toHaveBeenCalled();
  });

  it("uses Defuddle before browser for a thin HTTP result", async () => {
    const browser = vi.fn();
    const result = await fetchFav("https://example.com/client", undefined, {
      fetchHttp: async (url) => ({ html: "<title>Client</title>", finalUrl: url, via: "http" }),
      fetchDefuddle: async () => ({
        title: "Defuddled",
        markdown: "正文".repeat(120),
        text: "正文".repeat(120),
        source: "blog",
        adapter: "defuddle",
      }),
      fetchBrowser: browser,
    });
    expect(result.via).toBe("defuddle");
    expect(result.title).toBe("Defuddled");
    expect(browser).not.toHaveBeenCalled();
  });

  it("does not retry deterministic missing pages", async () => {
    const defuddle = vi.fn();
    const browser = vi.fn();
    await expect(fetchFav("https://example.com/missing", undefined, {
      fetchHttp: async () => { throw new HttpError(404); },
      fetchDefuddle: defuddle,
      fetchBrowser: browser,
    })).rejects.toMatchObject<FavError>({ code: "fetch_failed" });
    expect(defuddle).not.toHaveBeenCalled();
    expect(browser).not.toHaveBeenCalled();
  });

  it("reads repository metadata from the GitHub API", async () => {
    const result = await fetchFav("https://github.com/cloudflare/skills", undefined, {
      fetchGithub: async () => new Response(JSON.stringify({
        full_name: "cloudflare/skills",
        html_url: "https://github.com/cloudflare/skills",
        description: "Agent Skills",
        stargazers_count: 123,
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    expect(result).toMatchObject({ type: "repo", via: "github", stars: 123, repoName: "cloudflare/skills" });
  });
});
