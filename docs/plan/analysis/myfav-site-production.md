# MyFav 正式站点实现分析

## 1. 基线

- 目标仓库：`/Users/mew/code/myfav`，远端 `mewcoder/myfav`，Vue 3 + Vite。
- 现有内容：`sites.json` 82 条、`repos.json` 136 条；尚无 `articles.json` 与 `articles/`。
- 旧数据缺口：网站记录缺少 `tags`，仓库记录缺少 `category`。
- 部署：现有 GitHub Pages workflow 构建 `dist/`。

## 2. 模块拆分

| 模块 | 输入 | 输出 | 依赖 |
|---|---|---|---|
| 内容层 | 三个 JSON、Markdown、图片 | 经过校验的统一记录与文章正文 | Vite base URL |
| 应用外壳 | route、theme | 顶栏、移动导航、页面容器 | Vue Router |
| 列表页 | 统一记录 | 首页时间流、分类/标签筛选、两列或单列列表 | 内容层 |
| 搜索 | 三类记录、query、type | 分组关键词结果 | 内容层 |
| 文章页 | article meta、Markdown | 安全 HTML、TOC、图片、笔记 | Markdown renderer、Utterances |
| AI 配置 | base URL、key、model、remember | session/local 配置状态 | Web Storage |
| AI 客户端 | 单 JSON 或当前 Markdown | Chat Completions 流式文本或显式错误 | Fetch、SSE parser |
| 发布 | `dist/`、根目录 `articles/` | GitHub Pages 静态站与路由 fallback | Vite、Actions |

## 3. 对接链路

```text
App → content store → sites/repos/articles JSON
Search overlay → content store → keyword results
Search overlay → selected complete JSON → AI client
Article route → articles.json → root Markdown → safe renderer → TOC/images
Article assistant → current raw Markdown → AI client
Article route → Utterances(pathname) → GitHub Issue comments
Vite build → copy root articles + 404 fallback → GitHub Pages
```

每条链路必须使用真实实现；不保留 prototype mock、模拟流式文本或示例文章。

## 4. 交付策略

站点外壳、数据适配、文章、搜索和 AI 共享大量文件与状态，拆分并行会产生高重叠，因此作为一个串行任务交付。开发完成后由独立 verify 角色做一次集中 review。
