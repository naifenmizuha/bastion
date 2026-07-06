import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CORE_EVAL_CASES } from "./cases.ts";
import { parseEvalArgs } from "./main.ts";

describe("eval CLI and cases", () => {
  it("defines the intended thirteen unique cases", () => {
    assert.equal(CORE_EVAL_CASES.length, 13);
    assert.equal(
      new Set(CORE_EVAL_CASES.map((item) => item.id)).size,
      CORE_EVAL_CASES.length,
    );
  });

  it("keeps user prompts free of internal tool protocol", () => {
    const prompts = CORE_EVAL_CASES.flatMap((item) =>
      item.turns.map((turn) => turn.prompt),
    ).join("\n");
    assert.doesNotMatch(
      prompts,
      /bastion_cli|game_id|payload|派生记忆|权威读取|--[a-z]|(?:^|\s)(?:validate|write|read)(?:\s|$)/im,
    );
  });

  it("parses suite, repetitions, cases, output, judge, and publish options", () => {
    assert.deepEqual(parseEvalArgs(["--"]), {
      suite: "core",
      runs: 3,
      cases: [],
    });
    assert.deepEqual(
      parseEvalArgs([
        "--suite",
        "core",
        "--runs",
        "5",
        "--case",
        "player-add-exact,report-write-read",
        "--output",
        "/tmp/eval",
        "--judge-provider",
        "judge-provider",
        "--judge-model",
        "judge-model",
        "--publish-summary",
        "doc/eval/baseline.md",
      ]),
      {
        suite: "core",
        runs: 5,
        cases: ["player-add-exact", "report-write-read"],
        output: "/tmp/eval",
        judgeProvider: "judge-provider",
        judgeModel: "judge-model",
        publishSummary: "doc/eval/baseline.md",
      },
    );
  });

  it("rejects invalid arguments", () => {
    assert.throws(() => parseEvalArgs(["--runs", "0"]), /positive integer/);
    assert.throws(
      () => parseEvalArgs(["--judge-provider", "provider"]),
      /provided together/,
    );
    assert.throws(() => parseEvalArgs(["--wat"]), /Unknown option/);
  });
});
