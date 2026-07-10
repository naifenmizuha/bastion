import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface RuntimeEnvLoadResult {
  path: string;
  loaded: string[];
  skipped: string[];
}

const ENV_LINE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function parseEnvValue(raw: string): string {
  const value = raw.trim();
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    if (end !== -1) return value.slice(1, end);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

export function parseRuntimeEnv(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = ENV_LINE.exec(trimmed);
    if (!match) continue;
    values.set(match[1]!, parseEnvValue(match[2] ?? ""));
  }
  return values;
}

export function loadRuntimeEnv(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeEnvLoadResult[] {
  const results: RuntimeEnvLoadResult[] = [];
  for (const name of [".env.local", ".env"]) {
    const path = join(repoRoot, "runtime", name);
    let content: string;
    try {
      content = readFileSync(path, "utf8");
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }

    const loaded: string[] = [];
    const skipped: string[] = [];
    for (const [key, value] of parseRuntimeEnv(content)) {
      if (env[key] === undefined) {
        env[key] = value;
        loaded.push(key);
      } else {
        skipped.push(key);
      }
    }
    results.push({ path, loaded, skipped });
  }
  return results;
}
