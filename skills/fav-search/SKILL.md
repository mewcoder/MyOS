---
name: fav-search
description: Search the user's saved MyFav collection of websites, GitHub repositories, and archived articles. Use when the user asks in natural language to 帮我找、查找、搜索、找回 a previously saved item, describes a remembered article/site/repository, or asks what they have collected about a topic. Do not use for general web search or for saving a new URL.
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
