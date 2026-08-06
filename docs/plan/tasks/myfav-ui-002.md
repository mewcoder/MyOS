---
id: myfav-ui-002
scope: myfav-site-design
status: done
depends-on: [myfav-ui-001]
---

# objective

调整静态设计稿的信息密度：网站分类列表在 desktop 使用三列、tablet 使用两列；GitHub 分类列表在 desktop/tablet 使用两列；文章列表、全部收藏混合流和移动端保持单列。首页移除左侧介绍区，最近收录改为全宽单列时间流。

# context

- `docs/myfav/site-layout.md`
- `docs/plan/tasks/myfav-ui-001.md`

# path

- `docs/myfav/prototype/styles.css`
- `docs/myfav/prototype/app.js`
- `docs/myfav/site-layout.md`
- `docs/plan/README.md`
- `docs/plan/tasks/myfav-ui-002.md`

# constraints

- GitHub 双列从 tablet breakpoint 开始生效；网站 tablet 两列、desktop 三列；mobile `≤767px` 必须全部为单列。
- 只影响 `sites` 与 `repos` 路由；`articles`、`all` 和首页最近收录保持单列。
- 首页删除 `.library-intro` 整块，最近收录使用完整内容宽度。
- 保持无卡片设计：不添加独立背景、圆角、阴影或粗边框。
- 不改变搜索、筛选、路由和无障碍交互。
- 不 build/lint，不自动操作浏览器。

# verification

- 生成列表时存在可区分内容类型的 class 或 data attribute。
- CSS 明确将 repos 设为两列、sites 在 desktop 设为三列且 tablet 为两列，并在 mobile breakpoint 恢复一列。
- 首页 DOM 不再包含 `.library-intro`，最近收录保持单列。
- `node --check docs/myfav/prototype/app.js` 与 `git diff --check` 通过。
