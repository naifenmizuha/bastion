import { createHash } from "node:crypto";
import { parseCommand } from "../teamops/command-policy.ts";
import type {
  TeamOpsParams,
  TeamOpsToolDetails,
  CliEnvelope,
  VerificationResult,
} from "../teamops/types.ts";
import {
  TEAMOPS_DETAILS_KIND,
  isTeamOpsDetailsKind,
  isTeamOpsToolName,
} from "../teamops/types.ts";
import type {
  AuthorityReference,
  BastionExtraction,
  OperationOutcome,
  OperationRecord,
  OperationVerification,
} from "./types.ts";

interface ToolCall {
  id: string;
  args: TeamOpsParams;
  timestamp: number;
}

interface MessageLike {
  role?: unknown;
  timestamp?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  content?: unknown;
  details?: unknown;
}

const SAFE_FAILURE_CODES = new Set([
  "INVALID_COMMAND",
  "INVALID_FLAGS",
  "INVALID_INPUT",
  "UNCLASSIFIED_COMMAND",
  "missing_required",
  "unknown_field",
  "parse_error",
  "invalid_value",
  "not_found",
  "conflict",
]);

const NOT_PERSISTED_CODES = new Set(["USER_CANCELLED", "APPROVAL_REQUIRED"]);

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function primitive(
  object: Record<string, unknown> | undefined,
  key: string,
): string | number | boolean | undefined {
  const value = object?.[key];
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined;
}

function identifier(
  object: Record<string, unknown> | undefined,
  key: string,
): string | number | undefined {
  const value = object?.[key];
  return typeof value === "string" || typeof value === "number"
    ? value
    : undefined;
}

function flag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function envelopeData(details: TeamOpsToolDetails): Record<string, unknown> | undefined {
  const envelope = details.result?.envelope;
  return envelope?.ok ? asObject(envelope.data) : undefined;
}

function isBastionDetails(value: unknown): value is TeamOpsToolDetails {
  const object = asObject(value);
  return isTeamOpsDetailsKind(object?.kind) && typeof object.ok === "boolean";
}

function toolCalls(messages: readonly unknown[]): Map<string, ToolCall> {
  const calls = new Map<string, ToolCall>();
  for (const raw of messages) {
    const message = raw as MessageLike;
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const rawBlock of message.content) {
      const block = asObject(rawBlock);
      if (
        block?.type !== "toolCall" ||
        !isTeamOpsToolName(block.name) ||
        typeof block.id !== "string"
      ) {
        continue;
      }
      const args = asObject(block.arguments);
      if (!args || !Array.isArray(args.args)) continue;
      calls.set(block.id, {
        id: block.id,
        args: {
          args: args.args.filter((value): value is string => typeof value === "string"),
          ...("input" in args ? { input: args.input } : {}),
        },
        timestamp:
          typeof message.timestamp === "number" ? message.timestamp : Date.now(),
      });
    }
  }
  return calls;
}

function operationId(call: ToolCall | undefined, details: TeamOpsToolDetails): string {
  if (call) return call.id;
  return createHash("sha256")
    .update(JSON.stringify([details.command, details.error?.code]))
    .digest("hex")
    .slice(0, 24);
}

function verificationRecords(
  verification: VerificationResult[] | undefined,
): OperationVerification[] {
  if (!verification) return [];
  return verification.map((item) => ({
    args: [...item.args],
    expected: { ...item.expected },
  }));
}

