/** Core types for MyOS Gateway — channel-agnostic message protocol. */

/** A message entering the Gateway from any channel. */
export interface MessageEvent {
  id: string;
  channel: string;
  userId: string;
  content: string;
  timestamp: number;
  attachments?: Attachment[];
}

export interface Attachment {
  type: "image" | "voice" | "file" | "video";
  url: string;
  name?: string;
}

/** A response from the Agent Runtime back to the Gateway. */
export interface AgentResponse {
  text: string;
  attachments?: OutboundAttachment[];
}

export interface OutboundAttachment {
  type: "image" | "file";
  url: string;
  name?: string;
}

/** Channel adapter interface — each channel (WeChat, Telegram, etc.) implements this.
 *
 * If `onMessage` returns a promise, the channel may await it before
 * acknowledging/persisting its delivery cursor (at-least-once delivery). */
export interface ChannelAdapter {
  readonly name: string;
  start(onMessage: (event: MessageEvent) => void | Promise<void>): Promise<void>;
  stop(): Promise<void>;
  send(userId: string, response: AgentResponse): Promise<void>;
  sendTyping?(userId: string): Promise<void>;
}

/** Agent Runtime adapter interface — Pi implements this. */
export interface AgentAdapter {
  readonly name: string;
  run(request: AgentRequest): Promise<AgentResponse>;
  abort(sessionId: string): void;
  isRunning(sessionId: string): boolean;
  /** Abort and free a single session's resources (used by /new). */
  disposeSession?(sessionId: string): Promise<void>;
  shutdown(): Promise<void>;
}

export interface AgentRequest {
  sessionId: string;
  message: string;
  cwd?: string;
  systemPromptSuffix?: string;
}

/** Session record — maps a channel user to a Pi session. */
export interface Session {
  id: string;
  channel: string;
  userId: string;
  agentSessionId: string;
  createdAt: number;
  updatedAt: number;
}

/** Gateway configuration. */
export interface GatewayConfig {
  channels: ChannelConfig[];
  agent: AgentConfig;
  session: SessionConfig;
}

export interface ChannelConfig {
  type: string;
  enabled?: boolean;
  [key: string]: unknown;
}

/**
 * Agent configuration.
 *
 * `providers` uses the same structure as Pi's `models.json` providers,
 * so it's written directly to `~/.myos/pi/models.json` at startup.
 * `auth.json` is auto-generated from `providers.*.apiKey`.
 */
export interface AgentConfig {
  type: "pi";
  /** Pi provider definitions — same format as models.json providers. */
  providers: Record<string, PiProviderConfig>;
  /** Default model in "provider/model" format. */
  defaultModel: string;
  /** Working directory for agent sessions. */
  workspaceDir?: string;
  /** Thinking level: off, minimal, low, medium, high, xhigh, max. */
  thinkingLevel?: string;
}

/**
 * Pi provider configuration — mirrors Pi SDK's models.json provider format.
 *
 * @example
 * ```json
 * {
 *   "baseUrl": "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2",
 *   "api": "openai-completions",
 *   "apiKey": "your-api-key",
 *   "authHeader": true,
 *   "models": [{
 *     "id": "astron-code-latest",
 *     "name": "Astron Code (讯飞)",
 *     "input": ["text"],
 *     "contextWindow": 200000,
 *     "maxTokens": 16384,
 *     "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
 *   }]
 * }
 * ```
 */
export interface PiProviderConfig {
  baseUrl: string;
  api?: string;
  apiKey: string;
  authHeader?: boolean;
  compat?: Record<string, unknown>;
  models: PiModelConfig[];
  [key: string]: unknown;
}

/** Pi model definition — mirrors Pi SDK's models.json model format. */
export interface PiModelConfig {
  id: string;
  name?: string;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  [key: string]: unknown;
}

export interface SessionConfig {
  /** Directory for session persistence. Defaults to ~/.myos/sessions. */
  dir?: string;
}
