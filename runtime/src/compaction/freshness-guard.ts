import { parseCommand } from "../bastion-cli/command-policy.ts";
import type {
  BastionCliParams,
  BastionCliToolDetails,
} from "../bastion-cli/types.ts";
import {
  entityKeysForParams,
} from "./extractor.ts";
import type {
  BastionCompactionDetails,
  OperationRecord,
} from "./types.ts";

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
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

function isBastionDetails(value: unknown): value is BastionCliToolDetails {
  const object = asObject(value);
  return object?.kind === "bastion_cli" && typeof object.ok === "boolean";
}

export class BastionFreshnessGuard {
  private unresolved = new Map<string, OperationRecord>();

  load(details: BastionCompactionDetails): void {
    this.unresolved.clear();
    for (const operation of details.operations) {
      if (operation.outcome === "uncertain" && !operation.resolution) {
        this.unresolved.set(operation.operationId, operation);
      }
    }
  }

  observeToolResult(details: unknown): void {
    if (!isBastionDetails(details) || details.risk !== "read" || !details.ok) {
      return;
    }
    const envelope = details.result?.envelope;
    if (!envelope?.ok) return;
    for (const [id, operation] of this.unresolved) {
      const matched = operation.verification.some(
        (verification) =>
          JSON.stringify(verification.args) ===
            JSON.stringify(details.command) &&
          containsExpected(envelope.data, {
            ...verification.expected,
            ...(operation.expectedEffect ?? {}),
          }),
      );
      if (matched) this.unresolved.delete(id);
    }
  }

  blockReason(params: BastionCliParams): string | undefined {
    let risk;
    try {
      risk = parseCommand(params).spec.risk;
    } catch {
      return undefined;
    }
    if (risk === "read") return undefined;
    const keys = new Set(entityKeysForParams(params));
    for (const operation of this.unresolved.values()) {
      const overlaps =
        operation.command.join("\0") === params.args.join("\0") ||
        operation.entityRefs.some((key) => keys.has(key));
      if (!overlaps) continue;
      const readback = operation.verification[0]?.args;
      return `A previous Bastion write may already have taken effect (${operation.errorCode ?? "uncertain result"}). ${
        readback
          ? `Run ${readback.join(" ")} and verify the expected state first.`
          : "Resolve the authoritative state first."
      } Do not replay or overlap the write until it is resolved.`;
    }
    return undefined;
  }
}
