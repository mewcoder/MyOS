# MyFav 正式站点独立审查（第 1 轮）

- Task：`myfav-site-001`
- 被审查仓库：`/Users/mew/code/myfav`
- 被审查提交：`1c53784aacbcb5a44c399afbf48ca8fdb8b9199d`
- 审查日期：2026-08-07
- 结论：**blocked**

## 结论摘要

提交已经具备真实 Vue 站点、GitHub Pages 发布链路、82 个网站、136 个仓库、空文章状态、Markdown 消毒、Utterances、BYOK 存储和真实 Chat Completions 请求；现有 12 个单元测试全部通过，Vue SFC 与 JavaScript 静态编译检查也通过。

但是当前实现仍有 7 项直接违反已确认设计或运行时正确性的阻塞问题。最严重的是文章路由快速切换会让旧正文覆盖新文章、移动端文章没有约定的阅读工具栏和目录 drawer，以及 AI 数据问答会把旧来源的回答显示成新来源。当前提交不能合入。

## 阻塞发现

### 1. [P1][blocking] 文章路由切换存在异步竞态，会把旧文章正文和 AI 上下文写到新文章页面

- 代码：`/Users/mew/code/myfav/src/views/ArticleView.vue:53-72`
- 契约：`docs/myfav/ai.md:31-32`、`docs/myfav/ai.md:195-214`，`docs/plan/tasks/myfav-site-001.md:39`

`watch(article, async ...)` 每次切换文章都会启动新 `fetch`，但没有取消前一次请求，也没有用请求序号或当前 path 校验响应。若从文章 A 快速切换到 B，而 A 的请求较晚完成，A 会覆盖 B 已加载的 `rawMarkdown`、`renderedHtml` 和 `toc`。页面元信息仍属于 B，`ArticleAssistant` 却会收到 A 的 Markdown 和 B 的 path；这既显示错误正文，也破坏“文章问答只发送当前原始 Markdown”的数据边界，并可能将总结写入错误的 path/hash 缓存键。

修复时应在文章变更和组件卸载时中止旧请求，或只允许与当前 article path/request id 一致的响应提交状态；需要加入可控延迟的路由竞态测试。

### 2. [P1][blocking] tablet/mobile 文章详情没有实现已确认的阅读布局与目录交互

- 代码：`/Users/mew/code/myfav/src/views/ArticleView.vue:2-27`、`/Users/mew/code/myfav/src/styles.css:169-180`、`/Users/mew/code/myfav/src/styles.css:182-224`
- 契约：`docs/myfav/site-layout.md:235-239`、`docs/myfav/site-layout.md:243-276`、`docs/myfav/site-layout.md:398-399`，`docs/myfav/ai.md:195-212`

移动端仍显示全站 `site-header`，正文只提供普通“返回文章”链接；代码没有“返回 / 目录 / 主题”阅读工具栏，也没有右侧 TOC drawer、打开后将焦点移入首个目录项、关闭后恢复触发按钮焦点的行为。TOC 使用带 `open` 的普通 `<details>`，tablet/mobile 样式只是把 desktop 侧栏改成静态块，因此目录默认展开；tablet/mobile 的文章 AI 也没有约定的独立折叠状态。

这不是细节样式偏差，而是移动阅读和无障碍交互骨架缺失。应按 768–1099 与 ≤767 两个断点分别实现折叠入口；mobile 还需替换全站头部为阅读工具栏，并为 drawer 补齐 focus 生命周期。

### 3. [P1][blocking] AI 数据问答的答案来源会在切换数据源或重新打开搜索时漂移

- 代码：`/Users/mew/code/myfav/src/components/SearchOverlay.vue:16-22`、`/Users/mew/code/myfav/src/components/SearchOverlay.vue:60-68`、`/Users/mew/code/myfav/src/components/SearchOverlay.vue:71-97`
- 契约：`docs/myfav/ai.md:153-166`、`docs/myfav/ai.md:169-189`，`docs/plan/tasks/myfav-site-001.md:39`

