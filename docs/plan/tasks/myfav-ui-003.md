---
id: myfav-ui-003
scope: myfav-site-design
status: done
depends-on: [myfav-ui-002]
---

# objective

将网站分类列表从 desktop 三列调整为两列，使其与 GitHub 列表保持一致；tablet 继续两列，mobile 继续单列。

# context

- `docs/myfav/site-layout.md`
- `docs/plan/tasks/myfav-ui-002.md`

# path

- `docs/myfav/prototype/styles.css`
- `docs/myfav/site-layout.md`
- `docs/plan/README.md`
- `docs/plan/tasks/myfav-ui-003.md`

# constraints

- 只修改 sites 的 desktop 列数，不改变 GitHub、文章、首页与交互。
- desktop/tablet 两列，mobile `≤767px` 单列。
- 保持无卡片、分隔线列表样式。
- 不 build/lint，不自动操作浏览器。

# verification

- sites 和 repos 在 desktop/tablet 均为两列。
- mobile 仍统一为单列。
- `git diff --check` 通过。
