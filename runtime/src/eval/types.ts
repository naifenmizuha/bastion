import type { Model, Usage } from "@earendil-works/pi-ai/compat";
import type { BastionCliExecutor } from "../bastion-cli/executor.ts";
import type { createBastionRuntimeHost } from "../runtime-host.ts";
import type {
  BastionCliParams,
  BastionCliToolDetails,
  ConfirmWrite,
} from "../bastion-cli/types.ts";

export type GradeDimension = "task" | "safety" | "trajectory" | "answer";

export interface EvalGrade {
  dimension: GradeDimension;
  name: string;
  passed: boolean;
  message: string;
}

export interface EvalToolCall {
  toolCallId?: string;
  args: string[];
  input?: unknown;
  details: BastionCliToolDetails;
}

export interface EvalGenericToolCall {
  toolCallId?: string;
  name: string;
  input?: unknown;
  details?: unknown;
}

export interface EvalUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: Usage["cost"];
}

export interface JudgeScore {
  groundedness: number;
  completeness: number;
  clarity: number;
  rationale: string;
  usage: EvalUsage;
  model: { provider: string; id: string };
}

export interface EvalObservation {
  messages: readonly unknown[];
  finalAnswer: string;
  toolCalls: EvalToolCall[];
  allToolCalls: EvalGenericToolCall[];
  usage: EvalUsage;
  durationMs: number;
  model?: { provider: string; id: string };
  stopReason?: string;
}

export interface EvalCaseContext {
  executor: BastionCliExecutor;
  databasePath: string;
  agentDir: string;
  runDirectory: string;
}

export interface EvalGradeContext extends EvalCaseContext {
  observation: EvalObservation;
}

export interface EvalTurn {
  prompt: string;
  requireSuccessfulTool?: boolean;
}

export interface EvalCase {
  id: string;
  title: string;
  category: "domain" | "reliability" | "safety" | "quality" | "memory";
  turns: readonly EvalTurn[];
  setup?(context: EvalCaseContext): Promise<void>;
  confirmWrite?: ConfirmWrite;
  grade(context: EvalGradeContext): Promise<EvalGrade[]> | EvalGrade[];
}

export type EvalRunStatus = "passed" | "failed" | "incomplete";

export interface EvalRunResult {
  caseId: string;
  title: string;
  category: EvalCase["category"];
  repetition: number;
  status: EvalRunStatus;
  startedAt: string;
  durationMs: number;
  model?: { provider: string; id: string };
  stopReason?: string;
  grades: EvalGrade[];
  usage: EvalUsage;
  toolCallCount: number;
  transcriptPath?: string;
  manualReviewPath?: string;
  sessionPath?: string;
  providerLogPath?: string;
  contextAnalysisPath?: string;
  contextMetrics?: {
    finalSkillReferenceTokens: number;
    finalToolSchemaTokens: number;
    failedGameEventWrites: number;
  };
  error?: {
    kind: "agent_protocol" | "provider" | "infrastructure";
    message: string;
  };
  judge?: JudgeScore;
  judgeError?: string;
}

export interface EvalCaseSummary {
  caseId: string;
  title: string;
  attempts: number;
  passed: number;
  failed: number;
  incomplete: number;
  passRate: number;
  meetsThreshold: boolean;
}

export interface EvalSuiteSummary {
  suite: string;
  runsPerCase: number;
  total: number;
  passed: number;
  failed: number;
  incomplete: number;
  scoredRuns: number;
  passRate: number;
  safetyPassed: boolean;
  caseThresholdPassed: boolean;
  overallThresholdPassed: boolean;
  passedGate: boolean;
  usage: EvalUsage;
  durationMs: number;
  cases: EvalCaseSummary[];
}

export interface EvalManifest {
  schemaVersion: "1.0";
  suite: string;
  runsPerCase: number;
  selectedCases: string[];
  startedAt: string;
  commit: string | null;
  dirty: boolean;
  judge: { provider: string; model: string } | null;
}

export interface JudgeConfig {
  provider: string;
  model: string;
}

export interface EvalRunnerOptions {
  suite: string;
  cases: readonly EvalCase[];
  runs: number;
  outputDirectory: string;
  repositoryRoot: string;
  executablePath: string;
  judge?: JudgeConfig;
  publishSummaryPath?: string;
  onProgress?(message: string): void;
  runtimeHostFactory?: typeof createBastionRuntimeHost;
}

export interface JudgeRequest {
  config: JudgeConfig;
  modelRegistry: {
    find(provider: string, modelId: string): Model<any> | undefined;
    getApiKeyAndHeaders(model: Model<any>): Promise<
      | {
          ok: true;
          apiKey?: string;
          headers?: Record<string, string>;
          env?: Record<string, string>;
        }
      | { ok: false; error: string }
    >;
  };
  caseDefinition: EvalCase;
  observation: EvalObservation;
}

export type EvalCliParams = BastionCliParams;
