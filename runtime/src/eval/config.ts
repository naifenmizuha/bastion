import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { parse } from "smol-toml";
import type {
  EvaluationExpectation,
  EvaluationConfig,
  EvaluationSession,
  EvaluationTurn,
  PassRules,
  PromptCase,
  ReviewerSettings,
  ThinkingLevel,
} from "./types.ts";

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

const DEFAULT_RULES: PassRules = {
  relevance: 4,
  usefulness: 4,
  groundedness: 4,
  databaseCorrectness: 4,
  executionQuality: 3,
  average: 4,
  minimumCasePassRate: 0.5,
  minimumSuitePassRate: 0.9,
};

type Table = Record<string, unknown>;

function table(value: unknown, path: string): Table {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be a TOML table`);
  }
  return value as Table;
}

function keys(value: Table, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new Error(`${path}.${key} is not a supported field`);
    }
  }
}

function stringValue(value: unknown, path: string, maxLength = 4096): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} must be a non-empty string`);
  }
  if (value.length > maxLength) throw new Error(`${path} is too long`);
  return value;
}

function optionalString(value: unknown, path: string, maxLength = 4096): string | undefined {
  if (value === undefined) return undefined;
  return stringValue(value, path, maxLength);
}

function integerValue(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${path} must be an integer`);
  }
  if (value < minimum || value > maximum) {
    throw new Error(`${path} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function numberValue(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a number`);
  }
  if (value < minimum || value > maximum) {
    throw new Error(`${path} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((item, index) => stringValue(item, `${path}[${index}]`, 128));
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  return table(value, path);
}

function parseExpectation(raw: unknown, path: string): EvaluationExpectation {
  const source = table(raw, path);
  const common = ["id", "title", "type", "weight", "points"];
  const type = stringValue(source.type, `${path}.type`, 64);
  if (source.weight !== undefined && source.points !== undefined) throw new Error(`${path} cannot define both weight and points`);
  const rawWeight = source.weight ?? source.points;
  if (rawWeight === undefined) throw new Error(`${path}.weight is required`);
  const base = {
    id: stringValue(source.id, `${path}.id`, 64),
    title: optionalString(source.title, `${path}.title`, 256) ?? String(source.id),
    weight: numberValue(rawWeight, source.weight === undefined ? `${path}.points` : `${path}.weight`, 0.01, 1_000_000),
  };
  if (type === "response_contains") {
    keys(source, [...common, "value", "case_sensitive"], path);
    if (source.case_sensitive !== undefined && typeof source.case_sensitive !== "boolean") {
      throw new Error(`${path}.case_sensitive must be a boolean`);
    }
    return { ...base, type, value: stringValue(source.value, `${path}.value`, 32 * 1024), caseSensitive: source.case_sensitive === true };
  }
  if (type === "response_regex") {
    keys(source, [...common, "pattern", "flags"], path);
    const pattern = stringValue(source.pattern, `${path}.pattern`, 4096);
    const flags = optionalString(source.flags, `${path}.flags`, 8) ?? "u";
    if (!/^[dgimsuvy]*$/.test(flags) || new Set(flags).size !== flags.length) throw new Error(`${path}.flags is invalid`);
    try { new RegExp(pattern, flags); } catch (error) { throw new Error(`${path}.pattern is invalid: ${error instanceof Error ? error.message : String(error)}`); }
    return { ...base, type, pattern, flags };
  }
  if (type === "tool_called" || type === "tool_not_called") {
    keys(source, [...common, "tool", "status", "arguments", "command", "command_prefix"], path);
    const status = source.status;
    if (status !== undefined && !["running", "succeeded", "failed", "cancelled"].includes(String(status))) {
      throw new Error(`${path}.status is invalid`);
    }
    const command = source.command === undefined ? undefined : stringArray(source.command, `${path}.command`);
    const commandPrefix = source.command_prefix === undefined ? undefined : stringArray(source.command_prefix, `${path}.command_prefix`);
    if (command !== undefined && commandPrefix !== undefined) throw new Error(`${path} cannot define both command and command_prefix`);
    if (commandPrefix?.length === 0) throw new Error(`${path}.command_prefix must not be empty`);
    const args = source.arguments === undefined ? undefined : objectValue(source.arguments, `${path}.arguments`);
    return { ...base, type, tool: stringValue(source.tool, `${path}.tool`, 128), ...(status ? { status: status as "running" | "succeeded" | "failed" | "cancelled" } : {}), ...(args ? { arguments: args } : {}), ...(command ? { command } : {}), ...(commandPrefix ? { commandPrefix } : {}) };
  }
  if (type === "sql") {
    keys(source, [...common, "database", "query", "expected_rows", "expected_row_count"], path);
    if (source.database !== "teamops" && source.database !== "derived-memory") throw new Error(`${path}.database must be teamops or derived-memory`);
    const query = stringValue(source.query, `${path}.query`, 16 * 1024).trim();
    if (!/^(select|with)\b/i.test(query) || query.includes(";")) throw new Error(`${path}.query must be one read-only SELECT/WITH statement without semicolons`);
    const expectedRows = source.expected_rows === undefined ? undefined : (() => {
      if (!Array.isArray(source.expected_rows)) throw new Error(`${path}.expected_rows must be an array`);
      return source.expected_rows.map((row, index) => objectValue(row, `${path}.expected_rows[${index}]`));
    })();
    const expectedRowCount = source.expected_row_count === undefined ? undefined : integerValue(source.expected_row_count, `${path}.expected_row_count`, 0, 1_000_000);
    if (expectedRows === undefined && expectedRowCount === undefined) throw new Error(`${path} must define expected_rows or expected_row_count`);
    return { ...base, type, database: source.database, query, ...(expectedRows ? { expectedRows } : {}), ...(expectedRowCount === undefined ? {} : { expectedRowCount }) };
  }
  if (type === "rubric") {
    keys(source, [...common, "criteria", "anchors", "required_facts", "forbidden", "reference"], path);
    const anchors = table(source.anchors, `${path}.anchors`);
    keys(anchors, ["1", "3", "5"], `${path}.anchors`);
    return {
      ...base,
      type,
      criteria: stringValue(source.criteria, `${path}.criteria`, 8192),
      anchors: {
        1: stringValue(anchors["1"], `${path}.anchors.1`, 2048),
        3: stringValue(anchors["3"], `${path}.anchors.3`, 2048),
        5: stringValue(anchors["5"], `${path}.anchors.5`, 2048),
      },
      requiredFacts: stringArray(source.required_facts, `${path}.required_facts`),
      forbidden: stringArray(source.forbidden, `${path}.forbidden`),
      ...(source.reference === undefined ? {} : { reference: stringValue(source.reference, `${path}.reference`, 16 * 1024) }),
    };
  }
  throw new Error(`${path}.type is not supported`);
}

function parseExpectations(value: unknown, path: string): EvaluationExpectation[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  const output = value.map((item, index) => parseExpectation(item, `${path}[${index}]`));
  const ids = new Set<string>();
  for (const item of output) {
    if (ids.has(item.id)) throw new Error(`duplicate expectation id in ${path}: ${item.id}`);
    ids.add(item.id);
  }
  return output;
}

function parseTurns(value: unknown, path: string): EvaluationTurn[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${path} must be a non-empty array`);
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const turnPath = `${path}[${index}]`;
    const source = table(raw, turnPath);
    keys(source, ["id", "prompt", "expectations"], turnPath);
    const id = stringValue(source.id, `${turnPath}.id`, 64);
    if (ids.has(id)) throw new Error(`duplicate turn id: ${id}`);
    ids.add(id);
    return { id, prompt: stringValue(source.prompt, `${turnPath}.prompt`, 32 * 1024), expectations: parseExpectations(source.expectations, `${turnPath}.expectations`) };
  });
}

function parseSessions(value: unknown, path: string): EvaluationSession[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${path} must contain at least two session tables`);
  }
  const sessionIds = new Set<string>();
  const turnIds = new Set<string>();
  return value.map((raw, index) => {
    const sessionPath = `${path}[${index}]`;
    const source = table(raw, sessionPath);
    keys(source, ["id", "turns"], sessionPath);
    const id = stringValue(source.id, `${sessionPath}.id`, 64);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
      throw new Error(`${sessionPath}.id must match [a-z0-9][a-z0-9_-]{0,63}`);
    }
    if (sessionIds.has(id)) throw new Error(`duplicate session id: ${id}`);
    sessionIds.add(id);
    const turns = parseTurns(source.turns, `${sessionPath}.turns`);
    for (const turn of turns) {
      if (turnIds.has(turn.id)) throw new Error(`duplicate turn id across sessions: ${turn.id}`);
      turnIds.add(turn.id);
    }
    return { id, turns };
  });
}

