import { homedir } from "node:os";
import { join } from "node:path";
import { MYFAV_DIR } from "../paths.js";
import { FavError } from "./types.js";
import {
  searchFav,
  type FavSearchDependencies,
  type FavSearchInput,
  type FavSearchKind,
  type FavSearchResult,
} from "./search.js";

export interface FavSearchCliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

interface ParsedSearchArgs extends FavSearchInput {
  json: boolean;
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function optionValue(args: string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new FavError("invalid_input", `${option} 缺少参数`);
  return value;
}

export function parseFavSearchArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): ParsedSearchArgs {
  const queryParts: string[] = [];
  let type: FavSearchKind = "all";
  let limit = 5;
  let json = false;
  let repoDir = env.MYOS_FAV_DIR || MYFAV_DIR;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (!arg.startsWith("--")) {
      queryParts.push(arg);
      continue;
    }
    switch (arg) {
      case "--json": json = true; break;
      case "--type": {
        const value = optionValue(args, index, arg);
        if (value !== "all" && value !== "site" && value !== "repo" && value !== "article") {
          throw new FavError("invalid_input", "--type 必须是 all、site、repo 或 article");
        }
        type = value;
        index += 1;
        break;
      }
      case "--limit": {
        const value = optionValue(args, index, arg);
        limit = Number(value);
        index += 1;
        break;
      }
      case "--repo-dir": repoDir = optionValue(args, index++, arg); break;
      default: throw new FavError("invalid_input", `未知 fav-search 选项：${arg}`);
    }
  }

  const query = queryParts.join(" ").trim();
  if (!query) throw new FavError("invalid_input", "用法：myos fav-search <query> [options]");
  return { query, type, limit, repoDir: expandHome(repoDir), json };
}

function humanResult(result: FavSearchResult): string {
  if (result.status === "empty") return `没有找到与“${result.query}”相关的收藏。`;
  return [
    `找到 ${result.count} 条收藏：`,
    ...result.results.map((item, index) => [
      `${index + 1}. [${item.type}] ${item.title}`,
      `   ${item.description}`,
      `   ${item.category} · ${item.tags.join(" / ") || "无标签"} · 命中${item.matchedIn.join("、")}`,
      `   ${item.url}`,
    ].join("\n")),
  ].join("\n");
}

export async function runFavSearchCli(
  args: string[],
  io: FavSearchCliIo = {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
  dependencies: FavSearchDependencies = {},
): Promise<number> {
  const wantsJson = args.includes("--json");
  try {
    const { json, ...input } = parseFavSearchArgs(args);
    const result = await searchFav(input, dependencies);
    io.stdout(`${json ? JSON.stringify(result, null, 2) : humanResult(result)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof FavError ? `${error.code}: ${error.message}` : String(error);
    const result = { status: "failed", error: message };
    const output = `${wantsJson ? JSON.stringify(result, null, 2) : `❌ ${message}`}\n`;
    if (wantsJson) io.stdout(output);
    else io.stderr(output);
    return 1;
  }
}
