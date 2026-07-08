import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import type { TeamOpsToolDetails } from "../teamops/types.ts";
import {
  isTeamOpsDetailsKind,
  isTeamOpsToolName,
} from "../teamops/types.ts";
import { extractBastionContext } from "../compaction/extractor.ts";
import type {
  AuthorityReference,
  OperationRecord,
} from "../compaction/types.ts";

type AgentMessage = ContextEvent["messages"][number];
type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;

interface MessageLike {
  role?: unknown;
  content?: unknown;
  stopReason?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  details?: unknown;
}

interface ToolCallLocation {
  messageIndex: number;
}

export interface ContextProjectionDiagnostics {
  messagesBefore: number;
  messagesAfter: number;
  completedTurnsProjected: number;
  incompleteTurnsProjected: number;
  conservativeTurnsKept: number;
  toolCallsRemoved: number;
  toolResultsRemoved: number;
  receiptsAdded: number;
  warnings: string[];
}

export interface ContextProjectionResult {
  messages: AgentMessage[];
  diagnostics: ContextProjectionDiagnostics;
}

interface ProjectedTurn {
  messages: AgentMessage[];
  projected: boolean;
  incomplete: boolean;
  conservative: boolean;
  toolCallsRemoved: number;
  toolResultsRemoved: number;
  receiptAdded: boolean;
  warnings: string[];
}

const SAFE_NON_PERSISTED_ERROR_CODES = new Set([
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
  "USER_CANCELLED",
  "APPROVAL_REQUIRED",
]);

const MAX_AUTHORITY_REFS_PER_TURN = 32;
const MAX_RECEIPT_STRING_LENGTH = 256;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isAssistant(message: AgentMessage): message is AssistantMessage {
  return message.role === "assistant";
}

function toolCallBlocks(message: MessageLike): Record<string, unknown>[] {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content
    .map(asObject)
    .filter(
      (block): block is Record<string, unknown> =>
        block?.type === "toolCall" &&
        typeof block.id === "string" &&
        typeof block.name === "string",
    );
}

function textBlocks(message: AssistantMessage): AssistantMessage["content"] {
  return message.content.filter((block) => block.type === "text");
}

interface TerminalAssistant {
  index: number;
  incompleteReason?: string;
}

function terminalAssistant(
  messages: readonly AgentMessage[],
  closedByFollowingUser: boolean,
): TerminalAssistant | undefined {
  const index = messages.length - 1;
  const message = messages[index];
  if (
    !message ||
    !isAssistant(message) ||
    toolCallBlocks(message).length > 0
  ) {
    return undefined;
  }
  if (message.stopReason === "stop" && textBlocks(message).length > 0) {
    return { index };
  }
  if (
    closedByFollowingUser &&
    (message.stopReason === "length" || message.stopReason === "error")
  ) {
    return { index, incompleteReason: message.stopReason };
  }
  return undefined;
}

function validateCompletedToolProtocol(
  messages: readonly AgentMessage[],
  terminalIndex: number,
): { valid: true; calls: number; results: number } | {
  valid: false;
  warning: string;
} {
  const calls = new Map<string, ToolCallLocation>();
  const results = new Map<string, number>();

  for (const [messageIndex, raw] of messages.entries()) {
    const message = raw as MessageLike;
    for (const block of toolCallBlocks(message)) {
      const id = block.id as string;
      if (calls.has(id)) {
        return { valid: false, warning: `DUPLICATE_TOOL_CALL:${id}` };
      }
      calls.set(id, {
        messageIndex,
      });
    }
    if (message.role !== "toolResult") continue;
    if (typeof message.toolCallId !== "string") {
      return { valid: false, warning: "TOOL_RESULT_WITHOUT_ID" };
    }
    if (results.has(message.toolCallId)) {
      return {
        valid: false,
        warning: `DUPLICATE_TOOL_RESULT:${message.toolCallId}`,
      };
    }
    results.set(message.toolCallId, messageIndex);
  }

  for (const [id, call] of calls) {
    const resultIndex = results.get(id);
    if (resultIndex === undefined) {
      return { valid: false, warning: `MISSING_TOOL_RESULT:${id}` };
    }
    if (resultIndex <= call.messageIndex || resultIndex >= terminalIndex) {
      return { valid: false, warning: `INVALID_TOOL_RESULT_ORDER:${id}` };
    }
  }
  for (const id of results.keys()) {
    if (!calls.has(id)) {
      return { valid: false, warning: `ORPHAN_TOOL_RESULT:${id}` };
    }
  }

  return { valid: true, calls: calls.size, results: results.size };
}

