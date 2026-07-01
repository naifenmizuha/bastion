import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BastionFreshnessGuard } from "./freshness-guard.ts";
import type { BastionCompactionDetails } from "./types.ts";

function details(): BastionCompactionDetails {
  return {
    kind: "bastion-compaction",
    schemaVersion: "1.0",
    policyVersion: "1.0",
    generatedAt: 1,
    trigger: "threshold",
    willRetry: false,
    narrative: {
      goals: [],
      constraints: [],
      decisions: [],
      completed: [],
      inProgress: [],
      blocked: [],
      nextSteps: [],
    },
    authorityRefs: [],
    operations: [
      {
        operationId: "write-1",
        command: ["game", "score", "set"],
        risk: "write",
        entityRefs: ["game:12"],
        outcome: "uncertain",
        errorCode: "WRITE_VERIFICATION_FAILED",
        expectedEffect: { id: 12, own_score: 5, opponent_score: 3 },
        verification: [
          {
            args: ["game", "read", "--id", "12"],
            expected: { id: 12 },
          },
        ],
        observedAt: 1,
      },
    ],
    pendingActions: [],
    readFiles: [],
    modifiedFiles: [],
    diagnostics: {
      fallbackUsed: false,
      sourceMessageCount: 2,
      droppedResolvedOperations: 0,
      warnings: [],
    },
  };
}

describe("Bastion freshness guard", () => {
  it("blocks an overlapping write until matching read-back", () => {
    const guard = new BastionFreshnessGuard();
    guard.load(details());

    assert.match(
      guard.blockReason({
        args: ["game", "score", "set"],
        input: { game_id: 12, own_score: 5, opponent_score: 3 },
      }) ?? "",
      /may already have taken effect/,
    );

    guard.observeToolResult({
      kind: "bastion_cli",
      ok: true,
      command: ["game", "read", "--id", "12"],
      risk: "read",
      result: {
        envelope: {
          ok: true,
          data: { id: 12, own_score: 4, opponent_score: 3 },
        },
        exitCode: 0,
        stderr: "",
      },
    });
    assert.match(
      guard.blockReason({
        args: ["game", "score", "set"],
        input: { game_id: 12, own_score: 5, opponent_score: 3 },
      }) ?? "",
      /may already have taken effect/,
    );

    guard.observeToolResult({
      kind: "bastion_cli",
      ok: true,
      command: ["game", "read", "--id", "12"],
      risk: "read",
      result: {
        envelope: {
          ok: true,
          data: { id: 12, own_score: 5, opponent_score: 3 },
        },
        exitCode: 0,
        stderr: "",
      },
    });

    assert.equal(
      guard.blockReason({
        args: ["game", "score", "set"],
        input: { game_id: 12, own_score: 5, opponent_score: 3 },
      }),
      undefined,
    );
  });
});