数据源按钮在请求期间仍可操作，`source` 改变时不会取消请求或清空回答；展示中的 `context.filename` 却立即跟随新 source。结果是基于 `sites.json` 的流式回答可能被标成 `repos.json`。请求完成后关闭搜索，再从另一类型页面打开，也会保留旧 `answer`，同时把来源标签切换为新文件。

单次网络请求本身确实只发送一个 JSON，但 UI 丢失了回答与请求快照的来源绑定，用户无法判断答案实际依据哪个文件。开始请求时应冻结 source/context 快照；切换 source 或关闭时应取消并重置旧状态，或让回答携带不可变的 filename/source 标识。需覆盖“流式过程中切源”和“跨页面重新打开”测试。

### 4. [P2][blocking] SSE parser 无法实时处理跨网络 chunk 拆开的 CRLF 事件边界

- 代码：`/Users/mew/code/myfav/src/lib/aiClient.js:16-42`
- 测试缺口：`/Users/mew/code/myfav/src/lib/aiClient.test.js:4-12`
- 契约：`docs/plan/tasks/myfav-site-001.md:40,50`

parser 在每个 chunk 内单独把 `\r\n` 替换为 `\n`，再把结果追加到 buffer。如果标准 SSE 的 `\r\n\r\n` 分隔符恰好在 chunk 边界被拆开，跨 chunk 的 CRLF 不会被规范化，buffer 中保留 `\r\n\r\n`，而 parser 只搜索 `\n\n`。复查脚本用三个 chunk 依次推送完整事件后，`finish()` 前 delta 仍为空，只有连接结束后才得到 `A`；长连接会因此失去流式输出。

现有测试仅覆盖 LF 分隔。应对累计 buffer 统一处理 CRLF，或实现可跨 chunk 的 SSE 行解析器，并新增 CRLF、分隔符逐字节拆分、多行 data 和 `[DONE]` 用例。

### 5. [P2][blocking] 关键词搜索只实现了字符串过滤，缺少设计稿确认的键盘与空输入行为

- 代码：`/Users/mew/code/myfav/src/components/SearchOverlay.vue:5-12`、`/Users/mew/code/myfav/src/components/SearchOverlay.vue:54-56`
- 契约：`docs/myfav/site-layout.md:296-299`、`docs/myfav/site-layout.md:347-355`

当前输入立即计算，没有 150 ms debounce；空输入直接返回全部记录并截取前 30 条，而界面语义没有“最近收藏”；结果没有按类型分组，也没有统一的 `↑/↓` 焦点序列。输入框的 Enter 只在 AI 模式提交，关键词模式无法用 Enter 打开当前结果。

本地字段匹配范围（标题/名称、描述、分类、作者、tags）是正确的，但搜索浮层尚未达到已确认的完整交互契约。应补齐键盘选中模型、Enter 打开、明确的空输入最近收藏状态和相应测试。

### 6. [P2][blocking] 两个 modal 缺少可访问名称，AI 设置状态与焦点也不符合契约

- 代码：`/Users/mew/code/myfav/src/components/SearchOverlay.vue:2-5`、`/Users/mew/code/myfav/src/components/AISettingsModal.vue:2-14`、`/Users/mew/code/myfav/src/components/AISettingsModal.vue:34-41`、`/Users/mew/code/myfav/src/components/AISettingsModal.vue:58-70`
- 契约：`docs/myfav/ai.md:124-140`、`docs/myfav/site-layout.md:347-360`

两个 `<dialog>` 都没有 `aria-label` 或 `aria-labelledby`；搜索 dialog 甚至没有可供命名的标题。原生 `showModal()` 能提供 modal 行为，但不会自动给 dialog 生成可靠的可访问名称。AI 设置每次都强制 focus 到 Base URL，而未配置时首个空/无效字段通常是 API Key；“测试中”也只禁用测试按钮，三个字段仍可编辑，违反“字段暂时只读”的状态约定。

