export const BASTION_COMPACTION_KIND = "bastion-compaction";
export const BASTION_COMPACTION_SCHEMA_VERSION = "1.0";
export const BASTION_COMPACTION_POLICY_VERSION = "1.0";

export type CompactionTrigger = "manual" | "threshold" | "overflow";

export interface BastionNarrativeDecision {
  actor: "user" | "assistant";
  decision: string;
  rationale?: string;
}

export interface BastionNarrativeState {
  goals: string[];
  constraints: string[];
  decisions: BastionNarrativeDecision[];
  completed: string[];
  inProgress: string[];
  blocked: string[];
  nextSteps: string[];
}

export type AuthorityKind =
  | "player"
  | "report"
  | "game"
  | "game_analysis"
  | "person_analysis"
  | "lineup"
  | "drill_recommendation"
  | "training";

export interface AuthorityReference {
  key: string;
  kind: AuthorityKind;
  identifiers: Record<string, string | number>;
  refreshArgs: string[];
  observedAt: number;
  freshness: "stale_hint" | "must_refresh";
  reason: string;
}

export type OperationOutcome =
  | "confirmed"
  | "not_persisted"
  | "failed"
  | "uncertain";

export interface OperationVerification {
  args: string[];
  expected: Record<string, string | number | boolean>;
}

export interface OperationRecord {
  operationId: string;
  command: string[];
  risk: "compute_write" | "write";
  entityRefs: string[];
  outcome: OperationOutcome;
  errorCode?: string;
  approved?: boolean;
  expectedEffect?: Record<string, string | number | boolean>;
  verification: OperationVerification[];
  observedAt: number;
  resolution?: {
    outcome: Exclude<OperationOutcome, "uncertain">;
    evidenceCommand: string[];
    resolvedAt: number;
  };
}

export interface PendingAction {
  actionId: string;
  kind:
    | "refresh_authority"
    | "resolve_uncertain_write"
    | "request_user_input"
    | "validate_candidate"
    | "persist_candidate";
  description: string;
  requiredBefore: string;
  args?: string[];
}

export interface BastionCompactionDetails {
  kind: typeof BASTION_COMPACTION_KIND;
  schemaVersion: typeof BASTION_COMPACTION_SCHEMA_VERSION;
  policyVersion: typeof BASTION_COMPACTION_POLICY_VERSION;
  generatedAt: number;
  trigger: CompactionTrigger;
  willRetry: boolean;
  narrative: BastionNarrativeState;
  authorityRefs: AuthorityReference[];
  operations: OperationRecord[];
  pendingActions: PendingAction[];
  readFiles: string[];
  modifiedFiles: string[];
  diagnostics: {
    fallbackUsed: boolean;
    sourceMessageCount: number;
    droppedResolvedOperations: number;
    warnings: string[];
  };
}

export interface ReadObservation {
  args: string[];
  data: unknown;
  observedAt: number;
}

export interface BastionExtraction {
  authorityRefs: AuthorityReference[];
  operations: OperationRecord[];
  reads: ReadObservation[];
  warnings: string[];
}

export const EMPTY_NARRATIVE: BastionNarrativeState = {
  goals: [],
  constraints: [],
  decisions: [],
  completed: [],
  inProgress: [],
  blocked: [],
  nextSteps: [],
};

