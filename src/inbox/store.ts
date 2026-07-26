/** Archive storage: Markdown files for reading, JSONL index for querying.
 *
 * The directory is a git repo that doubles as the VitePress site source, so
 * the same tree serves the blog and the weekly-report data source.
 */

import { mkdir, writeFile, appendFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { INBOX_DIR, INBOX_ITEMS_DIR, INBOX_INDEX_PATH } from "../paths.js";
import { logger } from "../log.js";
import type { SourceKind } from "./extract.js";

const execFileAsync = promisify(execFile);

export interface InboxItem {
  id: string;
  title: string;
  url: string;
  source: SourceKind;
  author?: string;
  siteName?: string;
  published?: string;
  captured: string;
  /** ISO week, e.g. "2026-W30" — the grouping key for weekly reports. */
  week: string;
  tags: string[];
  summary?: string;
  note?: string;
  /** Repo-relative path of the Markdown file. */
  path: string;
  words: number;
}

/** ISO-8601 week number (weeks start Monday; week 1 contains the first Thursday). */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Thursday of the current week determines the year the week belongs to
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** URL- and filesystem-safe slug that keeps CJK readable. */
export function slugify(title: string, fallback: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[\s　]+/g, "-")
    // Keep word chars and CJK; drop punctuation that complicates paths/URLs
    .replace(/[^\w一-鿿-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildFrontmatter(item: InboxItem): string {
  const lines = [
    "---",
    `title: ${yamlString(item.title)}`,
    `url: ${yamlString(item.url)}`,
    `source: ${item.source}`,
    `captured: ${yamlString(item.captured)}`,
    `week: ${yamlString(item.week)}`,
  ];
  if (item.author) lines.push(`author: ${yamlString(item.author)}`);
  if (item.siteName) lines.push(`siteName: ${yamlString(item.siteName)}`);
  if (item.published) lines.push(`published: ${yamlString(item.published)}`);
  if (item.summary) lines.push(`summary: ${yamlString(item.summary)}`);
  if (item.note) lines.push(`note: ${yamlString(item.note)}`);
  lines.push(`words: ${item.words}`);
  lines.push(`tags: [${item.tags.map(yamlString).join(", ")}]`);
  lines.push("---");
  return lines.join("\n");
}

/** Body shown above the archived content: provenance and the user's own note. */
function buildBody(item: InboxItem, markdown: string): string {
  const parts = [`# ${item.title}`, ""];

  const meta: string[] = [`[原文](${item.url})`];
  if (item.author) meta.push(item.author);
  if (item.published) meta.push(item.published.slice(0, 10));
  parts.push(`> ${meta.join(" · ")}`, "");

  if (item.summary) parts.push("## 摘要", "", item.summary, "");
  if (item.note) parts.push("## 我的备注", "", item.note, "");

  parts.push("## 正文", "", markdown || "_（未能提取正文，请点击原文链接）_", "");
  return parts.join("\n");
}

async function git(args: string[]): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", ["-C", INBOX_DIR, ...args], {
      timeout: 30_000,
    });
    return { ok: true, output: stdout || stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, output: e.stderr || e.stdout || String(err) };
  }
}

/** Initialise the archive repo if absent. Safe to call on every capture. */
export async function ensureRepo(): Promise<void> {
  await mkdir(INBOX_ITEMS_DIR, { recursive: true });
  await mkdir(dirname(INBOX_INDEX_PATH), { recursive: true });
  if (!existsSync(join(INBOX_DIR, ".git"))) {
    await git(["init", "-b", "main"]);
    logger.log("inbox_repo_initialized", { dir: INBOX_DIR });
  }
}

/**
 * Commit the archive, and push when a remote is configured.
 * Never throws: a git failure must not lose the captured file.
 */
export async function commitAndPush(message: string): Promise<{ committed: boolean; pushed: boolean }> {
  const add = await git(["add", "-A"]);
  if (!add.ok) {
    logger.log("inbox_git_failed", { step: "add", output: add.output.slice(0, 300) });
    return { committed: false, pushed: false };
  }

  const commit = await git(["commit", "-m", message]);
  if (!commit.ok) {
    // "nothing to commit" is a normal no-op, not a failure
    const nothing = commit.output.includes("nothing to commit");
    if (!nothing) logger.log("inbox_git_failed", { step: "commit", output: commit.output.slice(0, 300) });
    return { committed: false, pushed: false };
  }

  const remotes = await git(["remote"]);
  if (!remotes.ok || !remotes.output.trim()) return { committed: true, pushed: false };

  const push = await git(["push", "-u", "origin", "HEAD"]);
  if (!push.ok) {
    logger.log("inbox_git_failed", { step: "push", output: push.output.slice(0, 300) });
    return { committed: true, pushed: false };
  }
  return { committed: true, pushed: true };
}

/** Write the Markdown file and append the index entry. */
export async function saveItem(item: InboxItem, markdown: string): Promise<void> {
  const absolute = join(INBOX_DIR, item.path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${buildFrontmatter(item)}\n\n${buildBody(item, markdown)}`, "utf8");
  await appendFile(INBOX_INDEX_PATH, `${JSON.stringify(item)}\n`, "utf8");
}

/** Build the item metadata (path, week, slug) for a capture. */
export function buildItem(input: {
  title: string;
  url: string;
  source: SourceKind;
  author?: string;
  siteName?: string;
  published?: string;
  summary?: string;
  tags?: string[];
  note?: string;
  words: number;
  now?: Date;
}): InboxItem {
  const now = input.now ?? new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const date = `${year}-${month}-${day}`;
  const slug = slugify(input.title, `item-${now.getTime()}`);

  return {
    id: `${date}-${slug}`,
    title: input.title,
    url: input.url,
    source: input.source,
    author: input.author,
    siteName: input.siteName,
    published: input.published,
    captured: now.toISOString(),
    week: isoWeek(now),
    tags: input.tags ?? [],
    summary: input.summary,
    note: input.note,
    path: `items/${year}/${month}/${date}-${slug}.md`,
    words: input.words,
  };
}

/** Read the index — the query surface for weekly reports and site generation. */
export async function readIndex(): Promise<InboxItem[]> {
  try {
    const raw = await readFile(INBOX_INDEX_PATH, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as InboxItem;
        } catch {
          return null;
        }
      })
      .filter((item): item is InboxItem => item !== null);
  } catch {
    return [];
  }
}

/** True when the URL is already archived — avoids duplicate captures. */
export async function findByUrl(url: string): Promise<InboxItem | undefined> {
  const items = await readIndex();
  return items.find((item) => item.url === url);
}
