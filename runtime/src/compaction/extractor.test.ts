import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TeamOpsToolDetails } from "../teamops/types.ts";
import { extractBastionContext } from "./extractor.ts";

function assistant(
  id: string,
  args: string[],
  input?: Record<string, unknown>,
  timestamp = 1,
): unknown {
  return {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id,
        name: "teamops",
        arguments: { args, ...(input ? { input } : {}) },
      },
    ],
    timestamp,
  };
}

function result(
  id: string,
  details: TeamOpsToolDetails,
  timestamp = 2,
): unknown {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "teamops",
    content: [{ type: "text", text: "{}" }],
    details,
    isError: !details.ok,
    timestamp,
  };
}

describe("Bastion compaction extractor", () => {
  it("extracts confirmed writes and authoritative refresh references", () => {
    const details: TeamOpsToolDetails = {
      kind: "teamops",
      ok: true,
      command: ["game", "score", "set"],
      risk: "write",
      approved: true,
      result: {
        envelope: { ok: true, data: { game_id: 12 } },
        exitCode: 0,
        stderr: "",
      },
      verification: [
        {
          args: ["game", "read", "--id", "12"],
          expected: { id: 12 },
          matched: true,
          envelope: { ok: true, data: { id: 12 } },
          exitCode: 0,
          stderr: "",
        },
      ],
    };
    const extraction = extractBastionContext([
      assistant("call-1", ["game", "score", "set"], {
        game_id: 12,
        own_score: 5,
        opponent_score: 3,
      }),
      result("call-1", details),
    ]);

    assert.equal(extraction.operations.length, 1);
    assert.equal(extraction.operations[0]?.outcome, "confirmed");
    assert.deepEqual(extraction.operations[0]?.expectedEffect, {
      id: 12,
      own_score: 5,
      opponent_score: 3,
    });
    assert.deepEqual(extraction.operations[0]?.verification, [
      {
        args: ["game", "read", "--id", "12"],
        expected: { id: 12 },
      },
    ]);
    assert.deepEqual(
      extraction.authorityRefs.map((item) => item.key),
      ["game:12"],
    );
  });

  it("classifies cancelled writes as not persisted", () => {
    const extraction = extractBastionContext([
      assistant("call-2", ["lineup", "accept", "--id", "7"]),
      result("call-2", {
        kind: "teamops",
        ok: false,
        command: ["lineup", "accept", "--id", "7"],
        error: {
          code: "USER_CANCELLED",
          message: "The user cancelled the Bastion write",
        },
      }),
    ]);
    assert.equal(extraction.operations[0]?.outcome, "not_persisted");
  });

  it("classifies failed verification as uncertain", () => {
    const extraction = extractBastionContext([
      assistant("call-3", ["game", "score", "set"], {
        game_id: 12,
        own_score: 5,
        opponent_score: 3,
      }),
      result("call-3", {
        kind: "teamops",
        ok: false,
        command: ["game", "score", "set"],
        risk: "write",
        approved: true,
        result: {
          envelope: { ok: true, data: { game_id: 12 } },
          exitCode: 0,
          stderr: "",
        },
        verification: [
          {
            args: ["game", "read", "--id", "12"],
            expected: { id: 12 },
            matched: false,
            envelope: {
              ok: false,
              error: { code: "not_found", message: "not found" },
            },
            exitCode: 1,
            stderr: "",
          },
        ],
        error: {
          code: "WRITE_VERIFICATION_FAILED",
          message: "verification failed",
        },
      }),
    ]);
    assert.equal(extraction.operations[0]?.outcome, "uncertain");
    assert.equal(
      extraction.authorityRefs[0]?.freshness,
      "must_refresh",
    );
  });

  it("does not treat an invalid lineup write as persisted", () => {
    const extraction = extractBastionContext([
      assistant("call-4", ["lineup", "write"], {
        schema_version: "1.0",
        game_id: 12,
        starters: [],
      }),
      result("call-4", {
        kind: "teamops",
        ok: true,
        command: ["lineup", "write"],
        risk: "write",
        approved: true,
        result: {
          envelope: {
            ok: true,
            data: { valid: false, errors: ["missing starters"] },
          },
          exitCode: 0,
          stderr: "",
        },
      }),
    ]);
    assert.equal(extraction.operations[0]?.outcome, "not_persisted");
    assert.deepEqual(
      extraction.authorityRefs.map((item) => item.key),
      ["game:12"],
    );
  });

  it("keeps an orphan write call as uncertain", () => {
    const extraction = extractBastionContext([
      assistant("call-5", ["game", "score", "set"], {
        game_id: 12,
        own_score: 5,
        opponent_score: 3,
      }),
    ]);
    assert.equal(extraction.operations[0]?.outcome, "uncertain");
    assert.equal(extraction.operations[0]?.errorCode, "MISSING_TOOL_RESULT");
  });
});
