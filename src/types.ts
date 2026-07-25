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
  type: "image" | "file" | "voice" | "video";
  filename: string;
  data: Buffer;
  mimeType?: string;
}

/** A response from the Agent Runtime back to the Gateway. */
export interface AgentResponse {
  text: string;
  attachments?: OutboundAttachment[];
}

export interface OutboundAttachment {
  type: "image" | "file";
  filename: string;
  data: Buffer;
  mimeType?: string;
}

/** Channel adapter interface — each channel (WeChat, Telegram, etc.) implements this. */
export interface ChannelAdapter {
  readonly name: string;

  /** Start listening for inbound messages. Calls `onMessage` for each. */
  start(onMessage: (event: MessageEvent) => void): Promise<void>;

  /** Stop listening. */
  stop(): Promise<void>;

  /** Send a response back through this channel to a specific user. */
  send(userId: string, response: AgentResponse): Promise<void>;

  /** Send a typing indicator (best-effort). */
  sendTyping?(userId: string): Promise<void>;
}

/** Agent Runtime adapter interface — Pi implements this. */
export interface AgentAdapter {
  /** Run a message through the agent, returning the full response. */
  run(request: AgentRequest): Promise<AgentResponse>;

  /** Abort the current run for a session. */
  abort(sessionId: string): void;

  /** Check if a session has an active run. */
  isRunning(sessionId: string): boolean;
}

export interface AgentRequest {
  sessionId: string;
  message: string;
  /** Channel-specific context injected into the system prompt. */
  systemPromptSuffix?: string;
  /** Working directory for the agent. */
  cwd?: string;
}

/** Session record — maps a channel user to a Pi session. */
export interface Session {
  id: string;
  channel: string;
  userId: string;
  piSessionId: string;
  createdAt: number;
  lastActiveAt: number;
}

/** Gateway configuration. */
export interface GatewayConfig {
  channels: ChannelConfig[];
  agent: AgentConfig;
  session: SessionConfig;
}

export interface ChannelConfig {
  type: string;
  enabled: boolean;
  [key: string]: unknown;
}

export interface AgentConfig {
  type: "pi";
  /** LLM provider name (e.g. "xfyun-astron"). */
  provider?: string;
  /** LLM model ID (e.g. "astron-code-latest"). */
  model?: string;
  /** Working directory for agent sessions. */
  workspaceDir?: string;
  /** Custom PI_CODING_AGENT_DIR for models.json/auth.json. */
  piDir?: string;
  /** Thinking level: off, minimal, low, medium, high, xhigh, max. */
  thinkingLevel?: string;
}

export interface SessionConfig {
  /** Directory for session persistence. Defaults to ~/.myos/sessions. */
  dir?: string;
}
