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

export class Gateway {
  private channels = new Map<string, ChannelAdapter>();
  private agent: AgentAdapter;
  private sessions: SessionStore;
  private config: GatewayConfig;
  private running = false;

  private constructor(
    config: GatewayConfig,
    agent: AgentAdapter,
    sessions: SessionStore,
  ) {
    this.config = config;
    this.agent = agent;
    this.sessions = sessions;
  }

  static async create(config: GatewayConfig): Promise<Gateway> {
    const sessionDir = config.session.dir ?? join(homedir(), ".myos", "sessions");
    const sessions = await SessionStore.create(sessionDir);

    const workspaceDir = config.agent.workspaceDir ?? join(homedir(), ".myos", "workspace");
    await mkdir(workspaceDir, { recursive: true });

    const agent = new PiAdapter({
      providers: config.agent.providers,
      defaultModel: config.agent.defaultModel,
      workspaceDir,
      thinkingLevel: config.agent.thinkingLevel,
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
  }

  // ─── Core message handling ───────────────────────────────────────

  private async handleMessage(event: MessageEvent, channel: ChannelAdapter): Promise<void> {
    process.stdout.write(`[gateway] ${event.channel}:${event.userId} → ${event.content.slice(0, 80)}\n`);

    // 1. Resolve session
    const session = await this.sessions.getOrCreate(event.channel, event.userId);

    // 2. Send typing indicator
    if (channel.sendTyping) {
      channel.sendTyping(event.userId).catch(() => {});
    }

    // 3. Build system prompt suffix with channel context
    const systemPromptSuffix = this.buildSystemPromptSuffix(event);

    // 4. Run through agent
    try {
      const response = await this.agent.run({
        sessionId: session.agentSessionId,
        message: event.content,
        systemPromptSuffix,
      });

      // 5. Send response back through channel
      await channel.send(event.userId, response);
      process.stdout.write(`[gateway] ${event.channel}:${event.userId} ← ${response.text.slice(0, 80)}\n`);
    } catch (err) {
      process.stderr.write(`[gateway] agent error: ${err}\n`);
      await channel.send(event.userId, {
        text: "抱歉，处理消息时出错了。请稍后重试。",
      });
    }
  }

  private buildSystemPromptSuffix(event: MessageEvent): string {
    return `

You are a personal AI assistant running in MyOS.
The user is messaging you via ${event.channel}.
Respond concisely and helpfully. You have access to file and shell tools.
Your working directory is the user's workspace.`;
  }

  // ─── Channel factory ─────────────────────────────────────────────

  private createChannelAdapter(config: { type: string; [key: string]: unknown }): ChannelAdapter | null {
    const dataDir = join(homedir(), ".myos", "data", config.type);

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
