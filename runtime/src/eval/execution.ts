import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  isTeamOpsDetailsKind,
  isTeamOpsToolName,
} from "../teamops/types.ts";
import type {
  DatabaseChanges,
  ExecutionFlow,
  ExecutionStep,
  TokenUsage,
} from "./types.ts";
import { EMPTY_TOKEN_USAGE } from "./types.ts";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : undefined;
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .filter((item): item is RecordValue => Boolean(record(item)))
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => String(item.text).trim())
    .filter(Boolean)
    .join("\n");
}

function normalizedUsage(value: unknown): TokenUsage {
  const source = record(value);
  const cost = record(source?.cost);
  const number = (candidate: unknown) =>
    typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
  if (!source) return { ...EMPTY_TOKEN_USAGE };
  return {
    requestCount: 1,
    input: number(source.input),
    output: number(source.output),
    cacheRead: number(source.cacheRead),
    cacheWrite: number(source.cacheWrite),
    total: number(source.totalTokens) || number(source.input) + number(source.output),
    ...(cost
      ? {
          cost: {
            input: number(cost.input),
            output: number(cost.output),
            cacheRead: number(cost.cacheRead),
            cacheWrite: number(cost.cacheWrite),
            total: number(cost.total),
          },
        }
      : {}),
  };
}

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  const cost = left.cost || right.cost
    ? {
        input: (left.cost?.input ?? 0) + (right.cost?.input ?? 0),
        output: (left.cost?.output ?? 0) + (right.cost?.output ?? 0),
        cacheRead: (left.cost?.cacheRead ?? 0) + (right.cost?.cacheRead ?? 0),
        cacheWrite: (left.cost?.cacheWrite ?? 0) + (right.cost?.cacheWrite ?? 0),
        total: (left.cost?.total ?? 0) + (right.cost?.total ?? 0),
      }
    : undefined;
  return {
    requestCount: left.requestCount + right.requestCount,
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    total: left.total + right.total,
    ...(cost ? { cost } : {}),
  };
}

function parseToolArguments(value: unknown): RecordValue {
  if (record(value)) return value as RecordValue;
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value)) ?? {};
    } catch {
      return {};
    }
  }
  return {};
}

function nowIso(): string {
  return new Date().toISOString();
}

export class ExecutionRecorder {
  readonly #steps: ExecutionStep[] = [];
  readonly #relations: Array<{ fromStepId: string; toStepId: string; kind: "contains" | "calls" | "uses" | "guides" | "verifies" | "changes" | "depends_on" }> = [];
  readonly #open = new Map<string, ExecutionStep>();
  readonly #toolSteps = new Map<string, ExecutionStep>();
  readonly #modelSteps: ExecutionStep[] = [];
  readonly #teamOpsSteps: ExecutionStep[] = [];
  readonly #memorySteps: ExecutionStep[] = [];
  readonly #startedAt = Date.now();
  #order = 0;
  #sessionId: string | undefined;
  #turnId: string | undefined;

  setSession(sessionId: string | undefined): void {
    this.#sessionId = sessionId;
  }

  setTurn(turnId: string | undefined): void {
    this.#turnId = turnId;
  }

