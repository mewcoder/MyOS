# MyOS

> Pi Agent Host with Gateway —— 把 IM 通道桥接到 AI Coding Agent 的轻量级网关。

MyOS 让你在微信(及未来的更多通道)里直接和一个具备文件读写、Shell 执行能力的 AI Agent 对话。它通过 Gateway 路由消息，在通道适配器(WeChat)与 Agent 适配器(Pi)之间传递上下文，让远程对话拥有本地 Coding Agent 的完整能力。

## 架构

```
┌─────────────┐    MessageEvent    ┌──────────┐   AgentRequest   ┌────────────┐
│   Channel   │ ───────────────► │  Gateway │ ───────────────► │   Agent    │
│  (WeChat)   │ ◄─────────────── │ (router) │ ◄─────────────── │    (Pi)    │
└─────────────┘   AgentResponse   └──────────┘   AgentResponse  └────────────┘
       ▲                                                              ▲
       │ ChannelAdapter                                       AgentAdapter
```

**Gateway** 负责通道注册、消息路由、会话解析与优雅关闭。
**ChannelAdapter** 抽象通道接入(微信扫码、长轮询、发送回复)。
**AgentAdapter** 抽象 Agent 运行时(创建会话、收集回复、中止运行)。

## 快速开始

### 环境要求

- Node.js >= 22.0.0
- 一个支持 OpenAI 兼容协议的 LLM Provider

### 安装

```bash
git clone https://github.com/mewcoder/MyOS.git myos
cd myos
npm install
npm run build
npm link   # 将 myos 命令加入 PATH（后文的 myos --install 等命令依赖它）
```

### 配置

首次运行会在 `~/.myos/config.json` 自动生成默认配置，其中 `apiKey` 使用 `${MYOS_API_KEY}` 环境变量引用。你可以选择：

**方式一：环境变量（推荐）**

```bash
export MYOS_API_KEY="your-api-key"
myos
```

**方式二：直接写入 config.json**

编辑 `~/.myos/config.json`，将 `apiKey` 字段改为实际值：

```jsonc
// 扁平结构：3 个必填字段，一层嵌套
{
  "channels": {
    "wechat": {}                          // key 即渠道类型，省略 enabled 即启用
  },
  "providers": {
    "xfyun-astron": {
      "baseUrl": "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2",
      "api": "openai-completions",
      "apiKey": "your-api-key-here",      // 或 "${MYOS_API_KEY}"
      "authHeader": true,
      "models": [{
        "id": "astron-code-latest",
        "name": "Astron Code (讯飞)",
        "contextWindow": 200000,
        "maxTokens": 16384
      }]
    }
  },
  "defaultModel": "xfyun-astron/astron-code-latest"
}
```

#### 配置字段参考

| 字段 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `channels.<type>` | ✓ | — | 渠道配置，key 为渠道类型（目前支持 `wechat`），`{}` 即可 |
| `channels.<type>.enabled` | | `true` | 设为 `false` 禁用该渠道 |
| `channels.wechat.baseUrl` | | 官方地址 | 微信 iLink API 地址 |
| `channels.wechat.token` | | 无 | Bot token；不填则用 `--login` 扫码获取的持久化 token |
| `providers` | ✓ | — | Pi `models.json` 的 providers 格式，至少一个 |
| `defaultModel` | ✓ | — | `provider/model-id` 格式 |
| `workspaceDir` | | `~/.myos/workspace` | Agent 工作区，支持 `~` |
| `thinkingLevel` | | 模型默认 | `off`/`minimal`/`low`/`medium`/`high`/`xhigh`/`max` |
| `sessionDir` | | `~/.myos/data` | 会话映射存放目录，一般无需设置 |

`providers.<id>.models[]` 中除 `id` 外都可省略，Pi SDK 会补默认值——**与默认值相同的字段不必写**：

