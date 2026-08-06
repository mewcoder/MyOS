import { parseHTML } from "linkedom";
import { fetchViaDefuddle } from "../inbox/defuddle.js";
import { extractArticle, isThin, type ExtractedArticle } from "../inbox/extract.js";
import { fetchViaBrowser, fetchViaHttp, HttpError, type FetchResult } from "../inbox/fetch.js";
import { meta, textOf } from "../inbox/dom.js";
import { FavError, type FavKind, type FavVia } from "./types.js";
import { parseGitHubRepo } from "./url.js";

export interface FetchedFav {
  type: FavKind;
  url: string;
  title: string;
  description: string;
  via: FavVia;
  markdown?: string;
  text?: string;
  author?: string;
  published?: string;
  stars?: number;
  repoName?: string;
  source?: ExtractedArticle["source"];
  warnings: string[];
}

export interface FavFetchDependencies {
  fetchHttp?: (url: string) => Promise<FetchResult>;
  fetchDefuddle?: (url: string) => Promise<ExtractedArticle | null>;
  fetchBrowser?: (url: string) => Promise<FetchResult>;
  fetchGithub?: (input: string, init?: RequestInit) => Promise<Response>;
}

function pageDescription(html: string): string | undefined {
  const { document } = parseHTML(html);
  const doc = document as unknown as Document;
  return meta(doc, ["description", "og:description", "twitter:description"]);
}

function conciseDescription(description: string | undefined, article: ExtractedArticle): string {
  const raw = textOf(description) || textOf(article.text).slice(0, 180) || article.title;
  return raw.length > 180 ? `${raw.slice(0, 179)}…` : raw;
}

function normalizePublished(value: string | undefined): string | undefined {
  const match = value?.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0];
}

function fromArticle(
  article: ExtractedArticle,
  finalUrl: string,
  via: Exclude<FavVia, "github">,
  type: FavKind,
  description?: string,
  warnings: string[] = [],
): FetchedFav {
  return {
    type,
    url: finalUrl,
    title: textOf(article.title) || finalUrl,
    description: conciseDescription(description, article),
    via,
    markdown: article.markdown,
    text: article.text,
    author: textOf(article.author) || undefined,
    published: normalizePublished(article.published),
    source: article.source,
    warnings,
  };
}

async function fetchGithubRepo(
  url: string,
  fetchGithub: NonNullable<FavFetchDependencies["fetchGithub"]>,
): Promise<FetchedFav> {
  const parsed = parseGitHubRepo(url);
  if (!parsed) throw new FavError("invalid_input", "该链接不是 GitHub 仓库根路径");

  let response: Response;
  try {
    response = await fetchGithub(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "myos-fav",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new FavError("fetch_failed", `GitHub API 请求失败：${String(error)}`, error);
  }

  if (!response.ok) {
    throw new FavError("fetch_failed", `GitHub API HTTP ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  if (typeof data.full_name !== "string" || typeof data.stargazers_count !== "number") {
    throw new FavError("fetch_failed", "GitHub API 返回缺少 full_name 或 stargazers_count");
  }
  const canonicalUrl =
    typeof data.html_url === "string" ? data.html_url : `https://github.com/${data.full_name}`;
  const description = typeof data.description === "string" && data.description.trim()
    ? data.description.trim()
    : data.full_name;

  return {
    type: "repo",
    url: canonicalUrl,
    title: data.full_name,
    description,
    via: "github",
    repoName: data.full_name,
    stars: data.stargazers_count,
    warnings: [],
  };
}

function interactionPage(html: string): boolean {
  return /(captcha|验证码|verify you are human|sign in to continue|登录后继续)/i.test(html);
}

/** Fetch a link through the deterministic HTTP → Defuddle → browser chain. */
export async function fetchFav(
  url: string,
  requestedType: FavKind | undefined,
  dependencies: FavFetchDependencies = {},
): Promise<FetchedFav> {
  const github = parseGitHubRepo(url);
  if (requestedType === "repo" || (!requestedType && github)) {
    return fetchGithubRepo(url, dependencies.fetchGithub ?? fetch);
  }
  const fetchHttp = dependencies.fetchHttp ?? fetchViaHttp;
  const fetchDefuddle = dependencies.fetchDefuddle ?? fetchViaDefuddle;
  const fetchBrowser = dependencies.fetchBrowser ?? fetchViaBrowser;
  const warnings: string[] = [];
  let best: { article: ExtractedArticle; finalUrl: string; description?: string } | undefined;
  let firstError: unknown;

  try {
    const result = await fetchHttp(url);
    const article = extractArticle(result.html, result.finalUrl);
    const description = pageDescription(result.html);
    best = { article, finalUrl: result.finalUrl, description };
    if (article.adapter || !isThin(article)) {
      const type = requestedType ?? "article";
      return fromArticle(article, result.finalUrl, "http", type, description);
    }
  } catch (error) {
    if (error instanceof HttpError && !error.worthRetryingInBrowser) {
      throw new FavError("fetch_failed", error.message, error);
    }
    firstError = error;
    warnings.push(`HTTP 抓取未完成：${String(error)}`);
  }

  try {
    const article = await fetchDefuddle(url);
    if (article && !isThin(article)) {
      return fromArticle(article, url, "defuddle", requestedType ?? "article", undefined, warnings);
    }
  } catch (error) {
    warnings.push(`Defuddle 抓取未完成：${String(error)}`);
  }

  try {
    const result = await fetchBrowser(url);
    const article = extractArticle(result.html, result.finalUrl);
    if (interactionPage(result.html) && isThin(article)) {
      throw new FavError("interaction_required", "页面需要登录、验证码或人工操作");
    }
    if (!isThin(article) || !best) {
      const type = requestedType ?? (!isThin(article) ? "article" : "site");
      return fromArticle(article, result.finalUrl, "browser", type, pageDescription(result.html), warnings);
    }
  } catch (error) {
    if (error instanceof FavError) throw error;
    warnings.push(`浏览器抓取未完成：${String(error)}`);
  }

  if (best) {
    return fromArticle(
      best.article,
      best.finalUrl,
      "http",
      requestedType ?? "site",
      best.description,
      warnings,
    );
  }

  throw new FavError("fetch_failed", `所有抓取层级均失败：${String(firstError ?? "无可用内容")}`);
}

export function countRemoteImages(markdown: string): number {
  return [...markdown.matchAll(/!\[[^\]]*\]\((?:<)?https?:\/\//gi)].length;
}
