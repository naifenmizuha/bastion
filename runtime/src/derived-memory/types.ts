export type DerivedMemoryStatus = "fresh" | "stale";
export type EffectiveDerivedMemoryStatus = DerivedMemoryStatus | "unknown";
export type DerivedMemoryVisibility = "private" | "staff" | "team";
export type DerivedMemoryListScope = "all" | DerivedMemoryVisibility;
export type PrincipalRole = "admin" | "coach" | "player";

export interface PrincipalContext {
  authorityId: string;
  teamId: string;
  userId: string;
  role: PrincipalRole;
  playerId?: string;
}

export interface SourceSnapshotEntry {
  sourceKey: string;
  updatedAt: string;
}

export interface SourceSnapshot {
  sources: SourceSnapshotEntry[];
  hash: string;
}

export interface DerivedMemory {
  id: string;
  authorityId: string;
  teamId: string;
  ownerUserId: string;
  visibility: DerivedMemoryVisibility;
  title: string;
  content: string;
  rebuildInstruction: string;
  status: DerivedMemoryStatus;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  invalidatedAt?: number;
  invalidatedByEventId?: string;
  supersedesId?: string;
  supersededById?: string;
}

export interface DerivedMemoryDependency {
  memoryId: string;
  command: string[];
  input?: Record<string, unknown>;
  normalizedCommandHash: string;
  invalidationTopics: string[];
  observedAt: number;
  sourceSnapshot?: SourceSnapshot;
}

export interface DerivedMemoryWithDependencies extends DerivedMemory {
  dependencies: DerivedMemoryDependency[];
}

export interface DomainChangeEvent {
  id: string;
  topics: string[];
  occurredAt: number;
  sourceToolCallId?: string;
}

export type DomainChangeHandler = (event: DomainChangeEvent) => void;

export interface ChangeEventSource {
  subscribe(handler: DomainChangeHandler): () => void;
}

export interface ChangeEventPublisher {
  publish(event: DomainChangeEvent): void;
}

export interface VerifiedTeamOpsEvidence {
  command: string[];
  input?: Record<string, unknown>;
  normalizedCommandHash: string;
  invalidationTopics: string[];
  observedAt: number;
  sourceSnapshot: SourceSnapshot;
}

export interface DependencyRequest {
  args: string[];
  input?: Record<string, unknown>;
}

export interface SaveDerivedMemoryInput {
  title: string;
  content: string;
  rebuildInstruction: string;
  dependencies: DependencyRequest[];
}

export interface ReplaceDerivedMemoryInput extends SaveDerivedMemoryInput {
  id: string;
  confirmedByUser: true;
}

export interface ListDerivedMemoryInput {
  scope?: DerivedMemoryListScope;
  limit?: number;
  offset?: number;
}

export type DerivedMemorySharingAction = "publish" | "withdraw" | "delete";

export interface DerivedMemorySharingEvent {
  memoryId: string;
  actorUserId: string;
  action: DerivedMemorySharingAction;
  fromVisibility: DerivedMemoryVisibility;
  toVisibility?: DerivedMemoryVisibility;
  occurredAt: number;
}

export interface DerivedMemoryInvalidation {
  memoryId: string;
  eventId: string;
  topics: string[];
  invalidatedAt: number;
  sourceKeys?: string[];
}
