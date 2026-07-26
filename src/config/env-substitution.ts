/**
 * Environment variable substitution for config values.
 *
 * Supports `${VAR_NAME}` syntax in string values, substituted at config load time.
 * - Only uppercase env var names are matched: `[A-Z_][A-Z0-9_]*`
 * - Escape with `$${VAR}` to output literal `${VAR}`
 * - Missing env vars produce a clear error with the config path
 *
 * Inspired by OpenClaw's env-substitution.ts.
 */

const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

/** Error thrown when a config value references a missing environment variable. */
export class MissingEnvVarError extends Error {
  constructor(
    public readonly varName: string,
    public readonly configPath: string,
  ) {
    super(`Missing env var "${varName}" referenced at config path: ${configPath}`);
    this.name = "MissingEnvVarError";
  }
}

type EnvToken =
  | { kind: "escaped"; name: string; end: number }
  | { kind: "substitution"; name: string; end: number };

function parseEnvTokenAt(value: string, index: number): EnvToken | null {
  if (value[index] !== "$") return null;

  const next = value[index + 1];
  const afterNext = value[index + 2];

  // Escaped: $${VAR} -> literal ${VAR}
  if (next === "$" && afterNext === "{") {
    const start = index + 3;
    const end = value.indexOf("}", start);
    if (end !== -1) {
      const name = value.slice(start, end);
      if (ENV_VAR_NAME_PATTERN.test(name)) {
        return { kind: "escaped", name, end };
      }
    }
  }

  // Substitution: ${VAR} -> env value
  if (next === "{") {
    const start = index + 2;
    const end = value.indexOf("}", start);
    if (end !== -1) {
      const name = value.slice(start, end);
      if (ENV_VAR_NAME_PATTERN.test(name)) {
        return { kind: "substitution", name, end };
      }
    }
  }

  return null;
}

function substituteString(
  value: string,
  env: NodeJS.ProcessEnv,
  configPath: string,
): string {
  if (!value.includes("$")) return value;

  const chunks: string[] = [];

  for (let i = 0; i < value.length; i++) {
    const char = value.charAt(i);
    if (char !== "$") {
      chunks.push(char);
      continue;
    }

    const token = parseEnvTokenAt(value, i);
    if (token?.kind === "escaped") {
      chunks.push(`\${${token.name}}`);
      i = token.end;
      continue;
    }
    if (token?.kind === "substitution") {
      const envValue = env[token.name];
      if (envValue === undefined || envValue === "") {
        throw new MissingEnvVarError(token.name, configPath);
      }
      chunks.push(envValue);
      i = token.end;
      continue;
    }

    chunks.push(char);
  }

  return chunks.join("");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function substituteAny(
  value: unknown,
  env: NodeJS.ProcessEnv,
  path: string,
): unknown {
  if (typeof value === "string") {
    return substituteString(value, env, path);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => substituteAny(item, env, `${path}[${index}]`));
  }

  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      result[key] = substituteAny(val, env, childPath);
    }
    return result;
  }

  return value;
}

/**
 * Resolves `${VAR_NAME}` environment variable references in config values.
 *
 * @param obj - The parsed config object (after JSON.parse)
 * @param env - Environment variables to use (defaults to process.env)
 * @returns The config object with env vars substituted
 * @throws {MissingEnvVarError} If a referenced env var is not set or empty
 */
export function resolveConfigEnvVars(
  obj: unknown,
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  return substituteAny(obj, env, "");
}

function collectFromString(value: string, names: Set<string>): void {
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "$") continue;
    const token = parseEnvTokenAt(value, i);
    if (token) {
      if (token.kind === "substitution") names.add(token.name);
      i = token.end;
    }
  }
}

function collectAny(value: unknown, names: Set<string>): void {
  if (typeof value === "string") {
    collectFromString(value, names);
  } else if (Array.isArray(value)) {
    for (const item of value) collectAny(item, names);
  } else if (isPlainObject(value)) {
    for (const val of Object.values(value)) collectAny(val, names);
  }
}

/**
 * Collects the names of all `${VAR_NAME}` env vars referenced in config values
 * (escaped `$${VAR}` references are excluded). Used at daemon install time to
 * know which env vars the service needs.
 */
export function collectReferencedEnvVars(obj: unknown): string[] {
  const names = new Set<string>();
  collectAny(obj, names);
  return [...names];
}
