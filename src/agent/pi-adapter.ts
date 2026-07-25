/** Pi Agent Runtime adapter — communicates with Pi via RPC mode (JSONL over subprocess). */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentAdapter, AgentRequest, AgentResponse } from "../types.js";

interface RpcCommand {
  id: string;
  command: string;
  [key: string]: unknown;
}

interface RpcEvent {
  id?: string;
  type: string;
  [key: string]: unknown;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export class PiAdapter implements AgentAdapter {
  readonly name = "pi";
  private processes = new Map<string, ChildProcess>(); // sessionId → process
  private pending = new Map<string, PendingRequest>(); // requestId → pending
  private buffers = new Map<string, string>(); // sessionId → line buffer
  private eventHandlers = new Map<string, Array<(event: RpcEvent) => void>>();
  private running = new Set<string>(); // sessionIds with active agent runs

  private binary: string;
  private provider?: string;
  private model?: string;
  private workspaceDir: string;
  private piDir?: string;

  constructor(config: {
    binary?: string;
    provider?: string;
    model?: string;
    workspaceDir: string;
    piDir?: string;
  }) {
    this.binary = config.binary ?? "pi";
    this.provider = config.provider;
    this.model = config.model;
    this.workspaceDir = config.workspaceDir;
    this.piDir = config.piDir;
  }

  async run(request: AgentRequest): Promise<AgentResponse> {
    const proc = await this.ensureProcess(request.sessionId, request.cwd, request.systemPromptSuffix);
    this.running.add(request.sessionId);

    try {
      // Send prompt command
      const result = await this.sendCommand(proc, request.sessionId, {
        id: randomUUID(),
        command: "prompt",
        content: request.message,
      });

      // Collect the full text response from events
      return this.collectResponse(request.sessionId);
    } finally {
      this.running.delete(request.sessionId);
    }
  }

  abort(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (!proc) return;

    this.sendCommand(proc, sessionId, {
      id: randomUUID(),
      command: "abort",
    }).catch(() => {});
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId);
  }

  /** Shut down all Pi processes. */
  async shutdown(): Promise<void> {
    for (const [sessionId, proc] of this.processes) {
      proc.kill("SIGTERM");
      this.processes.delete(sessionId);
    }
  }

  private async ensureProcess(
    sessionId: string,
    cwd?: string,
    systemPromptSuffix?: string,
  ): Promise<ChildProcess> {
    const existing = this.processes.get(sessionId);
    if (existing && !existing.killed) return existing;

    const workDir = cwd ?? join(this.workspaceDir, sessionId);
    await mkdir(workDir, { recursive: true });

    const args = ["--mode", "rpc", "--no-session"];
    if (this.provider) args.push("--provider", this.provider);
    if (this.model) args.push("--model", this.model);
    if (systemPromptSuffix) args.push("--append-system-prompt", systemPromptSuffix);

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (this.piDir) env.PI_CODING_AGENT_DIR = this.piDir;

    const proc = spawn(this.binary, args, {
      cwd: workDir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.processes.set(sessionId, proc);
    this.buffers.set(sessionId, "");

    proc.stdout!.on("data", (chunk: Buffer) => {
      this.handleData(sessionId, chunk.toString());
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      // Log Pi stderr for debugging but don't crash
      process.stderr.write(`[pi:${sessionId}] ${chunk}`);
    });

    proc.on("exit", (code) => {
      this.processes.delete(sessionId);
      this.buffers.delete(sessionId);
      this.running.delete(sessionId);
      if (code !== 0 && code !== null) {
        process.stderr.write(`[pi:${sessionId}] exited with code ${code}\n`);
      }
    });

    // Wait for Pi to be ready — it sends a response to the initial handshake
    await this.waitForReady(sessionId);

    return proc;
  }

  private handleData(sessionId: string, data: string): void {
    const buffer = (this.buffers.get(sessionId) ?? "") + data;
    const lines = buffer.split("\n");
    // Last element may be incomplete — keep it in buffer
    this.buffers.set(sessionId, lines.pop() ?? "");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event: RpcEvent = JSON.parse(trimmed);
        this.dispatchEvent(sessionId, event);
      } catch {
        process.stderr.write(`[pi:${sessionId}] non-JSON: ${trimmed}\n`);
      }
    }
  }

  private dispatchEvent(sessionId: string, event: RpcEvent): void {
    // Resolve pending RPC requests
    if (event.id && event.type === "response") {
      const pending = this.pending.get(event.id);
      if (pending) {
        this.pending.delete(event.id);
        if (event.success === false) {
        pending.reject(new Error(String(event.error ?? "RPC command failed")));
        } else {
          pending.resolve(event);
        }
        return;
      }
    }

    // Dispatch to event listeners
    const handlers = this.eventHandlers.get(sessionId);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }
  }

  private sendCommand(proc: ChildProcess, sessionId: string, cmd: RpcCommand): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(cmd.id, { resolve, reject });
      proc.stdin!.write(JSON.stringify(cmd) + "\n");

      // Timeout after 5 minutes
      setTimeout(() => {
        if (this.pending.has(cmd.id)) {
          this.pending.delete(cmd.id);
          reject(new Error(`RPC command ${cmd.command} timed out`));
        }
      }, 300_000);
    });
  }

  private waitForReady(sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Pi RPC process failed to start"));
      }, 30_000);

      const handler = (event: RpcEvent) => {
        if (event.type === "response" && event.command === "prompt") {
          // First response means Pi is ready
          clearTimeout(timeout);
          const handlers = this.eventHandlers.get(sessionId);
          if (handlers) {
            const idx = handlers.indexOf(handler);
            if (idx >= 0) handlers.splice(idx, 1);
          }
          resolve();
        }
      };

      let handlers = this.eventHandlers.get(sessionId);
      if (!handlers) {
        handlers = [];
        this.eventHandlers.set(sessionId, handlers);
      }
      handlers.push(handler);
    });
  }

  private collectResponse(sessionId: string): Promise<AgentResponse> {
    return new Promise((resolve) => {
      let text = "";
      const handlers = this.eventHandlers.get(sessionId) ?? [];

      const handler = (event: RpcEvent) => {
        // Collect text deltas from message_update events
        if (event.type === "message_update" && event.delta) {
          const delta = event.delta as { type: string; text?: string };
          if (delta.type === "text_delta" && delta.text) {
            text += delta.text;
          }
        }

        // Agent settled — full response collected
        if (event.type === "agent_settled") {
          const idx = handlers.indexOf(handler);
          if (idx >= 0) handlers.splice(idx, 1);
          resolve({ text: text || "[no response]" });
        }
      };

      handlers.push(handler);
      this.eventHandlers.set(sessionId, handlers);
    });
  }
}
