export type DerivedMemoryStatus = "fresh" | "stale";

export interface DerivedMemory {
  id: string;
  kind: string;
  subjectKeys: string[];
  topics: string[];
  conclusion: string;
  limitations: string[];
  status: DerivedMemoryStatus;
  createdAt: number;
  updatedAt: number;
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
  kind?: string;
  subject?: string;
  topic?: string;
  query?: string;
  includeStale?: boolean;
  limit?: number;
}

export interface DerivedMemoryInvalidation {
  memoryId: string;
  eventId: string;
  topics: string[];
  invalidatedAt: number;
}
