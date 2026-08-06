# Capture fallback policy

The CLI, not the Skill, executes fallback logic:

1. GitHub repository roots use the GitHub REST API.
2. Other links use local HTTP extraction and known X/WeChat adapters.
3. Thin or blocked HTTP results try Defuddle.
4. Only then may the CLI try clean headless system Chrome.

Handle failures as follows:

- `404` and `410`: report `fetch_failed`; do not suggest a browser retry.
- `401`, `403`, `429`, `5xx`, timeout, or thin content: allow the CLI fallback chain to finish.
- `interaction_required`: ask the user to handle login, CAPTCHA, or provide another public link. Do not claim capture succeeded.
- Image warning: saving may continue. Successful images become local paths; failed images retain their remote URLs.
- Git warning: content remains written locally, but no commit should be claimed.

For validation, use `--dry-run --json`. Do not open a real browser or write the production MyFav clone unless the user explicitly requests that test.