function expectedEffect(
  command: readonly string[],
  input: unknown,
  data: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> | undefined {
  const flagIndex = command.findIndex((token) => token.startsWith("--"));
  const key = command
    .slice(0, flagIndex < 0 ? command.length : flagIndex)
    .join(" ");
  const source = asObject(input);
  const fieldsByCommand: Record<string, string[]> = {
    "player add": ["name", "number"],
    "report write": ["name", "date"],
    "game write": ["id", "date", "own_score", "opponent_score"],
    "game create": ["id", "date", "opponent"],
    "game score set": ["game_id", "own_score", "opponent_score"],
    "game analysis generate": ["game_id"],
    "lineup write": ["id", "game_id"],
    "lineup accept": ["id", "game_id", "status"],
    "lineup reject": ["id", "status"],
    "drill recommend write": ["id", "name", "status"],
    "drill review approve": ["id", "review_status"],
    "drill review reject": ["id", "review_status"],
  };
  const fields = fieldsByCommand[key] ?? [];
  const expected: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const value = primitive(data, field) ?? primitive(source, field);
    if (value !== undefined) expected[field] = value;
  }
  if (key === "game score set") {
    const gameId = primitive(source, "game_id") ?? primitive(data, "game_id");
    if (gameId !== undefined) {
      delete expected.game_id;
      expected.id = gameId;
    }
  }
  if (key === "lineup accept") expected.status = "accepted";
  if (key === "lineup reject") expected.status = "rejected";
  if (key === "drill review approve") expected.review_status = "approved";
  if (key === "drill review reject") expected.review_status = "rejected";
  return Object.keys(expected).length > 0 ? expected : undefined;
}

function fallbackVerification(
  command: readonly string[],
  expected: Record<string, string | number | boolean> | undefined,
  refs: readonly AuthorityReference[],
): OperationVerification[] {
  if (!expected) return [];
  const key = command.slice(0, 2).join(" ");
  const safelyResolvable = new Set([
    "player add",
    "game score",
    "lineup accept",
    "lineup reject",
    "drill review",
  ]);
  if (!safelyResolvable.has(key)) return [];
  const ref = refs[0];
  return ref
    ? [{ args: [...ref.refreshArgs], expected: { ...expected } }]
    : [];
}

function classifyOutcome(
  command: readonly string[],
  details: TeamOpsToolDetails,
): OperationOutcome {
  const data = envelopeData(details);
  if (
    command[0] === "lineup" &&
    command[1] === "write" &&
    data?.valid === false
  ) {
    return "not_persisted";
  }
  if (details.ok) return "confirmed";
  const code = details.error?.code;
  if (code && NOT_PERSISTED_CODES.has(code)) return "not_persisted";
  if (code && SAFE_FAILURE_CODES.has(code)) return "failed";
  return "uncertain";
}

function reference(
  kind: AuthorityReference["kind"],
  key: string,
  identifiers: AuthorityReference["identifiers"],
  refreshArgs: string[],
  observedAt: number,
  reason: string,
  mustRefresh = false,
): AuthorityReference {
  return {
    key,
    kind,
    identifiers,
    refreshArgs,
    observedAt,
    freshness: mustRefresh ? "must_refresh" : "stale_hint",
    reason,
  };
}

