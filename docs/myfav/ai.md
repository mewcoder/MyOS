# MyFav 浏览器 AI 设计

> 状态：第一版，待安全边界与交互确认
>
> 范围：OpenAI-compatible 配置、JSON 数据问答、文章 Markdown 问答与总结
> 非范围：服务端代理、共享密钥、embeddings、向量数据库、Responses API

## 1. 目标与边界

MyFav 保持 GitHub Pages 纯静态站。AI 是可选的浏览器端增强，使用访问者自己提供的 API 配置（BYOK）。

```text
用户选择一个数据范围
  sites.json / repos.json / articles.json
                    │ 完整 JSON 上下文
                    ├──────────────────────┐
                    │                      │
                    │              文章详情页
                    │              当前文章 Markdown
                    │                      │
                    ▼                      ▼
       OpenAI-compatible Chat Completions
                    │
                    ▼
            数据问答 / 文章问答与总结
```

- 没有 API 配置时，网站、关键词搜索、文章阅读和 GitHub Issues 笔记不受影响。
- MyFav 仓库、构建产物和 GitHub Pages 环境中不得出现 API Key。
- 浏览器直接请求第三方 API；提供方必须允许 GitHub Pages 来源的 CORS。
- AI 数据问答一次只使用三个 JSON 中的一个，不跨数据源混合上下文。
- 文章详情的 AI 只使用当前文章 Markdown；文章标题等元信息仅用于标识上下文。

## 2. API 兼容契约

只支持经典 OpenAI Chat Completions 请求格式：

```http
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}
Content-Type: application/json
```

```json
{
  "model": "user-configured-model",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "stream": true
}
```

兼容层只依赖：

- 请求字段：`model`、`messages`，可选 `stream`。
- 非流式响应：`choices[0].message.content`。
- 流式响应：SSE 中的 `choices[0].delta.content`。
- 认证方式：`Authorization: Bearer`。

不依赖 `tools`、`response_format`、`reasoning_effort`、`embeddings` 或供应商扩展字段。`baseUrl` 示例为 `https://api.openai.com/v1`，客户端统一去除末尾 `/` 后追加 `/chat/completions`。

## 3. 配置模型

### 3.1 字段

| 字段 | 必填 | 规则 |
|---|---|---|
| `baseUrl` | 是 | HTTPS URL；本地开发可允许 `http://localhost` |
| `apiKey` | 是 | 密码输入，不回显完整值 |
| `model` | 是 | 自由文本，不维护在线模型清单 |
| `rememberKey` | 否 | 默认关闭；明确选择后才持久保存 |

不提供 provider 列表、温度、top-p、max tokens 等高级参数，避免配置膨胀。

### 3.2 浏览器存储

```text
localStorage
  myfav.ai.baseUrl
  myfav.ai.model
  myfav.ai.rememberKey
  myfav.ai.apiKey          # 仅 rememberKey=true

sessionStorage
  myfav.ai.apiKey          # 默认
  myfav.ai.summary.*       # 当前会话总结缓存
```

- 默认只在当前 tab session 保存 API Key。
- “在此设备保存密钥”必须由用户显式勾选，并显示“任何能读取本页面存储的脚本都可能访问它”的提示。
- 切换为不记住时必须从 `localStorage` 删除旧 key。
- “清除 AI 配置”同时删除 localStorage、sessionStorage 中的配置和总结缓存。
- Key 不写入 URL、console、错误详情、Analytics、Issues 或 DOM data attribute。

纯浏览器应用无法把用户密钥变成真正的服务器秘密。若未来需要共享密钥，必须新增受控后端代理并重新评审部署方案。

## 4. 设置界面

### 4.1 Desktop

```text
┌──────────────────────────────────────────────────────┐
│ AI 设置                                         ×   │
│ 使用你自己的 OpenAI-compatible Chat Completions。   │
│                                                      │
│ API Base URL                                         │
│ [ https://api.openai.com/v1                       ]  │
│                                                      │
│ API Key                                              │
│ [ sk-••••••••••••••••••••                        ]  │
│                                                      │
│ Model                                                │
│ [ model-name                                      ]  │
│                                                      │
│ □ 在此设备保存密钥                                  │
│   密钥将保存在浏览器 localStorage。                  │
│                                                      │
│ [清除配置]             [测试连接]  [保存]            │
└──────────────────────────────────────────────────────┘
```

- 顶栏主题按钮旁增加“AI 设置”图标；不增加新的主导航入口。
- Desktop modal 宽 560 px；mobile 使用全屏设置页，避免键盘挤压 bottom sheet。
- 打开时 focus 落在第一个无效或空字段；关闭后回到触发按钮。
- API Key 已保存时只显示掩码和“替换”状态，不把完整值重新写回 DOM。

### 4.2 状态

| 状态 | 表现 |
|---|---|
| 未配置 | 顶栏图标无状态点；AI 入口引导打开设置 |
| 已配置 | 图标显示小型 accent 状态点，不显示模型常驻文字 |
| 测试中 | 按钮显示“正在连接…”，字段暂时只读 |
| 成功 | 显示“连接成功”，不展示响应正文 |
| 401/403 | “API Key 无效或无权限” |
| 404 | “Base URL 或模型不正确” |
| 429 | “请求过多或额度不足” |
| CORS/network | “浏览器无法访问该接口，请检查 CORS 或网络” |
| timeout | 20 秒后停止并允许重试 |

连接测试使用一次最小 Chat Completions 请求，不依赖 `/models` 接口。

## 5. JSON 数据问答

### 5.1 数据范围与回答

```text
选择范围：网站 / GitHub / 文章
          │
          ▼
读取一个完整 JSON 文件
sites.json / repos.json / articles.json
          │
          ▼
用户问题 + JSON → Chat Completions → 回答
```

