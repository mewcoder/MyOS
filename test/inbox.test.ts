/** Unit tests for the inbox capture pipeline's pure logic. */

import { describe, it, expect } from "vitest";
import { isoWeek, slugify, buildItem } from "../src/inbox/store.js";
import { parseCapture } from "../src/inbox/service.js";
import { extractArticle, classifySource, isThin } from "../src/inbox/extract.js";
import { findAdapter } from "../src/inbox/sites.js";

describe("isoWeek", () => {
  it("numbers weeks per ISO-8601", () => {
    expect(isoWeek(new Date("2026-07-26T12:00:00Z"))).toBe("2026-W30");
    // Monday starts a new week
    expect(isoWeek(new Date("2026-07-27T12:00:00Z"))).toBe("2026-W31");
  });

  it("assigns early-January days to the previous year's last week", () => {
    // 2027-01-01 is a Friday, so it belongs to week 53 of 2026
    expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
  });
});

describe("slugify", () => {
  it("keeps CJK readable and strips punctuation", () => {
    expect(slugify("深入理解 useEffect：完全指南", "fallback")).toBe("深入理解-useeffect完全指南");
  });

  it("falls back when nothing usable survives", () => {
    expect(slugify("!!!???", "fallback-id")).toBe("fallback-id");
  });

  it("bounds the length", () => {
    expect(slugify("a".repeat(200), "x").length).toBeLessThanOrEqual(60);
  });
});

describe("parseCapture", () => {
  it("extracts a bare URL", () => {
    expect(parseCapture("https://example.com/post")).toEqual({
      url: "https://example.com/post",
      note: undefined,
    });
  });

  it("keeps surrounding text as the note", () => {
    expect(parseCapture("这篇不错 https://example.com/post 值得细读")).toEqual({
      url: "https://example.com/post",
      note: "这篇不错 值得细读",
    });
  });

  it("strips trailing punctuation that is not part of the URL", () => {
    expect(parseCapture("看这个 https://example.com/post。")?.url).toBe("https://example.com/post");
  });

  it("returns null without a URL", () => {
    expect(parseCapture("帮我看看今天的天气")).toBeNull();
  });
});

describe("site adapters", () => {
  it("classifies known sources and treats everything else as a blog", () => {
    expect(classifySource("https://x.com/jack/status/20")).toBe("x");
    expect(classifySource("https://twitter.com/jack/status/20")).toBe("x");
    expect(classifySource("https://mp.weixin.qq.com/s/abc")).toBe("wechat");
    expect(classifySource("https://overreacted.io/post/")).toBe("blog");
  });

  it("matches known hosts regardless of www, and no adapter for unknown ones", () => {
    expect(findAdapter("https://www.x.com/jack/status/20")?.id).toBe("x");
    expect(findAdapter("https://mp.weixin.qq.com/s/abc")?.id).toBe("wechat");
    expect(findAdapter("https://overreacted.io/post/")).toBeUndefined();
    expect(findAdapter("not a url")).toBeUndefined();
  });

  it("tags adapter output so the caller can skip the browser retry", () => {
    const html = `<html><head>
      <meta property="og:title" content="jack (@jack) on X">
      <meta property="og:description" content="hello">
    </head><body></body></html>`;

    expect(extractArticle(html, "https://x.com/jack/status/20").adapter).toBe("x");
    // Unknown sites carry no adapter id, so thinness decides
    expect(extractArticle("<html><body><p>x</p></body></html>", "https://blog.example.com/p").adapter)
      .toBeUndefined();
  });
});

describe("extractArticle", () => {
  it("reads a post body from Open Graph tags", () => {
    const html = `<html><head>
      <meta property="og:title" content="jack (@jack) on X">
      <meta property="og:description" content="just setting up my twttr">
    </head><body><div>irrelevant chrome</div></body></html>`;

    const article = extractArticle(html, "https://x.com/jack/status/20");

    expect(article.source).toBe("x");
    expect(article.title).toBe("just setting up my twttr");
    expect(article.author).toBe("jack (@jack)");
    expect(article.text).toBe("just setting up my twttr");
  });

  it("reads a WeChat article out of its hidden content container", () => {
    // #js_content ships hidden until WeChat's own script reveals it, and the
    // page's only byline-looking element is a follow prompt — the generic
    // Readability path extracts ~nothing and the wrong author.
    const html = `<html><head><title>页面标题</title></head><body>
      <h1 id="activity-name">在手机上 Python 编程</h1>
      <a id="js_name">Python猫</a>
      <span>点击关注--&gt;</span>
      <div id="js_content" style="visibility: hidden; opacity: 0;">
        <p>${"正文内容。".repeat(50)}</p>
        <p><img data-src="https://mmbiz.qpic.cn/pic.jpg"></p>
      </div>
    </body></html>`;

    const article = extractArticle(html, "https://mp.weixin.qq.com/s/abc");

    expect(article.source).toBe("wechat");
    expect(article.title).toBe("在手机上 Python 编程");
    expect(article.author).toBe("Python猫");
    expect(article.text.length).toBeGreaterThan(200);
    expect(isThin(article)).toBe(false);
    // Lazy-loaded images must survive as real image links
    expect(article.markdown).toContain("https://mmbiz.qpic.cn/pic.jpg");
  });

  it("resolves relative image URLs against the source page", () => {
    const body = `<p>${"内容段落。".repeat(40)}</p><p><img src="./yoda.jpg"></p>`;
    const html = `<html><head><title>示例文章</title></head>
      <body><article>${body}</article></body></html>`;

    const article = extractArticle(html, "https://blog.example.com/posts/guide/");

    // A relative path here would break the static site build
    expect(article.markdown).toContain("https://blog.example.com/posts/guide/yoda.jpg");
    expect(article.markdown).not.toContain("./yoda.jpg");
  });

  it("treats short posts as complete but thin articles as needing a retry", () => {
    const post = { source: "x", text: "短推文" } as ReturnType<typeof extractArticle>;
    expect(isThin(post)).toBe(false);

    const emptyPost = { source: "x", text: "" } as ReturnType<typeof extractArticle>;
    expect(isThin(emptyPost)).toBe(true);

    const shell = { source: "blog", text: "Loading…" } as ReturnType<typeof extractArticle>;
    expect(isThin(shell)).toBe(true);
  });
});

describe("buildItem", () => {
  it("derives the archive path, week and id from the capture time", () => {
    const item = buildItem({
      title: "测试文章",
      url: "https://example.com/a",
      source: "blog",
      words: 1234,
      now: new Date("2026-07-26T10:00:00Z"),
    });

    expect(item.path).toBe("items/2026/07/2026-07-26-测试文章.md");
    expect(item.week).toBe("2026-W30");
    expect(item.id).toBe("2026-07-26-测试文章");
    expect(item.tags).toEqual([]);
  });
});
