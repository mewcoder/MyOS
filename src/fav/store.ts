import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  FavError,
  type ArticleRecord,
  type FavKind,
  type RepoRecord,
  type SiteRecord,
} from "./types.js";
import { normalizeUrl } from "./url.js";

const execFileAsync = promisify(execFile);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface FavCollections {
  sites: SiteRecord[];
  repos: RepoRecord[];
  articles: ArticleRecord[];
}

export interface DuplicateEntry {
  type: FavKind;
  title: string;
  url: string;
  path?: string;
}

export interface StoreInput {
  type: FavKind;
  url: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  saveTime: string;
  repoName?: string;
  stars?: number;
  author?: string;
  published?: string;
  markdown?: string;
}

export interface StoreResult {
  path?: string;
  committed: boolean;
  pushed: boolean;
  warnings: string[];
}

export interface StoreDependencies {
  fetchImage?: (input: string, init?: RequestInit) => Promise<Response>;
  runGit?: (repoDir: string, args: string[]) => Promise<{ ok: boolean; output: string }>;
  repoRemote?: string;
}

export const DEFAULT_MYFAV_REMOTE = "https://github.com/mewcoder/myfav.git";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): void {
  if (typeof record[key] !== "string" || !(record[key] as string).trim()) {
    throw new FavError("repo_invalid", `${key} 必须是非空字符串`);
  }
}

function validateTags(record: Record<string, unknown>): void {
  if (!Array.isArray(record.tags) || record.tags.some((tag) => typeof tag !== "string")) {
    throw new FavError("repo_invalid", "tags 必须是字符串数组");
  }
  if (new Set(record.tags).size !== record.tags.length) {
    throw new FavError("repo_invalid", "tags 不得重复");
  }
}

function validateCommon(record: Record<string, unknown>, titleKey: "title" | "name"): void {
  for (const key of [titleKey, "url", "description", "category", "saveTime"]) requireString(record, key);
  validateTags(record);
  if (!DATE.test(record.saveTime as string)) {
    throw new FavError("repo_invalid", "saveTime 必须是 YYYY-MM-DD");
  }
  try {
    normalizeUrl(record.url as string);
  } catch (error) {
    throw new FavError("repo_invalid", `数据中存在无效 URL：${record.url}`, error);
  }
}

function validateSites(value: unknown): asserts value is SiteRecord[] {
  if (!Array.isArray(value)) throw new FavError("repo_invalid", "sites.json 顶层必须是数组");
  for (const item of value) {
    if (!isObject(item)) throw new FavError("repo_invalid", "sites.json 条目必须是对象");
    validateCommon(item, "title");
  }
}

function validateRepos(value: unknown): asserts value is RepoRecord[] {
  if (!Array.isArray(value)) throw new FavError("repo_invalid", "repos.json 顶层必须是数组");
  for (const item of value) {
    if (!isObject(item)) throw new FavError("repo_invalid", "repos.json 条目必须是对象");
    validateCommon(item, "name");
    if (typeof item.stars !== "number" || !Number.isFinite(item.stars) || item.stars < 0) {
      throw new FavError("repo_invalid", "stars 必须是非负数");
    }
  }
}

