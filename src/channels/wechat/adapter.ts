/** WeChat channel adapter — connects via iLink Bot API (long-polling) with QR code login. */

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import qrcode from "qrcode-terminal";
import { logger } from "../../log.js";
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

interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

interface QRStatusResponse {
  status: "wait" | "scaned" | "confirmed" | "expired" | "scaned_but_redirect" | "need_verifycode" | "verify_code_blocked" | "binded_redirect";
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

// ─── WeChat Adapter ────────────────────────────────────────────────

export interface WeChatConfig {
  baseUrl?: string;
  cdnBaseUrl?: string;
  /** Bot token — if not set, QR login will be triggered on start. */
  token?: string;
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
  private tokenFilePath: string;
  private dataDir: string;
  private processedMsgIds = new Set<number>(); // dedup by message_id

  constructor(config: WeChatConfig, dataDir: string) {
    this.baseUrl = config.baseUrl ?? "https://ilinkai.weixin.qq.com";
    this.cdnBaseUrl = config.cdnBaseUrl ?? "https://novac2c.cdn.weixin.qq.com/c2c";
    this.token = config.token ?? "";
    this.botAgent = config.botAgent ?? "MyOS/0.1";
    this.dataDir = dataDir;
    this.syncFilePath = join(dataDir, "wechat-sync.json");
    this.tokenFilePath = join(dataDir, "bot-token.json");
  }

  // ─── QR Code Login ───────────────────────────────────────────────

  /** Interactive QR code login — displays QR in terminal, waits for scan. Auto-refreshes on expiry. */
  async login(): Promise<void> {
    const MAX_ATTEMPTS = 5;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      process.stdout.write(`\n[wechat] 正在获取二维码... (第 ${attempt}/${MAX_ATTEMPTS} 次)\n\n`);

      // Step 1: Get QR code
      const qrResponse = await this.fetchQRCode();

      // Step 2: Display QR code in terminal
      const qrUrl = qrResponse.qrcode_img_content;
      if (qrUrl) {
        qrcode.generate(qrUrl, { small: true });
        process.stdout.write(`\n请用手机微信扫描上方二维码\n`);
        process.stdout.write(`如无法扫描，可访问: ${qrUrl}\n\n`);
      } else {
        process.stdout.write(`[wechat] 未能获取二维码链接\n`);
        continue;
      }

      // Step 3: Poll for scan status
      const result = await this.waitForScan(qrResponse.qrcode);

      if (result.bot_token) {
        this.token = result.bot_token;
        await this.saveToken();
        process.stdout.write(`[wechat] 登录成功！token 已保存\n`);
        logger.log("wechat_login_success", { userId: result.ilink_user_id });
        if (result.ilink_user_id) {
          process.stdout.write(`[wechat] 绑定用户: ${result.ilink_user_id}\n`);
        }
        return;
      }

      if (result.status === "expired") {
        process.stdout.write(`[wechat] 二维码已过期，正在刷新...\n`);
        continue;
      }

      // Other failure
      process.stdout.write(`[wechat] 登录状态: ${result.status}\n`);
      continue;
    }

    throw new Error("[wechat] 登录未完成，已达到最大重试次数");
  }

  private async fetchQRCode(): Promise<QRCodeResponse> {
    const url = `${this.baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ local_token_list: this.token ? [this.token] : [] }),
    });
    if (!resp.ok) throw new Error(`get_bot_qrcode returned ${resp.status}`);
    return resp.json() as Promise<QRCodeResponse>;
  }

  private async waitForScan(qrcodeKey: string, timeoutMs = 120_000): Promise<QRStatusResponse> {
    const deadline = Date.now() + timeoutMs;
    let scannedPrinted = false;

    while (Date.now() < deadline) {
      let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcodeKey)}`;
      const url = `${this.baseUrl}/${endpoint}`;

      let statusResp: QRStatusResponse;
      try {
        const resp = await fetch(url, {
          signal: AbortSignal.timeout(35_000),
        });
        if (!resp.ok) throw new Error(`get_qrcode_status returned ${resp.status}`);
        statusResp = await resp.json() as QRStatusResponse;
      } catch {
        // Network error or timeout — keep polling
        await new Promise((r) => setTimeout(r, 3_000));
        continue;
      }

      switch (statusResp.status) {
        case "wait":
          // Still waiting for scan
          break;
        case "scaned":
          if (!scannedPrinted) {
            process.stdout.write(`[wechat] 已扫描，请在手机上确认登录...\n`);
            scannedPrinted = true;
          }
          break;
        case "confirmed":
        case "binded_redirect":
          return statusResp;
        case "expired":
          process.stdout.write(`[wechat] 二维码已过期\n`);
          return statusResp;
        default:
          process.stdout.write(`[wechat] 登录状态: ${statusResp.status}\n`);
          break;
      }

      // Poll interval
      await new Promise((r) => setTimeout(r, 3_000));
    }

