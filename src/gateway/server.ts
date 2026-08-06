/** MyOS Gateway — message routing, session resolution, and lifecycle management. */

import type {
  ChannelAdapter,
  AgentAdapter,
  MessageEvent,
  AgentResponse,
  GatewayConfig,
} from "../types.js";
import { SessionStore } from "../session/store.js";
import { PiAdapter } from "../agent/pi-adapter.js";
import { WeChatAdapter, type WeChatConfig } from "../channels/wechat/adapter.js";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { logger, preview } from "../log.js";
import { SESSION_STORE_DIR, WORKSPACE_DIR, channelDataDir } from "../paths.js";
import { InboxService, parseCapture } from "../inbox/service.js";

/** Expand a leading `~` to the user's home directory. */
function expandHome(path: string | undefined): string | undefined {
  if (!path) return path;
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

export class Gateway {
  private channels = new Map<string, ChannelAdapter>();
  private agent: AgentAdapter;
  private sessions: SessionStore;
  private config: GatewayConfig;
  private running = false;
  private queues = new Map<string, Promise<void>>(); // key: `${channel}:${userId}`
  private inbox: InboxService;

  private constructor(
    config: GatewayConfig,
    agent: AgentAdapter,
    sessions: SessionStore,
  ) {
    this.config = config;
    this.agent = agent;
    this.sessions = sessions;
    this.inbox = new InboxService({
      providers: config.agent.providers,
      defaultModel: config.agent.defaultModel,
    });
  }

  static async create(config: GatewayConfig): Promise<Gateway> {
    const sessionDir = expandHome(config.session.dir) ?? SESSION_STORE_DIR;
    const sessions = await SessionStore.create(sessionDir);

    const workspaceDir = expandHome(config.agent.workspaceDir) ?? WORKSPACE_DIR;
    await mkdir(workspaceDir, { recursive: true });

    const agent = new PiAdapter({
      providers: config.agent.providers,
      defaultModel: config.agent.defaultModel,
      workspaceDir,
      thinkingLevel: config.agent.thinkingLevel,
      skillDir: expandHome(config.agent.skillDir),
    });

    const gateway = new Gateway(config, agent, sessions);

    // Register configured channels
    for (const channelConfig of config.channels) {
      if (!channelConfig.enabled) continue;
      const adapter = gateway.createChannelAdapter(channelConfig);
      if (adapter) {
        gateway.channels.set(adapter.name, adapter);
      }
    }

    return gateway;
  }

  /** Start all channels and begin processing messages. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    const startPromises: Promise<void>[] = [];
    for (const [name, channel] of this.channels) {
      process.stdout.write(`[gateway] starting channel: ${name}\n`);
      startPromises.push(
        channel.start((event) => this.handleMessage(event, channel)),
      );
    }

    await Promise.all(startPromises);
    process.stdout.write(`[gateway] all channels started\n`);
    logger.log("gateway_started", { channels: [...this.channels.keys()] });
  }

  /** Stop all channels and shut down the agent. */
  async stop(): Promise<void> {
    this.running = false;
    for (const [name, channel] of this.channels) {
      process.stdout.write(`[gateway] stopping channel: ${name}\n`);
      await channel.stop();
    }
    if (this.agent instanceof PiAdapter) {
      await this.agent.shutdown();
    }
    process.stdout.write(`[gateway] stopped\n`);
    logger.log("gateway_stopped");
  }

  // ─── Core message handling ───────────────────────────────────────

  /** Serialize message processing per channel:user — concurrent prompts to the
   *  same Pi session would interleave their streamed responses.
   *
   *  Control commands bypass the queue so /stop can act while the agent is
   *  busy. /save is translated to $fav and deliberately re-enters the queue. */
  private handleMessage(event: MessageEvent, channel: ChannelAdapter): Promise<void> {
    if (event.content.startsWith("/")) {
      return this.handleCommand(event, channel).catch((err) => {
        process.stderr.write(`[gateway] command error: ${err}\n`);
      });
    }

    return this.queueAgentMessage(event, channel);
  }

  /** Serialize an ordinary or fav-translated message through its Pi session. */
  private queueAgentMessage(event: MessageEvent, channel: ChannelAdapter): Promise<void> {
    const key = `${event.channel}:${event.userId}`;
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev
      .then(() => this.processMessage(event, channel))
      .catch((err) => {
        process.stderr.write(`[gateway] message handling error: ${err}\n`);
        logger.log("message_handling_error", {
          channel: event.channel,
          userId: event.userId,
          msgId: event.id,
          error: String(err),
        });
      });
    this.queues.set(key, next);
    next.finally(() => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    });
    return next;
  }

  private async processMessage(event: MessageEvent, channel: ChannelAdapter): Promise<void> {
    process.stdout.write(`[gateway] ${event.channel}:${event.userId} → ${event.content.slice(0, 80)}\n`);
    logger.log("message_received", {
      channel: event.channel,
      userId: event.userId,
      msgId: event.id,
      chars: event.content.length,
      preview: preview(event.content),
    });

    // 1. Resolve session
    const session = await this.sessions.getOrCreate(event.channel, event.userId);

    // 2. Send typing indicator — awaited so it can't land AFTER the final
    //    reply and leave a stuck "typing…" state (it's best-effort inside)
    if (channel.sendTyping) {
      await channel.sendTyping(event.userId).catch(() => {});
    }

    // 3. Build system prompt suffix with channel context
    const systemPromptSuffix = this.buildSystemPromptSuffix(event);

    // 4. Run through agent
    const startedAt = Date.now();
    try {
      const response = await this.agent.run({
        sessionId: session.agentSessionId,
        message: event.content,
        systemPromptSuffix,
      });

      // 5. Send response back through channel
      await channel.send(event.userId, response);
      process.stdout.write(`[gateway] ${event.channel}:${event.userId} ← ${response.text.slice(0, 80)}\n`);
      logger.log("reply_sent", {
        channel: event.channel,
        userId: event.userId,
        msgId: event.id,
        sessionId: session.agentSessionId,
        durationMs: Date.now() - startedAt,
        chars: response.text.length,
        preview: preview(response.text),
      });
    } catch (err) {
      process.stderr.write(`[gateway] agent error: ${err}\n`);
      logger.log("agent_error", {
        channel: event.channel,
        userId: event.userId,
        msgId: event.id,
        sessionId: session.agentSessionId,
        durationMs: Date.now() - startedAt,
        error: String(err),
      });
      await channel.send(event.userId, {
        text: "抱歉，处理消息时出错了。请稍后重试。",
      });
    }
  }

  // ─── Slash commands ──────────────────────────────────────────────

  private static readonly HELP_TEXT = [
    "可用命令：",
    "/help — 显示本帮助",
    "/new — 重置会话，清空上下文重新开始（同 /reset）",
    "/stop — 中断当前正在执行的任务",
    "/status — 查看会话状态",
    "/save <链接> — 通过 fav 收藏到本地 MyFav",
    "/inbox — 查看收藏统计与最近条目",
    "",
    "直接发链接会交给 fav；其他消息发给 AI 助手。",
  ].join("\n");

  private async handleCommand(event: MessageEvent, channel: ChannelAdapter): Promise<void> {
    const command = event.content.slice(1).trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
    process.stdout.write(`[gateway] ${event.channel}:${event.userId} → command /${command}\n`);
    logger.log("command", { channel: event.channel, userId: event.userId, command });

    const reply = async (text: string) => {
      await channel.send(event.userId, { text });
    };

    switch (command) {
      case "help":
        await reply(Gateway.HELP_TEXT);
        return;

      case "new":
      case "reset": {
        const existing = this.sessions.get(event.channel, event.userId);
        if (existing && this.agent.disposeSession) {
          await this.agent.disposeSession(existing.agentSessionId);
        }
        await this.sessions.reset(event.channel, event.userId);
        await reply("✅ 会话已重置，上下文已清空。");
        return;
      }

      case "stop": {
        const existing = this.sessions.get(event.channel, event.userId);
        if (existing && this.agent.isRunning(existing.agentSessionId)) {
          this.agent.abort(existing.agentSessionId);
          await reply("⏹ 已请求中断当前任务。");
        } else {
          await reply("当前没有正在运行的任务。");
        }
        return;
      }

      case "status": {
        const existing = this.sessions.get(event.channel, event.userId);
        if (!existing) {
          await reply(`模型: ${this.config.agent.defaultModel}\n会话: 尚未创建（发送任意消息开始）`);
          return;
        }
        const running = this.agent.isRunning(existing.agentSessionId);
        const created = new Date(existing.createdAt).toLocaleString("zh-CN");
        await reply(
          [
            `模型: ${this.config.agent.defaultModel}`,
            `会话: ${existing.agentSessionId}`,
            `创建时间: ${created}`,
            `状态: ${running ? "运行中" : "空闲"}`,
          ].join("\n"),
        );
        return;
      }

      case "save": {
        const capture = parseCapture(event.content);
        if (!capture) {
          await reply("用法：/save <链接>");
          return;
        }
        const note = capture.note?.replace(/^\/save\s*/, "").trim();
        await this.queueAgentMessage({
          ...event,
          content: `$fav ${capture.url}${note ? `\n${note}` : ""}`,
        }, channel);
        return;
      }

      case "inbox": {
        const stats = await this.inbox.stats();
        if (stats.total === 0) {
          await reply("旧 Inbox 为空。新收藏请直接发送链接，它会通过 fav 写入 MyFav。");
          return;
        }
        const lines = [
          `📚 旧 Inbox 共 ${stats.total} 篇，本周（${stats.week}）${stats.thisWeek} 篇`,
          "",
          "最近收藏：",
          ...stats.recent.map((i) => `· ${i.title}`),
        ];
        await reply(lines.join("\n"));
        return;
      }

      default:
        await reply(`未知命令 /${command}，发送 /help 查看可用命令。`);
        return;
    }
  }

  private buildSystemPromptSuffix(event: MessageEvent): string {
    return `

You are a personal AI assistant running in MyOS.
The user is messaging you via ${event.channel}.
Respond concisely and helpfully. You have access to file and shell tools.
Your working directory is the user's workspace.
MyOS handles slash commands (/help, /new, /stop, /status) before they reach you —
if the user asks what commands exist, tell them to send /help.`;
  }

  // ─── Channel factory ─────────────────────────────────────────────

  private createChannelAdapter(config: { type: string; [key: string]: unknown }): ChannelAdapter | null {
    const dataDir = channelDataDir(config.type);

    switch (config.type) {
      case "wechat": {
        const wechatConfig = config as unknown as WeChatConfig;
        // Token is optional — QR login will be triggered on start if missing
        return new WeChatAdapter(wechatConfig, dataDir);
      }
      default:
        process.stderr.write(`[gateway] unknown channel type: ${config.type}, skipping\n`);
        return null;
    }
  }
}
