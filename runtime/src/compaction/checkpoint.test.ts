import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCheckpoint,
  emergencyNarrative,
  renderCheckpoint,
} from "./checkpoint.ts";
import type {
  BastionExtraction,
  BastionNarrativeState,
  OperationRecord,
} from "./types.ts";

const narrative: BastionNarrativeState = {
  goals: ["Prepare lineup for game 12"],
  constraints: ["Do not use 张三 as pitcher"],
  decisions: [
    {
      actor: "assistant",
      decision: "Prefer defense",
      rationale: "Recent errors",
    },
  ],
  completed: ["Read the game"],
  inProgress: ["Resolve score write"],
  blocked: [],
  nextSteps: ["Read game 12"],
};

function extraction(
  operations: OperationRecord[],
  reads: BastionExtraction["reads"] = [],
): BastionExtraction {
  return {
    authorityRefs: [
      {
        key: "game:12",
        kind: "game",
        identifiers: { id: 12 },
        refreshArgs: ["game", "read", "--id", "12"],
        observedAt: 2,
        freshness: "must_refresh",
        reason: "target game",
      },
    ],
    operations,
    reads,
    warnings: [],
  };
}

function uncertainOperation(): OperationRecord {
  return {
    operationId: "call-1",
    command: ["game", "score", "set"],
    risk: "write",
    entityRefs: ["game:12"],
    outcome: "uncertain",
    errorCode: "WRITE_VERIFICATION_FAILED",
    expectedEffect: { id: 12, own_score: 5, opponent_score: 3 },
    verification: [
      {
        args: ["game", "read", "--id", "12"],
        expected: { id: 12, own_score: 5, opponent_score: 3 },
      },
    ],
    observedAt: 2,
  };
}

describe("Bastion checkpoint", () => {
  it("renders authoritative references and unresolved write rules", () => {
    const details = buildCheckpoint({
      extraction: extraction([uncertainOperation()]),
      narrative,
      trigger: "threshold",
      willRetry: false,
      generatedAt: 3,
      sourceMessageCount: 2,
      fallbackUsed: false,
      readFiles: [],
      modifiedFiles: [],
    });
    const summary = renderCheckpoint(details);

    assert.match(summary, /# Bastion Context Checkpoint/);
    assert.match(summary, /game read --id 12/);
    assert.match(summary, /WRITE_VERIFICATION_FAILED/);
    assert.match(summary, /Do not repeat the write until resolved/);
    assert.match(summary, /\[assistant suggestion\] Prefer defense/);
    assert.equal(details.pendingActions.length, 1);
  });

  it("resolves an uncertain write only with matching read-back evidence", () => {
    const details = buildCheckpoint({
      extraction: extraction(
        [uncertainOperation()],
        [
          {
            args: ["game", "read", "--id", "12"],
            data: {
              id: 12,
              own_score: 5,
              opponent_score: 3,
            },
            observedAt: 4,
          },
        ],
      ),
      narrative,
      trigger: "threshold",
      willRetry: false,
      generatedAt: 5,
      sourceMessageCount: 2,
      fallbackUsed: false,
      readFiles: [],
      modifiedFiles: [],
    });

    assert.equal(details.operations[0]?.resolution?.outcome, "confirmed");
    assert.equal(details.pendingActions.length, 0);
    assert.equal(details.authorityRefs[0]?.freshness, "stale_hint");
  });

  it("rejects a persisted refresh reference that is not a read command", () => {
    const unsafeExtraction = extraction([]);
    unsafeExtraction.authorityRefs[0] = {
      ...unsafeExtraction.authorityRefs[0]!,
      refreshArgs: ["game", "score", "set"],
    };
    const details = buildCheckpoint({
      extraction: unsafeExtraction,
      narrative,
      trigger: "threshold",
      willRetry: false,
      generatedAt: 5,
      sourceMessageCount: 1,
      fallbackUsed: false,
      readFiles: [],
      modifiedFiles: [],
    });
    assert.equal(details.authorityRefs.length, 0);
    assert.ok(
      details.diagnostics.warnings.includes("REJECTED_REFRESH_COMMANDS:1"),
    );
  });

  it("builds a bounded emergency narrative from user messages", () => {
    const fallback = emergencyNarrative([
      { role: "user", content: "Keep game 12 and 张三 in context" },
    ], undefined, "Previous generic Pi summary");
    assert.deepEqual(fallback.goals, ["Keep game 12 and 张三 in context"]);
    assert.match(fallback.inProgress[0] ?? "", /Previous generic Pi summary/);
    assert.match(fallback.nextSteps[0] ?? "", /Reconstruct detailed narrative/);
  });
});
