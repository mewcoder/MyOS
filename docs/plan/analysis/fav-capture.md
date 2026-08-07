# `fav` 采集闭环分析

## 模块拆分

| 模块 | 输入 | 输出 | 依赖 |
|---|---|---|---|
| `skills/fav` | 用户收藏意图和 URL | `myos fav` 调用与用户反馈 | Pi Skill loader、CLI |
| Pi ResourceLoader | 内置和配置 Skill 路径 | 可被 session 使用的 Skills | Pi SDK `DefaultResourceLoader` |
| Fav CLI | URL 与覆盖选项 | preview/saved/duplicate JSON | Fav service |
| Fav service | 规范化请求 | 三类候选记录 | Inbox 提取器、GitHub API |
| Fav store | 候选记录和 MyFav 路径 | JSON/Markdown/图片与 commit 状态 | 文件系统、Git |

## 对接链枚举

1. `Gateway.create` 把 `skillDir` 传给 `PiAdapter`。
2. `PiAdapter.createSession` 创建并 reload `DefaultResourceLoader`，加载内置 `skills/fav` 和可选自定义目录。
3. Gateway 将裸链接等所有非命令消息交给 Agent；`/fav` 转换为 `$fav` 后进入同一 Agent 队列，不再调用旧 Inbox 写入。
4. `fav` Skill 调用 `myos fav --dry-run --json`，再调用正式写入。
5. `src/index.ts` 把 `fav` 子命令交给 Fav CLI，且不启动 Gateway。
6. Fav service 对文章复用 Inbox 的 HTTP、站点适配器、Readability、Defuddle 和浏览器层，但不复用 Inbox 的存储与 push 流程。
7. Fav service 把三类结果交给 Fav store，Fav store 写入设计文档定义的 MyFav 路径。

## 任务边界

这些模块必须形成真实入口到真实文件的闭环；拆成多个并行任务会让 CLI、Skill 和 loader 保留 stub，因此首版合并为一个串行任务 `fav-001`。