function markdownImageTargets(markdown: string): string[] {
  const targets: string[] = [];
  const pattern = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*["'])?\s*\)/g;
  for (const match of markdown.matchAll(pattern)) {
    const target = match[1] ?? match[2];
    if (target) targets.push(target);
  }
  return targets;
}

async function validateLocalImages(markdownPath: string, repoDir: string): Promise<void> {
  let markdown: string;
  try {
    markdown = await readFile(markdownPath, "utf8");
  } catch (error) {
    throw new FavError("repo_invalid", `无法读取文章 Markdown：${markdownPath}`, error);
  }
  for (const rawTarget of markdownImageTargets(markdown)) {
    if (/^[a-z][a-z\d+.-]*:/i.test(rawTarget) || rawTarget.startsWith("//")) continue;
    let target: string;
    try {
      target = decodeURIComponent(rawTarget.split(/[?#]/, 1)[0]!);
    } catch (error) {
      throw new FavError("repo_invalid", `Markdown 图片路径编码无效：${rawTarget}`, error);
    }
    if (!target || target.startsWith("/") || target.startsWith("\\")) {
      throw new FavError("repo_invalid", `Markdown 本地图片必须使用相对路径：${rawTarget}`);
    }
    const absolute = resolve(dirname(markdownPath), target);
    const withinRepo = relative(repoDir, absolute);
    if (withinRepo.startsWith("..") || isAbsolute(withinRepo)) {
      throw new FavError("repo_invalid", `Markdown 图片路径超出 MyFav：${rawTarget}`);
    }
    if (!existsSync(absolute)) {
      throw new FavError("repo_invalid", `Markdown 本地图片不存在：${rawTarget}`);
    }
  }
}

async function validateArticles(value: unknown, repoDir: string): Promise<ArticleRecord[]> {
  if (!Array.isArray(value)) throw new FavError("repo_invalid", "articles.json 顶层必须是数组");
  const seenPaths = new Set<string>();
  for (const item of value) {
    if (!isObject(item)) throw new FavError("repo_invalid", "articles.json 条目必须是对象");
    validateCommon(item, "title");
    requireString(item, "path");
    if (item.author !== undefined && typeof item.author !== "string") {
      throw new FavError("repo_invalid", "author 必须是字符串");
    }
    if (item.published !== undefined && (typeof item.published !== "string" || !DATE.test(item.published))) {
      throw new FavError("repo_invalid", "published 必须是 YYYY-MM-DD");
    }
    const path = item.path as string;
    if (!/^articles\/\d{4}-\d{2}\/[^/]+\.md$/.test(path) || path.includes("..")) {
      throw new FavError("repo_invalid", `无效文章路径：${path}`);
    }
    if (seenPaths.has(path)) {
      throw new FavError("repo_invalid", `articles.json 存在重复 path：${path}`);
    }
    seenPaths.add(path);
    const markdownPath = join(repoDir, path);
    if (!existsSync(markdownPath)) {
      throw new FavError("repo_invalid", `文章文件不存在：${path}`);
    }
    if (!path.startsWith(`articles/${(item.saveTime as string).slice(0, 7)}/`)) {
      throw new FavError("repo_invalid", `文章月份与 saveTime 不一致：${path}`);
    }
    await validateLocalImages(markdownPath, repoDir);
  }
  return value as ArticleRecord[];
}

function ensureUniqueUrls(items: Array<{ url: string }>, file: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = normalizeUrl(item.url);
    if (seen.has(normalized)) throw new FavError("repo_invalid", `${file} 存在重复 URL：${normalized}`);
    seen.add(normalized);
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new FavError("repo_invalid", `无法读取 ${path}：${String(error)}`, error);
  }
}

export async function readCollections(repoDir: string): Promise<FavCollections> {
  const dataDir = join(repoDir, "public", "data");
  const [sites, repos, articles] = await Promise.all([
    readJson(join(dataDir, "sites.json")),
    readJson(join(dataDir, "repos.json")),
    readJson(join(dataDir, "articles.json")),
  ]);
  validateSites(sites);
  validateRepos(repos);
  const validatedArticles = await validateArticles(articles, repoDir);
  ensureUniqueUrls(sites, "sites.json");
  ensureUniqueUrls(repos, "repos.json");
  ensureUniqueUrls(validatedArticles, "articles.json");
  return { sites, repos, articles: validatedArticles };
}

export function findDuplicate(collections: FavCollections, url: string): DuplicateEntry | undefined {
  const normalized = normalizeUrl(url);
  const site = collections.sites.find((item) => normalizeUrl(item.url) === normalized);
  if (site) return { type: "site", title: site.title, url: site.url };
  const repo = collections.repos.find((item) => normalizeUrl(item.url) === normalized);
  if (repo) return { type: "repo", title: repo.name, url: repo.url };
  const article = collections.articles.find((item) => normalizeUrl(item.url) === normalized);
  if (article) return { type: "article", title: article.title, url: article.url, path: article.path };
  return undefined;
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw new FavError("write_failed", `原子更新失败：${path}`, error);
  }
}

function sorted<T extends { saveTime: string }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.saveTime.localeCompare(a.item.saveTime) || a.index - b.index)
    .map(({ item }) => item);
}

