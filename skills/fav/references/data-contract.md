# MyFav data contract

Use only the CLI options. The CLI owns these storage records:

- Site: `title`, `url`, `description`, `category`, `tags`, `saveTime`.
- GitHub repository: `name`, `url`, `description`, `category`, `tags`, `stars`, `saveTime`.
- Article index: `title`, `url`, `description`, `category`, `tags`, optional `author` and `published`, `saveTime`, `path`.
- Article Markdown: body only, without frontmatter. Images live in the same month directory under a folder matching the Markdown basename.

Metadata rules:

- Keep `description` to one useful sentence.
- Choose exactly one non-empty category. Use `未分类` when uncertain.
- Use a small deduplicated tag list. Do not invent a taxonomy; prefer existing labels.
- Preserve the original title unless the fetched title is clearly broken.
- `stars` is a capture-time GitHub API snapshot, not a live count.

Result statuses:

- `preview`: dry-run succeeded and wrote nothing.
- `saved`: files were written. Check `committed` before claiming a commit exists.
- `duplicate`: normalized URL already exists; do not save again.
- `failed`: inspect `code` and report the error.
