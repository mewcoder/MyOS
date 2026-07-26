/** Structured JSONL event log — one JSON object per line, daily files.
 *
 * Complements the human-readable text output on stdout/stderr: text is for
 * watching, JSONL is for tracing and debugging after the fact
 * (`jq 'select(.event=="agent_error")' ~/.myos/logs/myos-*.jsonl`).
 *
 * Writes are serialized on a promise chain and fire-and-forget: logging must
 * never block or break message flow.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { LOGS_DIR } from "./paths.js";

/** Truncate long values (message bodies) so lines stay small and greppable. */
export function preview(text: string, max = 200): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

class JsonlLogger {
  private chain: Promise<void> = Promise.resolve();
  private dirReady = false;

  log(event: string, fields: Record<string, unknown> = {}): void {
    const line = `${JSON.stringify({ ts: new Date().toISOString(), event, ...fields })}\n`;
    const dir = process.env.MYOS_LOG_DIR || LOGS_DIR;
    const file = join(dir, `myos-${new Date().toISOString().slice(0, 10)}.jsonl`);
    this.chain = this.chain
      .then(async () => {
        if (!this.dirReady) {
          await mkdir(dir, { recursive: true, mode: 0o700 });
          this.dirReady = true;
        }
        await appendFile(file, line, { mode: 0o600 });
      })
      .catch(() => {
        // Logging must never break message flow
      });
  }
}

export const logger = new JsonlLogger();
