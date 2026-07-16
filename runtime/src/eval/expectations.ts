import { DatabaseSync } from "node:sqlite";
import type {
  EvaluationExpectation,
  ExecutionStep,
  ExpectationResult,
  QualityReview,
  RubricExpectation,
  RunScore,
} from "./types.ts";

type Scope = { kind: "turn" | "case"; turnId?: string; answer: string; steps: ExecutionStep[] };

function normalized(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)]));
  }
  return value;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

function subset(expected: unknown, actual: unknown): boolean {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(expected as Record<string, unknown>).every(([key, value]) => subset(value, (actual as Record<string, unknown>)[key]));
  }
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((item, index) => subset(item, actual[index]));
  return equal(expected, actual);
}

function result(expectation: EvaluationExpectation, scope: Scope, passed: boolean, reason: string, expected?: unknown, actual?: unknown, evidenceStepIds: string[] = []): ExpectationResult {
  return {
    expectationId: expectation.id,
    title: expectation.title,
    type: expectation.type,
    scope: scope.kind,
    ...(scope.turnId ? { turnId: scope.turnId } : {}),
    passed,
    maxWeight: expectation.weight,
    earnedWeight: passed ? expectation.weight : 0,
    deductedWeight: passed ? 0 : expectation.weight,
    reason,
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
    evidenceStepIds,
  };
}

function commandFrom(step: ExecutionStep): unknown {
  const output = step.output as Record<string, unknown> | undefined;
  const details = output?.details as Record<string, unknown> | undefined;
  return details?.command;
}

function hasCommandPrefix(command: unknown, prefix: string[]): boolean {
  return Array.isArray(command) && prefix.length <= command.length && prefix.every((item, index) => command[index] === item);
}

