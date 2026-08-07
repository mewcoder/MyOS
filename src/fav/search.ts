import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FavError, type FavKind } from "./types.js";
import {
  ensureMyFavRepo,
  readCollections,
  type StoreDependencies,
} from "./store.js";

export type FavSearchKind = FavKind | "all";

export interface FavSearchInput {
  query: string;
  type?: FavSearchKind;
  limit?: number;
  repoDir: string;
}

export interface FavSearchResultItem {
  type: FavKind;
  title: string;
  url: string;
  description: string;
  category: string;
  tags: string[];
  saveTime: string;
  path?: string;
  stars?: number;
  matchedIn: string[];
}

export interface FavSearchResult {
  status: "found" | "empty";
  query: string;
  type: FavSearchKind;
  count: number;
  results: FavSearchResultItem[];
}

interface Candidate extends Omit<FavSearchResultItem, "matchedIn"> {
  body?: string;
}

interface ScoredCandidate {
  item: Candidate;
  score: number;
  matchedIn: Set<string>;
}

export interface FavSearchDependencies extends StoreDependencies {}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").trim();
}

function queryTerms(query: string): string[] {
  const normalized = normalize(query);
  const parts = normalized.split(/[\s,，。.!！?？:：;；、/\\|()[\]{}<>《》“”"'`~@#$%^&*+=_-]+/u);
  return [...new Set([normalized, ...parts].filter((term) => term.length > 0))];
}

function fieldScore(value: string, term: string, exact: number, contains: number): number {
  const normalized = normalize(value);
  if (!normalized) return 0;
  if (normalized === term) return exact;
  return normalized.includes(term) ? contains : 0;
}

function scoreCandidate(candidate: Candidate, terms: string[]): ScoredCandidate {
  let score = 0;
  const matchedIn = new Set<string>();
  for (const term of terms) {
    const title = fieldScore(candidate.title, term, 14, 9);
    if (title) matchedIn.add("标题");
    score += title;

    const category = fieldScore(candidate.category, term, 8, 5);
    if (category) matchedIn.add("分类");
    score += category;

    for (const tag of candidate.tags) {
      const tagScore = fieldScore(tag, term, 10, 6);
      if (tagScore) matchedIn.add("标签");
      score += tagScore;
    }

    const description = fieldScore(candidate.description, term, 7, 4);
    if (description) matchedIn.add("简介");
    score += description;

    const url = fieldScore(candidate.url, term, 4, 2);
    if (url) matchedIn.add("链接");
    score += url;

    if (candidate.body) {
      const body = fieldScore(candidate.body, term, 3, 1);
      if (body) matchedIn.add("正文");
      score += body;
    }
  }
  return { item: candidate, score, matchedIn };
}

async function candidates(repoDir: string, type: FavSearchKind): Promise<Candidate[]> {
  const collections = await readCollections(repoDir);
  const results: Candidate[] = [];
  if (type === "all" || type === "site") {
    results.push(...collections.sites.map((item) => ({ type: "site" as const, ...item })));
  }
  if (type === "all" || type === "repo") {
    results.push(...collections.repos.map(({ name, ...item }) => ({
      type: "repo" as const,
      title: name,
      ...item,
    })));
  }
  if (type === "all" || type === "article") {
    const articles = await Promise.all(collections.articles.map(async (item) => ({
      type: "article" as const,
      ...item,
      body: await readFile(join(repoDir, item.path), "utf8"),
    })));
    results.push(...articles);
  }
  return results;
}

export async function searchFav(
  input: FavSearchInput,
  dependencies: FavSearchDependencies = {},
): Promise<FavSearchResult> {
  const query = input.query.trim();
  if (!query) throw new FavError("invalid_input", "搜索内容不能为空");
  const type = input.type ?? "all";
  const limit = input.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new FavError("invalid_input", "--limit 必须是 1 到 20 的整数");
  }

  // Search never pulls an existing clone. Saving already keeps this working copy
  // current; when it is absent, clone the fixed MyFav repository once.
  await ensureMyFavRepo(input.repoDir, true, dependencies);
  const terms = queryTerms(query);
  const ranked = (await candidates(input.repoDir, type))
    .map((item) => scoreCandidate(item, terms))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.item.saveTime.localeCompare(left.item.saveTime))
    .slice(0, limit)
    .map(({ item, matchedIn }) => {
      const { body: _body, ...result } = item;
      return { ...result, matchedIn: [...matchedIn] };
    });

  return {
    status: ranked.length ? "found" : "empty",
    query,
    type,
    count: ranked.length,
    results: ranked,
  };
}
