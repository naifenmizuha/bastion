import type {
  AuthorityReference,
  BastionCompactionDetails,
  BastionExtraction,
  BastionNarrativeState,
  CompactionTrigger,
  OperationRecord,
  PendingAction,
  ReadObservation,
} from "./types.ts";
import { parseCommand } from "../teamops/command-policy.ts";
import {
  BASTION_COMPACTION_KIND,
  BASTION_COMPACTION_POLICY_VERSION,
  BASTION_COMPACTION_SCHEMA_VERSION,
  EMPTY_NARRATIVE,
} from "./types.ts";

const MAX_CONFIRMED_OPERATIONS = 32;
const MAX_WARNINGS = 32;
const FALLBACK_USER_CHARS = 6000;

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function isBastionCompactionDetails(
  value: unknown,
): value is BastionCompactionDetails {
  const object = asObject(value);
  return (
    object?.kind === BASTION_COMPACTION_KIND &&
    object.schemaVersion === BASTION_COMPACTION_SCHEMA_VERSION &&
    Array.isArray(object.authorityRefs) &&
    Array.isArray(object.operations) &&
    typeof object.narrative === "object" &&
    object.narrative !== null
  );
}

function containsExpected(
  value: unknown,
  expected: Readonly<Record<string, string | number | boolean>>,
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsExpected(item, expected));
  }
  const object = asObject(value);
  if (!object) return false;
  if (
    Object.entries(expected).every(
      ([key, expectedValue]) => object[key] === expectedValue,
    )
  ) {
    return true;
  }
  return Object.values(object).some((item) =>
    containsExpected(item, expected),
  );
}

function resolveOperation(
  operation: OperationRecord,
  reads: readonly ReadObservation[],
): OperationRecord {
  if (operation.outcome !== "uncertain" || operation.resolution) {
    return operation;
  }
  for (const verification of operation.verification) {
    const read = reads.find(
      (item) =>
        JSON.stringify(item.args) === JSON.stringify(verification.args) &&
        containsExpected(item.data, {
          ...verification.expected,
          ...(operation.expectedEffect ?? {}),
        }),
    );
    if (read) {
      return {
        ...operation,
        resolution: {
          outcome: "confirmed",
          evidenceCommand: [...read.args],
          resolvedAt: read.observedAt,
        },
      };
    }
  }
  return operation;
}