- 用户必须选择 `sites.json`、`repos.json` 或 `articles.json` 中的一个；AI 模式不提供“全部”范围。
- 从对应页面进入时默认选择当前类型；首页进入时默认选择 `articles.json`，但允许切换。
- 每次请求把选中的完整 JSON 作为上下文，不做候选召回、跨源拼接或 embeddings。
- JSON 发送前仅做稳定的空白压缩，不删除字段或记录。
- Prompt 明确要求只根据该 JSON 回答；资料不足时说“不足”，不得利用模型记忆补全。
- 请求前显示将发送的文件名、记录数与字符数。
- 若单个 JSON 超过模型上下文限制，明确报错并建议先使用本地关键词搜索；v1 不静默截断。
- 普通关键词搜索继续在浏览器本地运行，不调用 API。

### 5.2 搜索界面

```text
┌──────────────────────────────────────────────────────────────┐
│ 向收藏数据提问…                                       Esc  │
├──────────────────────────────────────────────────────────────┤
│ 数据范围   [网站] [GitHub] [文章]               [询问 AI]  │
│                                                              │
│ AI 回答                                                      │
│ 在 repos.json 中，与 Agent Skill 相关的仓库包括……             │
│                                                              │
│ 本次上下文：repos.json · 136 条 · 42 KB                       │
└──────────────────────────────────────────────────────────────┘
```

- 原有关键词搜索界面和 AI 数据问答使用两个明确模式，关键词搜索仍为默认。
- “询问 AI”是显式提交，不对每个键入字符调用 API。
- 流式答案显示当前 JSON 文件名和范围；用户可随时停止。
- 未配置时点击按钮直接打开 AI 设置，保存后回到当前搜索问题。
- Mobile 使用现有全屏搜索页，数据范围切换和答案单列展示。

## 6. 文章 Markdown 问答与总结

### 6.1 入口与问答

文章头部的原文链接旁增加次要操作“问 AI”。打开后，当前文章 Markdown 是唯一正文上下文。

```text
文章元信息                           [问 AI] [阅读原文 ↗]
────────────────────────────────────────────────────────
文章 AI
[总结这篇文章]                                              quick action

[ 针对当前文章提问…                              ] [发送]

回答
文章的核心观点是……

基于 articles/2026-08/example.md · 仅保存在当前会话
────────────────────────────────────────────────────────
正文
```

- 可以自由提问；每轮请求都带当前文章 Markdown，不读取其他文章或三个 JSON。
- “总结这篇文章”是预设问题，输出一段简短摘要和 3–5 条要点。
- AI 区域位于元信息之后、正文之前，可折叠、清空对话、重新生成和停止。
- 未配置时打开设置；保存后自动恢复本次提问或总结意图。
- 对话只保存在当前页面内存；总结可在 `sessionStorage` 中按文章 path、正文 hash 和 model 缓存。
- 问答与总结都不回写 Markdown、`articles.json.description` 或 GitHub Issues。

### 6.2 长文章

- 从 `articles.json.path` 加载当前 Markdown；清理图片 URL 和重复空白后发送正文。
- 短文在一次请求中完成。
- 超过模型上下文预算时，文章总结可按二级标题分块后合并；自由问答 v1 明确提示文章过长，不静默省略正文。
- 任一总结分块失败时显示部分结果与重试入口，不把不完整内容标记为成功缓存。

## 7. Prompt 边界

### JSON 问答 system prompt

```text
你是 MyFav 私人收藏库的数据问答助手。只使用用户提供的单个 JSON 文件回答。
资料不足时明确说明，不要用外部知识补全。引用链接只能来自 JSON 中已有的 url/path。
```

### 文章问答 system prompt

```text
你是文章阅读助手。只根据当前 Markdown 回答，保留作者原意，不添加正文没有的事实。
当用户要求总结时，输出一个简短摘要和 3–5 条要点。
```

JSON 数据和文章 Markdown 都视为不可信数据，不允许其中的指令覆盖 system prompt。

## 8. 错误、取消与隐私

- 使用 `AbortController` 支持停止 JSON 问答、文章问答、总结和连接测试。
- 同一功能同一时间只允许一个请求；新请求先取消旧请求。
- 页面离开文章时取消正在运行的总结。
- 任何错误 UI 不包含 API Key、完整请求头或完整 prompt。
- 显示模型、JSON 文件名/记录数或 Markdown 路径/字符数，帮助用户理解费用与数据边界。
- 第三方 API 的数据保留策略由用户选择的提供方决定，MyFav 不替其承诺。

## 9. 原型范围

静态设计稿只演示：

- AI 设置 modal / mobile full-screen。
- 未配置、已配置、测试成功和错误文案。
- 选择单个 JSON 后的模拟流式数据问答。
- 文章页模拟自由问答、总结快捷操作、折叠、重新生成和停止。

原型不得发送真实网络请求，也不得要求输入真实 API Key。生产实现需另立任务，并在接线前使用非生产测试 Key 验证 CORS、流式解析和错误映射。

## 10. 验收场景

- 未配置 AI 时，所有原有页面和关键词搜索可正常使用。
- API Key 默认只进入 sessionStorage；勾选记住后才进入 localStorage，取消时删除持久 key。
- JSON 问答每次只发送用户选择的一个完整 JSON；不跨源拼接、不静默截断。
- JSON 回答中的链接只允许使用该 JSON 已有的 `url/path`。
- 文章问答和总结只使用当前 Markdown，不会写回仓库、Issues 或永久数据文件。
- CORS、401、404、429、超时和主动停止均有不同反馈。
- 设置、搜索和总结在 mobile 上可完成，focus 不逃出 modal，关闭后恢复触发点。
