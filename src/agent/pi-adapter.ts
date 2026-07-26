/** Pi Agent Runtime adapter — uses the Pi SDK with Pi-native provider config. */

import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ResourceLoader,
  resolveCliModel,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../log.js";
import { PI_DIR, PI_SESSIONS_DIR } from "../paths.js";
import type { AgentAdapter, AgentRequest, AgentResponse, PiProviderConfig } from "../types.js";

export interface PiAdapterConfig {
  /** Pi provider definitions — same format as models.json providers. */
  providers: Record<string, PiProviderConfig>;
  /** Default model in "provider/model" format. */
  defaultModel: string;
  /** Working directory for agent sessions. */
  workspaceDir: string;
  /** Thinking level: off, minimal, low, medium, high, xhigh, max. */
  thinkingLevel?: string;
}


export class PiAdapter implements AgentAdapter {
  readonly name = "pi";

  private modelRuntime!: ModelRuntime;
  private sessions = new Map<string, AgentSession>();
  private sessionCreations = new Map<string, Promise<AgentSession>>();
  private running = new Set<string>();
  private config: PiAdapterConfig;
  private initPromise: Promise<void> | null = null;
  constructor(config: PiAdapterConfig) {
    this.config = config;
  }

  /** Initialize ModelRuntime — must be called before run().
   *  Concurrent callers share one initialization. */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit().catch((err) => {
        this.initPromise = null; // allow retry after failure
        throw err;
      });
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    // Write models.json + auth.json to ~/.myos/pi/ (0700 — files hold API keys)
    await mkdir(PI_DIR, { recursive: true, mode: 0o700 });
    await this.writeProviderFiles(PI_DIR);

    this.modelRuntime = await ModelRuntime.create({
      authPath: join(PI_DIR, "auth.json"),
      modelsPath: join(PI_DIR, "models.json"),
    });
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    await this.init();

    let session: AgentSession;
    try {
      session = await this.getOrCreateSession(request.sessionId, request.cwd, request.systemPromptSuffix);
    } catch (err) {
      process.stderr.write(`[pi] session creation error: ${err}\n`);
      return { text: "[error — failed to create session]" };
    }

    this.running.add(request.sessionId);

