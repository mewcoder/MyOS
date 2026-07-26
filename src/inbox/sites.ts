/** Per-site extraction adapters.
 *
 * A known site takes a deterministic fast path: fetch over HTTP once and read
 * the fields straight out of the markup we already know. Unknown sites fall
 * back to generic extraction, and only escalate to a browser when that comes
 * up short.
 *
 * To support a new site, add an adapter here — no other file changes.
 */

import { createTurndown, meta, textOf } from "./dom.js";

export type SourceKind = "x" | "wechat" | "blog";

export interface ExtractedArticle {
  title: string;
  author?: string;
  published?: string;
  markdown: string;
  /** Plain text, used for summarisation and length checks. */
  text: string;
  source: SourceKind;
  siteName?: string;
  /** Id of the site adapter that produced this, when one applied. */
  adapter?: string;
}

export interface SiteAdapter {
  id: string;
  source: SourceKind;
  /** Matched against the hostname, with any leading "www." removed. */
  hosts: string[];
  /** Set when the site genuinely renders nothing useful without JavaScript;
   *  skips the wasted HTTP attempt. Neither current adapter needs it. */
  browserOnly?: boolean;
  /** Returns null when the markup doesn't look as expected, which lets the
   *  caller fall back to generic extraction or a browser retry. */
  extract(doc: Document, url: string): ExtractedArticle | null;
}

/** X posts: the body is served in Open Graph tags to every client.
 *
 * X withholds the `data-testid` markup its own UI uses from non-interactive
 * clients — including headless Chrome — so scraping the rendered DOM is both
 * slower and less reliable than reading the meta tags. */
const xAdapter: SiteAdapter = {
  id: "x",
  source: "x",
  hosts: ["x.com", "twitter.com", "mobile.twitter.com"],

  extract(doc, url) {
    const body = meta(doc, ["og:description", "description"]);
    if (!body) return null;

    const ogTitle = meta(doc, ["og:title", "twitter:title"]) ?? "";
    // "jack (@jack) on X" — the handle is the reliable half; fall back to the URL
    const handle =
      ogTitle.match(/\(@([^)]+)\)/)?.[1] ??
      url.match(/(?:x|twitter)\.com\/([^/]+)\/status/i)?.[1];
    const displayName = ogTitle.replace(/\s*\(@[^)]+\)\s*on X\s*$/i, "").trim();
    const author =
      displayName && handle ? `${displayName} (@${handle})` : handle ? `@${handle}` : undefined;

    const firstLine = body.split("\n")[0]!.trim();
    const title = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;

    return {
      title: title || author || "推文",
      author,
      markdown: body,
      text: body,
      source: "x",
      siteName: "X",
      adapter: "x",
    };
  },
};

/** WeChat 公众号 articles.
 *
 * Generic extraction fails badly here: the body lives in `#js_content`, which
 * ships with `visibility: hidden` until WeChat's own script reveals it, and
 * Readability skips hidden nodes — leaving ~15 characters and triggering a
 * pointless browser retry. Byline detection is equally wrong, latching onto
 * the "click to follow" call-to-action instead of the account name. */
const wechatAdapter: SiteAdapter = {
  id: "wechat",
  source: "wechat",
  hosts: ["mp.weixin.qq.com"],

  extract(doc, url) {
    const content = doc.querySelector("#js_content");
    if (!content) return null;

    // Lazy-loaded images carry the real source in data-src
    for (const img of Array.from(content.querySelectorAll("img"))) {
      const real = img.getAttribute("data-src") ?? img.getAttribute("data-original");
      if (real) img.setAttribute("src", real);
    }

    const text = textOf(content.textContent);
    if (!text) return null;

    const title =
      textOf(doc.querySelector("#activity-name")?.textContent) ||
      meta(doc, ["og:title", "twitter:title"]) ||
      textOf(doc.querySelector("title")?.textContent) ||
      url;

    // The account name is the meaningful author for a 公众号 post
    const author =
      textOf(doc.querySelector("#js_name")?.textContent) || meta(doc, ["author"]) || undefined;

    return {
      title,
      author,
      markdown: createTurndown().turndown(content.innerHTML).trim(),
      text,
      source: "wechat",
      siteName: "微信公众号",
      adapter: "wechat",
    };
  },
};

const ADAPTERS: SiteAdapter[] = [xAdapter, wechatAdapter];

/** The adapter for a URL's host, if the site is known. */
export function findAdapter(url: string): SiteAdapter | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
  return ADAPTERS.find((adapter) => adapter.hosts.includes(host));
}

/** Source label for a URL, used before extraction runs. */
export function classifySource(url: string): SourceKind {
  return findAdapter(url)?.source ?? "blog";
}
