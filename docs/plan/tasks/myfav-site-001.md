---
id: myfav-site-001
scope: myfav-production-site
status: in-progress
depends-on: [myfav-ai-001, myfav-ui-003]
---

# objective

在 `/Users/mew/code/myfav` 现有 Vue 3 + Vite 仓库中完成可部署到 GitHub Pages 的 MyFav 正式站点。实现必须读取真实 JSON/Markdown，包含首页、网站、GitHub、文章、文章详情、搜索、AI 配置与问答、Utterances 和发布辅助脚本，不得保留 prototype mock 或模拟 API 回答。

# context

- `/Users/mew/code/myos/docs/INDEX.md`
- `/Users/mew/code/myos/docs/myfav/README.md`
- `/Users/mew/code/myos/docs/myfav/site-layout.md`
- `/Users/mew/code/myos/docs/myfav/ai.md`
- `/Users/mew/code/myos/docs/plan/analysis/myfav-site-production.md`

# path

- `/Users/mew/code/myfav/src/`
- `/Users/mew/code/myfav/public/data/`
- `/Users/mew/code/myfav/articles/`
- `/Users/mew/code/myfav/scripts/`
- `/Users/mew/code/myfav/package.json`
- `/Users/mew/code/myfav/package-lock.json`
- `/Users/mew/code/myfav/vite.config.js`
- `/Users/mew/code/myfav/.github/workflows/deploy.yml`
- `/Users/mew/code/myfav/README.md`

# contract

- 保留 82 个网站与 136 个仓库；迁移 `sites.tags` 和 `repos.category`，不得丢失旧字段。
- 新建空 `articles.json` 与根目录 `articles/`，空文章页展示真实 empty state，不伪造文章。
- 所有静态 URL 使用 `import.meta.env.BASE_URL`；根目录文章在 dev 与 Pages 构建中均可读取。
- 网站和 GitHub desktop/tablet 两列、mobile 单列；首页/文章单列。
- 列表页无大标题；顶栏常驻搜索框打开关键词搜索/AI 数据问答层。
- 数据问答每次只发送用户选择的一个完整 JSON；文章问答只发送当前原始 Markdown。
- API 仅使用 OpenAI-compatible `POST /chat/completions`；实现流式 SSE、取消、超时和 401/403/404/429/CORS 错误映射。
- API Key 默认进入 sessionStorage；仅用户勾选后进入 localStorage，清除配置删除两处数据。
- Markdown 必须消毒；图片限制在正文宽度内；TOC 与文章 AI 共用 desktop 左侧功能栏。
- Utterances 按唯一文章 pathname 映射 Issue，主题随站点变化；失败时正文仍可阅读并显示 GitHub Issues 降级链接。
- 不引入数据库、服务端代理、Cloudflare、embeddings 或 Responses API。
- 不自动操作浏览器；不运行 build/lint。可运行单元测试和必要静态检查。

# verification

- 数据迁移后数量仍为 sites=82、repos=136，三个 JSON 可解析且符合字段契约。
- 单元测试覆盖数据校验、搜索、AI 配置存储、SSE 解析和错误映射。
- `npm test` 通过。
- `git diff --check` 通过。
- 源码中不存在 prototype 模拟回答、硬编码真实密钥或跨 JSON AI 上下文拼接。
- GitHub Pages workflow 与发布脚本包含根目录文章复制和 history fallback；不实际执行 build。
