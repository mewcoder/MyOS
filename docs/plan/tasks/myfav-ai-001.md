---
id: myfav-ai-001
scope: myfav-site-ai-design
status: done
depends-on: [myfav-ui-003]
---

# objective

依据 `docs/myfav/ai.md` 扩展静态交互原型：加入 OpenAI-compatible AI 设置、单 JSON 数据问答，以及基于当前文章 Markdown 的通用问答与总结快捷问题。同步重排文章详情为居中主阅读流与独立辅助目录。不得发送真实 API 请求或要求真实密钥。

# context

- `docs/myfav/ai.md`
- `docs/myfav/site-layout.md`
- `docs/plan/tasks/myfav-ui-001.md`

# path

- `docs/myfav/prototype/index.html`
- `docs/myfav/prototype/styles.css`
- `docs/myfav/prototype/app.js`
- `docs/myfav/ai.md`
- `docs/plan/README.md`
- `docs/plan/tasks/myfav-ai-001.md`

# constraints

- 设置字段仅为 `baseUrl`、`apiKey`、`model`、`rememberKey`。
- 原型 UI 必须明确“演示，不会发送网络请求”，不得调用 fetch/XHR/WebSocket。
- 关键词搜索与 AI 问答是两个模式；AI 模式必须选择 sites/repos/articles 中一个，不提供 all。
- 文章 AI 支持自由问题、总结快捷操作、折叠、重新生成、停止的演示状态；desktop 位于目录下方的同一侧栏，tablet/mobile 位于元信息和正文之间。
- 标题、元信息与正文位于同一视口居中的稳定阅读列；desktop 目录与文章 AI 独立侧置且不挤压正文，tablet/mobile 使用折叠目录。
- 图片严格限制在正文列内，不使用横向 breakout。
- 列表页不显示占空间的大标题；全站搜索与 AI 数据问答统一从头部常驻搜索框进入。
- Desktop 设置使用 modal，mobile 使用全屏层。
- 新 modal 复用现有 focus trap、inert、Esc 和焦点恢复机制。
- 不增加依赖，不 build/lint，不自动操作浏览器。

# verification

- `rg "fetch\\(|XMLHttpRequest|WebSocket" docs/myfav/prototype` 无真实网络调用。
- `node --check docs/myfav/prototype/app.js` 通过。
- `git diff --check` 通过。
- 设置、AI 搜索和总结入口均有未配置/已配置演示路径。
- 新交互具备 label、aria 状态、键盘关闭和 mobile 响应式规则。