function slugify(title: string, fallback: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[\s　]+/g, "-")
    .replace(/[^\w一-鿿-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

function chooseArticlePath(repoDir: string, articles: ArticleRecord[], title: string, saveTime: string): string {
  const month = saveTime.slice(0, 7);
  const base = slugify(title, `article-${Date.now()}`);
  const used = new Set(articles.map((item) => item.path));
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const slug = suffix === 1 ? base : `${base}-${suffix}`;
    const relative = posix.join("articles", month, `${slug}.md`);
    if (!used.has(relative) && !existsSync(join(repoDir, relative))) return relative;
  }
  throw new FavError("write_failed", "无法生成不冲突的文章路径");
}

function imageExtension(url: string, contentType: string | null): string {
  const byType: Record<string, string> = {
    "image/avif": ".avif",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/svg+xml": ".svg",
    "image/webp": ".webp",
  };
  const normalizedType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (normalizedType && byType[normalizedType]) return byType[normalizedType];
  const ext = extname(new URL(url).pathname).toLowerCase();
  return [".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"].includes(ext) ? ext : ".img";
}

async function localizeImages(
  markdown: string,
  assetDir: string,
  assetName: string,
  fetchImage: NonNullable<StoreDependencies["fetchImage"]>,
): Promise<{ markdown: string; downloaded: number; warnings: string[] }> {
  const pattern = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+["'][^)]*["'])?\)/g;
  const matches = [...markdown.matchAll(pattern)];
  if (matches.length === 0) return { markdown, downloaded: 0, warnings: [] };

  const warnings: string[] = [];
  let downloaded = 0;
  let cursor = 0;
  let output = "";
  for (const match of matches) {
    const index = match.index ?? cursor;
    output += markdown.slice(cursor, index);
    const url = match[2]!;
    let replacement = match[0];
    try {
      const response = await fetchImage(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      downloaded += 1;
      const filename = `${String(downloaded).padStart(2, "0")}${imageExtension(url, response.headers.get("content-type"))}`;
      await mkdir(assetDir, { recursive: true });
      await writeFile(join(assetDir, filename), Buffer.from(await response.arrayBuffer()));
      replacement = `![${match[1] ?? ""}](./${assetName}/${filename})`;
    } catch (error) {
      warnings.push(`图片下载失败 ${url}：${String(error)}`);
    }
    output += replacement;
    cursor = index + match[0].length;
  }
  output += markdown.slice(cursor);
  return { markdown: output, downloaded, warnings };
}

async function defaultRunGit(repoDir: string, args: string[]): Promise<{ ok: boolean; output: string }> {
  try {
    const result = await execFileAsync("git", ["-C", repoDir, ...args], { timeout: 30_000 });
    return { ok: true, output: result.stdout || result.stderr };
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string };
    return { ok: false, output: detail.stderr || detail.stdout || String(error) };
  }
}

async function commitPaths(
  repoDir: string,
  paths: string[],
  title: string,
  runGit: NonNullable<StoreDependencies["runGit"]>,
): Promise<{ committed: boolean; pushed: boolean; warning?: string }> {
  const added = await runGit(repoDir, ["add", "--", ...paths]);
  if (!added.ok) return { committed: false, pushed: false, warning: `Git add 失败：${added.output.trim()}` };
  const committed = await runGit(repoDir, ["commit", "-m", `fav: ${title}`, "--", ...paths]);
  if (!committed.ok) return { committed: false, pushed: false, warning: `Git commit 失败：${committed.output.trim()}` };
  const pushed = await runGit(repoDir, ["push", "origin", "HEAD"]);
  if (!pushed.ok) return { committed: true, pushed: false, warning: `Git push 失败：${pushed.output.trim()}` };
  return { committed: true, pushed: true };
}

export async function saveFav(
  repoDir: string,
  collections: FavCollections,
  input: StoreInput,
  noCommit: boolean,
  dependencies: StoreDependencies = {},
): Promise<StoreResult> {
  const duplicate = findDuplicate(collections, input.url);
  if (duplicate) throw new FavError("write_failed", `重复 URL 不应进入写入阶段：${duplicate.url}`);

  const dataPath = join(repoDir, "public", "data", `${input.type === "site" ? "sites" : input.type === "repo" ? "repos" : "articles"}.json`);
  const gitPaths: string[] = [posix.relative(repoDir.replaceAll("\\", "/"), dataPath.replaceAll("\\", "/"))];
  const warnings: string[] = [];
  let articlePath: string | undefined;

  if (input.type === "site") {
    const record: SiteRecord = {
      title: input.title,
      url: input.url,
      description: input.description,
      category: input.category,
      tags: input.tags,
      saveTime: input.saveTime,
    };
    await atomicJson(dataPath, sorted([record, ...collections.sites]));
  } else if (input.type === "repo") {
    if (!input.repoName || typeof input.stars !== "number") {
      throw new FavError("write_failed", "GitHub 仓库缺少 name 或 stars");
    }
    const record: RepoRecord = {
      name: input.repoName,
      url: input.url,
      description: input.description,
      category: input.category,
      tags: input.tags,
      stars: input.stars,
      saveTime: input.saveTime,
    };
    await atomicJson(dataPath, sorted([record, ...collections.repos]));
  } else {
    if (input.markdown === undefined) throw new FavError("write_failed", "文章缺少 Markdown 正文");
    articlePath = chooseArticlePath(repoDir, collections.articles, input.title, input.saveTime);
    const absoluteArticle = join(repoDir, articlePath);
    const assetName = basename(articlePath, ".md");
    const absoluteAssets = join(dirname(absoluteArticle), assetName);
    const articlesRoot = join(repoDir, "articles");
    await mkdir(articlesRoot, { recursive: true });
    const staging = await mkdtemp(join(articlesRoot, ".fav-"));
    const stagedArticle = join(staging, "article.md");
    const stagedAssets = join(staging, "assets");
    let articleMoved = false;
    let assetsMoved = false;
    try {
      const localized = await localizeImages(
        input.markdown,
        stagedAssets,
        assetName,
        dependencies.fetchImage ?? fetch,
      );
      warnings.push(...localized.warnings);
      await writeFile(stagedArticle, `${localized.markdown.trim()}\n`, "utf8");
      await mkdir(dirname(absoluteArticle), { recursive: true });
      await rename(stagedArticle, absoluteArticle);
      articleMoved = true;
      if (localized.downloaded > 0) {
        await rename(stagedAssets, absoluteAssets);
        assetsMoved = true;
      }

      const record: ArticleRecord = {
        title: input.title,
        url: input.url,
        description: input.description,
        category: input.category,
        tags: input.tags,
        ...(input.author ? { author: input.author } : {}),
        ...(input.published ? { published: input.published } : {}),
        saveTime: input.saveTime,
        path: articlePath,
      };
      await atomicJson(dataPath, sorted([record, ...collections.articles]));
      gitPaths.push(articlePath);
      if (assetsMoved) gitPaths.push(posix.join(posix.dirname(articlePath), assetName));
    } catch (error) {
      if (articleMoved) await rm(absoluteArticle, { force: true }).catch(() => {});
      if (assetsMoved) await rm(absoluteAssets, { recursive: true, force: true }).catch(() => {});
      if (error instanceof FavError) throw error;
      throw new FavError("write_failed", `文章写入失败：${String(error)}`, error);
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  let committed = false;
  let pushed = false;
  if (!noCommit) {
    const result = await commitPaths(repoDir, gitPaths, input.title, dependencies.runGit ?? defaultRunGit);
    committed = result.committed;
    pushed = result.pushed;
    if (result.warning) warnings.push(result.warning);
  }
  return { path: articlePath, committed, pushed, warnings };
}

export async function ensureMyFavRepo(
  repoDir: string,
  skipPull = false,
  dependencies: StoreDependencies = {},
): Promise<{ cloned: boolean }> {
  const runGit = dependencies.runGit ?? defaultRunGit;
  if (await repoExists(repoDir)) {
    if (!skipPull) {
      const pulled = await runGit(repoDir, ["pull", "--ff-only"]);
      if (!pulled.ok) throw new FavError("repo_invalid", `MyFav 同步失败：${pulled.output.trim()}`);
    }
    return { cloned: false };
  }

  const existed = existsSync(repoDir);
  await mkdir(dirname(repoDir), { recursive: true });
  const cloned = await runGit(dirname(repoDir), [
    "clone",
    "--origin",
    "origin",
    dependencies.repoRemote ?? DEFAULT_MYFAV_REMOTE,
    repoDir,
  ]);
  if (!cloned.ok) {
    if (!existed) await rm(repoDir, { recursive: true, force: true }).catch(() => {});
    throw new FavError("repo_invalid", `MyFav 自动 clone 失败：${cloned.output.trim()}`);
  }
  if (!await repoExists(repoDir)) {
    throw new FavError("repo_invalid", `clone 完成，但仓库缺少 MyFav 数据文件：${repoDir}`);
  }
  return { cloned: true };
}

export async function repoExists(repoDir: string): Promise<boolean> {
  try {
    await access(join(repoDir, "public", "data", "sites.json"));
    await access(join(repoDir, "public", "data", "repos.json"));
    await access(join(repoDir, "public", "data", "articles.json"));
    return true;
  } catch {
    return false;
  }
}
