import { homedir } from "node:os";
import { join } from "node:path";
import { FavService, type FavServiceDependencies } from "./service.js";
import { FavError, type FavFailedResult, type FavInput, type FavKind, type FavResult } from "./types.js";

export interface FavCliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

interface ParsedFavArgs extends FavInput {
  json: boolean;
}

function optionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new FavError("invalid_input", `${option} 缺少参数`);
  return value;
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export function parseFavArgs(args: string[], env: NodeJS.ProcessEnv = process.env): ParsedFavArgs {
  let url: string | undefined;
  let type: FavKind | undefined;
  let repoDir = env.MYOS_FAV_DIR || join(homedir(), ".myos", "myfav");
  let dryRun = false;
  let json = false;
  let noCommit = false;
  let title: string | undefined;
  let description: string | undefined;
  let category: string | undefined;
  const tags: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) {
      if (url) throw new FavError("invalid_input", "一次只能收藏一个 URL");
      url = arg;
      continue;
    }
    switch (arg) {
      case "--dry-run": dryRun = true; break;
      case "--json": json = true; break;
      case "--no-commit": noCommit = true; break;
      case "--type": {
        const value = optionValue(args, index, arg);
        if (value !== "site" && value !== "repo" && value !== "article") {
          throw new FavError("invalid_input", "--type 必须是 site、repo 或 article");
        }
        type = value;
        index += 1;
        break;
      }
      case "--repo-dir": repoDir = optionValue(args, index++, arg); break;
      case "--title": title = optionValue(args, index++, arg); break;
      case "--description": description = optionValue(args, index++, arg); break;
      case "--category": category = optionValue(args, index++, arg); break;
      case "--tag": tags.push(optionValue(args, index++, arg)); break;
      default: throw new FavError("invalid_input", `未知 fav 选项：${arg}`);
    }
  }

  if (!url) throw new FavError("invalid_input", "用法：myos fav <url> [options]");
  return {
    url,
    type,
    repoDir: expandHome(repoDir),
    dryRun,
    json,
    noCommit,
    title,
    description,
    category,
    tags,
  };
}

function failed(error: unknown): FavFailedResult {
  if (error instanceof FavError) return { status: "failed", code: error.code, error: error.message };
  return { status: "failed", code: "fetch_failed", error: String(error) };
}

function humanResult(result: FavResult): string {
  if (result.status === "failed") return `❌ ${result.code}: ${result.error}`;
  if (result.status === "duplicate") return `📎 已收藏：${result.title}${result.path ? `\n${result.path}` : ""}`;
  const action = result.status === "preview" ? "预览" : "已收藏";
  const lines = [`${result.status === "preview" ? "🔎" : "✅"} ${action} [${result.type}] ${result.title}`];
  lines.push(result.url, `${result.category} · ${result.tags.join(" / ") || "无标签"}`, `抓取：${result.via}`);
  if (result.status === "saved" && result.path) lines.push(`路径：${result.path}`);
  if (result.status === "saved" && !result.committed) lines.push("未创建 Git commit");
  if (result.warnings?.length) lines.push(...result.warnings.map((warning) => `⚠️ ${warning}`));
  return lines.join("\n");
}

export async function runFavCli(
  args: string[],
  io: FavCliIo = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
  dependencies: FavServiceDependencies = {},
): Promise<number> {
  const wantsJson = args.includes("--json");
  try {
    const parsed = parseFavArgs(args);
    const { json, ...input } = parsed;
    const result = await new FavService(dependencies).capture(input);
    io.stdout(`${json ? JSON.stringify(result, null, 2) : humanResult(result)}\n`);
    return 0;
  } catch (error) {
    const result = failed(error);
    const output = `${wantsJson ? JSON.stringify(result, null, 2) : humanResult(result)}\n`;
    if (wantsJson) io.stdout(output);
    else io.stderr(output);
    return 1;
  }
}