    return { status: "expired" };
  }

  // ─── Channel lifecycle ───────────────────────────────────────────

  async start(onMessage: (event: MessageEvent) => void | Promise<void>): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });

    // Load persisted token if not in config
    if (!this.token) {
      await this.loadToken();
    }

    // If still no token, trigger QR login — but only when someone can actually
    // scan the QR code. In a daemon (stdout is a log file) this would print QR
    // codes nobody sees, block ~10 minutes, throw, and crash-loop under
    // launchd/systemd KeepAlive.
    if (!this.token) {
      if (!process.stdout.isTTY) {
        throw new Error(
          "[wechat] 未登录（无 bot token）且当前为非交互环境 — 请先在终端运行 'myos --login' 扫码登录",
        );
      }
      await this.login();
      if (!this.token) {
        throw new Error("[wechat] 登录未完成，无法启动");
      }
    }

    await this.loadSyncBuf();
    await this.loadContextTokens();

    // Notify iLink that bot is starting
    await this.notifyStart();

    this.abortController = new AbortController();
    this.poll(onMessage);
  }

  async stop(): Promise<void> {
    this.abortController?.abort();
    this.abortController = null;
    await this.notifyStop();
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

  private async poll(onMessage: (event: MessageEvent) => void | Promise<void>): Promise<void> {
    const signal = this.abortController?.signal;
    if (!signal) return;

    while (!signal.aborted) {
      try {
        const resp = await this.apiCall("ilink/bot/getupdates", {
          get_updates_buf: this.syncBuf,
        }) as GetUpdatesResponse;

        // The API signals errors in-body: HTTP 200 with nonzero ret carries no
        // msgs and no cursor — without this check that would spin a hot loop.
        if (resp.ret) {
          throw new Error(`getupdates returned ret=${resp.ret}`);
        }

        const handled: Promise<void>[] = [];
        if (resp.msgs) {
          for (const msg of resp.msgs) {
            // Process USER messages (type=1) — both NEW (state=0) and FINISH (state=2).
            // The iLink API may deliver messages with state=2 on first poll, so we can't
            // rely on state=0 alone. Dedup by message_id prevents duplicate replies.
            if (msg.message_type === 1) {
              const msgId = msg.message_id ?? 0;
              if (msgId && this.processedMsgIds.has(msgId)) {
                continue; // Already processed
              }
              if (msgId) {
                this.processedMsgIds.add(msgId);
                // Prevent unbounded growth — keep last 500 IDs
                if (this.processedMsgIds.size > 500) {
                  const first = this.processedMsgIds.values().next().value;
                  if (first !== undefined) this.processedMsgIds.delete(first);
                }
              }
              const event = this.toMessageEvent(msg);
              if (event) {
                // Store context token for outbound echo
                if (msg.context_token && msg.from_user_id) {
                  this.contextTokens.set(msg.from_user_id, msg.context_token);
                }
                const result = onMessage(event);
                if (result) handled.push(result);
              }
            }
          }
        }

        // Wait for the batch to be fully handled before advancing the cursor —
        // persisting it earlier means a crash mid-processing silently drops
        // the in-flight messages on restart.
        if (handled.length) {
          await Promise.allSettled(handled);
        }

        // Persist sync cursor
        if (resp.get_updates_buf) {
          this.syncBuf = resp.get_updates_buf;
          await this.saveSyncBuf();
        }
      } catch (err) {
        if (signal.aborted) break;
        process.stderr.write(`[wechat] poll error: ${err}\n`);
        logger.log("wechat_poll_error", { error: String(err) });
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
      if (resp.status === 401 || resp.status === 403) {
        throw new Error(
          `WeChat API ${path} returned ${resp.status} — bot token 可能已失效，` +
            `请运行 'myos --login' 重新扫码登录`,
        );
      }
      throw new Error(`WeChat API ${path} returned ${resp.status}`);
    }

    return resp.json();
  }

  // ─── iLink lifecycle notifications ───────────────────────────────

  private async notifyStart(): Promise<void> {
    try {
      await this.apiCall("ilink/bot/msg/notifystart", {});
    } catch {
      // Non-critical
    }
  }

  private async notifyStop(): Promise<void> {
    try {
      await this.apiCall("ilink/bot/msg/notifystop", {});
    } catch {
      // Non-critical
    }
  }

  // ─── Persistence ─────────────────────────────────────────────────

  private async loadToken(): Promise<void> {
    try {
      const data = await readFile(this.tokenFilePath, "utf8");
      const parsed = JSON.parse(data) as { token?: string };
      if (parsed.token) this.token = parsed.token;
    } catch {
      // No saved token
    }
  }

  private async saveToken(): Promise<void> {
    // The token is the bot's sole bearer credential — owner-only
    await writeFile(this.tokenFilePath, JSON.stringify({ token: this.token }, null, 2), { mode: 0o600 });
    await chmod(this.tokenFilePath, 0o600).catch(() => {});
  }

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
