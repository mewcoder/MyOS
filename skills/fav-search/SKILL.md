---
name: fav-search
description: Search the user's local MyFav collection of saved websites, GitHub repositories, and archived articles. Always use when the request says 搜索收藏、查找收藏、从收藏里找、我的收藏、我收藏过, even when it also mentions GitHub, 网站, or 文章. Also use when the surrounding context clearly refers to previously saved items. Never replace a local-collection request with public GitHub or web search. Do not use when the user explicitly asks to search GitHub 上、网上、互联网、全网, or when saving a new URL.
---

# Fav Search

Use `myos fav-search` as the only search interface. Search the user's collection, not the public web, and never edit MyFav files or Git state directly.

## Workflow

1. Infer a type only when the user names one: 网站 → `site`, GitHub/仓库/项目 → `repo`, 文章/推文/公众号/博客文章 → `article`. Otherwise search `all`.
2. Remove conversational filler such as “帮我找一下” and keep one to three distinctive keywords from the user's description. Preserve technical names and phrases.
3. Run `myos fav-search "<keywords>" --type <type> --limit 5 --json`. Omit `--type` when searching all types.
4. If nothing matches, retry once with the single most distinctive keyword or an obvious shorter form. Do not broaden into an internet search.
5. Return concise results with type, linked title, description, category/tags, and why it matched. Say clearly when the local collection has no match.

The CLI searches metadata for websites and repositories, and both metadata and local Markdown body text for articles. It automatically clones the fixed MyFav repository into `~/.myos/myfav` only when the local collection is absent; it does not pull or write during normal searches.

## Examples

```bash
myos fav-search "Agent Skill" --type article --limit 5 --json
myos fav-search "Cloudflare" --type repo --limit 5 --json
myos fav-search "设计灵感" --json
```

## Guardrails

- Do not call `myos fav`; searching must never create a favorite.
- Do not edit JSON, Markdown, images, or run Git commands directly.
- Do not claim semantic similarity beyond the fields reported in `matchedIn`.
- Do not expose article body text unless the user separately asks to read or summarize that article.
- When the user wants an internet-wide result rather than their own collection, explain that this Skill only searches MyFav and use the appropriate web-search capability instead.
