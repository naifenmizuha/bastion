import type { DerivedMemoryStore } from "./store.ts";
import type { FreshnessProvider } from "./freshness.ts";
import type {
  DerivedMemory,
  DerivedMemorySearchScope,
  DerivedMemoryVisibility,
  DerivedMemoryWithDependencies,
  EffectiveDerivedMemoryStatus,
  PrincipalContext,
  SearchDerivedMemoryInput,
} from "./types.ts";

export type DerivedMemorySummary = Omit<DerivedMemory, "status"> & {
  status: EffectiveDerivedMemoryStatus;
};

export interface DerivedMemoryRetrievalOptions {
  store: DerivedMemoryStore;
  freshness: FreshnessProvider;
  principal: PrincipalContext;
}

export interface FreshMemoryCandidate {
  id: string;
  visibility: DerivedMemoryVisibility;
  kind: string;
  subjectKeys: string[];
  topics: string[];
  summary: string;
  limitations: string[];
  status: "fresh";
  updatedAt: number;
  relevance: number;
}

const SUMMARY_LENGTH = 400;
const CANDIDATE_LABEL_LIMIT = 6;
const CANDIDATE_LIMITATION_LIMIT = 4;
const CANDIDATE_LIMITATION_LENGTH = 160;
export const DEFAULT_CANDIDATE_LIMIT = 3;

function changedSourceKeys(
  saved: readonly { sourceKey: string; updatedAt: string }[],
  current: readonly { sourceKey: string; updatedAt: string }[],
): string[] {
  const left = new Map(saved.map((entry) => [entry.sourceKey, entry.updatedAt]));
  const right = new Map(current.map((entry) => [entry.sourceKey, entry.updatedAt]));
  return [...new Set([...left.keys(), ...right.keys()])]
    .filter((key) => left.get(key) !== right.get(key))
    .sort();
}

export function canReadStaff(principal: PrincipalContext): boolean {
  return principal.role === "admin" || principal.role === "coach";
}

function accessibleScopes(principal: PrincipalContext): DerivedMemoryVisibility[] {
  return canReadStaff(principal)
    ? ["private", "staff", "team"]
    : ["private", "team"];
}

export function readForScope(
  store: DerivedMemoryStore,
  principal: PrincipalContext,
  scope: DerivedMemoryVisibility,
  id: string,
): DerivedMemoryWithDependencies | undefined {
  if (scope === "private") return store.readPrivate(id, principal);
  if (scope === "staff") return store.readStaff(id, principal);
  return store.readTeam(id, principal);
}

export function readAccessible(
  store: DerivedMemoryStore,
  principal: PrincipalContext,
  id: string,
): DerivedMemoryWithDependencies | undefined {
  for (const scope of accessibleScopes(principal)) {
    const memory = readForScope(store, principal, scope, id);
    if (memory) return memory;
  }
  return undefined;
}

export function validateMemoryFreshness(
  memory: DerivedMemoryWithDependencies,
  options: DerivedMemoryRetrievalOptions,
): EffectiveDerivedMemoryStatus {
  if (memory.status === "stale") return "stale";
  try {
    const changed: string[] = [];
    for (const dependency of memory.dependencies) {
      if (!dependency.sourceSnapshot) {
        changed.push("legacy_missing_snapshot");
        continue;
      }
      const current = options.freshness.snapshot({
        args: dependency.command,
        ...(dependency.input ? { input: dependency.input } : {}),
      });
      if (current.hash !== dependency.sourceSnapshot.hash) {
        changed.push(...changedSourceKeys(
          dependency.sourceSnapshot.sources,
          current.sources,
        ));
      }
    }
    if (changed.length > 0) {
      options.store.invalidateFromFreshness(
        options.principal.authorityId,
        memory.id,
        [...new Set(changed)],
      );
      return "stale";
    }
    return "fresh";
  } catch {
    return "unknown";
  }
}

function memoriesForScope(
  options: DerivedMemoryRetrievalOptions,
  scope: DerivedMemoryVisibility,
  input: SearchDerivedMemoryInput,
): DerivedMemory[] {
  if (scope === "private") return options.store.searchPrivate(options.principal, input);
  if (scope === "staff") return options.store.searchStaff(options.principal, input);
  return options.store.searchTeam(options.principal, input);
}