| 模型字段 | 默认 |
|---|---|
| `name` | 同 `id` |
| `input` | `["text"]` |
| `cost` | 全 `0` |
| `contextWindow` | `128000`（模型实际更大时必须写明，否则会提前触发上下文压缩） |
| `maxTokens` | `16384` |
| `reasoning` | `false` |

#### 环境变量替换

配置文件中所有字符串值都支持 `${VAR_NAME}` 语法引用环境变量，启动时自动替换：

```jsonc
{
  "providers": {
    "my-provider": {
      "apiKey": "${MY_API_KEY}"   // → 替换为 process.env.MY_API_KEY
    }
  }
}
```

- 变量名必须全大写：`[A-Z_][A-Z0-9_]*`
- 用 `$${VAR}` 输出字面量 `${VAR}`
- 变量未设置或为空时，启动会报错并指出具体配置路径

#### 配置校验

启动时使用 zod schema 对 `config.json` 做校验，配置错误会给出精准的字段路径提示：

```
[myos] config validation failed with 1 error(s):
  • agent.providers.xfyun-astron.apiKey: apiKey is required — use ${ENV_VAR} to reference env vars
```

`agent.providers` 直接使用 Pi SDK 的 `models.json` providers 格式，启动时自动写入 `~/.myos/pi/`。如需添加更多 Provider（如 Anthropic、Babel Town），按相同格式添加即可。

### 运行

```bash
npm start
```

启动后在手机微信中扫码，登录成功后即可在微信中与 Agent 对话。按 `Ctrl+C` 优雅关闭。

### 微信内命令

以 `/` 开头的消息会被网关拦截为命令（不经过 AI，即时响应）：

| 命令 | 说明 |
|---|---|
| `/help` | 显示可用命令 |
| `/new`（或 `/reset`） | 重置会话：清空上下文，新开 Pi session 重新开始 |
| `/stop` | 中断当前正在执行的任务（agent 忙时同样立即生效，不排队） |
| `/status` | 查看当前模型、会话 ID 与运行状态 |
| `/save <链接>` | 强制收藏该链接（见下方 Inbox） |
| `/inbox` | 查看收藏统计与最近条目 |

其他消息将直接发给 AI 助手。未知的 `/xxx` 会返回提示而不是发给模型。

### Inbox：链接收藏

**直接发一条文章链接**（可附不超过 40 字的备注），网关会自动抓取、结构化归档并回复摘要。链接后面跟长文字则视为提问，仍走 AI 助手——想强制收藏用 `/save`。

抓取分两层，由**提取结果**决定升级，而不是靠域名猜测：

| 层 | 覆盖 | 说明 |
|---|---|---|
| HTTP | 公众号、独立博客、**X** | 约 2 秒。X 的正文在 `og:description` 里，服务端渲染，无需浏览器 |
| 无头 Chrome | 纯客户端渲染的页面 | 仅当 HTTP 提取不足时启动；用 `playwright-core` 驱动系统 Chrome，不下载 Chromium |

归档目录 `~/.myos/inbox/` 本身既是 git 仓库、也是 VitePress 站点源码：

```
inbox/
├── items/2026/07/2026-07-26-<slug>.md   # 正文 + frontmatter（标题/作者/周/标签/摘要）
├── data/index.jsonl                     # 结构化索引，周报直接查这个
├── weeks/2026-W30.md                    # 按 ISO 周归档（生成）
├── index.md / tags.md                   # 首页与标签页（生成）
└── .github/workflows/deploy.yml         # 推送后自动部署 GitHub Pages
```

每次收藏都会自动 `git commit`；配了 remote 就顺带 push。本地预览：

```bash
cd ~/.myos/inbox && npm install && npm run dev
```

**周报数据源**：`data/index.jsonl` 每行一条记录，含 `week` 字段，按 ISO 周过滤即可喂给 agent 生成周报。

### 后台运行（Daemon）

MyOS 使用操作系统原生服务管理器实现守护进程，参考 OpenClaw 的架构设计：