function mergeReferences(
  previous: readonly AuthorityReference[],
  incoming: readonly AuthorityReference[],
  unresolvedKeys: ReadonlySet<string>,
): AuthorityReference[] {
  const byKey = new Map<string, AuthorityReference>();
  for (const item of [...previous, ...incoming]) {
    const old = byKey.get(item.key);
    const freshness = unresolvedKeys.has(item.key)
      ? "must_refresh"
      : item.freshness;
    if (!old || item.observedAt >= old.observedAt) {
      byKey.set(item.key, { ...item, freshness });
    } else if (unresolvedKeys.has(item.key)) {
      byKey.set(item.key, { ...old, freshness: "must_refresh" });
    }
  }
  return [...byKey.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function isValidRefreshArgs(args: readonly string[]): boolean {
  try {
    return parseCommand({ args: [...args] }).spec.risk === "read";
  } catch {
    return false;
  }
}

function pendingFor(operations: readonly OperationRecord[]): PendingAction[] {
  return operations
    .filter(
      (operation) =>
        operation.outcome === "uncertain" && !operation.resolution,
    )
    .map((operation) => {
      const args = operation.verification[0]?.args;
      return {
        actionId: `resolve:${operation.operationId}`,
        kind: "resolve_uncertain_write" as const,
        description: `Resolve uncertain write: ${operation.command.join(" ")}`,
        requiredBefore: "any replay or overlapping write",
        ...(args ? { args: [...args] } : {}),
      };
    });
}

function capOperations(operations: OperationRecord[]): {
  operations: OperationRecord[];
  dropped: number;
} {
  const unresolved = operations.filter(
    (item) => item.outcome === "uncertain" && !item.resolution,
  );
  const retained = operations
    .filter((item) => !unresolved.includes(item))
    .sort((left, right) => right.observedAt - left.observedAt)
    .slice(0, MAX_CONFIRMED_OPERATIONS);
  const combined = [...unresolved, ...retained].sort(
    (left, right) => left.observedAt - right.observedAt,
  );
  return {
    operations: combined,
    dropped: operations.length - combined.length,
  };
}

function capReferences(
  references: AuthorityReference[],
  unresolvedKeys: ReadonlySet<string>,
): { references: AuthorityReference[]; dropped: number } {
  const required = references.filter((item) => unresolvedKeys.has(item.key));
  const optional = references
    .filter((item) => !unresolvedKeys.has(item.key))
    .sort((left, right) => right.observedAt - left.observedAt)
    .slice(0, Math.max(0, 64 - required.length));
  const retained = [...required, ...optional].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  return { references: retained, dropped: references.length - retained.length };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function emergencyNarrative(
  messages: readonly unknown[],
  previous?: BastionNarrativeState,
  legacySummary?: string,
): BastionNarrativeState {
  const userMessages: string[] = [];
  let chars = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asObject(messages[index]);
    if (message?.role !== "user") continue;
    let content = "";
    if (typeof message.content === "string") {
      content = message.content;
    } else if (Array.isArray(message.content)) {
      content = message.content
        .map((block) => asObject(block))
        .filter(
          (block): block is Record<string, unknown> =>
            block?.type === "text" && typeof block.text === "string",
        )
        .map((block) => String(block.text))
        .join("\n");
    }
    if (!content) continue;
    const remaining = FALLBACK_USER_CHARS - chars;
    if (remaining <= 0) break;
    userMessages.unshift(content.slice(0, remaining));
    chars += Math.min(content.length, remaining);
  }
  return {
    ...(previous ?? EMPTY_NARRATIVE),
    goals: uniqueStrings([...(previous?.goals ?? []), ...userMessages]),
    inProgress: uniqueStrings([
      ...(previous?.inProgress ?? []),
      ...(legacySummary
        ? [`Legacy checkpoint retained for migration:\n${legacySummary.slice(0, 6000)}`]
        : []),
    ]),
    nextSteps: uniqueStrings([
      ...(previous?.nextSteps ?? []),
      "Reconstruct detailed narrative from recent raw messages or session history if needed.",
    ]),
  };
}

export function buildCheckpoint(options: {
  previous?: BastionCompactionDetails;
  extraction: BastionExtraction;
  narrative: BastionNarrativeState;
  trigger: CompactionTrigger;
  willRetry: boolean;
  generatedAt: number;
  sourceMessageCount: number;
  fallbackUsed: boolean;
  readFiles: string[];
  modifiedFiles: string[];
  warnings?: string[];
}): BastionCompactionDetails {
  const operationMap = new Map<string, OperationRecord>();
  for (const operation of [
    ...(options.previous?.operations ?? []),
    ...options.extraction.operations,
  ]) {
    operationMap.set(operation.operationId, operation);
  }
  const resolvedOperations = [...operationMap.values()].map((operation) =>
    resolveOperation(operation, options.extraction.reads),
  );
  const capped = capOperations(resolvedOperations);
  const unresolvedKeys = new Set(
    capped.operations
      .filter(
        (operation) =>
          operation.outcome === "uncertain" && !operation.resolution,
      )
      .flatMap((operation) => operation.entityRefs),
  );
  const mergedAuthorityRefs = mergeReferences(
    options.previous?.authorityRefs ?? [],
    options.extraction.authorityRefs,
    unresolvedKeys,
  ).map((item) => {
    const refreshed = options.extraction.reads.some(
      (read) =>
        JSON.stringify(read.args) === JSON.stringify(item.refreshArgs),
    );
    return refreshed && !unresolvedKeys.has(item.key)
      ? { ...item, freshness: "stale_hint" as const }
      : item;
  });
  const validAuthorityRefs = mergedAuthorityRefs.filter((item) =>
    isValidRefreshArgs(item.refreshArgs),
  );
  const rejectedRefreshes =
    mergedAuthorityRefs.length - validAuthorityRefs.length;
  const cappedRefs = capReferences(validAuthorityRefs, unresolvedKeys);

  return {
    kind: BASTION_COMPACTION_KIND,
    schemaVersion: BASTION_COMPACTION_SCHEMA_VERSION,
    policyVersion: BASTION_COMPACTION_POLICY_VERSION,
    generatedAt: options.generatedAt,
    trigger: options.trigger,
    willRetry: options.willRetry,
    narrative: options.narrative,
    authorityRefs: cappedRefs.references,
    operations: capped.operations,
    pendingActions: pendingFor(capped.operations),
    readFiles: uniqueStrings([
      ...(options.previous?.readFiles ?? []),
      ...options.readFiles,
    ]),
    modifiedFiles: uniqueStrings([
      ...(options.previous?.modifiedFiles ?? []),
      ...options.modifiedFiles,
    ]),
    diagnostics: {
      fallbackUsed: options.fallbackUsed,
      sourceMessageCount: options.sourceMessageCount,
      droppedResolvedOperations:
        (options.previous?.diagnostics.droppedResolvedOperations ?? 0) +
        capped.dropped,
      warnings: uniqueStrings([
        ...(options.previous?.diagnostics.warnings ?? []),
        ...options.extraction.warnings,
        ...(options.warnings ?? []),
        ...(rejectedRefreshes > 0
          ? [`REJECTED_REFRESH_COMMANDS:${rejectedRefreshes}`]
          : []),
        ...(cappedRefs.dropped > 0
          ? [`DROPPED_AUTHORITY_REFS:${cappedRefs.dropped}`]
          : []),
      ]).slice(-MAX_WARNINGS),
    },
  };
}

function command(args: readonly string[]): string {
  return `\`${args.join(" ")}\``;
}

function bullets(values: readonly string[], empty = "(none)"): string {
  return values.length > 0
    ? values.map((value) => `- ${value}`).join("\n")
    : `- ${empty}`;
}

function renderOperation(operation: OperationRecord): string {
  const verification = operation.verification[0];
  const suffix = verification
    ? `; verify with ${command(verification.args)}`
    : "";
  const refs =
    operation.entityRefs.length > 0
      ? ` [${operation.entityRefs.join(", ")}]`
      : "";
  return `- ${command(operation.command)}${refs}${suffix}`;
}

export function renderCheckpoint(details: BastionCompactionDetails): string {
  const confirmed = details.operations.filter(
    (operation) =>
      operation.outcome === "confirmed" ||
      operation.resolution?.outcome === "confirmed",
  );
  const uncertain = details.operations.filter(
    (operation) =>
      operation.outcome === "uncertain" && !operation.resolution,
  );
  const decisions = details.narrative.decisions.map((item) => {
    const actor = item.actor === "user" ? "user" : "assistant suggestion";
    return `[${actor}] ${item.decision}${
      item.rationale ? ` — ${item.rationale}` : ""
    }`;
  });
  const refs = details.authorityRefs.map(
    (item) =>
      `${item.key} — refresh: ${command(item.refreshArgs)} — ${item.reason}`,
  );
  const uncertainLines = uncertain.map((item) => {
    const readback = item.verification[0]?.args;
    return `${command(item.command)} may have taken effect${
      item.errorCode ? ` (${item.errorCode})` : ""
    }. ${
      readback
        ? `First run ${command(readback)}.`
        : "Resolve its authoritative state first."
    } Do not repeat the write until resolved.`;
  });
  const pending = details.pendingActions.map(
    (item, index) =>
      `${index + 1}. ${item.description}${
        item.args ? ` — ${command(item.args)}` : ""
      }`,
  );

  return `# Bastion Context Checkpoint

## User Goals
${bullets(details.narrative.goals)}

## Constraints
${bullets(details.narrative.constraints)}

## Decisions
${bullets(decisions)}

## Workflow State
### Completed
${bullets(details.narrative.completed)}
### In Progress
${bullets(details.narrative.inProgress)}
### Blocked
${bullets(details.narrative.blocked)}

## Authoritative Data Policy
- Bastion database facts below are references, not cached current truth.
- Refresh a referenced entity with teamops before relying on its mutable fields.

## Authority References
${bullets(refs)}

## Confirmed Changes
${confirmed.length > 0 ? confirmed.map(renderOperation).join("\n") : "- (none)"}

## Uncertain Writes — Resolve Before Any Replay
${bullets(uncertainLines)}

## Pending Actions
${pending.length > 0 ? pending.join("\n") : "1. (none)"}

## Suggested Next Steps
${details.narrative.nextSteps
  .map((item, index) => `${index + 1}. ${item}`)
  .join("\n") || "1. (none)"}

## Continuation Rules
- Treat only teamops as authoritative for persisted team facts.
- Distinguish authoritative facts, suggestions, candidates, and persisted changes.
- Never replay an uncertain write before authoritative read-back.`;
}