export function searchAccessibleMemories(
  options: DerivedMemoryRetrievalOptions,
  input: SearchDerivedMemoryInput,
): { memories: DerivedMemorySummary[]; unknownCount: number } {
  const requestedScope: DerivedMemorySearchScope = input.scope ?? "all";
  const scopes = requestedScope === "all"
    ? accessibleScopes(options.principal)
    : [requestedScope];
  let unknownCount = 0;
  const validated = scopes.flatMap((scope) =>
    memoriesForScope(options, scope, input).flatMap((memory) => {
      const full = readForScope(options.store, options.principal, memory.visibility, memory.id)!;
      const status = validateMemoryFreshness(full, options);
      if (status === "unknown") unknownCount += 1;
      if (status === "unknown" || (!input.includeStale && status === "stale")) return [];
      return [{ ...memory, status }];
    })
  );
  const memories = [...new Map(
    validated
      .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
      .map((memory) => [memory.id, memory]),
  ).values()].slice(0, input.limit ?? 10);
  return { memories, unknownCount };
}

export function readAccessibleMemory(
  options: DerivedMemoryRetrievalOptions,
  id: string,
): { memory?: DerivedMemoryWithDependencies; status?: EffectiveDerivedMemoryStatus } {
  const memory = readAccessible(options.store, options.principal, id);
  return memory
    ? { memory, status: validateMemoryFreshness(memory, options) }
    : {};
}

function grams(text: string): Set<string> {
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  const output = new Set(normalized.match(/[\p{Letter}\p{Number}_:@/-]{2,}/gu) ?? []);
  for (const run of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    for (const size of [2, 3]) {
      for (let index = 0; index + size <= run.length; index += 1) {
        output.add(run.slice(index, index + size));
      }
    }
  }
  return output;
}

function relevance(
  prompt: Set<string>,
  memory: Pick<DerivedMemory, "kind" | "subjectKeys" | "topics" | "conclusion" | "limitations">,
): number {
  if (prompt.size === 0) return 0;
  const searchable = grams([
    memory.kind,
    ...memory.subjectKeys,
    ...memory.topics,
    memory.conclusion.slice(0, SUMMARY_LENGTH),
    ...memory.limitations,
  ].join("\n"));
  let matched = 0;
  let total = 0;
  for (const token of prompt) {
    const weight = Math.min(token.length, 6);
    total += weight;
    if (searchable.has(token)) matched += weight;
  }
  return total === 0 ? 0 : matched / total;
}

export function freshMemoryCandidates(
  options: DerivedMemoryRetrievalOptions,
  prompt: string,
  limit = DEFAULT_CANDIDATE_LIMIT,
): FreshMemoryCandidate[] {
  const promptGrams = grams(prompt);
  const { memories } = searchAccessibleMemories(options, { limit: Number.MAX_SAFE_INTEGER });
  return memories
    .map((memory) => ({ memory, relevance: relevance(promptGrams, memory) }))
    .filter((candidate) => candidate.relevance > 0)
    .sort((left, right) =>
      right.relevance - left.relevance ||
      right.memory.updatedAt - left.memory.updatedAt ||
      left.memory.id.localeCompare(right.memory.id)
    )
    .slice(0, Math.max(0, limit))
    .map(({ memory, relevance: score }) => ({
      id: memory.id,
      visibility: memory.visibility,
      kind: memory.kind,
      subjectKeys: memory.subjectKeys.slice(0, CANDIDATE_LABEL_LIMIT),
      topics: memory.topics.slice(0, CANDIDATE_LABEL_LIMIT),
      summary: memory.conclusion.length <= SUMMARY_LENGTH
        ? memory.conclusion
        : `${memory.conclusion.slice(0, SUMMARY_LENGTH - 1)}…`,
      limitations: memory.limitations
        .slice(0, CANDIDATE_LIMITATION_LIMIT)
        .map((limitation) => limitation.slice(0, CANDIDATE_LIMITATION_LENGTH)),
      status: "fresh",
      updatedAt: memory.updatedAt,
      relevance: Math.round(score * 10_000) / 10_000,
    }));
}