- **macOS** → `launchd` LaunchAgent（KeepAlive 崩溃自恢复 + RunAtLoad 开机自启）
- **Linux** → `systemd --user` service（Restart=always + WantedBy=default.target）
- **其他** → PID 文件 + detached spawn（fallback）

```bash
# 安装为系统服务（开机自启 + 崩溃自动重启）
myos --install

# 卸载系统服务
myos --uninstall

# 日常控制
myos --daemon          # 后台启动（等同 --install）
myos --status          # 查看状态
myos --stop            # 停止
myos --restart         # 重启
```

| 命令 | 说明 |
|---|---|
| `--login` / `-l` | 微信扫码登录（daemon 模式必须先登录一次） |
| `--install` | 安装为系统服务（launchd/systemd），开机自启 + 崩溃自动重启 |
| `--uninstall` | 卸载系统服务，移除 plist/unit 文件 |
| `--daemon` / `-d` | 后台启动（首次等同 --install） |
| `--status` | 查看服务状态 |
| `--stop` | 停止服务 |
| `--restart` | 重启服务 |
| `--force` / `-f` | 强制接管：杀掉已有实例并启动新实例 |
| `--help` / `-h` | 显示帮助 |

> **注意**：daemon 是非交互进程，无法显示二维码。首次使用请先在终端运行 `myos --login` 完成扫码登录，再执行 `myos --install`。安装服务时，config.json 中 `${VAR}` 引用的环境变量（如 `MYOS_API_KEY`）会从当前 shell 读取并写入服务环境文件（0600 权限）。

**macOS (launchd) 特性：**
- `KeepAlive: { SuccessfulExit: false }` — 仅异常退出时自动重启（正常退出不拉起）
- `RunAtLoad: true` — 开机自启
- `ThrottleInterval: 10` — 崩溃重启间隔 10 秒
- `ExitTimeOut: 20` — 优雅退出超时 20 秒
- 环境变量存储在 `~/.myos/service/gateway.env`（0600 权限），`--install/--restart` 时自动重写

**Linux (systemd) 特性：**
- `Restart=on-failure` — 仅异常退出时自动重启；配置错误（exit 78）不重启
- `RestartSec=5` — 崩溃重启间隔 5 秒
- `StartLimitBurst=5` — 60 秒内最多重启 5 次（防止 crash loop）
- `KillMode=control-group` — 干净地终止子进程
- `WantedBy=default.target` — 用户登录时自启

### 单实例锁

MyOS 使用 PID 文件 (`~/.myos/myos-gateway.pid`) 确保同一时间只有一个实例在运行，避免多个实例竞争同一个长轮询连接导致消息重复回复。

当检测到已有实例运行时：

- **交互模式（终端 TTY）**：会询问你是否接管旧实例：
  ```
  [myos] another instance is already running (PID 12345)
    Take over (stop existing instance and start)? [Y/n]
  ```
  回车或 `y` 接管，`n` 退出。

- **非交互模式（管道/脚本）**：提示后退出，可用 `--force` 强制接管。

- **`--force` / `-f`**：跳过确认，直接杀掉旧实例并启动新实例。

> **注意**：`launchd` / `systemd` 管理的守护进程被杀掉后会自动重启，`--force` 主要用于前台模式接管。

## 运行时目录

目录按用途分层（布局的唯一定义在 `src/paths.ts`，旧布局启动时自动迁移）：

