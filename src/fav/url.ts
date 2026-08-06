import { FavError, type FavKind } from "./types.js";

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref_src",
]);

export function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FavError("invalid_input", `无效 URL：${input}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FavError("invalid_input", "只支持 http 或 https URL");
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  const repo = parseGitHubRepo(url.href);
  if (repo) return `https://github.com/${repo.owner}/${repo.repo}`;
  return url.href.replace(/\/$/, url.pathname === "/" && !url.search ? "" : "/");
}

export function parseGitHubRepo(input: string): { owner: string; repo: string } | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.hostname.toLowerCase().replace(/^www\./, "") !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const [owner, rawRepo] = parts;
  const repo = rawRepo?.replace(/\.git$/i, "");
  if (!owner || !repo) return null;
  return { owner, repo };
}

export function classifyKnownUrl(url: string): FavKind | undefined {
  if (parseGitHubRepo(url)) return "repo";
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  if (["x.com", "twitter.com", "mobile.twitter.com", "mp.weixin.qq.com"].includes(host)) {
    return "article";
  }
  return undefined;
}
