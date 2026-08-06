/**
 * Zod validation schema for MyOS configuration.
 *
 * Validates config.json at startup, producing precise error messages with
 * field paths instead of failing with cryptic runtime errors.
 *
 * Inspired by OpenClaw's zod-schema.ts approach, simplified for MyOS.
 */

import { z } from "zod";
import type { GatewayConfig } from "../types.js";

// ─── Sub-schemas ─────────────────────────────────────────────────

const PiModelCostSchema = z
  .object({
    input: z.number().nonnegative().optional(),
    output: z.number().nonnegative().optional(),
    cacheRead: z.number().nonnegative().optional(),
    cacheWrite: z.number().nonnegative().optional(),
  })
  .passthrough();

const PiModelSchema = z
  .object({
    id: z.string().min(1, "model id is required"),
    name: z.string().optional(),
    input: z.array(z.string()).optional(),
    contextWindow: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
    reasoning: z.boolean().optional(),
    cost: PiModelCostSchema.optional(),
  })
  .passthrough();

const PiProviderSchema = z
  .object({
    baseUrl: z.string().url("baseUrl must be a valid URL"),
    api: z.string().optional(),
    apiKey: z.string().min(1, "apiKey is required — use ${ENV_VAR} to reference env vars"),
    authHeader: z.boolean().optional(),
    compat: z.record(z.string(), z.unknown()).optional(),
    models: z.array(PiModelSchema).min(1, "at least one model is required"),
  })
  .passthrough();

const ThinkingLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

// ─── Top-level config schema ─────────────────────────────────────
//
// Flat structure — three required keys, one level of nesting:
//   { channels: { wechat: {} }, providers: {...}, defaultModel: "p/m" }

export const GatewayConfigSchema = z.object({
  channels: z
    .record(
      z.string(),
      z.object({ enabled: z.boolean().default(true) }).passthrough(),
    )
    .refine(
      (channels) => Object.keys(channels).length > 0,
      "at least one channel is required",
    ),

  providers: z
    .record(z.string(), PiProviderSchema)
    .refine(
      (providers) => Object.keys(providers).length > 0,
      "at least one provider is required",
    ),

  defaultModel: z
    .string()
    .min(1, "defaultModel is required (format: provider/model-id)")
    .refine(
      (model) => model.includes("/"),
      "defaultModel must be in 'provider/model-id' format",
    ),

  workspaceDir: z.string().optional(),
  thinkingLevel: ThinkingLevelSchema.optional(),
  sessionDir: z.string().optional(),
  skillDir: z.string().optional(),
});

// ─── Types inferred from schema ──────────────────────────────────

export type ValidatedGatewayConfig = z.infer<typeof GatewayConfigSchema>;


// ─── Validation helper ───────────────────────────────────────────

/** Format zod errors into human-readable messages with field paths. */
export function formatZodError(error: z.ZodError): string {
  const lines: string[] = [];

  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    lines.push(`  • ${path}: ${issue.message}`);
  }

  return [
    `[myos] config validation failed with ${error.issues.length} error(s):`,
    ...lines,
    "",
    "Tip: API Key can be set via env var — use \"${MYOS_API_KEY}\" in config.json",
  ].join("\n");
}

/** Validate a parsed (flat) config object and map it to the internal
 *  GatewayConfig shape. Throws a formatted error on failure. */
export function validateConfig(raw: unknown): GatewayConfig {
  const result = GatewayConfigSchema.safeParse(raw);

  if (!result.success) {
    const message = formatZodError(result.error);
    throw new Error(message);
  }

  const flat = result.data;
  return {
    channels: Object.entries(flat.channels).map(([type, cfg]) => ({ type, ...cfg })),
    agent: {
      type: "pi",
      providers: flat.providers as GatewayConfig["agent"]["providers"],
      defaultModel: flat.defaultModel,
      workspaceDir: flat.workspaceDir,
      thinkingLevel: flat.thinkingLevel,
      skillDir: flat.skillDir,
    },
    session: { dir: flat.sessionDir },
  };
}