  private addStep(
    kind: ExecutionStep["kind"],
    name: string,
    parentStepId?: string,
    input?: unknown,
    toolCallId?: string,
  ): ExecutionStep {
    const step: ExecutionStep = {
      stepId: `step-${String(this.#steps.length + 1).padStart(4, "0")}`,
      ...(parentStepId ? { parentStepId } : {}),
      agentId: "root",
      ...(this.#sessionId ? { sessionId: this.#sessionId } : {}),
      ...(this.#turnId ? { turnId: this.#turnId } : {}),
      order: ++this.#order,
      kind,
      name,
      status: "running",
      startedAt: nowIso(),
      ...(input === undefined ? {} : { input }),
      ...(toolCallId ? { toolCallId } : {}),
    };
    this.#steps.push(step);
    if (parentStepId) {
      this.#relations.push({ fromStepId: parentStepId, toStepId: step.stepId, kind: "contains" });
    }
    return step;
  }

  private finish(step: ExecutionStep, status: ExecutionStep["status"], output?: unknown, error?: { code?: string; message: string }): void {
    step.status = status;
    step.endedAt = nowIso();
    step.durationMs = Math.max(0, Date.now() - new Date(step.startedAt).getTime());
    if (output !== undefined) step.output = output;
    if (error) step.error = error;
  }

  recordPrompt(prompt: string): string {
    const step = this.addStep("user_prompt", "用户提示", undefined, prompt);
    this.finish(step, "succeeded", prompt);
    return step.stepId;
  }

  onEvent(event: AgentSessionEvent): void {
    const raw = event as unknown as RecordValue;
    const eventType = raw.type;
    if (eventType === "message_start") {
      const message = record(raw.message);
      if (message?.role === "assistant") {
        const step = this.addStep("model_request", "模型请求");
        this.#modelSteps.push(step);
        this.#open.set(`model:${this.#modelSteps.length}`, step);
      } else if (message?.role === "user") {
        const step = this.addStep("user_prompt", "用户提示", undefined, message.content);
        this.finish(step, "succeeded", message.content);
      }
      return;
    }
    if (eventType === "message_end") {
      const message = record(raw.message);
      if (message?.role !== "assistant") return;
      const step = this.#modelSteps.at(-1);
      if (!step) return;
      const usage = normalizedUsage(message.usage);
      step.tokenUsage = usage;
      this.finish(step, "succeeded", message.content);
      this.#open.delete(`model:${this.#modelSteps.length}`);
      const answer = text(message.content);
      if (answer) {
        const answerStep = this.addStep("assistant_answer", "助手回答", step.stepId, answer);
        this.finish(answerStep, "succeeded", answer);
      }
      return;
    }
    if (eventType === "tool_execution_start") {
      const toolCallId = typeof raw.toolCallId === "string" ? raw.toolCallId : undefined;
      if (!toolCallId) return;
      const step = this.addStep(
        "tool",
        typeof raw.toolName === "string" ? raw.toolName : "unknown",
        this.#modelSteps.at(-1)?.stepId,
        raw.args,
        toolCallId,
      );
      this.#toolSteps.set(toolCallId, step);
      const args = parseToolArguments(raw.args);
      if (isTeamOpsToolName(raw.toolName)) {
        const child = this.addStep("teamops_command", "teamops 命令", step.stepId, args, toolCallId);
        this.#teamOpsSteps.push(child);
      } else if (raw.toolName === "derived_memory") {
        const child = this.addStep("memory_action", "记忆操作", step.stepId, args, toolCallId);
        this.#memorySteps.push(child);
      } else if (raw.toolName === "read") {
        const readArgs = parseToolArguments(args);
        const path = typeof readArgs.path === "string" ? readArgs.path : "";
        if (path.includes("/skills/") || path.startsWith("skills/")) {
          const kind: "skill" | "reference_document" = path.endsWith("SKILL.md") ? "skill" : "reference_document";
          const child = this.addStep(kind, kind === "skill" ? "Skill" : "参考文档", step.stepId, { path }, toolCallId);
          this.finish(child, "succeeded", { path });
        }
      }
      return;
    }
    if (eventType === "tool_execution_end") {
      const toolCallId = typeof raw.toolCallId === "string" ? raw.toolCallId : undefined;
      const step = toolCallId ? this.#toolSteps.get(toolCallId) : undefined;
      if (step) {
        this.finish(
          step,
          raw.isError === true ? "failed" : "succeeded",
          raw.result,
          raw.isError === true ? { message: text(raw.result) || "工具调用失败" } : undefined,
        );
      }
      const result = record(raw.result);
      const details = record(result?.details);
      if (toolCallId && isTeamOpsDetailsKind(details?.kind)) {
        const teamops = this.#teamOpsSteps.find((item) => item.toolCallId === toolCallId);
        if (teamops) {
          this.finish(teamops, details.ok === true ? "succeeded" : "failed", details);
          if (details.approved !== undefined) {
            const approval = this.addStep("write_confirmation", details.approved ? "写入已允许" : "写入已拒绝", teamops.stepId, {
              approved: details.approved,
            }, toolCallId);
            this.finish(approval, details.approved ? "succeeded" : "cancelled", details.approved);
          }
          if (Array.isArray(details.verification)) {
            for (const verification of details.verification) {
              const item = record(verification);
              const verificationStep = this.addStep("result_verification", "结果验证", teamops.stepId, item, toolCallId);
              this.finish(verificationStep, item?.matched === true ? "succeeded" : "failed", item);
            }
          }
        }
      }
      if (toolCallId && step?.name === "derived_memory") {
        const memory = this.#memorySteps.find((item) => item.toolCallId === toolCallId);
        if (memory) {
          const failed = raw.isError === true || details?.ok === false;
          this.finish(
            memory,
            failed ? "failed" : "succeeded",
            details ?? raw.result,
            failed ? { message: text(raw.result) || "派生记忆操作失败" } : undefined,
          );
        }
      }
      return;
    }
    if (eventType === "auto_retry_start") {
      const retry = this.addStep("retry", "自动重试", this.#modelSteps.at(-1)?.stepId, raw);
      this.finish(retry, "succeeded", raw);
      return;
    }
    if (eventType === "compaction_start" || eventType === "compaction_end") {
      const compaction = this.addStep("context_compaction", "上下文压缩", undefined, raw);
      this.finish(compaction, "succeeded", raw);
    }
  }

  addDatabaseChange(changes: DatabaseChanges, parentStepId?: string): void {
    if (!Object.keys(changes.changedTables).length) return;
    const parent = parentStepId ?? this.#teamOpsSteps.at(-1)?.stepId;
    const step = this.addStep("database_change", "数据库变化", parent, changes);
    this.finish(step, "succeeded", changes);
    if (parent) this.#relations.push({ fromStepId: parent, toStepId: step.stepId, kind: "changes" });
  }

  get lastTeamOpsStepId(): string | undefined {
    return this.#teamOpsSteps.at(-1)?.stepId;
  }

  get lastMemoryStepId(): string | undefined {
    return this.#memorySteps.at(-1)?.stepId;
  }

  get agentUsage(): TokenUsage {
    return this.#modelSteps.reduce((total, step) => addUsage(total, step.tokenUsage ?? EMPTY_TOKEN_USAGE), EMPTY_TOKEN_USAGE);
  }

  get flow(): ExecutionFlow {
    return {
      steps: this.#steps.map((step) => ({ ...step })),
      relations: [...this.#relations],
    };
  }
}

export function textContent(value: unknown): string {
  return text(value);
}

export function usageFromMessages(messages: readonly unknown[]): TokenUsage {
  return messages.reduce<TokenUsage>((usage, raw) => {
    const message = record(raw);
    return message?.role === "assistant"
      ? addUsage(usage, normalizedUsage(message.usage))
      : usage;
  }, { ...EMPTY_TOKEN_USAGE });
}

export function finalAssistantAnswer(messages: readonly unknown[]): string {
  let answer = "";
  for (const raw of messages) {
    const message = record(raw);
    if (message?.role === "assistant") {
      const content = text(message.content);
      if (content) answer = content;
    }
  }
  return answer;
}

export function stopReason(messages: readonly unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = record(messages[index]);
    if (message?.role === "assistant" && typeof message.stopReason === "string") return message.stopReason;
  }
  return undefined;
}

export function modelFromMessages(messages: readonly unknown[]): { provider: string; id: string } | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = record(messages[index]);
    if (message?.role === "assistant" && typeof message.provider === "string" && typeof message.model === "string") {
      return { provider: message.provider, id: message.model };
    }
  }
  return undefined;
}