    try {
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

  /** Abort and free a single session (used by /new). Abort is awaited first so
   *  an in-flight collectResponse settles via agent_settled before dispose
   *  tears down the event emitter. */
  async disposeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    this.running.delete(sessionId);
    if (!session) return;
    try {
      await session.abort();
    } catch {
      // Best-effort — dispose regardless
    }
    session.dispose();
    logger.log("pi_session_disposed", { sessionId });
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId);
  }

  async shutdown(): Promise<void> {
    for (const [, session] of this.sessions) {
      session.dispose();
    }
    this.sessions.clear();
    this.running.clear();
  }

  // ─── Private ─────────────────────────────────────────────────────

  /** Write models.json and auth.json from config providers. */
  private async writeProviderFiles(dir: string): Promise<void> {
    const modelsJson = { providers: this.config.providers };

    // Build auth.json: extract apiKey from each provider
    const authJson: Record<string, { type: string; key: string }> = {};
    for (const [providerId, provider] of Object.entries(this.config.providers)) {
      authJson[providerId] = { type: "api_key", key: provider.apiKey };
    }

    // Both files contain the API key (providers embed apiKey) — restrict to owner
    const mode = 0o600;
    await writeFile(join(dir, "models.json"), JSON.stringify(modelsJson, null, 2), { mode });
    await writeFile(join(dir, "auth.json"), JSON.stringify(authJson, null, 2), { mode });
    await chmod(join(dir, "models.json"), mode).catch(() => {});
    await chmod(join(dir, "auth.json"), mode).catch(() => {});
  }

  private getOrCreateSession(
    sessionId: string,
    cwd?: string,
    systemPromptSuffix?: string,
  ): Promise<AgentSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return Promise.resolve(existing);

    // Dedup concurrent creations for the same sessionId — a check-then-act
    // race here would produce two live AgentSessions for one conversation
    const pending = this.sessionCreations.get(sessionId);
    if (pending) return pending;

    const creation = this.createSession(sessionId, cwd, systemPromptSuffix).finally(() => {
      this.sessionCreations.delete(sessionId);
    });
    this.sessionCreations.set(sessionId, creation);
    return creation;
  }

  private async createSession(
    sessionId: string,
    cwd?: string,
    systemPromptSuffix?: string,
  ): Promise<AgentSession> {
    const workDir = cwd ?? join(this.config.workspaceDir, sessionId);
    await mkdir(workDir, { recursive: true });

    const model = this.resolveModel();

    const systemPrompt = `You are a personal AI assistant running in MyOS.
You have access to file and shell tools (read, bash, edit, write, grep, find, ls).
Respond concisely and helpfully. Your working directory is the user's workspace.
${systemPromptSuffix ?? ""}`;

    const resourceLoader: ResourceLoader = {
      getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
      getSkills: () => ({ skills: [], diagnostics: [] }),
      getPrompts: () => ({ prompts: [], diagnostics: [] }),
      getThemes: () => ({ themes: [], diagnostics: [] }),
      getAgentsFiles: () => ({ agentsFiles: [] }),
      getSystemPrompt: () => systemPrompt,
      getAppendSystemPrompt: () => [],
      extendResources: () => {},
      reload: async () => {},
    };

    // Persisted (not inMemory): the full transcript — messages, tool calls,
    // compaction summaries — lands as JSONL under ~/.myos/pi/sessions for
    // post-hoc tracing and debugging
    const sessionManager = SessionManager.create(workDir, PI_SESSIONS_DIR);
    const settingsManager = SettingsManager.inMemory({
      // Compaction must stay enabled: sessions live for the lifetime of a
      // channel user, and the SDK handles context overflow via compaction
      // only (overflow is explicitly not retried).
      compaction: { enabled: true },
      retry: { enabled: true, maxRetries: 2 },
    });

    const { session } = await createAgentSession({
      cwd: workDir,
      agentDir: PI_DIR,
      model: model ?? undefined,
      modelRuntime: this.modelRuntime,
      sessionManager,
      settingsManager,
      resourceLoader,
      tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    });

    if (this.config.thinkingLevel) {
      session.setThinkingLevel(this.config.thinkingLevel as Parameters<typeof session.setThinkingLevel>[0]);
    }

    this.sessions.set(sessionId, session);
    logger.log("pi_session_created", { sessionId, workDir });
    return session;
  }

  private resolveModel() {
    const cliModel = resolveCliModel({
      cliModel: this.config.defaultModel,
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
      // Completed assistant texts. Deltas are NOT accumulated: on auto-retry
      // the SDK removes the errored message and regenerates it, which would
      // duplicate partial text. Committing on message_end sidesteps that.
      const parts: string[] = [];
      let lastError: string | undefined;
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      let hardTimer: NodeJS.Timeout | undefined;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(hardTimer);
        unsubscribe();
        fn();
      };

      const finish = () => {
        settle(() => {
          const text = parts.join("\n\n");
          if (!text && lastError) {
            reject(new Error(lastError));
          } else {
            resolve(text);
          }
        });
      };

      const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        switch (event.type) {
          case "message_end": {
            const msg = event.message;
            if (msg.role === "assistant") {
              if (msg.stopReason === "error") {
                // Dropped and regenerated by the SDK on auto-retry — don't commit
                lastError = msg.errorMessage ?? "agent error";
              } else {
                for (const block of msg.content) {
                  if (block.type === "text" && block.text.trim()) {
                    parts.push(block.text);
                  }
                }
              }
            }
            break;
          }

          case "agent_settled":
            // Fires exactly once when the run FULLY settles — after auto-retries
            // and compaction continuations. Only now is the session idle, so
            // resolving here guarantees the next queued prompt won't hit
            // "Agent is already processing".
            finish();
            break;
        }
      });

      // followUp: belt-and-braces — should the session somehow still be
      // streaming (e.g. after a hard-timeout force-settle), the SDK queues
      // the message instead of throwing "Agent is already processing"
      session.prompt(message, { streamingBehavior: "followUp" }).catch((err: unknown) => {
        // agent_settled fires from the SDK's finally before this rejection
        // lands; this only settles pre-run failures
        lastError = lastError ?? String(err);
        finish();
      });

      // Safety timeout: abort and let agent_settled deliver what we have.
      // The hard timer only fires if even abort can't settle the run.
      timer = setTimeout(() => {
        logger.log("pi_run_timeout", { preview: message.slice(0, 80) });
        session.abort().catch(() => {});
        hardTimer = setTimeout(() => {
          settle(() => resolve(parts.join("\n\n") || "[timeout — no response]"));
        }, 15_000);
      }, 300_000);
    });
  }
}