export function evaluateDeterministicExpectation(options: {
  expectation: Exclude<EvaluationExpectation, RubricExpectation>;
  scope: Scope;
  databasePaths: { teamops: string; "derived-memory": string };
}): ExpectationResult {
  const { expectation, scope } = options;
  if (expectation.type === "response_contains") {
    const actual = expectation.caseSensitive ? scope.answer : scope.answer.toLocaleLowerCase();
    const expected = expectation.caseSensitive ? expectation.value : expectation.value.toLocaleLowerCase();
    const passed = actual.includes(expected);
    return result(expectation, scope, passed, passed ? "回答包含预期文本" : "回答未包含预期文本", expectation.value, scope.answer, scope.steps.filter((step) => step.kind === "assistant_answer").map((step) => step.stepId));
  }
  if (expectation.type === "response_regex") {
    const passed = new RegExp(expectation.pattern, expectation.flags).test(scope.answer);
    return result(expectation, scope, passed, passed ? "回答匹配预期正则" : "回答未匹配预期正则", `/${expectation.pattern}/${expectation.flags}`, scope.answer, scope.steps.filter((step) => step.kind === "assistant_answer").map((step) => step.stepId));
  }
  if (expectation.type === "tool_called" || expectation.type === "tool_not_called") {
    const candidates = scope.steps.filter((step) => step.kind === "tool" && step.name === expectation.tool);
    const matched = candidates.find((step) =>
      (expectation.status === undefined || step.status === expectation.status) &&
      (expectation.arguments === undefined || subset(expectation.arguments, step.input)) &&
      (expectation.command === undefined || equal(expectation.command, commandFrom(step))) &&
      (expectation.commandPrefix === undefined || hasCommandPrefix(commandFrom(step), expectation.commandPrefix))
    );
    const expected = { tool: expectation.tool, status: expectation.status, arguments: expectation.arguments, command: expectation.command, commandPrefix: expectation.commandPrefix };
    const actual = candidates.map((step) => ({ stepId: step.stepId, status: step.status, arguments: step.input, command: commandFrom(step) }));
    if (expectation.type === "tool_not_called") {
      return result(expectation, scope, !matched, matched ? "找到了禁止的工具调用" : "未找到禁止的工具调用", expected, actual, candidates.map((step) => step.stepId));
    }
    return result(expectation, scope, Boolean(matched), matched ? "找到符合预期的工具调用" : "未找到符合预期的工具调用", expected, actual, candidates.map((step) => step.stepId));
  }
  const db = new DatabaseSync(options.databasePaths[expectation.database], { readOnly: true });
  try {
    const rows = db.prepare(expectation.query).all() as unknown as Array<Record<string, unknown>>;
    const normalizedRows = normalized(rows) as Array<Record<string, unknown>>;
    const rowCountPassed = expectation.expectedRowCount === undefined || rows.length === expectation.expectedRowCount;
    const rowsPassed = expectation.expectedRows === undefined || equal(expectation.expectedRows, normalizedRows);
    const passed = rowCountPassed && rowsPassed;
    return result(
      expectation,
      scope,
      passed,
      passed ? "SQL 查询结果符合预期" : `SQL 查询结果不符${rowCountPassed ? "" : `：预期 ${expectation.expectedRowCount} 行，实际 ${rows.length} 行`}`,
      { expectedRows: expectation.expectedRows, expectedRowCount: expectation.expectedRowCount },
      { rows: normalizedRows, rowCount: rows.length },
    );
  } catch (error) {
    return result(
      expectation,
      scope,
      false,
      `SQL 校验执行失败: ${error instanceof Error ? error.message : String(error)}`,
      { expectedRows: expectation.expectedRows, expectedRowCount: expectation.expectedRowCount },
      { error: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    db.close();
  }
}

function scaled(score: number, weight: number): number {
  return Math.round((((score - 1) / 4) * weight) * 100) / 100;
}

export function rubricExpectationResults(options: {
  rubrics: Array<{ expectation: RubricExpectation; scope: Scope }>;
  review?: QualityReview;
}): ExpectationResult[] {
  const byId = new Map(options.review?.rubricResults?.map((item) => [item.expectationId, item]) ?? []);
  return options.rubrics.map(({ expectation, scope }) => {
    const reviewed = byId.get(expectation.id);
    const score = reviewed?.score ?? 1;
    const earned = reviewed ? scaled(score, expectation.weight) : 0;
    return {
      expectationId: expectation.id,
      title: expectation.title,
      type: "rubric",
      scope: scope.kind,
      ...(scope.turnId ? { turnId: scope.turnId } : {}),
      passed: score >= 3,
      score,
      maxWeight: expectation.weight,
      earnedWeight: earned,
      deductedWeight: Math.round((expectation.weight - earned) * 100) / 100,
      reason: reviewed?.reason ?? "Reviewer 未返回该 rubric 的评分",
      expected: { criteria: expectation.criteria, anchors: expectation.anchors, requiredFacts: expectation.requiredFacts, forbidden: expectation.forbidden, reference: expectation.reference },
      actual: { answer: scope.answer, evidence: reviewed?.evidence ?? "" },
      evidenceStepIds: scope.steps.map((step) => step.stepId),
    };
  });
}

const QUALITY_KEYS = ["relevance", "usefulness", "groundedness", "databaseCorrectness", "executionQuality"] as const;

export function qualityResults(review: QualityReview | undefined, weightPerDimension = 1): ExpectationResult[] {
  return QUALITY_KEYS.map((key) => {
    const score = review?.scores[key] ?? 1;
    const earned = review ? scaled(score, weightPerDimension) : 0;
    const detail = review?.scoreReasons?.[key];
    return {
      expectationId: `quality.${key}`,
      title: `通用质量：${key}`,
      type: `quality.${key}`,
      scope: "quality",
      passed: score >= 3,
      score,
      maxWeight: weightPerDimension,
      earnedWeight: earned,
      deductedWeight: Math.round((weightPerDimension - earned) * 100) / 100,
      reason: detail?.reason ?? review?.summary ?? "没有质量评审结果",
      actual: detail?.evidence,
      evidenceStepIds: [],
    };
  });
}

export function calculateScore(results: ExpectationResult[], passScore: number): RunScore {
  const maximumWeight = results.reduce((total, item) => total + item.maxWeight, 0);
  const normalized = (items: ExpectationResult[]) => maximumWeight === 0
    ? 0
    : Math.round((items.reduce((total, item) => total + item.earnedWeight, 0) / maximumWeight) * 10_000) / 100;
  return {
    programmatic: normalized(results.filter((item) => !item.type.startsWith("quality.") && item.type !== "rubric")),
    creative: normalized(results.filter((item) => item.type === "rubric")),
    quality: normalized(results.filter((item) => item.type.startsWith("quality."))),
    total: normalized(results),
    maximum: 100,
    passScore,
  };
}
