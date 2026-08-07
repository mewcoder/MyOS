import { countRemoteImages, fetchFav, type FavFetchDependencies } from "./fetch.js";
import {
  ensureMyFavRepo,
  findDuplicate,
  readCollections,
  repoExists,
  saveFav,
  type StoreDependencies,
} from "./store.js";
import {
  FavError,
  FAV_CATEGORIES,
  type FavInput,
  type FavKind,
  type FavSuccessResult,
} from "./types.js";
import { classifyKnownUrl, normalizeUrl } from "./url.js";

export interface FavServiceDependencies extends FavFetchDependencies, StoreDependencies {
  now?: () => Date;
}

function dateString(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function cleanOverride(value: string | undefined, option: string): string | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.trim();
  if (!cleaned) throw new FavError("invalid_input", `${option} 不得为空`);
  return cleaned;
}

const TAG_ALIASES: Record<string, string> = {
  "ai agent": "Agent",
  agent: "Agent",
  "claude-code": "Claude Code",
  skill: "Agent Skill",
  skills: "Agent Skill",
};

function normalizeCategory(value: string | undefined): string {
  const category = cleanOverride(value, "--category") ?? "工具";
  if (!FAV_CATEGORIES.some((candidate) => candidate === category)) {
    throw new FavError("invalid_input", `--category 必须是以下固定分类之一：${FAV_CATEGORIES.join("、")}`);
  }
  return category;
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of tags) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const alias = TAG_ALIASES[trimmed.toLowerCase()] ?? trimmed;
    if (seen.has(alias)) continue;
    seen.add(alias);
    output.push(alias);
  }
  return output;
}

function defaultSourceTags(type: FavKind, source: string | undefined): string[] {
  if (type === "repo") return ["GitHub"];
  if (source === "x") return ["X"];
  if (source === "wechat") return ["微信公众号"];
  return [];
}

function duplicateResult(duplicate: ReturnType<typeof findDuplicate>): FavSuccessResult {
  if (!duplicate) throw new Error("duplicateResult requires an entry");
  return {
    status: "duplicate",
    type: duplicate.type,
    url: duplicate.url,
    title: duplicate.title,
    ...(duplicate.path ? { path: duplicate.path } : {}),
  };
}

export class FavService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly dependencies: FavServiceDependencies = {}) {}

  capture(input: FavInput): Promise<FavSuccessResult> {
    const run = this.chain.then(() => this.runCapture(input));
    this.chain = run.catch(() => {});
    return run;
  }

  private async runCapture(input: FavInput): Promise<FavSuccessResult> {
    const normalizedInput = normalizeUrl(input.url);
    const requestedType = input.type ?? classifyKnownUrl(normalizedInput);
    const titleOverride = cleanOverride(input.title, "--title");
    const descriptionOverride = cleanOverride(input.description, "--description");
    const category = normalizeCategory(input.category);
    const inputTags = normalizeTags(input.tags ?? []);

    if (!input.dryRun) {
      await ensureMyFavRepo(input.repoDir, input.noCommit ?? false, this.dependencies);
    }
    let collections: Awaited<ReturnType<typeof readCollections>> | undefined;
    const hasRepo = await repoExists(input.repoDir);
    if (!input.dryRun || hasRepo) {
      collections = await readCollections(input.repoDir);
      const duplicate = findDuplicate(collections, normalizedInput);
      if (duplicate) return duplicateResult(duplicate);
    }

    const fetched = await fetchFav(normalizedInput, requestedType, this.dependencies);
    const type = input.type ?? fetched.type;
    const finalUrl = normalizeUrl(fetched.url);

    if (collections) {
      const redirectedDuplicate = findDuplicate(collections, finalUrl);
      if (redirectedDuplicate) return duplicateResult(redirectedDuplicate);
    }

    const title = titleOverride ?? fetched.title.trim();
    const description = descriptionOverride ?? (fetched.description.trim() || title);
    if (!title) throw new FavError("fetch_failed", "抓取结果缺少标题");
    const tags = normalizeTags([...inputTags, ...defaultSourceTags(type, fetched.source)]);
    const markdown = fetched.markdown ?? "";
    const article = type === "article"
      ? {
          ...(fetched.author ? { author: fetched.author } : {}),
          ...(fetched.published ? { published: fetched.published } : {}),
          characters: (fetched.text ?? "").trim().length,
          images: countRemoteImages(markdown),
          markdownPreview: markdown.slice(0, 500),
        }
      : undefined;

    const base = {
      type,
      url: finalUrl,
      title,
      description,
      category,
      tags,
      via: fetched.via,
      ...(fetched.warnings.length ? { warnings: [...fetched.warnings] } : {}),
      ...(article ? { article } : {}),
    };

    if (input.dryRun) return { status: "preview", ...base };
    if (!collections) throw new FavError("repo_invalid", `MyFav 目录不存在或不完整：${input.repoDir}`);

    const stored = await saveFav(
      input.repoDir,
      collections,
      {
        type,
        url: finalUrl,
        title,
        description,
        category,
        tags,
        saveTime: dateString((this.dependencies.now ?? (() => new Date()))()),
        repoName: fetched.repoName,
        stars: fetched.stars,
        author: fetched.author,
        published: fetched.published,
        markdown,
      },
      input.noCommit ?? false,
      this.dependencies,
    );

    const warnings = [...(base.warnings ?? []), ...stored.warnings];
    return {
      status: "saved",
      ...base,
      ...(stored.path ? { path: stored.path } : {}),
      committed: stored.committed,
      pushed: stored.pushed,
      ...(warnings.length ? { warnings } : {}),
    };
  }
}
