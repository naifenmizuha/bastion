import type { AgentSession } from "@earendil-works/pi-coding-agent";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type RunStatus = "passed" | "failed" | "not_completed";

export interface AgentModelSettings {
  provider?: string;
  model?: string;
  thinking: ThinkingLevel;
}

export interface ReviewerSettings {
  provider: string;
  model: string;
}

export interface PassRules {
  relevance: number;
  usefulness: number;
  groundedness: number;
  databaseCorrectness: number;
  executionQuality: number;
  average: number;
  minimumCasePassRate: number;
  minimumSuitePassRate: number;
}

export interface PromptCase {
  id: string;
  title: string;
  tags: string[];
  text: string;
  turns: EvaluationTurn[];
  sessions: EvaluationSession[];
  expectations: EvaluationExpectation[];
  runs?: number;
  writePermission: "allow" | "deny";
}

export interface EvaluationSession {
  id: string;
  turns: EvaluationTurn[];
}

export interface EvaluationTurn {
  id: string;
  prompt: string;
  expectations: EvaluationExpectation[];
}

interface ExpectationBase {
  id: string;
  title: string;
  weight: number;
}

export interface ResponseContainsExpectation extends ExpectationBase {
  type: "response_contains";
  value: string;
  caseSensitive: boolean;
}

export interface ResponseRegexExpectation extends ExpectationBase {
  type: "response_regex";
  pattern: string;
  flags: string;
}

export interface ToolCalledExpectation extends ExpectationBase {
  type: "tool_called";
  tool: string;
  status?: ExecutionStepStatus;
  arguments?: Record<string, unknown>;
  command?: string[];
  commandPrefix?: string[];
}

export interface ToolNotCalledExpectation extends ExpectationBase {
  type: "tool_not_called";
  tool: string;
  status?: ExecutionStepStatus;
  arguments?: Record<string, unknown>;
  command?: string[];
  commandPrefix?: string[];
}

export interface SqlExpectation extends ExpectationBase {
  type: "sql";
  database: "teamops" | "derived-memory";
  query: string;
  expectedRows?: Array<Record<string, unknown>>;
  expectedRowCount?: number;
}

export interface RubricExpectation extends ExpectationBase {
  type: "rubric";
  criteria: string;
  anchors: { 1: string; 3: string; 5: string };
  requiredFacts: string[];
  forbidden: string[];
  reference?: string;
}

export type EvaluationExpectation =
  | ResponseContainsExpectation
  | ResponseRegexExpectation
  | ToolCalledExpectation
  | ToolNotCalledExpectation
  | SqlExpectation
  | RubricExpectation;

export interface ScoringSettings {
  passScore: number;
}

export interface EvaluationConfig {
  schemaVersion: 1 | 2 | 3;
  name: string;
  description?: string;
  runs: number;
  timeoutSeconds: number;
  agent: AgentModelSettings;
  reviewer: ReviewerSettings;
  passRules: PassRules;
  scoring: ScoringSettings;
  prompts: PromptCase[];
  sourcePath: string;
}

export interface TokenCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface TokenUsage {
  requestCount: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  cost?: TokenCost;
}

export const EMPTY_TOKEN_USAGE: TokenUsage = {
  requestCount: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
};

export type ExecutionStepKind =
  | "user_prompt"
  | "model_request"
  | "assistant_answer"
  | "skill"
  | "reference_document"
  | "tool"
  | "teamops_command"
  | "write_confirmation"
  | "result_verification"
  | "memory_action"
  | "database_change"
  | "retry"
  | "context_compaction";

export type ExecutionStepStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ExecutionStep {
  stepId: string;
  parentStepId?: string;
  agentId: "root";
  sessionId?: string;
  turnId?: string;
  order: number;
  kind: ExecutionStepKind;
  name: string;
  status: ExecutionStepStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  error?: { code?: string; message: string };
  tokenUsage?: TokenUsage;
  resultFiles?: string[];
}

export type StepRelationKind =
  | "contains"
  | "calls"
  | "uses"
  | "guides"
  | "verifies"
  | "changes"
  | "depends_on";

export interface StepRelation {
  fromStepId: string;
  toStepId: string;
  kind: StepRelationKind;
}

export interface ExecutionFlow {
  steps: ExecutionStep[];
  relations: StepRelation[];
}

export interface DatabaseColumn {
  name: string;
  type: string;
  notNull: boolean;
  primaryKeyOrder: number;
}

export interface TableState {
  columns: DatabaseColumn[];
  rowCount: number;
  contentHash: string;
}

export interface DatabaseState {
  databaseName: "teamops" | "derived-memory";
  schemaVersion: number;
  integrityPassed: boolean;
  foreignKeyErrors: unknown[];
  tables: Record<string, TableState>;
  databaseHash: string;
}

export interface DatabaseTableChanges {
  beforeRowCount: number;
  afterRowCount: number;
  addedRows: unknown[];
  removedRows: unknown[];
  updatedRows: Array<{ key: unknown; before: unknown; after: unknown }>;
}

export interface DatabaseChanges {
  databaseName: "teamops" | "derived-memory";
  beforeHash: string;
  afterHash: string;
  changedTables: Record<string, DatabaseTableChanges>;
  truncated?: boolean;
}

export interface RuleCheckResult {
  code: string;
  title: string;
  passed: boolean;
  message: string;
  evidenceStepIds: string[];
  resultFiles: string[];
}

export interface QualityReviewIssue {
  code: string;
  severity: "low" | "medium" | "high";
  message: string;
  evidence: string;
}

