/** VitePress site generation.
 *
 * The archive repo *is* the site source: captured Markdown files are already
 * valid pages, so generation only has to produce the navigation surfaces —
 * home, per-week archives, and a tag index — from the JSONL index.
 *
 * Scaffold files (package.json, VitePress config, deploy workflow) are written
 * once and never overwritten, so hand edits survive.
 */

import { mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { INBOX_DIR } from "../paths.js";
import type { InboxItem } from "./store.js";

const SOURCE_LABEL: Record<string, string> = {
  x: "X",
  wechat: "公众号",
  blog: "博客",
};

/** Where a listing entry points.
 *
 * Archived pages hold other people's articles in full. That is fine for a
 * private archive, but a public site linking to them republishes the
 * originals — so unless full-text publishing is switched on, listings link to
 * the source and the local copies stay out of the repo (see ensureScaffold). */
function itemLink(item: InboxItem, publishFullText: boolean): string {
  return publishFullText ? `/${item.path.replace(/\.md$/, "")}` : item.url;
}

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderItemLine(item: InboxItem, publishFullText = false): string {
  const parts = [`### [${escapeTableCell(item.title)}](${itemLink(item, publishFullText)})`];
  const meta = [SOURCE_LABEL[item.source] ?? item.source];
  if (item.author) meta.push(item.author);
  meta.push(item.captured.slice(0, 10));
  parts.push("", `<small>${meta.join(" · ")} · [原文](${item.url})</small>`, "");
  if (item.summary) parts.push(item.summary, "");
  if (item.tags.length) parts.push(item.tags.map((t) => `\`${t}\``).join(" "), "");
  return parts.join("\n");
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function renderHome(items: InboxItem[], publishFullText = false): string {
  const recent = [...items].reverse();
  const byWeek = groupBy(recent, (i) => i.week);
  const weeks = [...byWeek.keys()].sort().reverse();

  const lines = [
    "---",
    "title: Inbox",
    "---",
    "",
    "# Inbox",
    "",
    `共 **${items.length}** 篇收藏，跨 **${weeks.length}** 周。[按标签浏览](/tags)`,
    "",
  ];

  // Only the two most recent weeks on the home page; the rest live in archives
  for (const week of weeks.slice(0, 2)) {
    lines.push(`## [${week}](/weeks/${week})`, "");
    for (const item of byWeek.get(week)!) lines.push(renderItemLine(item, publishFullText));
  }

  if (weeks.length > 2) {
    lines.push("## 更早", "");
    for (const week of weeks.slice(2)) {
      lines.push(`- [${week}](/weeks/${week}) — ${byWeek.get(week)!.length} 篇`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderWeek(week: string, items: InboxItem[], publishFullText = false): string {
  const lines = [
    "---",
    `title: ${week}`,
    "---",
    "",
    `# ${week}`,
    "",
    `本周收藏 ${items.length} 篇。`,
    "",
  ];
  for (const item of [...items].reverse()) lines.push(renderItemLine(item, publishFullText));
  return lines.join("\n");
}

function renderTags(items: InboxItem[], publishFullText = false): string {
  const byTag = new Map<string, InboxItem[]>();
  for (const item of items) {
    for (const tag of item.tags) {
      const list = byTag.get(tag);
      if (list) list.push(item);
      else byTag.set(tag, [item]);
    }
  }

  const tags = [...byTag.entries()].sort((a, b) => b[1].length - a[1].length);
  const lines = ["---", "title: 标签", "---", "", "# 标签", ""];

  if (tags.length === 0) {
    lines.push("_还没有标签_", "");
    return lines.join("\n");
  }

  for (const [tag, tagItems] of tags) {
    lines.push(`## ${tag} <small>(${tagItems.length})</small>`, "");
    for (const item of [...tagItems].reverse()) {
      lines.push(`- [${escapeTableCell(item.title)}](${itemLink(item, publishFullText)})`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

const VITEPRESS_CONFIG = `import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Inbox",
  description: "稍后读收藏archive",
  lang: "zh-CN",
  cleanUrls: true,
  lastUpdated: true,
  // Generated navigation pages plus the captured articles under items/
  themeConfig: {
    nav: [
      { text: "首页", link: "/" },
      { text: "标签", link: "/tags" },
    ],
    outline: [2, 3],
    search: { provider: "local" },
  },
});
`;

const PACKAGE_JSON = `{
  "name": "inbox",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vitepress dev",
    "build": "vitepress build",
    "preview": "vitepress preview"
  },
  "devDependencies": {
    "vitepress": "^1.6.4"
  }
}
`;

const GITIGNORE = `node_modules/
.vitepress/dist/
.vitepress/cache/
`;

const DEPLOY_WORKFLOW = `name: Deploy Inbox

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .vitepress/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
`;

/** Write scaffold files that don't exist yet. Never overwrites. */
async function ensureScaffold(): Promise<void> {
  const files: Array<[string, string]> = [
    [".vitepress/config.ts", VITEPRESS_CONFIG],
    ["package.json", PACKAGE_JSON],
    [".gitignore", GITIGNORE],
    [".github/workflows/deploy.yml", DEPLOY_WORKFLOW],
  ];

  for (const [relative, content] of files) {
    const path = join(INBOX_DIR, relative);
    if (existsSync(path)) continue;
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content, "utf8");
  }
}

/** Regenerate the navigation pages from the index. */
export async function generateSite(items: InboxItem[]): Promise<void> {
  await ensureScaffold();

  await writeFile(join(INBOX_DIR, "index.md"), renderHome(items), "utf8");
  await writeFile(join(INBOX_DIR, "tags.md"), renderTags(items), "utf8");

  const weeksDir = join(INBOX_DIR, "weeks");
  await mkdir(weeksDir, { recursive: true });

  const byWeek = groupBy(items, (i) => i.week);
  for (const [week, weekItems] of byWeek) {
    await writeFile(join(weeksDir, `${week}.md`), renderWeek(week, weekItems), "utf8");
  }

  // Drop week pages whose items are gone (e.g. after an archive edit)
  const existing = await readdir(weeksDir).catch(() => [] as string[]);
  for (const file of existing) {
    if (file.endsWith(".md") && !byWeek.has(file.replace(/\.md$/, ""))) {
      await rm(join(weeksDir, file)).catch(() => {});
    }
  }
}
