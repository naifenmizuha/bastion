import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EvalGradeContext } from "./types.ts";
import {
  orderedCommandsWithVerification,
  unicodeLength,
  verifiedCommand,
} from "./graders.ts";
import { EMPTY_USAGE } from "./observation.ts";

function context(): EvalGradeContext {
  return {
    executor: undefined as never,
    databasePath: "",
    agentDir: "",
    runDirectory: "",
    observation: {
      messages: [],
      finalAnswer: "",
      allToolCalls: [],
      usage: EMPTY_USAGE,
      durationMs: 0,
      toolCalls: [
        {
          args: ["report", "write"],
          details: {
            kind: "bastion_cli",
            ok: true,
            command: ["report", "write"],
            risk: "write",
            approved: true,
            verification: [
              {
                args: [
                  "report",
                  "read",
                  "--name",
                  "林晨",
                  "--date",
                  "2026-07-06",
                ],
                expected: { name: "林晨" },
                matched: true,
                envelope: { ok: true, data: {} },
                exitCode: 0,
                stderr: "",
              },
            ],
          },
        },
      ],
    },
  };
}

describe("eval graders", () => {
  it("treats matched authoritative verification as command evidence", () => {
    const value = context();
    assert.equal(
      verifiedCommand(value, ["report", "write"], ["report", "read"]),
      true,
    );
    assert.equal(
      orderedCommandsWithVerification(value, [
        ["report", "write"],
        ["report", "read"],
      ]),
      true,
    );
  });

  it("counts visible Unicode code points", () => {
    assert.equal(unicodeLength("打击⚾️"), 4);
    assert.equal(unicodeLength("**打击**"), 6);
  });
});
