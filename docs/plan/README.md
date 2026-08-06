# 交付计划

当前活动任务：

- [`myfav-site-001`](./tasks/myfav-site-001.md)（in-progress）：在 `mewcoder/myfav` 正式实现静态内容站、文章阅读、搜索、浏览器 AI 与 GitHub Pages 发布闭环。

已完成任务：

- [`myfav-ai-001`](./tasks/myfav-ai-001.md)（done）：完成 AI 设置、单 JSON 数据问答、文章 Markdown 通用问答与居中阅读布局原型。
- [`myfav-ui-003`](./tasks/myfav-ui-003.md)（done）：网站列表在 desktop/tablet 统一使用两列。
- [`myfav-ui-002`](./tasks/myfav-ui-002.md)（done）：网站 desktop 三列/tablet 两列、GitHub 双列，并将首页改为全宽最近收录。
- [`myfav-ui-001`](./tasks/myfav-ui-001.md)（done）：完成 MyFav 首页、统一收藏列表和文章详情的响应式静态设计稿。
- [`fav-001`](./tasks/fav-001.md)（done）：实现 `fav` Skill、Pi Skill 加载、统一微信链接路由、`myos fav` dry-run 与 MyFav 原子写入闭环。

实现与 review 均以 [`docs/myfav/README.md`](../myfav/README.md) 和 [`fav` 采集接口](../myfav/fav.md) 为事实源。分析记录位于 [`analysis/fav-capture.md`](./analysis/fav-capture.md)；若实现需要改变数据字段、目录结构或 MyOS/MyFav 的职责边界，应先更新设计文档。
