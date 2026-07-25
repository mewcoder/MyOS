/** WeChat channel adapter — connects via iLink Bot API (long-polling). */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ChannelAdapter, MessageEvent, AgentResponse } from "../../types.js";

// ─── iLink Bot API types ───────────────────────────────────────────

interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  message_type?: number; // 1=USER, 2=BOT
  message_state?: number; // 0=NEW, 1=GENERATING, 2=FINISH
  item_list?: MessageItem[];
  context_token?: string;
}

interface MessageItem {
  type?: number; // 1=TEXT, 2=IMAGE, 3=VOICE, 4=FILE, 5=VIDEO
  text_item?: { text: string };
  image_item?: { cdn_media?: CdnMedia };
  voice_item?: { cdn_media?: CdnMedia; silk_text?: string };
  file_item?: { cdn_media?: CdnMedia; file_name?: string };
  video_item?: { cdn_media?: CdnMedia };
}

interface CdnMedia {
  aes_key?: string;
  encrypt_query_param?: string;
  encrypt_type?: number;
}

interface GetUpdatesResponse {
  ret?: number;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

interface SendMessageRequest {
  msg: WeixinMessage;
}

// ─── WeChat Adapter ────────────────────────────────────────────────

export interface WeChatConfig {
  baseUrl?: string;
  cdnBaseUrl?: string;
  token: string;
  botAgent?: string;
  replyProgressMessages?: boolean;
}

export class WeChatAdapter implements ChannelAdapter {
  readonly name = "wechat";

  private baseUrl: string;
  private cdnBaseUrl: string;
  private token: string;
  private botAgent: string;
  private abortController: AbortController | null = null;
  private contextTokens = new Map<string, string>(); // userId → contextToken
  private syncBuf = "";
  private syncFilePath: string;
  private dataDir: string;

  constructor(config: WeChatConfig, dataDir: string) {
    this.baseUrl = config.baseUrl ?? "https://ilinkai.weixin.qq.com";
    this.cdnBaseUrl = config.cdnBaseUrl ?? "https://novac2c.cdn.weixin.qq.com/c2c";
    this.token = config.token;
    this.botAgent = config.botAgent ?? "MyOS/0.1";
    this.dataDir = dataDir;
    this.syncFilePath = join(dataDir, "wechat-sync.json");
  }

  async start(onMessage: (event: MessageEvent) => void): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await this.loadSyncBuf();
    await this.loadContextTokens();

    this.abortController = new AbortController();
    this.poll(onMessage);
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    await this.saveSyncBuf();
    await this.saveContextTokens();
  }

  async send(userId: string, response: AgentResponse): Promise<void> {
    const contextToken = this.contextTokens.get(userId);
    const msg: WeixinMessage = {
      from_user_id: "",
      to_user_id: userId,
      client_id: randomUUID(),
      message_type: 2, // BOT
      message_state: 2, // FINISH
      item_list: [{ type: 1, text_item: { text: response.text } }],
    };
    if (contextToken) msg.context_token = contextToken;

    await this.apiCall("ilink/bot/sendmessage", { msg } as SendMessageRequest);
  }

  async sendTyping(userId: string): Promise<void> {
    try {
      await this.apiCall("ilink/bot/sendtyping", {
        to_user_id: userId,
      });
    } catch {
      // Best-effort — typing indicators are non-critical
    }
  }

  // ─── Long-poll loop ──────────────────────────────────────────────

  private async poll(onMessage: (event: MessageEvent) => void): Promise<void> {
    const signal = this.abortController?.signal;
    if (!signal) return;

    while (!signal.aborted) {
      try {
        const resp = await this.apiCall("ilink/bot/getupdates", {
          get_updates_buf: this.syncBuf,
          base_info: {
            channel_version: 1,
            bot_agent: this.botAgent,
          },
          timeoutMs: 35_000,
        }) as GetUpdatesResponse;

        if (resp.msgs) {
          for (const msg of resp.msgs) {
            if (msg.message_type === 1 && msg.message_state === 0) {
              // Only process NEW USER messages
              const event = this.toMessageEvent(msg);
              if (event) {
                // Store context token for outbound echo
                if (msg.context_token && msg.from_user_id) {
                  this.contextTokens.set(msg.from_user_id, msg.context_token);
                }
                onMessage(event);
              }
            }
          }
        }

        // Persist sync cursor
        if (resp.get_updates_buf) {
          this.syncBuf = resp.get_updates_buf;
          await this.saveSyncBuf();
        }
      } catch (err) {
        if (signal.aborted) break;
        process.stderr.write(`[wechat] poll error: ${err}\n`);
        // Backoff on error
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  }

  private toMessageEvent(msg: WeixinMessage): MessageEvent | null {
    const userId = msg.from_user_id;
    if (!userId) return null;

    // Extract text from item_list
    let content = "";
    if (msg.item_list) {
      for (const item of msg.item_list) {
        if (item.type === 1 && item.text_item) {
          content += item.text_item.text;
        }
        // TODO: handle media items (image, voice, file, video) — download from CDN
      }
    }

    if (!content.trim()) return null;

    return {
      id: randomUUID(),
      channel: "wechat",
      userId,
      content: content.trim(),
      timestamp: msg.create_time_ms ?? Date.now(),
    };
  }

  // ─── API client ──────────────────────────────────────────────────

  private async apiCall(path: string, body: unknown): Promise<unknown> {
    const url = `${this.baseUrl}/${path}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
        AuthorizationType: "ilink_bot_token",
        "iLink-App-Id": "bot",
      },
      body: JSON.stringify(body),
      signal: this.abortController?.signal,
    });

    if (!resp.ok) {
      throw new Error(`WeChat API ${path} returned ${resp.status}`);
    }

    return resp.json();
  }

  // ─── Persistence ─────────────────────────────────────────────────

  private async loadSyncBuf(): Promise<void> {
    try {
      const data = await readFile(this.syncFilePath, "utf8");
      const parsed = JSON.parse(data);
      this.syncBuf = parsed.syncBuf ?? "";
    } catch {
      this.syncBuf = "";
    }
  }

  private async saveSyncBuf(): Promise<void> {
    await writeFile(this.syncFilePath, JSON.stringify({ syncBuf: this.syncBuf }), "utf8");
  }

  private async loadContextTokens(): Promise<void> {
    try {
      const data = await readFile(join(this.dataDir, "context-tokens.json"), "utf8");
      const parsed = JSON.parse(data) as Record<string, string>;
      for (const [k, v] of Object.entries(parsed)) {
        this.contextTokens.set(k, v);
      }
    } catch {
      // Start empty
    }
  }

  private async saveContextTokens(): Promise<void> {
    const obj: Record<string, string> = {};
    for (const [k, v] of this.contextTokens) {
      obj[k] = v;
    }
    await writeFile(join(this.dataDir, "context-tokens.json"), JSON.stringify(obj), "utf8");
  }
}
