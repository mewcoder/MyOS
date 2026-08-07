export type FavKind = "site" | "repo" | "article";
export type FavVia = "http" | "defuddle" | "browser" | "github";

export const FAV_CATEGORIES = [
  "AI",
  "开发",
  "设计",
  "知识",
  "工具",
  "生活",
] as const;

export interface FavInput {
  url: string;
  type?: FavKind;
  repoDir: string;
  dryRun?: boolean;
  noCommit?: boolean;
  title?: string;
  description?: string;
  category?: string;
  tags?: string[];
}

export interface SiteRecord {
  title: string;
  url: string;
  description: string;
  category: string;
  tags: string[];
  saveTime: string;
}

export interface RepoRecord {
  name: string;
  url: string;
  description: string;
  category: string;
  tags: string[];
  stars: number;
  saveTime: string;
}

export interface ArticleRecord {
  title: string;
  url: string;
  description: string;
  category: string;
  tags: string[];
  author?: string;
  published?: string;
  saveTime: string;
  path: string;
}

export interface FavArticlePreview {
  author?: string;
  published?: string;
  characters: number;
  images: number;
  markdownPreview: string;
}

interface FavResultBase {
  type: FavKind;
  url: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  via: FavVia;
  warnings?: string[];
  article?: FavArticlePreview;
}

export interface FavPreviewResult extends FavResultBase {
  status: "preview";
}

export interface FavSavedResult extends FavResultBase {
  status: "saved";
  path?: string;
  committed: boolean;
}

export interface FavDuplicateResult {
  status: "duplicate";
  type: FavKind;
  url: string;
  title: string;
  path?: string;
}

export type FavSuccessResult = FavPreviewResult | FavSavedResult | FavDuplicateResult;

export type FavErrorCode =
  | "invalid_input"
  | "fetch_failed"
  | "interaction_required"
  | "repo_invalid"
  | "write_failed";

export interface FavFailedResult {
  status: "failed";
  code: FavErrorCode;
  error: string;
}

export type FavResult = FavSuccessResult | FavFailedResult;

export class FavError extends Error {
  constructor(
    readonly code: FavErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FavError";
  }
}