function isBastionDetails(value: unknown): value is TeamOpsToolDetails {
  const object = asObject(value);
  return isTeamOpsDetailsKind(object?.kind) && typeof object.ok === "boolean";
}

function validateBastionExtraction(
  messages: readonly AgentMessage[],
  operations: readonly OperationRecord[],
): string[] {
  const operationIds = new Set(operations.map((operation) => operation.operationId));
  const warnings: string[] = [];

  for (const raw of messages) {
    const message = raw as MessageLike;
    if (
      message.role !== "toolResult" ||
      !isTeamOpsToolName(message.toolName)
    ) {
      continue;
    }
    if (!isBastionDetails(message.details)) {
      warnings.push(
        `MISSING_BASTION_DETAILS:${String(message.toolCallId ?? "unknown")}`,
      );
      continue;
    }
    const details = message.details;
    if (details.risk === "read") continue;
    if (
      (details.risk === "write" || details.risk === "compute_write") &&
      typeof message.toolCallId === "string" &&
      operationIds.has(message.toolCallId)
    ) {
      continue;
    }
    if (
      !details.ok &&
      details.error?.code &&
      SAFE_NON_PERSISTED_ERROR_CODES.has(details.error.code)
    ) {
      continue;
    }
    warnings.push(
      `UNSAFE_UNEXTRACTED_BASTION_RESULT:${String(
        message.toolCallId ?? "unknown",
      )}`,
    );
  }
  return warnings;
}

function boundedString(value: string): string {
  return value.length <= MAX_RECEIPT_STRING_LENGTH
    ? value
    : `${value.slice(0, MAX_RECEIPT_STRING_LENGTH - 1)}…`;
}

function boundedArgs(args: readonly string[]): string[] {
  return args.map(boundedString);
}

function authorityReceipt(reference: AuthorityReference) {
  return {
    key: boundedString(reference.key),
    freshness: reference.freshness,
    refresh: boundedArgs(reference.refreshArgs),
  };
}

function operationReceipt(operation: OperationRecord) {
  return {
    command: boundedArgs(operation.command),
    risk: operation.risk,
    outcome: operation.outcome,
    ...(operation.errorCode
      ? { error_code: boundedString(operation.errorCode) }
      : {}),
    entity_refs: operation.entityRefs.map(boundedString),
    ...(operation.expectedEffect
      ? { expected_effect: operation.expectedEffect }
      : {}),
    verification: operation.verification.map((verification) => ({
      command: boundedArgs(verification.args),
      expected: verification.expected,
    })),
    ...(operation.outcome === "uncertain"
      ? { required_next_step: "read back authoritative state before replaying" }
      : {}),
  };
}

function escapeReceiptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e");
}

function buildReceipt(messages: readonly AgentMessage[]): {
  text?: string;
  warnings: string[];
} {
  const extraction = extractBastionContext(messages);
  const unsafeWarnings = validateBastionExtraction(
    messages,
    extraction.operations,
  );
  if (unsafeWarnings.length > 0) {
    return {
      warnings: [...extraction.warnings, ...unsafeWarnings],
    };
  }

  const references = new Map<string, AuthorityReference>();
  for (const reference of extraction.authorityRefs) {
    references.set(reference.key, reference);
  }
  const selectedReferences = [...references.values()].slice(
    0,
    MAX_AUTHORITY_REFS_PER_TURN,
  );
  if (selectedReferences.length === 0 && extraction.operations.length === 0) {
    return { warnings: extraction.warnings };
  }

  const receipt = {
    notice:
      "Historical execution metadata only. Entity observations are stale; refresh before relying on them.",
    authority_refs: selectedReferences.map(authorityReceipt),
    ...(references.size > selectedReferences.length
      ? { omitted_authority_ref_count: references.size - selectedReferences.length }
      : {}),
    operations: extraction.operations.map(operationReceipt),
  };
  return {
    text: `<bastion_context_receipt>${escapeReceiptJson(receipt)}</bastion_context_receipt>`,
    warnings: extraction.warnings,
  };
}

function finalAssistantWithReceipt(
  message: AssistantMessage,
  receipt: string | undefined,
  incompleteReason?: string,
): AssistantMessage {
  const content = textBlocks(message);
  const incompleteMarker = incompleteReason
    ? {
        type: "text" as const,
        text:
          `<assistant_response_status complete="false" reason="${boundedString(
            incompleteReason,
          )}" />`,
      }
    : undefined;
  return {
    ...message,
    content: [
      ...(receipt ? [{ type: "text" as const, text: receipt }] : []),
      ...(incompleteMarker ? [incompleteMarker] : []),
      ...content,
    ],
  };
}