function reviewerFrom(value: unknown, env: NodeJS.ProcessEnv): ReviewerSettings {
  const source = value === undefined
    ? {}
    : table(value, "reviewer");
  keys(source, ["provider", "model"], "reviewer");
  const provider = source.provider ?? env.BASTION_EVAL_REVIEWER_PROVIDER;
  const model = source.model ?? env.BASTION_EVAL_REVIEWER_MODEL;
  if (typeof provider !== "string" || !provider.trim()) {
    throw new Error("reviewer.provider is required (or set BASTION_EVAL_REVIEWER_PROVIDER)");
  }
  if (typeof model !== "string" || !model.trim()) {
    throw new Error("reviewer.model is required (or set BASTION_EVAL_REVIEWER_MODEL)");
  }
  return { provider: provider.trim(), model: model.trim() };
}

function parseRules(value: unknown): PassRules {
  if (value === undefined) return { ...DEFAULT_RULES };
  const source = table(value, "pass_rules");
  keys(source, [
    "relevance",
    "usefulness",
    "groundedness",
    "database_correctness",
    "execution_quality",
    "average",
    "minimum_case_pass_rate",
    "minimum_suite_pass_rate",
  ], "pass_rules");
  return {
    relevance: integerValue(source.relevance ?? DEFAULT_RULES.relevance, "pass_rules.relevance", 1, 5),
    usefulness: integerValue(source.usefulness ?? DEFAULT_RULES.usefulness, "pass_rules.usefulness", 1, 5),
    groundedness: integerValue(source.groundedness ?? DEFAULT_RULES.groundedness, "pass_rules.groundedness", 1, 5),
    databaseCorrectness: integerValue(source.database_correctness ?? DEFAULT_RULES.databaseCorrectness, "pass_rules.database_correctness", 1, 5),
    executionQuality: integerValue(source.execution_quality ?? DEFAULT_RULES.executionQuality, "pass_rules.execution_quality", 1, 5),
    average: numberValue(source.average ?? DEFAULT_RULES.average, "pass_rules.average", 1, 5),
    minimumCasePassRate: numberValue(source.minimum_case_pass_rate ?? DEFAULT_RULES.minimumCasePassRate, "pass_rules.minimum_case_pass_rate", 0, 1),
    minimumSuitePassRate: numberValue(source.minimum_suite_pass_rate ?? DEFAULT_RULES.minimumSuitePassRate, "pass_rules.minimum_suite_pass_rate", 0, 1),
  };
}

