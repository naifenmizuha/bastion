import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateScore, evaluateDeterministicExpectation, qualityResults, rubricExpectationResults } from "./expectations.ts";
import type { ExecutionStep, QualityReview, RubricExpectation } from "./types.ts";

test("deterministic expectations validate response, tool calls and SQL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eval-expect-"));
  const databasePath = join(directory, "test.db");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE players(name TEXT); INSERT INTO players VALUES ('Alice')");
  db.close();
  const steps: ExecutionStep[] = [{
    stepId: "step-1", agentId: "root", turnId: "lookup", order: 1, kind: "tool", name: "teamops", status: "succeeded", startedAt: new Date().toISOString(), input: { args: ["player", "list"] }, output: { details: { command: ["player", "list"] } },
  }];
  const scope = { kind: "turn" as const, turnId: "lookup", answer: "Alice 是球员", steps };
  try {
    assert.equal(evaluateDeterministicExpectation({ expectation: { id: "text", title: "text", type: "response_contains", points: 10, value: "alice", caseSensitive: false }, scope, databasePaths: { teamops: databasePath, "derived-memory": databasePath } }).passed, true);
    assert.equal(evaluateDeterministicExpectation({ expectation: { id: "tool", title: "tool", type: "tool_called", points: 10, tool: "teamops", command: ["player", "list"] }, scope, databasePaths: { teamops: databasePath, "derived-memory": databasePath } }).passed, true);
    assert.equal(evaluateDeterministicExpectation({ expectation: { id: "prefix", title: "prefix", type: "tool_called", points: 10, tool: "teamops", commandPrefix: ["player"] }, scope, databasePaths: { teamops: databasePath, "derived-memory": databasePath } }).passed, true);
    assert.equal(evaluateDeterministicExpectation({ expectation: { id: "bad-prefix", title: "bad-prefix", type: "tool_called", points: 10, tool: "teamops", commandPrefix: ["game", "read"] }, scope, databasePaths: { teamops: databasePath, "derived-memory": databasePath } }).passed, false);
    assert.equal(evaluateDeterministicExpectation({ expectation: { id: "sql", title: "sql", type: "sql", points: 10, database: "teamops", query: "SELECT name FROM players ORDER BY name", expectedRows: [{ name: "Alice" }] }, scope, databasePaths: { teamops: databasePath, "derived-memory": databasePath } }).passed, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("creative and quality scores use anchored 1-5 scaling", () => {
  const rubric: RubricExpectation = { id: "creative", title: "creative", type: "rubric", points: 20, criteria: "clear", anchors: { 1: "bad", 3: "ok", 5: "great" }, requiredFacts: [], forbidden: [] };
  const review: QualityReview = {
    scores: { relevance: 3, usefulness: 3, groundedness: 3, databaseCorrectness: 3, executionQuality: 3 },
    summary: "ok", strengths: [], issues: [], confidence: "high", usage: { requestCount: 1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, model: { provider: "p", id: "m" },
    rubricResults: [{ expectationId: "creative", score: 3, reason: "部分满足", evidence: "answer" }],
  };
  const rubricResults = rubricExpectationResults({ rubrics: [{ expectation: rubric, scope: { kind: "case", answer: "answer", steps: [] } }], review });
  const score = calculateScore([...rubricResults, ...qualityResults(review)], 80);
  assert.equal(rubricResults[0]?.earnedPoints, 10);
  assert.equal(score.quality, 15);
  assert.equal(score.total, 25);
});
