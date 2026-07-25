/** Pi Agent Runtime adapter — uses the Pi SDK (createAgentSession, ModelRuntime). */

import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  DefaultResourceLoader,
  getAgentDir,
  resolveCliModel,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AgentAdapter, AgentRequest, AgentResponse } from "../types.js";

export interface PiAdapterConfig {
  /** Provider name (e.g. "xfyun-astron"). */
  provider?: string;
  /** Model ID (e.g. "astron-code-latest"). */
  model?: string;
  /** Working directory for agent sessions. */
  workspaceDir: string;
  /** Custom PI_CODING_AGENT_DIR for models.json/auth.json. Defaults to ~/.pi/agent. */
  piDir?: string;
  /** Thinking level: off, minimal, low, medium, high, xhigh, max. */
  thinkingLevel?: string;
}

export class PiAdapter implements AgentAdapter {
  readonly name = "pi";

  private modelRuntime!: ModelRuntime;
  private sessions = new Map<string, AgentSession>(); // sessionId → AgentSession
  private running = new Set<string>();
  private config: PiAdapterConfig;
  private initialized = false;

  constructor(config: PiAdapterConfig) {
    this.config = config;
  }

  /** Initialize ModelRuntime — must be called before run(). */
  async init(): Promise<void> {
    if (this.initialized) return;

    const agentDir = this.config.piDir ?? getAgentDir();
    this.modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: join(agentDir, "models.json"),
    });

    this.initialized = true;
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    await this.init();

    const session = await this.getOrCreateSession(request.sessionId, request.cwd, request.systemPromptSuffix);
    this.running.add(request.sessionId);

    try {
      // Collect the full text response from streaming events
      const text = await this.collectResponse(session, request.message);
      return { text: text || "[no response]" };
    } finally {
      this.running.delete(request.sessionId);
    }
  }

  abort(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.abort().catch(() => {});
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId);
  }

  /** Shut down all Pi sessions. */
  async shutdown(): Promise<void> {
    for (const [id, session] of this.sessions) {
      session.dispose();
      this.sessions.delete(id);
    }
    this.running.clear();
  }

  // ─── Private ─────────────────────────────────────────────────────

  private async getOrCreateSession(
    sessionId: string,
    cwd?: string,
    systemPromptSuffix?: string,
  ): Promise<AgentSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const workDir = cwd ?? join(this.config.workspaceDir, sessionId);
    await mkdir(workDir, { recursive: true });

    // Resolve model from provider/model config
    const model = this.resolveModel();

    const agentDir = this.config.piDir ?? getAgentDir();
    const loader = new DefaultResourceLoader({
      cwd: workDir,
      agentDir,
      systemPromptOverride: (base: string | undefined) => {
        return (base ?? "") + (systemPromptSuffix ?? "");
      },
    });
    await loader.reload();

    const sessionManager = SessionManager.inMemory(workDir);

    const { session } = await createAgentSession({
      cwd: workDir,
      model: model ?? undefined,
      modelRuntime: this.modelRuntime,
      sessionManager,
      resourceLoader: loader,
      tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  private resolveModel() {
    if (!this.config.provider && !this.config.model) return undefined;

    const cliModel = resolveCliModel({
      cliModel: this.config.provider && this.config.model
        ? `${this.config.provider}/${this.config.model}`
        : this.config.model ?? this.config.provider,
      modelRuntime: this.modelRuntime,
    });

    if (cliModel.error) {
      process.stderr.write(`[pi] model resolution error: ${cliModel.error}\n`);
      return undefined;
    }
    if (cliModel.warning) {
      process.stderr.write(`[pi] model resolution warning: ${cliModel.warning}\n`);
    }

    return cliModel.model;
  }

  private collectResponse(session: AgentSession, message: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let text = "";
      let settled = false;

      const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        if (settled) return;

        switch (event.type) {
          case "message_update":
            if (event.assistantMessageEvent.type === "text_delta") {
              text += event.assistantMessageEvent.delta;
            }
            break;

          case "agent_end":
            settled = true;
            unsubscribe();
            resolve(text);
            break;
        }
      });

      // Send the prompt — it resolves when the full run finishes
      session.prompt(message).catch((err: unknown) => {
        if (!settled) {
          settled = true;
          unsubscribe();
          reject(err);
        }
      });

      // Safety timeout: 5 minutes
      setTimeout(() => {
        if (!settled) {
          settled = true;
          unsubscribe();
          session.abort().catch(() => {});
          resolve(text || "[timeout — no response]");
        }
      }, 300_000);
    });
  }
}
