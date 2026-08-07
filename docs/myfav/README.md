# MyFav 内容库设计

> 状态：采集与静态网站实现已完成，第三方服务联机待部署验证
> 目标仓库：[mewcoder/myfav](https://github.com/mewcoder/myfav)  
> 采集端：MyOS

## 1. 目标

MyFav 是网站、GitHub 仓库和文章的统一内容仓库，也是 GitHub Pages 静态网站的源码仓库。MyOS 负责从微信接收链接、抓取内容并写入本地 MyFav clone。

系统遵循以下原则：

- 内容文件和图片优先保存在本地 Git 仓库中，任意 clone 都能恢复这部分资料；Issues 笔记是明确的例外。
- 网站和 GitHub 仓库使用轻量 JSON 数组；文章使用 JSON 导航数据和 Markdown 全文。
- 文章图片下载到本地，与 Markdown 放在同一个月份目录中并提交 Git。
- GitHub Issues 管理笔记、阅读过程和学习结论，不把这些状态写入内容文件。
- GitHub Pages 只托管构建后的静态网站；v1 不使用数据库、Cloudflare、R2 或自建动态 API。可选 AI 能力由浏览器使用用户自己的 OpenAI-compatible API 配置直接调用。

## 2. 边界与职责

```text
微信消息
   │
   ▼
MyOS
  识别链接类型 / 抓取 / 清洗 / 下载图片 / 生成简介与标签
   │
   ▼
本地 MyFav clone
  JSON 元信息 / Markdown 全文 / 图片 / Git commit
   │
   ▼
GitHub
  内容仓库 / Issues 笔记 / Actions 构建
   │
   ▼
GitHub Pages
  网站 / GitHub / 文章 / 后续博客展示
```

### MyFav 所有

- 三类内容的数据文件与校验规则。
- 文章 Markdown 和本地图片。
- Vue/Vite 静态网站及 GitHub Pages 工作流。
- GitHub Issues 中的笔记。

### MyOS 所有

- 微信命令和链接类型识别。
- X、微信公众号和普通博客的正文提取。
- Markdown 清洗、图片下载和 AI 元信息生成。
- 对本地 MyFav clone 的原子写入、commit 与合并推送。
- 失败重试和用户反馈。

MyOS 不再把 `~/.myos/inbox/` 作为最终网站数据源；现有 Inbox 的提取器和站点适配器继续复用。

链接收藏统一由 [`fav` Skill](./fav.md) 编排。Skill 负责理解用户意图和生成极简元信息，确定性的抓取、校验与落盘由 `myos fav` 命令完成。
微信裸链接直接进入 Agent 并触发 `fav`；`/save` 会转换为 `$fav`。两者均不得再写入或自动 push 旧 Inbox。

## 3. 仓库结构

```text
myfav/
├── public/data/
│   ├── sites.json
│   ├── repos.json
│   └── articles.json
├── articles/
│   ├── 2026-08/
│   │   ├── cloudflare-agent-skills.md
│   │   └── cloudflare-agent-skills/
│   │       ├── 01.webp
│   │       └── 02.png
│   └── 2026-09/
├── src/
├── scripts/
└── dist/                         # 构建产物，不提交 Git
```

目录规则：

- 文章月份目录固定为 `articles/YYYY-MM/`。
- Markdown 文件名为标题生成的可读 slug，例如 `cloudflare-agent-skills.md`。
- 图片目录与 Markdown 同名并去掉 `.md`。
- 图片按正文出现顺序命名为 `01`、`02`、`03`，保留实际扩展名。
- 没有本地图片时不创建同名图片目录。
- 同月 slug 冲突时追加数字后缀，例如 `cloudflare-agent-skills-2.md`，图片目录使用相同后缀。
- Markdown 和同名图片目录必须一起移动或重命名。

## 4. 数据结构

### 4.1 网站

`public/data/sites.json` 是网站元信息的唯一真源，保持 JSON 数组形式并按 `saveTime` 倒序排列。

```json
[
  {
    "title": "Linear",
    "url": "https://linear.app",
    "description": "项目管理工具",
    "category": "工具",
    "tags": ["项目管理", "效率"],
    "saveTime": "2026-08-06"
  }
]
```

字段约束：

| 字段 | 类型 | 规则 |
|---|---|---|
| `title` | string | 必填，展示名称 |
| `url` | string | 必填，规范化后唯一 |
| `description` | string | 必填，一句话说明用途 |
| `category` | string | 必填，单一主分类 |
| `tags` | string[] | 必填，可为空数组，去重后保存 |
| `saveTime` | `YYYY-MM-DD` | 必填，收藏日期 |

### 4.2 GitHub 仓库

`public/data/repos.json` 是仓库元信息的唯一真源，保持 JSON 数组形式并按 `saveTime` 倒序排列。

```json
[
  {
    "name": "cloudflare/skills",
    "url": "https://github.com/cloudflare/skills",
    "description": "Cloudflare Agent Skills",
    "category": "AI",
    "tags": ["Agent Skill", "Cloudflare"],
    "stars": 1600,
    "saveTime": "2026-08-06"
  }
]
```

字段约束：

| 字段 | 类型 | 规则 |
|---|---|---|
| `name` | string | 必填，`owner/repo` |
| `url` | string | 必填，规范化后唯一 |
| `description` | string | 必填，一句话说明用途 |
| `category` | string | 必填，单一主分类 |
| `tags` | string[] | 必填，可为空数组，去重后保存 |
| `stars` | number | 必填，最近一次抓取的快照值 |
| `saveTime` | `YYYY-MM-DD` | 必填，收藏日期 |

`stars` 不是实时真相。更新脚本可以刷新它，但刷新失败不得把已有值覆盖为 `0`。

### 4.3 文章

`public/data/articles.json` 是文章元信息和导航路径的唯一真源。Markdown 不保存 frontmatter，只保存正文。

```json
[
  {
    "title": "Cloudflare Agent Skills",
    "url": "https://example.com/article",
    "description": "介绍 Cloudflare 官方 Agent Skills",
    "category": "AI",
    "tags": ["AI", "Agent Skill"],
    "author": "Cloudflare",
    "published": "2026-08-01",
    "saveTime": "2026-08-06",
    "path": "articles/2026-08/cloudflare-agent-skills.md"
  }
]
```

字段约束：

| 字段 | 类型 | 规则 |
|---|---|---|
| `title` | string | 必填，文章标题 |
| `url` | string | 必填，规范化后的原文链接且唯一 |
| `description` | string | 必填，一句话介绍或 AI 摘要 |
| `category` | string | 必填，单一主分类 |
| `tags` | string[] | 必填，可为空数组，去重后保存 |
| `author` | string | 可选，抓取不到时省略字段 |
| `published` | `YYYY-MM-DD` | 可选，原文发布日期 |
| `saveTime` | `YYYY-MM-DD` | 必填，收藏日期 |
| `path` | string | 必填，仓库根目录相对路径且唯一 |

Markdown 只保存清洗后的正文：

```md
这里是文章正文。

## 主要内容

正文内容……

![示意图](./cloudflare-agent-skills/01.webp)
```

文章页面从 `articles.json` 读取标题、作者、分类、原文链接和导航路径，再加载 `path` 指向的 Markdown 正文。不得在 Markdown 中重复保存这些元信息。

## 5. 分类与标签

- `category` 是单选主分类，用于页面分组和主导航。
- `category` 固定为 6 个：`AI`、`开发`、`设计`、`知识`、`工具`、`生活`，不得在写入时新增分类。
- `tags` 是更具体的多选标签，用于记录技术、来源、内容形式和细分主题，并支持筛选、搜索和跨分类关联。
- 三类内容都必须提供 `category` 和 `tags`。
- 保存前对标签执行 trim、空值过滤、完全匹配去重。
- 标签大小写和同义词规范化由写入脚本处理；例如 `Skill`、`skills` 统一为 `Agent Skill`。

## 6. GitHub Issues 笔记

GitHub Issues 是笔记的唯一真源，文章详情页通过 [Utterances](https://github.com/utterance/utterances) 直接读写对应 Issue。静态网站不保存 GitHub Token，也不提供自建后端。

```text
文章详情页 pathname
        │
        ▼
Utterances GitHub App
  查找或创建同 pathname 的 Issue
        │
        ▼
Issue comments
  AI 初步分析 / 阅读笔记 / 理解 / 行动项
        │
        └────────► 文章页即时回显
```

### 6.1 页面与 Issue 映射

- 一篇文章对应一个 Issue。
- Utterances 使用 `issue-term="pathname"` 查找 Issue。
- Issue 标题使用文章详情页 pathname，例如 `/myfav/articles/2026-08/cloudflare-agent-skills`。
- Utterances 创建的 Issue 使用固定标签 `notes`；该标签必须预先存在。
- 内容 JSON 不保存 Issue 编号，也不重复保存笔记内容。
- 文章发布后的 pathname 视为稳定标识。若修改文章路由，必须同步迁移对应 Issue 标题，否则旧笔记不会自动回显。

### 6.2 笔记结构

Issue 是文章的笔记容器，每条 Issue comment 是一条独立笔记。评论使用普通 GitHub Markdown，可按需包含：

```md
## 我的理解

真正值得关注的是……

## 行动项

- [ ] 验证文章中的方案
- [ ] 与已有资料建立关联
```

- Utterances 在首次提交笔记时自动创建 Issue，后续提交追加 comment。
- 用户也可以直接进入 GitHub Issue 编辑、删除或追加 comment。
- MyOS 的 AI 摘要仍写入 `articles.json.description`；v1 不自动创建 Issue 或发布 AI comment。
- Issue 默认保持 Open。关闭或锁定 Issue 属于 GitHub 端管理行为，不承担文章阅读状态语义。

### 6.3 网站交互与回显

文章详情页在正文后展示笔记区：

```text
┌──────────────────────────────────────────┐
│ 标题 / 作者 / 分类 / 标签 / 原文链接       │
├──────────────────────────────────────────┤
│ Markdown 正文                            │
├──────────────────────────────────────────┤
│ 笔记                                     │
│  [使用 GitHub 登录]                      │
│  ┌────────────────────────────────────┐  │
│  │ Markdown 笔记输入                  │  │
│  └────────────────────────────────────┘  │
│                              [提交]       │
│                                          │
│  历史笔记 comments                        │
└──────────────────────────────────────────┘
```

- 用户使用 GitHub OAuth 授权 Utterances 后在页面内提交笔记。
- comment 写入成功后由 Utterances 即时回显，不触发 GitHub Pages 重新构建。
- MyFav 是 Vue SPA；文章路由变化时必须销毁并重新挂载 Utterances iframe，并以当前 pathname 作为组件 `key`，避免显示上一篇文章的笔记。
- 笔记区主题跟随网站明暗主题。
- 加载失败时显示“在 GitHub Issues 中查看或记录笔记”的降级链接，不影响正文阅读。
- v1 不在文章列表显示笔记数量或“有笔记”标记；这类聚合信息需要额外的 GitHub API 索引。

### 6.4 前置条件与公开边界

- MyFav 仓库必须公开并启用 GitHub Issues。
- MyFav 仓库必须安装 Utterances GitHub App。
- 写笔记需要 GitHub 账号；未登录用户只能阅读已有公开笔记。
- Issues 和 comments 均为公开内容，其他 GitHub 用户也可能发表评论；仓库所有者通过 GitHub 删除、锁定或限制互动。
- Issues 不随 `git clone` 下载；v1 接受这一点，不额外维护 Issues 的 Git 镜像。

## 7. 写入流程

### 网站

```text
URL → 规范化 → 查重 → 抓标题/描述 → 生成分类与标签
    → 原子更新 sites.json → git commit
```

### GitHub 仓库

```text
URL → 提取 owner/repo → 查重 → GitHub API 获取描述与 stars
    → 生成分类与标签 → 原子更新 repos.json → git commit
```

### 文章

```text
URL → 规范化并查重 → 抓取正文 → 清洗为 Markdown
    → 下载正文图片 → 重写为相对路径 → 生成简介/分类/标签
    → 写入月份目录 → 原子更新 articles.json → git commit
```

文章写入必须以临时目录完成。只有 Markdown 和图片全部落盘成功后，才移动到最终月份目录并更新 `articles.json`。JSON 更新失败时不得留下网站可见但正文不存在的记录。

允许图片下载部分失败：失败图片保留原始远程 URL，并在 MyOS 回复中提示；成功下载的图片必须改为本地相对路径。

## 8. 展示与发布

同一个 MyFav 网站提供四个顶层入口：

```text
MyFav
├── 网站
├── GitHub
├── 文章
└── 博客（后续从原创内容或已整理 Issues 产生）
```

- 网站页读取 `sites.json`，支持 category 分组、tags 筛选和搜索。
- GitHub 页读取 `repos.json`，支持 category 分组、tags 筛选和搜索。
- 文章页读取 `articles.json`，支持 category、tags、月份和搜索。
- 文章详情使用 JSON 元信息和 Markdown 正文组合渲染。
- 文章详情在正文后通过 Utterances 展示 GitHub Issues 笔记区。
- GitHub Actions 在 push 后执行构建并将 `dist/` 发布到 GitHub Pages。
- MyOS 首次收藏时自动 clone 绑定仓库到 `~/.myos/myfav`，之后每次正式收藏先 pull，再 commit 并 push。
- push 会触发 GitHub Pages 构建；push 失败时保留本地 commit，并在结果中明确提示。
- [浏览器 AI](./ai.md) 是可选增强：未配置 API 时，列表、关键词搜索、文章阅读和笔记仍完整可用。

## 9. 一致性与校验

写入和构建前必须校验：

- 三个 JSON 均可解析且顶层是数组。
- 必填字段存在且类型正确。
- 同一数据文件中规范化 URL 不重复。
- `category` 非空，`tags` 是无重复字符串数组。
- 每条文章的 `path` 唯一且文件存在。
- Markdown 中的本地图片相对路径存在。
- `articles.json` 的 `saveTime` 与所在月份目录一致。
- 每篇文章生成唯一且稳定的详情页 pathname，满足 Utterances 的一页一 Issue 映射。
- JSON 数组按 `saveTime` 倒序排列。

## 10. 迁移

现有 MyFav 数据保留在原文件中并就地补字段：

- `sites.json`：每条记录新增 `tags`，无法推断时使用 `[]`。
- `repos.json`：每条记录新增 `category`，无法推断时使用 `其他`。
- 新建空的 `articles.json` 和 `articles/` 目录。
- 迁移脚本统一现有标签的大小写和同义词，但不改变 URL、描述、stars 或收藏时间。

迁移完成后，现有页面必须仍能展示全部 82 个网站和 136 个仓库。

## 11. 容量边界

图片与 Markdown 都提交 Git，因此需要在构建时统计：

- Git 工作树大小。
- `dist/` 总大小。
- 静态文件总数。
- 最大单文件大小。

达到以下任一条件时发出预警，但 v1 不自动迁移存储：

- 仓库或发布站点接近 800 MB。
- 单文件接近 80 MiB。
- GitHub Pages 构建接近 10 分钟。

## 12. 非目标

v1 明确不包含：

- 一条收藏一个 JSON 文件。
- Markdown frontmatter。
- `assets.json` 图片清单。
- SQLite、D1、KV、R2 或其他数据库与对象存储。
- Cloudflare 部署。
- 在内容 JSON 中保存阅读状态、质量评分或笔记。
- 自动把所有 Issues 发布成博客。
- 选中文字后的行内批注。
- 在文章列表聚合 Issue 笔记数量。
- 在静态站中内置共享 API Key 或代理服务。
- 依赖 embeddings、向量数据库、Responses API 或工具调用。

## 13. 验收场景

- 保存网站后，`sites.json` 新增一条带 category 和 tags 的记录，现有记录不丢失。
- 保存 GitHub 仓库后，`repos.json` 新增 category，stars 获取失败不会破坏已有数据。
- 保存带多张图片的文章后，Markdown 位于正确月份目录，图片位于同名目录且相对链接可解析。
- 保存无图片文章时只生成 Markdown，不创建同名图片目录。
- 保存同月同标题文章时生成不冲突的文件名和图片目录。
- 重复 URL 不新增记录，返回已有收藏信息。
- 文章写入中断时，不产生只存在 JSON 或只存在半份正文的可见记录。
- GitHub Pages 构建后，三类列表能按分类、标签和关键词查询，文章详情能显示元信息、全文和本地图片。
- 未登录用户打开文章时能看到已有公开笔记和 GitHub 登录入口。
- 登录用户首次提交笔记时自动创建带 `notes` 标签的对应 Issue，comment 无需重新构建即可在页面回显。
- 在两个文章路由间切换时，笔记区跟随 pathname 重新加载，不串用 Issue。
- Utterances 加载失败时正文仍可阅读，并提供 GitHub Issues 降级入口。
- `fav` 对网站、GitHub 仓库、独立博客、X 和微信公众号真实链接执行 dry-run 时，能返回分类、抓取层级和候选元信息，且不修改 MyFav 或 Git。
- `fav` 对同一规范化 URL 再次保存时返回 duplicate，不新增 JSON、Markdown 或图片。
- HTTP 正文过薄时按本地 HTTP → Defuddle → Chrome 的顺序降级；404 不启动浏览器并明确失败。

## 14. 后续模块

| 模块 | 设计状态 |
|---|---|
| MyFav 数据校验与写入脚本 | 已实现于 `src/fav/store.ts` |
| [`fav` Skill 与 MyOS → MyFav 写入接口](./fav.md) | 已实现 |
| [MyFav 网站布局与文章 Markdown 渲染](./site-layout.md) | 已实现于 `mewcoder/myfav` |
| [OpenAI-compatible 浏览器 AI](./ai.md) | 已实现于 `mewcoder/myfav` |
| Utterances 笔记组件 | 已实现；GitHub App、Issues 与联机状态待部署验证 |
| GitHub Issues 到博客的整理流程 | 待设计 |
