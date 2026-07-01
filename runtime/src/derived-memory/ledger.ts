import { createHash, randomUUID } from "node:crypto";
import type {
  BastionCliParams,
  BastionCliToolDetails,
} from "../bastion-cli/types.ts";
import {
  normalizedCommand,
  readDependencyTopics,
  writeChangeTopics,
} from "./command-topics.ts";
import type {
  ChangeEventPublisher,
  DependencyRequest,
  SuccessfulReadObservation,
} from "./types.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function commandHash(params: BastionCliParams): string {
  return createHash("sha256").update(normalizedCommand(params)).digest("hex");
}

export class CliObservationLedger {
  readonly #reads = new Map<string, SuccessfulReadObservation>();

  record(
    toolCallId: string,
    params: BastionCliParams,
    details: BastionCliToolDetails,
    publisher: ChangeEventPublisher,
    observedAt = Date.now(),
  ): void {
    if (!details.ok || !details.risk) return;
    if (details.risk === "read") {
      const invalidationTopics = readDependencyTopics(params.args);
      if (invalidationTopics.length === 0) return;
      const normalizedCommandHash = commandHash(params);
      this.#reads.set(normalizedCommandHash, {
        command: [...params.args],
        ...(isObject(params.input) ? { input: params.input } : {}),
        normalizedCommandHash,
        invalidationTopics,
        observedAt,
      });
      return;
    }

    const topics = writeChangeTopics(params.args);
    if (topics.length === 0) return;
    publisher.publish({
      id: randomUUID(),
      topics,
      occurredAt: observedAt,
      sourceToolCallId: toolCallId,
    });
  }

  resolveDependencies(
    requests: readonly DependencyRequest[],
  ): SuccessfulReadObservation[] {
    const resolved: SuccessfulReadObservation[] = [];
    const seen = new Set<string>();
    for (const request of requests) {
      const params: BastionCliParams = {
        args: request.args,
        ...(request.input !== undefined ? { input: request.input } : {}),
      };
      const hash = commandHash(params);
      if (seen.has(hash)) {
        throw new Error("DUPLICATE_DEPENDENCY");
      }
      const observation = this.#reads.get(hash);
      if (!observation) {
        throw new Error("UNOBSERVED_DEPENDENCY");
      }
      seen.add(hash);
      resolved.push(observation);
    }
    return resolved;
  }

  clear(): void {
    this.#reads.clear();
  }
}
