# MyFav 正式站点独立审查与复核

- Task：`myfav-site-001`
- 被审查仓库：`/Users/mew/code/myfav`
- 首轮提交：`1c53784aacbcb5a44c399afbf48ca8fdb8b9199d`
- 修复提交：`a15b2928232eb82db8f223e271f2d2779a50dd6c`
- 首轮审查：2026-08-07，`blocked`
- 本轮复核：2026-08-07，**pass**

## 复核结论

首轮报告中的 7 项 blocking findings 已全部关闭。复核严格限定于原发现，没有新增泛化审查范围。修复提交可以通过本轮验收。

## 原阻塞项关闭情况

### 1. [P1][closed] 文章路由异步竞态

- 原位置：`/Users/mew/code/myfav/src/views/ArticleView.vue:53-72`（首轮提交）
- 修复位置：`/Users/mew/code/myfav/src/lib/articleLoader.js`、`/Users/mew/code/myfav/src/views/ArticleView.vue`
- 回归测试：`/Users/mew/code/myfav/src/lib/articleLoader.test.js`

`createArticleLoader` 同时使用 AbortController 和递增 request id；`ArticleView` 在路由变化及卸载时取消旧请求，并在提交状态前再次核对当前 article path。延迟完成的旧请求返回 `null`，无法再覆盖新文章正文、TOC 或 AI Markdown 上下文。原 finding 已关闭。

### 2. [P1][closed] tablet/mobile 文章阅读布局与 TOC drawer

- 修复位置：`/Users/mew/code/myfav/src/views/ArticleView.vue`、`/Users/mew/code/myfav/src/App.vue`、`/Users/mew/code/myfav/src/styles.css`
- 回归测试：`/Users/mew/code/myfav/src/views/ArticleView.test.js`

文章页已增加“返回 / 目录 / 主题”阅读工具栏；mobile 隐藏全站 header 和底部导航，tablet/mobile 隐藏 desktop TOC 并使用 dialog drawer。drawer 有显式可访问名称，打开后 focus 首个目录链接，关闭后恢复目录按钮焦点；文章 AI 仍在元信息之后、正文之前并保持可折叠。原 finding 已关闭。

### 3. [P1][closed] AI 数据问答来源漂移

- 修复位置：`/Users/mew/code/myfav/src/components/SearchOverlay.vue`
- 回归测试：`/Users/mew/code/myfav/src/components/modals.test.js`

请求开始时保存不可变的 `requestContext` 与 `answerSource`，增量回写受 request id 约束；切换 source 会取消旧请求并清空输出，普通关闭和跨页面重新打开会重置 overlay。测试覆盖流式期间切源、旧请求随后完成，以及跨页面重开，旧答案均不会显示为新 JSON 来源。原 finding 已关闭。

### 4. [P2][closed] SSE 跨 chunk CRLF 解析

- 修复位置：`/Users/mew/code/myfav/src/lib/aiClient.js`
- 回归测试：`/Users/mew/code/myfav/src/lib/aiClient.test.js`

parser 现在先把 chunk 追加到累计 buffer，再统一规范化 CRLF，因此能识别被拆到多个 chunk 的 `\r\n\r\n` 事件边界。测试覆盖逐 chunk 拆分 CRLF、`[DONE]` 和多行 `data:`；独立复现也在 `finish()` 前立即得到 delta。原 finding 已关闭。

### 5. [P2][closed] 关键词搜索交互

- 修复位置：`/Users/mew/code/myfav/src/components/SearchOverlay.vue`、`/Users/mew/code/myfav/src/styles.css`
- 回归测试：`/Users/mew/code/myfav/src/components/modals.test.js`

搜索现已实现 150 ms debounce、空输入“最近收藏”、按类型分组、统一 active index、上下方向键循环选择、`aria-activedescendant` 和 Enter 打开结果。回归测试覆盖 debounce 边界、键盘序列与文章路由打开。原 finding 已关闭。

### 6. [P2][closed] modal 可访问名称、焦点和测试状态

- 修复位置：`/Users/mew/code/myfav/src/components/SearchOverlay.vue`、`/Users/mew/code/myfav/src/components/AISettingsModal.vue`、`/Users/mew/code/myfav/src/App.vue`
- 回归测试：`/Users/mew/code/myfav/src/components/modals.test.js`

两个 dialog 均通过 `aria-labelledby` 获得显式名称。AI 设置打开时定位首个空或无效字段，测试期间输入字段只读、复选框及动作按钮禁用，关闭后恢复触发元素焦点；搜索 dialog 同样保存并恢复触发点。原 finding 已关闭。

### 7. [P2][closed] JSON `saveTime` 倒序不变量

- 修复位置：`/Users/mew/code/myfav/public/data/sites.json`、`/Users/mew/code/myfav/public/data/repos.json`、`/Users/mew/code/myfav/src/lib/content.js`、`/Users/mew/code/myfav/scripts/migrate-data.mjs`、`/Users/mew/code/myfav/public/fav.js`
- 回归测试：`/Users/mew/code/myfav/src/lib/content.test.js`、`/Users/mew/code/myfav/src/lib/dataFiles.test.js`

数据已稳定重排为倒序，实测 `sites=82`、`repos=136` 且两者从首项到末项均满足 `saveTime` 非递增。validator、迁移脚本和收藏写入脚本都加入排序约束，测试覆盖乱序拒绝及真实文件顺序。原 finding 已关闭。

## 本轮验证

- `npm test`：8 个测试文件、22 个测试全部通过。
- `git diff --check 1c53784..a15b292`：通过。
- 全部 `.js/.mjs/.cjs`：`node --check` 通过。
- 全部 12 个 `.vue` 文件：`@vue/compiler-sfc` template/script 静态编译通过。
- SSE 跨 chunk CRLF 独立复现：在 `finish()` 前得到 `A`。
- 真实数据顺序检查：sites 82 条、repos 136 条，均为 `saveTime` 倒序。
- 按任务约束未执行 build、lint 或浏览器测试。

## 最终结论

**pass**。首轮 7 项 blocking findings 全部关闭，没有剩余 blocking finding。
