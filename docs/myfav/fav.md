# `fav` Skill 与采集接口

> 状态：已实现

## 1. 目的与边界

`fav` 是 MyOS 中唯一的收藏 Skill，覆盖网站、GitHub 仓库和文章。它不直接拼接 JSON 或操作 Git，而是调用确定性的 `myos fav` 命令。

```text
用户意图 / URL
      │
      ▼
fav Skill
  判断类型 / 补充 description、category、tags / 先 dry-run
      │
      ▼
myos fav
  规范化 / 抓取 / 校验 / 下载图片 / 原子写入 / commit
      │
      ▼
本地 MyFav clone
```

职责边界：

- Skill 负责理解“收藏网站”“保存这篇文章”等自然语言，并生成简短元信息。
- CLI 负责网络访问、提取层级、路径规则、查重、数据校验、原子写入和 Git commit。
- Skill 不用 shell 文本替换直接修改 `sites.json`、`repos.json` 或 `articles.json`。
- CLI 不调用大模型；未传入的分类和标签使用本文明确的保守默认值。
- v1 不自动 push。发布同步由用户显式触发或后续批处理完成。

## 2. Skill 结构与加载

```text
skills/fav/
├── SKILL.md
├── agents/openai.yaml
└── references/
    ├── data-contract.md
    └── fallback-policy.md
```

- Skill 名称和目录名固定为 `fav`。
- 触发语义包括 `$fav`、收藏/保存/归档链接，以及对网站、GitHub 仓库、X、微信公众号或博客文章的收藏请求。
- `SKILL.md` 只保存执行步骤；字段契约和抓取降级规则放在 references 中按需读取。
- MyOS 使用 Pi 的资源加载器加载仓库内置 `skills/fav`，并额外加载配置的 `skillDir`。不得继续返回空 Skills 列表。
- 自定义 `skillDir` 不存在时记录诊断信息；内置 `fav` 仍应可用。

## 3. CLI 契约

入口：

```text
myos fav <url> [options]
```

首版选项：

| 选项 | 说明 |
|---|---|
| `--dry-run` | 抓取并输出候选结果，不写文件、不执行 Git |
| `--json` | 输出机器可读 JSON，供 Skill 读取 |
| `--type site\|repo\|article` | 覆盖自动分类 |
| `--repo-dir <path>` | MyFav clone 路径；默认 `${MYOS_FAV_DIR}`，未设置时为 `~/.myos/myfav` |
| `--title <text>` | 覆盖抓取标题 |
| `--description <text>` | 覆盖一句话介绍 |
| `--category <text>` | 覆盖主分类 |
| `--tag <text>` | 添加一个 tag，可重复传入 |
| `--no-commit` | 写入但不执行 Git commit，供隔离测试使用 |

成功结果至少包含：

```json
{
  "status": "preview",
  "type": "article",
  "url": "https://example.com/post",
  "title": "Example Post",
  "description": "文章的一句话介绍",
  "category": "未分类",
  "tags": [],
  "via": "http",
  "article": {
    "author": "Example",
    "published": "2026-08-01",
    "characters": 3200,
    "images": 2,
    "markdownPreview": "..."
  }
}
```

`status` 的合法值为：

- `preview`：dry-run 成功。
- `saved`：内容与索引已写入。
- `duplicate`：规范化 URL 已存在；不得产生写入。
- `failed`：命令行输出结构化错误并使用非零退出码。

## 4. 类型识别与元信息

类型识别优先级：

1. 用户或 Skill 传入的 `--type`。
2. `github.com/{owner}/{repo}` 根路径识别为 `repo`；issues、pull、tree、blob 等子资源不自动识别为仓库。
3. X、微信公众号链接识别为 `article`。
4. 普通链接抓取后，正文达到有效阈值时识别为 `article`，否则为 `site`。

Skill 必须先执行一次 `--dry-run --json`，再依据预览结果补充或收敛元信息。正式写入时传回最终 `title`、`description`、`category` 和 `tags`。

当 Skill 没有提供覆盖值时，CLI 使用以下明确默认值：

- `description`：优先页面 description；其次截取正文首段；仍不存在时使用标题。
- `category`：`未分类`。
- `tags`：空数组；GitHub、X、微信公众号可各自补一个来源 tag。

## 5. 抓取降级链

