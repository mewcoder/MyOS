/** Summary + tags for a captured article.
 *
 * Calls the configured provider directly rather than going through an
 * AgentSession: this needs one short completion with no tools, and routing it
 * through the user's chat session would block their conversation.
 */

import { logger } from "../log.js";
import type { PiProviderConfig } from "../types.js";

export interface Summary {
  summary: string;
  tags: string[];
}

const SYSTEM_PROMPT = `你是一个稍后读收藏夹的整理助手。给定一篇文章，输出严格的 JSON：
{"summary": "2-3 句中文摘要，说清文章的核心论点和值得记住的结论", "tags": ["标签1", "标签2"]}
标签用 2-5 个中文或英文短词，覆盖主题领域和文章类型。只输出 JSON，不要代码块包裹，不要任何解释。`;

/** Keep the request small and predictable — the tail of a long article rarely
 *  changes the summary, and context limits vary by provider. */
const MAX_INPUT_CHARS = 12_000;

function parseSummary(raw: string): Summary | null {
  // Models sometimes wrap JSON in a fence despite instructions
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Partial<Summary>;
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim())
      : [];
    if (!summary) return null;
    return { summary, tags: tags.slice(0, 5) };
  } catch {
    return null;
  }
}

/**
 * Summarise an article. Returns null when the provider is unreachable or the
 * reply can't be parsed — capture must still succeed without a summary.
 */
export async function summarize(
  article: { title: string; text: string },
  provider: PiProviderConfig,
  modelId: string,
  timeoutMs = 60_000,
): Promise<Summary | null> {
  const body = article.text.slice(0, MAX_INPUT_CHARS);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.authHeader !== false) headers.Authorization = `Bearer ${provider.apiKey}`;

  try {
    const resp = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `标题：${article.title}\n\n正文：\n${body}` },
        ],
        temperature: 0.3,
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) {
      logger.log("inbox_summarize_failed", { status: resp.status });
      return null;
    }

    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return null;

    const summary = parseSummary(content);
    if (!summary) logger.log("inbox_summarize_unparsable", { preview: content.slice(0, 200) });
    return summary;
  } catch (err) {
    logger.log("inbox_summarize_failed", { error: String(err) });
    return null;
  }
}
