import { createHash } from "node:crypto";
import type {
  TeamOpsParams,
  TeamOpsToolDetails,
} from "../teamops/types.ts";
import {
  normalizedCommand,
  readDependencyTopics,
} from "./command-topics.ts";
import type {
  DependencyRequest,
  VerifiedTeamOpsEvidence,
} from "./types.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function commandHash(params: TeamOpsParams): string {
  return createHash("sha256").update(normalizedCommand(params)).digest("hex");
}

export class DerivedMemoryEvidenceRegistry {
  readonly #teamOpsReads = new Map<string, VerifiedTeamOpsEvidence>();

  registerTeamOpsRead(
    params: TeamOpsParams,
    details: TeamOpsToolDetails,
    observedAt = Date.now(),
  ): void {
    if (!details.ok || details.risk !== "read" || !details.freshness) return;
    const invalidationTopics = readDependencyTopics(params.args);
    if (invalidationTopics.length === 0) return;
    const normalizedCommandHash = commandHash(params);
    this.#teamOpsReads.set(normalizedCommandHash, {
      command: [...params.args],
      ...(isObject(params.input) ? { input: params.input } : {}),
      normalizedCommandHash,
      invalidationTopics,
      observedAt,
      sourceSnapshot: details.freshness,
    });
  }

  resolveTeamOpsDependencies(
    requests: readonly DependencyRequest[],
  ): VerifiedTeamOpsEvidence[] {
    const resolved: VerifiedTeamOpsEvidence[] = [];
    const seen = new Set<string>();
    for (const request of requests) {
      const params: TeamOpsParams = {
        args: request.args,
        ...(request.input !== undefined ? { input: request.input } : {}),
      };
      const hash = commandHash(params);
      if (seen.has(hash)) throw new Error("DUPLICATE_DEPENDENCY");
      const evidence = this.#teamOpsReads.get(hash);
      if (!evidence) throw new Error("UNOBSERVED_DEPENDENCY");
      seen.add(hash);
      resolved.push(evidence);
    }
    return resolved;
  }

  clear(): void {
    this.#teamOpsReads.clear();
  }
}
