/** Article extraction: HTML → structured content + Markdown.
 *
 * Known sites are handled by their own adapter (see sites.ts); everything else
 * goes through Readability.
 */

import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";
import { absolutizeUrls, createTurndown, meta, textOf } from "./dom.js";
import { findAdapter, classifySource, type ExtractedArticle, type SourceKind } from "./sites.js";

export { classifySource };
export type { ExtractedArticle, SourceKind };

/** Readability-based extraction, for sites we know nothing specific about. */
function extractGeneric(doc: Document, url: string, source: SourceKind): ExtractedArticle {
  const metaAuthor = meta(doc, ["author", "article:author", "og:article:author"]);
  const metaPublished = meta(doc, [
    "article:published_time",
    "og:article:published_time",
    "publishdate",
    "date",
  ]);
  const siteName = meta(doc, ["og:site_name"]);

  // Readability mutates the document, so it runs last
  const parsed = new Readability(doc, { charThreshold: 100 }).parse();

  const title =
    textOf(parsed?.title) ||
    meta(doc, ["og:title", "twitter:title"]) ||
    textOf(doc.querySelector("title")?.textContent) ||
    url;

  const contentHtml = parsed?.content ?? "";
  const markdown = contentHtml ? createTurndown().turndown(contentHtml).trim() : "";
  const text = textOf(parsed?.textContent) || markdown;

  return {
    title,
    author: textOf(parsed?.byline) || metaAuthor,
    published: metaPublished,
    markdown,
    text,
    source,
    siteName,
  };
}

/**
 * Extract an article. When a site adapter matches and succeeds, the result
 * carries its `adapter` id — the signal that no browser retry is needed.
 */
export function extractArticle(html: string, url: string): ExtractedArticle {
  const { document } = parseHTML(html);
  const doc = document as unknown as Document;

  absolutizeUrls(doc, url);

  const adapter = findAdapter(url);
  if (adapter) {
    const extracted = adapter.extract(doc, url);
    if (extracted) return extracted;
  }

  return extractGeneric(doc, url, adapter?.source ?? "blog");
}

/** Whether extraction came up short enough to be worth retrying through a
 *  browser. Posts are legitimately brief, so they only need *something*. */
export function isThin(article: ExtractedArticle): boolean {
  const length = article.text.trim().length;
  return article.source === "x" ? length === 0 : length < 200;
}
