/** Shared DOM helpers for extraction. Kept dependency-free so both the
 *  generic extractor and the per-site adapters can use them. */

import TurndownService from "turndown";

export function createTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  // Drop chrome that survives extraction and is noise in an archive
  td.remove(["script", "style", "noscript", "iframe", "form"]);
  return td;
}

/** Collapse whitespace; returns "" for missing nodes. */
export function textOf(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** First non-empty `<meta>` content among the given property/name keys. */
export function meta(doc: Document, names: string[]): string | undefined {
  for (const name of names) {
    const el =
      doc.querySelector(`meta[property="${name}"]`) ??
      doc.querySelector(`meta[name="${name}"]`);
    const content = el?.getAttribute("content")?.trim();
    if (content) return content;
  }
  return undefined;
}

/** Rewrite relative URLs against the source page.
 *
 * Extracted Markdown is stored under a different path than the original page,
 * so a relative `./yoda.jpg` resolves to nothing — and breaks the static site
 * build outright, since the generator tries to resolve every image. */
export function absolutizeUrls(doc: Document, pageUrl: string): void {
  const resolve = (value: string): string | null => {
    if (!value || /^(https?:|data:|mailto:|#)/i.test(value)) return null;
    try {
      return new URL(value, pageUrl).href;
    } catch {
      return null;
    }
  };

  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const src = img.getAttribute("src");
    if (src) {
      const absolute = resolve(src);
      if (absolute) img.setAttribute("src", absolute);
    }
    // Relative candidates here would resurface the same resolution problem
    img.removeAttribute("srcset");
  }

  for (const anchor of Array.from(doc.querySelectorAll("a"))) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    const absolute = resolve(href);
    if (absolute) anchor.setAttribute("href", absolute);
  }
}
