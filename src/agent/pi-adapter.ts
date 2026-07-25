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
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
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

/** Fixed directory for Pi config files. */
const PI_CONFIG_DIR = join(homedir(), ".myos", "pi");

export class PiAdapter implements AgentAdapter {
  readonly name = "pi";

  private modelRuntime!: ModelRuntime;
  private sessions = new Map<string, AgentSession>();
  private running = new Set<string>();
  private config: PiAdapterConfig;
  private initialized = false;
  constructor(config: PiAdapterConfig) {
    this.config = config;
  }

  /** Initialize ModelRuntime — must be called before run(). */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Write models.json + auth.json to ~/.myos/pi/
    await mkdir(PI_CONFIG_DIR, { recursive: true });
    await this.writeProviderFiles(PI_CONFIG_DIR);

    this.modelRuntime = await ModelRuntime.create({
      authPath: join(PI_CONFIG_DIR, "auth.json"),
      modelsPath: join(PI_CONFIG_DIR, "models.json"),
    });

    this.initialized = true;
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

    await writeFile(join(dir, "models.json"), JSON.stringify(modelsJson, null, 2), "utf8");
    await writeFile(join(dir, "auth.json"), JSON.stringify(authJson, null, 2), "utf8");
  }

  private async getOrCreateSession(
    sessionId: string,
    cwd?: string,
    systemPromptSuffix?: string,
  ): Promise<AgentSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

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

    const sessionManager = SessionManager.inMemory(workDir);
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: true, maxRetries: 2 },
    });

    const { session } = await createAgentSession({
      cwd: workDir,
      agentDir: PI_CONFIG_DIR,
      model: model ?? undefined,
      modelRuntime: this.modelRuntime,
      sessionManager,
      settingsManager,
      resourceLoader,
      tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    });

    this.sessions.set(sessionId, session);
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