```text
GitHub repo ───────────────► GitHub REST API

网站 / 文章
  │
  ├─► 本地 HTTP + 站点适配器 / Readability
  │       有效 ─► 返回
  │
  ├─► Defuddle
  │       有效 ─► 返回
  │
  └─► 系统 Chrome（Playwright，无头）
          有效 ─► 返回
          登录/验证码 ─► interaction_required
```

- 404/410 是确定性不存在，不进入 Defuddle 或浏览器。
- 401/403/429、5xx、超时或正文过薄可以降级。
- X 和微信公众号适配器成功时直接返回，不因正文较短启动浏览器。
- Chrome 只在前两层失败时启动；测试和 typecheck 不自动打开浏览器。
- v1 的浏览器使用干净无头上下文。持久登录 profile 与 `browser-login` 是后续扩展，不伪装成已实现能力。

## 6. 写入与错误

- 三个 JSON 文件均须在内存中完成 schema 与重复 URL 校验后，通过同目录临时文件原子替换。
- 文章先在临时目录生成 Markdown 和已下载图片，再移动到 `articles/YYYY-MM/`，最后更新 `articles.json`。
- 图片失败时保留远程 URL，并在结果 warnings 中列出；不得让一张图片失败破坏全文。
- commit 只包含本次 `fav` 写入涉及的路径，不使用 `git add -A`。
- Git commit 失败不回滚已写入内容，但结果必须返回 warning；数据写入失败必须返回 typed error。

错误 code：

| code | 条件 |
|---|---|
| `invalid_input` | URL、type 或参数无效 |
| `fetch_failed` | 所有允许的抓取层级失败 |
| `interaction_required` | 需要登录、验证码或人工操作 |
| `repo_invalid` | MyFav 目录或数据文件不符合契约 |
| `write_failed` | 原子写入失败 |

## 7. Skill 工作流

1. 从用户消息提取一个 URL 和明确的类型意图。
2. 读取需要的 reference；不要提前加载无关 reference。
3. 执行 `myos fav <url> --dry-run --json`，有明确类型时追加 `--type`。
4. 检查 `status`、抓取层级、正文长度、图片数和 warnings。
5. 生成极简 `description`、一个 `category` 和少量 tags，优先复用 MyFav 现有词汇。
6. 向用户报告 interaction_required；其他情况执行正式保存命令。
7. 返回保存类型、标题、路径或重复记录信息。不得声称未执行的 push 已完成。

## 8. 验证

### 稳定自动测试

- URL 规范化和三类识别。
- GitHub API、HTTP 有效正文、Defuddle 降级、Chrome 降级均使用受控 fixture/mocks。
- dry-run 零文件写入、零 Git 调用。
- JSON 查重、原子写入、同月 slug 冲突和图片部分失败。
- Skill frontmatter 与 `agents/openai.yaml` 通过 `quick_validate.py`。
- Pi ResourceLoader 实际发现 `fav`，不接受仅验证文件存在。

### 真实链接 smoke test

真实链接只执行 dry-run，不写正式仓库：

| 类型 | 链接 |
|---|---|
| 网站 | `https://linear.app/` |
| GitHub | `https://github.com/cloudflare/skills` |
| 独立博客 | `https://overreacted.io/a-complete-guide-to-useeffect/` |
| X | `https://x.com/jack/status/20` |
| 微信公众号 | 实施时从公开搜索结果选取仍可访问的 `mp.weixin.qq.com/s/...` |

外部站点变化导致的失败应记录为 smoke-test 结果，不把它当作稳定回归测试。浏览器层只做受控测试，除非用户明确要求启动真实浏览器。

## 9. 实现映射

| 契约 | 实现 |
|---|---|
| Skill 与 references | `skills/fav/` |
| CLI 参数和结构化输出 | `src/fav/cli.ts` |
| URL 规范化与类型识别 | `src/fav/url.ts` |
| GitHub / HTTP / Defuddle / Chrome 降级 | `src/fav/fetch.ts` |
| dry-run 与元信息收敛 | `src/fav/service.ts` |
| schema 校验、图片本地化、原子写入与显式 Git stage | `src/fav/store.ts` |
| Pi Skill 发现 | `src/agent/pi-adapter.ts` 的 `DefaultResourceLoader` |

稳定回归使用 `tests/fav/` 中的 fixture 和 mock，不启动真实浏览器。真实链接只在显式 smoke test 中进行 dry-run。