function projectTurn(
  messages: readonly AgentMessage[],
  closedByFollowingUser: boolean,
): ProjectedTurn {
  const terminal = terminalAssistant(messages, closedByFollowingUser);
  if (!terminal) {
    return {
      messages: [...messages],
      projected: false,
      incomplete: false,
      conservative: false,
      toolCallsRemoved: 0,
      toolResultsRemoved: 0,
      receiptAdded: false,
      warnings: [],
    };
  }
  const terminalIndex = terminal.index;

  const protocol = validateCompletedToolProtocol(messages, terminalIndex);
  if (!protocol.valid) {
    return {
      messages: [...messages],
      projected: false,
      incomplete: false,
      conservative: true,
      toolCallsRemoved: 0,
      toolResultsRemoved: 0,
      receiptAdded: false,
      warnings: [protocol.warning],
    };
  }

  const unsupported = messages
    .slice(1, terminalIndex)
    .find(
      (message) =>
        message.role !== "assistant" && message.role !== "toolResult",
    );
  if (unsupported) {
    return {
      messages: [...messages],
      projected: false,
      incomplete: false,
      conservative: true,
      toolCallsRemoved: 0,
      toolResultsRemoved: 0,
      receiptAdded: false,
      warnings: [`UNSUPPORTED_TURN_MESSAGE:${unsupported.role}`],
    };
  }

  const receipt = buildReceipt(messages);
  if (
    receipt.warnings.some(
      (warning) =>
        warning.startsWith("MISSING_BASTION_DETAILS:") ||
        warning.startsWith("UNSAFE_UNEXTRACTED_BASTION_RESULT:"),
    )
  ) {
    return {
      messages: [...messages],
      projected: false,
      incomplete: false,
      conservative: true,
      toolCallsRemoved: 0,
      toolResultsRemoved: 0,
      receiptAdded: false,
      warnings: receipt.warnings,
    };
  }

  const first = messages[0];
  const final = messages[terminalIndex];
  if (!first || first.role !== "user" || !final || !isAssistant(final)) {
    return {
      messages: [...messages],
      projected: false,
      incomplete: false,
      conservative: true,
      toolCallsRemoved: 0,
      toolResultsRemoved: 0,
      receiptAdded: false,
      warnings: ["INVALID_COMPLETED_TURN_BOUNDARY"],
    };
  }
  return {
    messages: [
      first,
      finalAssistantWithReceipt(
        final,
        receipt.text,
        terminal.incompleteReason,
      ),
    ],
    projected: true,
    incomplete: terminal.incompleteReason !== undefined,
    conservative: false,
    toolCallsRemoved: protocol.calls,
    toolResultsRemoved: protocol.results,
    receiptAdded: receipt.text !== undefined,
    warnings: receipt.warnings,
  };
}

export function projectContext(
  messages: readonly AgentMessage[],
): ContextProjectionResult {
  const projected: AgentMessage[] = [];
  const diagnostics: ContextProjectionDiagnostics = {
    messagesBefore: messages.length,
    messagesAfter: 0,
    completedTurnsProjected: 0,
    incompleteTurnsProjected: 0,
    conservativeTurnsKept: 0,
    toolCallsRemoved: 0,
    toolResultsRemoved: 0,
    receiptsAdded: 0,
    warnings: [],
  };

  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (!message) break;
    if (message.role !== "user") {
      projected.push(message);
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < messages.length && messages[end]?.role !== "user") {
      end += 1;
    }
    const turn = projectTurn(messages.slice(index, end), end < messages.length);
    projected.push(...turn.messages);
    if (turn.projected) diagnostics.completedTurnsProjected += 1;
    if (turn.incomplete) diagnostics.incompleteTurnsProjected += 1;
    if (turn.conservative) diagnostics.conservativeTurnsKept += 1;
    diagnostics.toolCallsRemoved += turn.toolCallsRemoved;
    diagnostics.toolResultsRemoved += turn.toolResultsRemoved;
    if (turn.receiptAdded) diagnostics.receiptsAdded += 1;
    diagnostics.warnings.push(...turn.warnings);
    index = end;
  }

  diagnostics.messagesAfter = projected.length;
  return { messages: projected, diagnostics };
}