function parsePrompts(value: unknown): PromptCase[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("prompts must be a non-empty array of TOML tables");
  }
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const path = `prompts[${index}]`;
    const source = typeof raw === "string"
      ? { id: `case-${index + 1}`, text: raw }
      : table(raw, path);
    keys(source, ["id", "title", "tags", "text", "runs", "write_permission"], path);
    const id = stringValue(source.id, `${path}.id`, 64);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) {
      throw new Error(`${path}.id must match [a-z0-9][a-z0-9_-]{0,63}`);
    }
    if (ids.has(id)) throw new Error(`duplicate prompt id: ${id}`);
    ids.add(id);
    const writePermission = source.write_permission ?? "allow";
    if (writePermission !== "allow" && writePermission !== "deny") {
      throw new Error(`${path}.write_permission must be allow or deny`);
    }
    const runs = source.runs === undefined
      ? undefined
      : integerValue(source.runs, `${path}.runs`, 1, 10);
    if (runs !== undefined && runs < 1) throw new Error(`${path}.runs must be positive`);
    return {
      id,
      title: optionalString(source.title, `${path}.title`, 256) ?? id,
      tags: stringArray(source.tags, `${path}.tags`),
      text: stringValue(source.text, `${path}.text`, 32 * 1024),
      turns: [{ id: "turn-1", prompt: stringValue(source.text, `${path}.text`, 32 * 1024), expectations: [] }],
      sessions: [{ id: "session-1", turns: [{ id: "turn-1", prompt: stringValue(source.text, `${path}.text`, 32 * 1024), expectations: [] }] }],
      expectations: [],
      ...(runs === undefined ? {} : { runs }),
      writePermission,
    };
  });
}

function parseCases(value: unknown, schemaVersion: 2 | 3): PromptCase[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("cases must be a non-empty array of TOML tables");
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const path = `cases[${index}]`;
    const source = table(raw, path);
    keys(source, ["id", "title", "tags", "runs", "write_permission", "turns", "sessions", "expectations"], path);
    const id = stringValue(source.id, `${path}.id`, 64);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new Error(`${path}.id must match [a-z0-9][a-z0-9_-]{0,63}`);
    if (ids.has(id)) throw new Error(`duplicate case id: ${id}`);
    ids.add(id);
    if (schemaVersion === 2 && source.sessions !== undefined) throw new Error(`${path}.sessions requires schema_version 3`);
    if (schemaVersion === 3 && source.turns !== undefined && source.sessions !== undefined) throw new Error(`${path} cannot define both turns and sessions`);
    if (schemaVersion === 3 && source.turns !== undefined) throw new Error(`${path}.turns is not supported by schema_version 3; use sessions`);
    const sessions = schemaVersion === 3
      ? parseSessions(source.sessions, `${path}.sessions`)
      : [{ id: "session-1", turns: parseTurns(source.turns, `${path}.turns`) }];
    const turns = sessions.flatMap((session) => session.turns);
    const expectations = parseExpectations(source.expectations, `${path}.expectations`);
    const allExpectations = [...turns.flatMap((turn) => turn.expectations), ...expectations];
    const expectationIds = new Set<string>();
    for (const item of allExpectations) {
      if (expectationIds.has(item.id)) throw new Error(`duplicate expectation id in ${path}: ${item.id}`);
      expectationIds.add(item.id);
    }
    const writePermission = source.write_permission ?? "allow";
    if (writePermission !== "allow" && writePermission !== "deny") throw new Error(`${path}.write_permission must be allow or deny`);
    const runs = source.runs === undefined ? undefined : integerValue(source.runs, `${path}.runs`, 1, 10);
    return { id, title: optionalString(source.title, `${path}.title`, 256) ?? id, tags: stringArray(source.tags, `${path}.tags`), text: turns[0]!.prompt, turns, sessions, expectations, ...(runs === undefined ? {} : { runs }), writePermission };
  });
}

