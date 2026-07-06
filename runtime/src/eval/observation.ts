import type { Usage } from "@earendil-works/pi-ai/compat";
import type { BastionCliToolDetails } from "../bastion-cli/types.ts";
import type {
  EvalObservation,
  EvalToolCall,
  EvalUsage,
} from "./types.ts";

type RecordLike = Record<string, unknown>;

export const EMPTY_USAGE: EvalUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

function asRecord(value: unknown): RecordLike | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordLike)
    : undefined;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      const record = asRecord(item);
      return record?.type === "text" && typeof record.text === "string"
        ? record.text
        : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function addUsage(left: EvalUsage, right: EvalUsage): EvalUsage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    totalTokens: left.totalTokens + right.totalTokens,
    cost: {
      input: left.cost.input + right.cost.input,
      output: left.cost.output + right.cost.output,
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      total: left.cost.total + right.cost.total,
    },
  };
}

function normalizeUsage(value: unknown): EvalUsage {
  const usage = asRecord(value);
  const cost = asRecord(usage?.cost);
  if (!usage || !cost) return EMPTY_USAGE;
  const number = (candidate: unknown) =>
    typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
  return {
    input: number(usage.input),
    output: number(usage.output),
    cacheRead: number(usage.cacheRead),
    cacheWrite: number(usage.cacheWrite),
    totalTokens: number(usage.totalTokens),
    cost: {
      input: number(cost.input),
      output: number(cost.output),
      cacheRead: number(cost.cacheRead),
      cacheWrite: number(cost.cacheWrite),
      total: number(cost.total),
    },
  };
}

export function extractObservation(
  messages: readonly unknown[],
  durationMs: number,
): EvalObservation {
  let finalAnswer = "";
  let stopReason: string | undefined;
  let model: { provider: string; id: string } | undefined;
  let usage = EMPTY_USAGE;
  const toolCalls: EvalToolCall[] = [];
  const allToolCalls: EvalObservation["allToolCalls"] = [];

  for (const message of messages) {
    const record = asRecord(message);
    if (!record) continue;
    if (record.role === "assistant") {
      const text = textContent(record.content);
      if (text.trim()) finalAnswer = text.trim();
      if (typeof record.stopReason === "string") stopReason = record.stopReason;
      if (typeof record.provider === "string" && typeof record.model === "string") {
        model = { provider: record.provider, id: record.model };
      }
      usage = addUsage(usage, normalizeUsage(record.usage));
    }
    if (record.role !== "toolResult") continue;
    const genericInput = asRecord(record.input);
    allToolCalls.push({
      ...(typeof record.toolCallId === "string"
        ? { toolCallId: record.toolCallId }
        : {}),
      name: typeof record.toolName === "string" ? record.toolName : "unknown",
      ...(record.input !== undefined ? { input: record.input } : {}),
      ...(record.details !== undefined ? { details: record.details } : {}),
    });
    const details = asRecord(record.details) as BastionCliToolDetails | undefined;
    if (details?.kind !== "bastion_cli") continue;
    const input = genericInput;
    const args = Array.isArray(input?.args)
      ? input.args.filter((item): item is string => typeof item === "string")
      : [...details.command];
    toolCalls.push({
      toolCallId:
        typeof record.toolCallId === "string" ? record.toolCallId : undefined,
      args,
      ...(input && "input" in input ? { input: input.input } : {}),
      details,
    });
  }

  return {
    messages,
    finalAnswer,
    toolCalls,
    allToolCalls,
    usage,
    durationMs,
    model,
    stopReason,
  };
}

export function usageFromProvider(value: Usage): EvalUsage {
  return {
    input: value.input,
    output: value.output,
    cacheRead: value.cacheRead,
    cacheWrite: value.cacheWrite,
    totalTokens: value.totalTokens,
    cost: { ...value.cost },
  };
}

export function isProviderFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /api key|auth|oauth|provider|model|rate.?limit|429|network|fetch|timeout|ECONN|ENOTFOUND/i.test(
    message,
  );
}
