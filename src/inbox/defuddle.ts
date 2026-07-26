/** defuddle.md — a hosted extraction service used as a middle fallback tier.
 *
 * `https://defuddle.md/{url}` returns Markdown with a YAML frontmatter header.
 * It renders JavaScript server-side, so it rescues client-rendered pages in
 * ~4s instead of the ~25s a headless Chrome launch costs.
 *
 * It is deliberately *not* the primary path: every captured link would travel
 * through someone else's servers, and hosted extractors are not dependable —
 * r.jina.ai served anonymous requests until it began rejecting them with 401.
 * Known sites are handled locally, and this tier only sees pages that local
 * extraction could not read.
 */

import type { ExtractedArticle } from "./sites.js";

/** Parse the YAML-ish frontmatter defuddle emits. Values are quoted strings
 *  or bare scalars; nesting never appears, so a full YAML parser is overkill. */
function parseFrontmatter(text: string): { fields: Record<string, string>; body: string } {
  if (!text.startsWith("---")) return { fields: {}, body: text };

  const end = text.indexOf("\n---", 3);
  if (end === -1) return { fields: {}, body: text };

  const fields: Record<string, string> = {};
  for (const line of text.slice(3, end).split("\n")) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length > 1) {
      value = value.slice(1, -1);
    }
    if (key && value) fields[key] = value;
  }

  const bodyStart = text.indexOf("\n", end + 1);
  return { fields, body: bodyStart === -1 ? "" : text.slice(bodyStart + 1).trim() };
}

/** Strip Markdown syntax to approximate the plain-text length. */
function toPlainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchViaDefuddle(
  url: string,
  timeoutMs = 45_000,
): Promise<ExtractedArticle | null> {
  const resp = await fetch(`https://defuddle.md/${url}`, {
    headers: { Accept: "text/markdown, text/plain, */*" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) throw new Error(`defuddle ${resp.status}`);

  const { fields, body } = parseFrontmatter(await resp.text());
  if (!body) return null;

  return {
    title: fields.title || url,
    author: fields.author,
    published: fields.published,
    markdown: body,
    text: toPlainText(body),
    source: "blog",
    siteName: fields.site,
    adapter: "defuddle",
  };
}