export function parseEvaluationConfig(
  text: string,
  sourcePath: string,
  env: NodeJS.ProcessEnv = process.env,
): EvaluationConfig {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    throw new Error(`cannot parse TOML ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const source = table(parsed, "root");
  keys(source, ["schema_version", "name", "description", "runs", "timeout_seconds", "agent", "reviewer", "pass_rules", "scoring", "prompts", "cases"], "root");
  if (source.schema_version !== 1 && source.schema_version !== 2 && source.schema_version !== 3) throw new Error("schema_version must be 1, 2, or 3");
  if (source.schema_version === 1 && source.cases !== undefined) throw new Error("schema_version 1 uses prompts, not cases");
  if (source.schema_version === 2 && source.prompts !== undefined) throw new Error("schema_version 2 uses cases, not prompts");
  if (source.schema_version === 3 && source.prompts !== undefined) throw new Error("schema_version 3 uses cases, not prompts");
  const runs = integerValue(source.runs ?? 1, "runs", 1, 10);
  const timeoutSeconds = integerValue(source.timeout_seconds ?? 180, "timeout_seconds", 10, 1800);
  const agentSource = source.agent === undefined ? {} : table(source.agent, "agent");
  keys(agentSource, ["provider", "model", "thinking"], "agent");
  const provider = optionalString(agentSource.provider, "agent.provider", 128);
  const model = optionalString(agentSource.model, "agent.model", 256);
  if (Boolean(provider) !== Boolean(model)) {
    throw new Error("agent.provider and agent.model must be provided together");
  }
  const thinking = agentSource.thinking ?? "low";
  if (typeof thinking !== "string" || !THINKING_LEVELS.has(thinking as ThinkingLevel)) {
    throw new Error("agent.thinking must be off, minimal, low, medium, high, or xhigh");
  }
  const scoringSource = source.scoring === undefined ? {} : table(source.scoring, "scoring");
  keys(scoringSource, ["pass_score"], "scoring");
  const passRules = parseRules(source.pass_rules);
  return {
    schemaVersion: source.schema_version,
    name: stringValue(source.name, "name", 128),
    ...(source.description === undefined ? {} : { description: stringValue(source.description, "description", 2048) }),
    runs,
    timeoutSeconds,
    agent: {
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
      thinking: thinking as ThinkingLevel,
    },
    reviewer: reviewerFrom(source.reviewer, env),
    passRules,
    scoring: {
      passScore: source.schema_version >= 2
        ? numberValue(scoringSource.pass_score ?? 80, "scoring.pass_score", 0, 100)
        : passRules.average * 20,
    },
    prompts: source.schema_version === 2 || source.schema_version === 3
      ? parseCases(source.cases, source.schema_version)
      : parsePrompts(source.prompts),
    sourcePath,
  };
}

export async function readEvaluationConfig(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EvaluationConfig> {
  const absolutePath = isAbsolute(path) ? path : resolve(path);
  return parseEvaluationConfig(await readFile(absolutePath, "utf8"), absolutePath, env);
}

export function selectPrompts(
  config: EvaluationConfig,
  ids: readonly string[] = [],
  tags: readonly string[] = [],
): PromptCase[] {
  const idSet = new Set(ids);
  const tagSet = new Set(tags);
  const selected = config.prompts.filter((prompt) =>
    (idSet.size === 0 || idSet.has(prompt.id)) &&
    (tagSet.size === 0 || prompt.tags.some((tag) => tagSet.has(tag))),
  );
  const missing = ids.filter((id) => !config.prompts.some((prompt) => prompt.id === id));
  if (missing.length) throw new Error(`unknown prompt id: ${missing.join(", ")}`);
  if (!selected.length) throw new Error("no prompts matched the selected filters");
  return selected;
}
