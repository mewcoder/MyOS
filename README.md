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
```

### 配置

首次运行会在 `~/.myos/config.json` 自动生成默认配置。编辑该文件填入 API Key：

```jsonc
{
  "channels": [{ "type": "wechat", "enabled": true }],
  "agent": {
    "type": "pi",
    "providers": {
      "xfyun-astron": {
        "baseUrl": "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2",
        "api": "openai-completions",
        "apiKey": "",       // 填入你的 API Key
        "authHeader": true,
        "models": [{
          "id": "astron-code-latest",
          "name": "Astron Code (讯飞)",
          "input": ["text"],
          "contextWindow": 200000,
          "maxTokens": 16384,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }]
      }
    },
    "defaultModel": "xfyun-astron/astron-code-latest",
    "workspaceDir": "~/.myos/workspace"
  },
  "session": { "dir": "~/.myos/sessions" }
}
```

`agent.providers` 直接使用 Pi SDK 的 `models.json` providers 格式，启动时自动写入 `~/.myos/pi/`。如需添加更多 Provider（如 Anthropic、Babel Town），按相同格式添加即可。

### 运行

```bash
npm start
```

启动后在手机微信中扫码，登录成功后即可在微信中与 Agent 对话。按 `Ctrl+C` 优雅关闭。

## 运行时目录

```
~/.myos/
├── config.json          # 主配置
├── pi/
│   ├── models.json      # Pi 模型配置（从 config.json 自动生成）
│   └── auth.json        # Pi 认证信息（从 config.json 自动生成）
├── data/wechat/         # 微信运行时数据（登录态、同步游标等）
├── sessions/            # 会话映射
└── workspace/           # Pi 会话工作区
```

## 项目结构

```
myos/
├── src/
│   ├── index.ts                  # 入口：加载配置、启动 Gateway
│   ├── types.ts                  # 核心接口与配置类型
│   ├── gateway/server.ts         # Gateway：消息路由、会话解析、生命周期
│   ├── agent/pi-adapter.ts       # Pi Agent 适配器
│   ├── channels/wechat/adapter.ts # 微信适配器
│   └── session/store.ts          # 文件型会话存储
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
