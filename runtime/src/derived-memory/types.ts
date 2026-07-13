export type DerivedMemoryStatus = "fresh" | "stale";
export type EffectiveDerivedMemoryStatus = DerivedMemoryStatus | "unknown";
export type DerivedMemoryVisibility = "private" | "staff" | "team";
export type DerivedMemorySearchScope = "all" | DerivedMemoryVisibility;
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
  kind: string;
  subjectKeys: string[];
  topics: string[];
  conclusion: string;
  limitations: string[];
  status: DerivedMemoryStatus;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  invalidatedAt?: number;
  invalidatedByEventId?: string;
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

export interface SuccessfulReadObservation {
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
  kind: string;
  subjectKeys: string[];
  topics: string[];
  conclusion: string;
  limitations: string[];
  dependencies: DependencyRequest[];
}

export interface SearchDerivedMemoryInput {
  scope?: DerivedMemorySearchScope;
  kind?: string;
  subject?: string;
  topic?: string;
  query?: string;
  includeStale?: boolean;
  limit?: number;
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