应为 dialog 建立显式名称关联，按首个无效/空字段选择初始 focus，并在测试期间锁定会改变请求配置的字段；用组件测试验证 Esc 关闭、焦点恢复和状态切换。

### 7. [P2][blocking] `sites.json` 与 `repos.json` 未按 `saveTime` 倒序排列，现有校验未覆盖该不变量

- 数据：`/Users/mew/code/myfav/public/data/sites.json:602-656`、`/Users/mew/code/myfav/public/data/repos.json:1683-1718`
- 校验：`/Users/mew/code/myfav/src/lib/content.js:4-35`、`/Users/mew/code/myfav/src/lib/dataFiles.test.js:5-12`
- 契约：`docs/myfav/README.md:123-151`、`docs/myfav/README.md:343-355`

`sites.json` 尾部出现 `2026-03-29 → 2026-04-09 → 2026-04-19 → 2026-04-21`，`repos.json` 尾部出现 `2026-03-29 → 2026-04-11 → 2026-04-19`，均不是倒序。运行时统一记录会再次排序，因此多数页面暂时能显示正确顺序，但仓库真源和写入/构建前校验契约已被破坏。`validateContent` 与数据测试只检查字段和数量，没有检查排序，导致问题被测试放过。

应稳定地按 `saveTime` 倒序重排原数组，并把排序不变量加入 validator/test，防止后续 `fav` 写入再次产生乱序。

## 已确认通过

- 数据迁移保持 `sites=82`、`repos=136`；逐 URL 对比父提交未发现旧记录、旧字段值丢失或被修改。
- `public/data/articles.json` 为 `[]`，根目录 `articles/.gitkeep` 存在，文章列表使用真实 empty state。
- 三个数据文件均可解析；当前记录必填字段、URL 唯一性、非空 category、tags 类型与单条内去重检查通过。
- Router 使用 `createWebHistory(import.meta.env.BASE_URL)`；运行时静态 fetch 经 `withBase`；发布脚本复制根目录文章并生成 `404.html` history fallback。
- Markdown 使用 `marked` 后交给 `DOMPurify`；本地图片 URL 结合 `BASE_URL` 重写，正文图片、表格和代码块有宽度/溢出限制；h2/h3 TOC 能生成稳定 id。
- Utterances 使用真实 `https://utteranc.es/client.js`、`issue-term=pathname`、`label=notes`，按路由 key 重挂载并同步主题，失败后提供 GitHub Issues 降级入口。
- 关键词搜索字段覆盖标题/名称、描述、分类、作者与 tags；数据 AI 的单次 payload 使用一个完整 JSON，没有“全部”范围或跨 JSON 拼接。
- AI 请求使用真实 `POST /chat/completions`，支持 AbortController、20 秒超时和 401/403/404/429/network 映射；生产源码未发现模拟回答或硬编码真实 API Key。
- API Key 默认写入 sessionStorage，用户显式勾选后才写 localStorage；清除动作删除两处配置及总结缓存，已保存 key 不回填到 DOM。
- `npm test`：5 个测试文件、12 个测试通过。
- `git diff --check 1c53784^ 1c53784` 通过。
- 全部 `.vue` 文件通过 `@vue/compiler-sfc` 模板和 script 编译；全部 `.js/.mjs/.cjs` 通过 `node --check`。
- 按任务约束未执行 build、lint 或浏览器测试。

## 复审门槛

修复以上 7 项并增加对应回归测试后再提交第 2 轮审查。复审至少需要覆盖：文章请求竞态、AI 来源快照、CRLF 跨 chunk SSE、关键词键盘序列、modal focus/状态、JSON 倒序不变量，以及 tablet/mobile 文章结构的组件级断言。