```
~/.myos/
├── config.json          # 用户配置 —— 唯一需要手动编辑的文件
├── run/                 # 易变运行状态（停止后可安全删除）
│   ├── gateway.pid      #   单实例锁
│   └── daemon.pid       #   pid 后端守护进程 PID
├── logs/                # 全部日志
│   ├── myos.log         #   文本日志（daemon stdout/stderr）
│   └── myos-<日期>.jsonl #   结构化事件日志（0600）
├── data/                # 网关持久状态
│   ├── sessions.json    #   会话映射（channel:user → Pi 会话）
│   └── wechat/          #   渠道运行时数据（登录态、同步游标）
├── pi/                  # Pi 生成物
│   ├── models.json      #   模型配置（从 config.json 生成，0600）
│   ├── auth.json        #   认证信息（从 config.json 生成，0600）
│   └── sessions/        #   会话完整过程（JSONL：消息、工具调用、压缩记录）
├── service/             # 系统服务支持文件
│   ├── gateway.env      #   环境变量（含密钥，0600）
│   └── wrapper.sh       #   launchd 启动 wrapper（0700）
├── inbox/               # 链接收藏归档（独立 git 仓库 + VitePress 站点）
└── workspace/           # Pi 会话工作区

macOS LaunchAgent:
~/Library/LaunchAgents/ai.myos.gateway.plist

Linux systemd:
~/.config/systemd/user/myos-gateway.service
```

### 日志与排查

两层日志，各司其职：

- **`~/.myos/logs/myos.log`** — 人读的文本日志（stdout/stderr）。
- **`~/.myos/logs/myos-<日期>.jsonl`** — 机器可查的结构化事件日志，每行一个 JSON。关键事件：`startup` / `shutdown` / `fatal`、`message_received` / `reply_sent`（含 `durationMs`）、`agent_error`、`command`、`wechat_poll_error`、`wechat_login_success`、`pi_session_created` / `pi_session_disposed`、`pi_run_timeout`。消息内容只记录前 200 字符预览。

常用查询：

```bash
# 今天所有错误
jq 'select(.event | test("error|fatal|timeout"))' ~/.myos/logs/myos-$(date +%F).jsonl

# 回复耗时统计
jq 'select(.event=="reply_sent") | .durationMs' ~/.myos/logs/myos-*.jsonl

# 某个用户的完整往来
jq 'select(.userId=="wxid_xxx")' ~/.myos/logs/myos-*.jsonl
```

**对话级回溯**：每个 Pi 会话的完整过程（用户消息、模型回复、每次工具调用及结果、压缩摘要）自动持久化在 `~/.myos/pi/sessions/*.jsonl`，配合事件日志里的 `pi_session_created`（含 `sessionId` 与 `workDir`）定位到具体会话文件。

## 项目结构

```
myos/
├── src/
│   ├── index.ts                  # 入口：加载配置、启动 Gateway、daemon 命令分发
│   ├── types.ts                  # 核心接口与配置类型
│   ├── config/                   # 配置校验与环境变量替换
│   │   ├── schema.ts             # zod 校验 schema
│   │   └── env-substitution.ts   # ${VAR} 环境变量替换
│   ├── gateway/server.ts         # Gateway：消息路由、会话解析、生命周期
│   ├── agent/pi-adapter.ts       # Pi Agent 适配器
│   ├── channels/wechat/adapter.ts # 微信适配器
│   ├── session/store.ts          # 文件型会话存储
│   └── daemon/                   # 守护进程模块（参考 OpenClaw 架构）
│       ├── types.ts              # DaemonManager 接口
│       ├── index.ts              # 平台分发（launchd/systemd/pid）
│       ├── launchd.ts            # macOS LaunchAgent plist + launchctl
│       ├── systemd.ts            # Linux systemd user service + systemctl
│       └── pid.ts                # PID 文件 fallback（detached spawn）
├── test/
│   ├── gateway.test.ts
│   ├── pi-adapter.test.ts
│   └── session-store.test.ts
├── package.json
└── tsconfig.json
```

## 扩展

### 新增通道

实现 `ChannelAdapter` 接口并在 Gateway 中注册。

### 替换 Agent 运行时

实现 `AgentAdapter` 接口即可，Gateway 不依赖具体 Agent 实现。

## 技术栈

| 层 | 选型 |
|---|---|
| 语言 | TypeScript 5.7 (strict, ESM) |
| 运行时 | Node.js 22+ |
| Agent SDK | `@earendil-works/pi-coding-agent` |
| 测试 | Vitest 4 |
