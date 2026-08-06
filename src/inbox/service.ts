/** Inbox capture pipeline: URL → fetch → extract → summarise → archive → git. */

import { fetchViaHttp, fetchViaBrowser, HttpError, type FetchVia } from "./fetch.js";
import { fetchViaDefuddle } from "./defuddle.js";
import { extractArticle, isThin, type ExtractedArticle } from "./extract.js";
import { findAdapter, classifySource } from "./sites.js";
import { summarize } from "./summarize.js";
import { ensureRepo, saveItem, buildItem, commitAndPush, findByUrl, readIndex, type InboxItem } from "./store.js";
import { generateSite } from "./site.js";
import { logger } from "../log.js";
import type { PiProviderConfig } from "../types.js";

export interface InboxConfig {
  providers: Record<string, PiProviderConfig>;
  /** "provider/model-id" — the model used for summaries. */
  defaultModel: string;
  /** Generate summary + tags on capture. */
  summarize?: boolean;
}

export interface CaptureResult {
  status: "saved" | "duplicate" | "failed";
  item?: InboxItem;
  pushed?: boolean;
  error?: string;
}

/** Extract the first URL in a message, plus whatever the user typed around it. */
export function parseCapture(content: string): { url: string; note?: string } | null {
  const match = content.match(/https?:\/\/[^\s<>"'）)】]+/);
  if (!match) return null;

  const url = match[0].replace(/[.,;:!?、。，]+$/, "");
  const note = content.replace(match[0], " ").replace(/\s+/g, " ").trim();
  return { url, note: note || undefined };
}

export class InboxService {
  private config: InboxConfig;
  /** Captures run one at a time: concurrent runs would race on git's index
   *  lock and on the append-only index, and would launch parallel browsers. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(config: InboxConfig) {
    this.config = config;
  }

  /** Resolve the provider + model id used for summarisation. */
  private resolveModel(): { provider: PiProviderConfig; modelId: string } | null {
    const slash = this.config.defaultModel.indexOf("/");
    if (slash === -1) return null;
    const providerId = this.config.defaultModel.slice(0, slash);
    const modelId = this.config.defaultModel.slice(slash + 1);
    const provider = this.config.providers[providerId];
    return provider ? { provider, modelId } : null;
  }

  capture(url: string, note?: string): Promise<CaptureResult> {
    const run = this.chain.then(() => this.runCapture(url, note));
    this.chain = run.catch(() => {}); // a failed capture must not break the chain
    return run;
  }

  /** Fetch and extract, taking the cheapest path that can work.
   *
   *  Known site  → one HTTP request, read via its adapter, done. No guessing.
   *  Unknown site → HTTP + generic extraction, escalating to a browser only
   *                 when that comes up short.
   *  Declared JS-only site → straight to the browser. */
  private async fetchAndExtract(
    url: string,
  ): Promise<{ article: ExtractedArticle; finalUrl: string; via: FetchVia | "defuddle" }> {
    const adapter = findAdapter(url);

    if (adapter?.browserOnly) {
      const { html, finalUrl } = await fetchViaBrowser(url);
      return { article: extractArticle(html, finalUrl), finalUrl, via: "browser" };
    }

    let httpError: unknown;
    try {
      const { html, finalUrl } = await fetchViaHttp(url);
      const article = extractArticle(html, finalUrl);

      // A matching adapter is authoritative — its result needs no heuristics
      if (article.adapter || !isThin(article)) {
        return { article, finalUrl, via: "http" };
      }
      logger.log("inbox_fetch_thin", {
        url,
        chars: article.text.trim().length,
        knownSite: Boolean(adapter),
      });
    } catch (err) {
      // A missing page stays missing — retrying in a browser would happily
      // render the site's 404 and archive it as if it were an article.
      if (err instanceof HttpError && !err.worthRetryingInBrowser) throw err;
      httpError = err;
      logger.log("inbox_fetch_http_failed", { url, error: String(err) });
    }

    try {
      const article = await fetchViaDefuddle(url);
      if (article && !isThin(article)) {
        return { article, finalUrl: url, via: "defuddle" };
      }
      logger.log("inbox_fetch_defuddle_thin", { url, chars: article?.text.trim().length ?? 0 });
    } catch (err) {
      logger.log("inbox_fetch_defuddle_failed", { url, error: String(err) });
    }

    try {
      const { html, finalUrl } = await fetchViaBrowser(url);
      return { article: extractArticle(html, finalUrl), finalUrl, via: "browser" };
    } catch (err) {
      // Report the original failure when HTTP was the one that broke
      throw httpError ?? err;
    }
  }

  private async runCapture(url: string, note?: string): Promise<CaptureResult> {
    const startedAt = Date.now();
    logger.log("inbox_capture_start", { url, hasNote: Boolean(note) });

    try {
      const existing = await findByUrl(url);
      if (existing) {
        logger.log("inbox_capture_duplicate", { url, id: existing.id });
        return { status: "duplicate", item: existing };
      }

      await ensureRepo();

      const { article, finalUrl, via } = await this.fetchAndExtract(url);

      if (!article.title && !article.text) {
        throw new Error("提取不到任何内容");
      }

      let summary: string | undefined;
      let tags: string[] = [];
      if (this.config.summarize !== false && article.text.length > 120) {
        const model = this.resolveModel();
        if (model) {
          const result = await summarize(article, model.provider, model.modelId);
          if (result) {
            summary = result.summary;
            tags = result.tags;
          }
        }
      }

      const item = buildItem({
        title: article.title,
        url: finalUrl,
        source: article.source,
        author: article.author,
        siteName: article.siteName,
        published: article.published,
        summary,
        tags,
        note,
        words: article.text.length,
      });

      await saveItem(item, article.markdown);
      await generateSite(await readIndex());
      const { pushed } = await commitAndPush(`inbox: ${item.title}`);

      logger.log("inbox_capture_saved", {
        url: finalUrl,
        id: item.id,
        source: item.source,
        via,
        words: item.words,
        tags: item.tags,
        summarized: Boolean(summary),
        pushed,
        durationMs: Date.now() - startedAt,
      });

      return { status: "saved", item, pushed };
    } catch (err) {
      logger.log("inbox_capture_failed", {
        url,
        error: String(err),
        durationMs: Date.now() - startedAt,
      });
      return { status: "failed", error: String(err) };
    }
  }

  /** Counts for the /inbox command. */
  async stats(): Promise<{ total: number; thisWeek: number; week: string; recent: InboxItem[] }> {
    const items = await readIndex();
    const { isoWeek } = await import("./store.js");
    const week = isoWeek(new Date());
    return {
      total: items.length,
      thisWeek: items.filter((i) => i.week === week).length,
      week,
      recent: items.slice(-5).reverse(),
    };
  }
}

export { classifySource };