export interface QualityReview {
  scores: {
    relevance: number;
    usefulness: number;
    groundedness: number;
    databaseCorrectness: number;
    executionQuality: number;
  };
  summary: string;
  scoreReasons?: Partial<Record<keyof QualityReview["scores"], { reason: string; evidence: string }>>;
  rubricResults?: Array<{ expectationId: string; score: number; reason: string; evidence: string }>;
  strengths: string[];
  issues: QualityReviewIssue[];
  confidence: "low" | "medium" | "high";
  usage: TokenUsage;
  model: { provider: string; id: string };
}

export interface RunEvidence {
  prompt: PromptCase;
  sessions: SessionEvidence[];
  turns: TurnEvidence[];
  finalAnswer: string;
  messages: unknown[];
  executionFlow: ExecutionFlow;
  agentModel?: { provider: string; id: string };
  stopReason?: string;
  durationMs: number;
  agentUsage: TokenUsage;
  teamopsChanges: DatabaseChanges;
  memoryChanges: DatabaseChanges;
  teamopsState: DatabaseState;
  memoryState: DatabaseState;
  operationChanges: Array<{
    databaseName: "teamops" | "derived-memory";
    stepId?: string;
    toolCallId?: string;
    command?: string;
    changes: DatabaseChanges;
  }>;
  review?: QualityReview;
}

export interface TurnEvidence {
  sessionId: string;
  turnId: string;
  prompt: string;
  finalAnswer: string;
  messageStart: number;
  messageEnd: number;
  stepIds: string[];
  teamopsChanges: DatabaseChanges;
  memoryChanges: DatabaseChanges;
}

export interface SessionEvidence {
  sessionId: string;
  runtimeSessionId?: string;
  status: "completed" | "not_completed";
  startedAt: string;
  durationMs: number;
  finalAnswer: string;
  messages: unknown[];
  turns: TurnEvidence[];
  agentUsage: TokenUsage;
  stopReason?: string;
}

export interface ExpectationResult {
  expectationId: string;
  title: string;
  type: EvaluationExpectation["type"] | `quality.${keyof QualityReview["scores"]}`;
  scope: "turn" | "case" | "quality";
  turnId?: string;
  passed: boolean;
  score?: number;
  maxWeight: number;
  earnedWeight: number;
  deductedWeight: number;
  reason: string;
  expected?: unknown;
  actual?: unknown;
  evidenceStepIds: string[];
}

export interface RunScore {
  programmatic: number;
  creative: number;
  quality: number;
  total: number;
  maximum: number;
  passScore: number;
}

export interface RunResult {
  schemaVersion: "3.0";
  caseId: string;
  title: string;
  repetition: number;
  status: RunStatus;
  startedAt: string;
  durationMs: number;
  prompt: string;
  sessions: Array<{
    sessionId: string;
    runtimeSessionId?: string;
    status: "completed" | "not_completed";
    startedAt: string;
    durationMs: number;
    finalAnswer: string;
    agentUsage: TokenUsage;
    stopReason?: string;
    turns: Array<{ sessionId: string; turnId: string; prompt: string; finalAnswer: string; stepIds: string[] }>;
  }>;
  turns: Array<{ sessionId: string; turnId: string; prompt: string; finalAnswer: string; stepIds: string[] }>;
  finalAnswer: string;
  agentModel?: { provider: string; id: string };
  stopReason?: string;
  agentUsage: TokenUsage;
  reviewerUsage?: TokenUsage;
  checks: RuleCheckResult[];
  expectationResults: ExpectationResult[];
  score: RunScore;
  review?: QualityReview;
  errors?: Array<{ kind: "configuration" | "provider" | "infrastructure" | "protocol"; message: string }>;
  files: Record<string, string>;
}

export interface CaseSummary {
  caseId: string;
  title: string;
  attempts: number;
  passed: number;
  failed: number;
  notCompleted: number;
  passRate: number;
  meetsRule: boolean;
}

export interface SuiteSummary {
  schemaVersion: "3.0";
  name: string;
  total: number;
  passed: number;
  failed: number;
  notCompleted: number;
  completed: number;
  passRate: number;
  averageScore: number;
  safetyPassed: boolean;
  rulesPassed: boolean;
  qualityPassed: boolean;
  passedGate: boolean;
  agentUsage: TokenUsage;
  reviewerUsage: TokenUsage;
  durationMs: number;
  cases: CaseSummary[];
}

export interface RunInfo {
  schemaVersion: "3.0";
  name: string;
  configPath: string;
  startedAt: string;
  gitCommit: string | null;
  dirty: boolean;
  agent?: { provider: string; model: string; thinking: string };
  reviewer: ReviewerSettings;
  selectedCases: string[];
  runs: number;
  athleticsSqlHash: string;
  baselineDatabaseHash: string;
  teamopsBinaryHash: string | null;
}

export interface RunnerOptions {
  config: EvaluationConfig;
  outputDirectory: string;
  repositoryRoot: string;
  executablePath: string;
  selectedCaseIds?: readonly string[];
  selectedTags?: readonly string[];
  onProgress?: (message: string) => void;
  /** Test seam; production uses createBastionRuntimeHost. */
  runtimeHostFactory?: (options: Record<string, unknown>) => Promise<{
    runtime: unknown;
    agentDir: string;
    dispose(): Promise<void>;
  }>;
  reviewer?: (options: {
    session: AgentSession;
    provider: string;
    modelId: string;
    evidence: RunEvidence;
  }) => Promise<QualityReview>;
}

export interface RunnerResult {
  runInfo: RunInfo;
  results: RunResult[];
  summary: SuiteSummary;
  exitCode: number;
}
