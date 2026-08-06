---
id: myfav-ui-001
scope: myfav-site-design
status: done
depends-on: []
---

# objective

依据 `docs/myfav/site-layout.md` 制作一个可点击、无构建依赖的 MyFav 静态设计稿，覆盖首页、统一收藏列表和文章详情，并通过真实 CSS media query 支持桌面端与移动端。设计稿只用于视觉评审，不连接真实 JSON、Utterances 或 GitHub API。

# context

- `docs/INDEX.md`
- `docs/myfav/README.md`
- `docs/myfav/site-layout.md`

# path

- `docs/myfav/prototype/`
- `docs/myfav/site-layout.md`
- `docs/plan/README.md`
- `docs/plan/tasks/myfav-ui-001.md`

# constraints

- 使用纯 HTML、CSS、JavaScript；不增加 package dependency，不需要构建。
- 保持编辑式列表，避免 dashboard 卡片墙、装饰性渐变与 pill soup。
- 使用设计文档中的颜色、字体层级和 breakpoint。
- 提供顶部导航、移动底部导航、全局搜索 overlay、分类筛选、首页、列表页、文章详情和移动目录 drawer 的可点击演示。
- 使用内联 SVG 或字符图标，不拉取外部图片与字体。
- 不改生产代码，不自动打开浏览器，不运行 build/lint。

# verification

- HTML、CSS、JS 文件存在且引用路径正确。
- 核心页面与交互均能从源码对应到设计文档。
- CSS 包含 `≤767px` 与 `768–1099px` 响应式规则、safe-area 和 reduced-motion。
- 表单控件有 label/aria-label，overlay/drawer 有可识别的关闭入口。
