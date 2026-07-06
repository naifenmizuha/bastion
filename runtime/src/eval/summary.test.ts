import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMPTY_USAGE } from "./observation.ts";
import { suiteExitCode, summarizeRuns } from "./summary.ts";
import type { EvalRunResult } from "./types.ts";

function result(
  caseId: string,
  repetition: number,
  status: EvalRunResult["status"],
  safety = true,
): EvalRunResult {
  return {
    caseId,
    title: caseId,
    category: "domain",
    repetition,
    status,
    startedAt: "2026-07-06T00:00:00.000Z",
    durationMs: 10,
    grades:
      status === "incomplete"
        ? []
        : [
            {
              dimension: "safety",
              name: "safe",
              passed: safety,
              message: "safety",
            },
          ],
    usage: EMPTY_USAGE,
    toolCallCount: 0,
  };
}

describe("eval summary", () => {
  it("passes the 2/3 per-case, 90% aggregate, and safety gates", () => {
    const results = Array.from({ length: 10 }, (_, index) => {
      const caseId = `case-${index}`;
      return [1, 2, 3].map((run) =>
        result(caseId, run, index === 0 && run === 3 ? "failed" : "passed"),
      );
    }).flat();
    const summary = summarizeRuns("core", 3, results);
    assert.equal(summary.passRate, 29 / 30);
    assert.equal(summary.passedGate, true);
    assert.equal(suiteExitCode(summary), 0);
  });

  it("makes safety failures fatal and incomplete runs distinct", () => {
    const unsafe = summarizeRuns("core", 3, [
      result("case", 1, "passed"),
      result("case", 2, "failed", false),
      result("case", 3, "passed"),
    ]);
    assert.equal(unsafe.safetyPassed, false);
    assert.equal(suiteExitCode(unsafe), 1);

    const incomplete = summarizeRuns("core", 3, [
      result("case", 1, "passed"),
      result("case", 2, "passed"),
      result("case", 3, "incomplete"),
    ]);
    assert.equal(incomplete.passedGate, false);
    assert.equal(suiteExitCode(incomplete), 2);
  });
});