function referencesFor(
  params: TeamOpsParams,
  details: TeamOpsToolDetails,
  observedAt: number,
): AuthorityReference[] {
  const args = details.command.length > 0 ? details.command : params.args;
  const input = asObject(params.input);
  const data = envelopeData(details);
  const refs: AuthorityReference[] = [];
  const mustRefresh = !details.ok && details.error?.code !== "USER_CANCELLED";
  const playerName =
    flag(args, "--name") ?? identifier(input, "name") ?? identifier(data, "name");
  const date =
    flag(args, "--date") ?? identifier(input, "date") ?? identifier(data, "date");
  const gameId =
    flag(args, "--game-id") ??
    flag(args, "--id") ??
    identifier(input, "game_id") ??
    identifier(data, "game_id") ??
    (args[0] === "game" ? identifier(data, "id") : undefined);
  const lineupId =
    args[0] === "lineup"
      ? flag(args, "--id") ?? identifier(data, "id")
      : undefined;
  const recommendationId =
    flag(args, "--recommendation-id") ??
    identifier(input, "recommendation_id") ??
    identifier(data, "recommendation_id") ??
    (args[0] === "drill" ? identifier(data, "id") : undefined);

  if (args[0] === "player" && playerName !== undefined) {
    refs.push(
      reference(
        "player",
        `player:${playerName}`,
        { name: playerName },
        ["player", "read", "--name", String(playerName)],
        observedAt,
        "player used by the conversation",
        mustRefresh,
      ),
    );
  }
  if (args[0] === "report" && playerName !== undefined && date !== undefined) {
    refs.push(
      reference(
        "report",
        `report:${playerName}:${date}`,
        { name: playerName, date },
        ["report", "read", "--name", String(playerName), "--date", String(date)],
        observedAt,
        "training report used by the conversation",
        mustRefresh,
      ),
    );
  }
  if (args[0] === "game" && args[1] === "analysis" && gameId !== undefined) {
    const analysisPlayer = flag(args, "--player");
    refs.push(
      reference(
        "game_analysis",
        `game-analysis:${gameId}${analysisPlayer ? `:${analysisPlayer}` : ""}`,
        {
          gameId,
          ...(analysisPlayer ? { player: analysisPlayer } : {}),
        },
        [
          "game",
          "analysis",
          "read",
          "--game-id",
          String(gameId),
          ...(analysisPlayer ? ["--player", analysisPlayer] : []),
        ],
        observedAt,
        "game analysis used by the conversation",
        mustRefresh,
      ),
    );
  } else if (args[0] === "game" && gameId !== undefined) {
    refs.push(
      reference(
        "game",
        `game:${gameId}`,
        { id: gameId },
        ["game", "read", "--id", String(gameId)],
        observedAt,
        "game used by the conversation",
        mustRefresh,
      ),
    );
  }
  if (args[0] === "lineup" && lineupId !== undefined) {
    refs.push(
      reference(
        "lineup",
        `lineup:${lineupId}`,
        { id: lineupId },
        ["lineup", "read", "--id", String(lineupId)],
        observedAt,
        "lineup used by the conversation",
        mustRefresh,
      ),
    );
  }
  const lineupGameId =
    args[0] === "lineup"
      ? identifier(input, "game_id") ?? identifier(data, "game_id")
      : undefined;
  if (lineupGameId !== undefined) {
    refs.push(
      reference(
        "game",
        `game:${lineupGameId}`,
        { id: lineupGameId },
        ["game", "read", "--id", String(lineupGameId)],
        observedAt,
        "game targeted by a lineup operation",
        mustRefresh,
      ),
    );
  }
  if (
    args[0] === "person" &&
    args[1] === "analysis" &&
    playerName !== undefined
  ) {
    const from = flag(args, "--from");
    const to = flag(args, "--to");
    if (from && to) {
      refs.push(
        reference(
          "person_analysis",
          `person-analysis:${playerName}:${from}:${to}`,
          { name: playerName, from, to },
          [...args],
          observedAt,
          "person analysis used by the conversation",
          mustRefresh,
        ),
      );
    }
  }
  if (
    args[0] === "drill" &&
    args[1] === "training" &&
    recommendationId !== undefined
  ) {
    refs.push(
      reference(
        "training",
        `training:${recommendationId}`,
        { recommendationId },
        [
          "drill",
          "training",
          "read",
          "--recommendation-id",
          String(recommendationId),
        ],
        observedAt,
        "approved training used by the conversation",
        mustRefresh,
      ),
    );
  } else if (args[0] === "drill" && recommendationId !== undefined) {
    refs.push(
      reference(
        "drill_recommendation",
        `drill-recommendation:${recommendationId}`,
        { id: recommendationId },
        ["drill", "recommend", "list"],
        observedAt,
        "drill recommendation used by the conversation",
        mustRefresh,
      ),
    );
  }
  return refs;
}

function riskFor(
  params: TeamOpsParams,
  details: TeamOpsToolDetails,
): "read" | "compute_write" | "write" | undefined {
  if (details.risk) return details.risk;
  try {
    return parseCommand(params).spec.risk;
  } catch {
    return undefined;
  }
}

function successfulReadData(details: TeamOpsToolDetails): unknown | undefined {
  if (!details.ok || details.risk !== "read") return undefined;
  const envelope: CliEnvelope | undefined = details.result?.envelope;
  return envelope?.ok ? envelope.data : undefined;
}

