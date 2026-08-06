---
name: fav
description: Save and archive public websites, GitHub repositories, X posts, WeChat public-account articles, and independent blog articles into the user's local MyFav collection. Use when the user invokes $fav, sends a message containing only a public URL, or asks to 收藏、保存、收录、归档 a link; do not trigger for questions that merely mention or ask about a URL.
---

# Fav

Use `myos fav` as the only mutation interface. Never edit MyFav JSON, Markdown, images, or Git state directly.

## Workflow

1. Extract exactly one HTTP(S) URL and any explicit type or metadata overrides from the request.
2. Read [references/fallback-policy.md](references/fallback-policy.md) when capture fails or reports warnings. Read [references/data-contract.md](references/data-contract.md) before choosing metadata or interpreting output fields.
3. Run `myos fav <url> --dry-run --json`. Add `--type site|repo|article` only when the user states the type explicitly.
4. Inspect `status`, `type`, `via`, warnings, and article character/image counts. Stop and report a `failed` result; never hide `interaction_required`.
5. Produce a short description, one category, and a few tags. Prefer vocabulary already used by MyFav when it is available. Keep `未分类` and `[]` when there is no sound basis for guessing.
6. Run the final `myos fav` command with `--title`, `--description`, `--category`, and repeated `--tag` arguments. Preserve any explicit user wording.
7. Report `saved` or `duplicate`, the detected type, title, article path when present, commit state, and warnings. Never claim that content was pushed: v1 does not push.

Quote every shell argument derived from page content or user text. Do not use shell interpolation or text-replacement commands to mutate data files.

## Commands

Preview:

```bash
myos fav "https://example.com/post" --dry-run --json
```

Save after reviewing the preview:

```bash
myos fav "https://example.com/post" \
  --title "Example Post" \
  --description "A concise description" \
  --category "开发工具" \
  --tag "AI" --tag "skill" \
  --json
```

Use `--repo-dir` only when the user specifies another local MyFav clone. Use `--no-commit` only for isolated tests or when explicitly requested.

## Guardrails

- Always preview before saving.
- Treat `duplicate` as success; do not create a second record.
- Do not retry deterministic 404/410 responses in a browser.
- Do not automatically open a browser during testing. Browser fallback belongs to the CLI and uses a clean, headless system Chrome only when earlier tiers fail.
- Do not push, create cloud resources, add frontmatter, or write notes into content files.