export function extractBastionContext(
  messages: readonly unknown[],
): BastionExtraction {
  const calls = toolCalls(messages);
  const authorityRefs: AuthorityReference[] = [];
  const operations: OperationRecord[] = [];
  const reads: BastionExtraction["reads"] = [];
  const warnings: string[] = [];

  for (const raw of messages) {
    const message = raw as MessageLike;
    if (
      message.role !== "toolResult" ||
      !isTeamOpsToolName(message.toolName) ||
      typeof message.toolCallId !== "string"
    ) {
      continue;
    }
    const call = calls.get(message.toolCallId);
    if (!isBastionDetails(message.details)) {
      warnings.push(`MISSING_BASTION_DETAILS:${message.toolCallId}`);
      continue;
    }
    const details = message.details;
    const params = call?.args ?? { args: [...details.command] };
    const observedAt =
      typeof message.timestamp === "number"
        ? message.timestamp
        : call?.timestamp ?? Date.now();
    const refs = referencesFor(params, details, observedAt);
    authorityRefs.push(...refs);

    const risk = riskFor(params, details);
    if (risk === "read") {
      const data = successfulReadData(details);
      if (data !== undefined) {
        reads.push({ args: [...details.command], data, observedAt });
      }
      continue;
    }
    if (risk !== "write" && risk !== "compute_write") {
      warnings.push(`UNCLASSIFIED_BASTION_COMMAND:${details.command.join(" ")}`);
      continue;
    }
    const data = envelopeData(details);
    const expected = expectedEffect(details.command, params.input, data);
    const outcome = classifyOutcome(details.command, details);
    const recordedVerification = verificationRecords(details.verification);
    operations.push({
      operationId: operationId(call, details),
      command: [...details.command],
      risk,
      entityRefs: refs.map((item) => item.key),
      outcome,
      ...(details.error?.code ? { errorCode: details.error.code } : {}),
      ...(details.approved !== undefined ? { approved: details.approved } : {}),
      ...(expected ? { expectedEffect: expected } : {}),
      verification:
        recordedVerification.length > 0 || outcome !== "uncertain"
          ? recordedVerification
          : fallbackVerification(details.command, expected, refs),
      observedAt,
    });
  }

  for (const [id, call] of calls) {
    const hasResult = messages.some((raw) => {
      const message = raw as MessageLike;
      return message.role === "toolResult" && message.toolCallId === id;
    });
    if (hasResult) continue;
    let risk;
    try {
      risk = parseCommand(call.args).spec.risk;
    } catch {
      warnings.push(`ORPHAN_UNCLASSIFIED_CALL:${id}`);
      continue;
    }
    if (risk === "read") continue;
    const syntheticDetails: TeamOpsToolDetails = {
      kind: TEAMOPS_DETAILS_KIND,
      ok: false,
      command: [...call.args.args],
      risk,
      error: {
        code: "MISSING_TOOL_RESULT",
        message: "The tool call has no terminal result in the compaction scope",
      },
    };
    const refs = referencesFor(call.args, syntheticDetails, call.timestamp);
    const expected = expectedEffect(
      call.args.args,
      call.args.input,
      undefined,
    );
    authorityRefs.push(...refs);
    operations.push({
      operationId: id,
      command: [...call.args.args],
      risk,
      entityRefs: refs.map((item) => item.key),
      outcome: "uncertain",
      errorCode: "MISSING_TOOL_RESULT",
      ...(expected ? { expectedEffect: expected } : {}),
      verification: fallbackVerification(call.args.args, expected, refs),
      observedAt: call.timestamp,
    });
  }

  return { authorityRefs, operations, reads, warnings };
}

export function entityKeysForParams(params: TeamOpsParams): string[] {
  let risk: TeamOpsToolDetails["risk"];
  try {
    risk = parseCommand(params).spec.risk;
  } catch {
    return [];
  }
  const details: TeamOpsToolDetails = {
    kind: TEAMOPS_DETAILS_KIND,
    ok: false,
    command: [...params.args],
    risk,
    error: {
      code: "PREFLIGHT",
      message: "Synthetic preflight details",
    },
  };
  return referencesFor(params, details, Date.now()).map((item) => item.key);
}
