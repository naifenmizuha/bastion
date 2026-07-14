import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import type { DerivedMemoryEvidenceRegistry } from "./evidence-registry.ts";
import type { DerivedMemoryStore } from "./store.ts";
import type {
  ChangeEventSource,
  DerivedMemoryInvalidation,
  DerivedMemoryListScope,
  DerivedMemoryVisibility,
  DerivedMemoryWithDependencies,
  DomainChangeEvent,
  PrincipalContext,
  ReplaceDerivedMemoryInput,
  SaveDerivedMemoryInput,
  VerifiedTeamOpsEvidence,
} from "./types.ts";
import type { FreshnessProvider } from "./freshness.ts";

const MAX_CONTENT_LENGTH = 4_000;
const MAX_TITLE_LENGTH = 128;
const MAX_DEPENDENCIES = 12;
const MAX_REBUILD_INSTRUCTION_LENGTH = 2_000;

const DependencySchema = Type.Object(
  {
    args: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      maxItems: 32,
    }),
    input: Type.Optional(Type.Object({}, { additionalProperties: true })),
  },
  { additionalProperties: false },
);

const DerivedMemoryActionParameters = Type.Union([
  Type.Object(
    {
      action: Type.Literal("save"),
      title: Type.String({
        minLength: 1,
        maxLength: MAX_TITLE_LENGTH,
        description: "Standalone title used to discover this memory in list results.",
      }),
      content: Type.String({
        minLength: 1,
        maxLength: MAX_CONTENT_LENGTH,
        description: "Self-contained reusable conclusion, including material scope and limitations.",
      }),
      rebuildInstruction: Type.String({
        minLength: 1,
        maxLength: MAX_REBUILD_INSTRUCTION_LENGTH,
      }),
      dependencies: Type.Array(DependencySchema, {
        minItems: 2,
        maxItems: MAX_DEPENDENCIES,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("replace"),
      id: Type.String({ minLength: 1, maxLength: 128 }),
      title: Type.String({
        minLength: 1,
        maxLength: MAX_TITLE_LENGTH,
        description: "Standalone title used to discover the replacement memory.",
      }),
      content: Type.String({
        minLength: 1,
        maxLength: MAX_CONTENT_LENGTH,
        description: "Self-contained rebuilt conclusion, including material scope and limitations.",
      }),
      rebuildInstruction: Type.String({
        minLength: 1,
        maxLength: MAX_REBUILD_INSTRUCTION_LENGTH,
      }),
      dependencies: Type.Array(DependencySchema, {
        minItems: 2,
        maxItems: MAX_DEPENDENCIES,
      }),
      confirmedByUser: Type.Literal(true),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("list"),
      scope: Type.Optional(Type.Union([
        Type.Literal("all"),
        Type.Literal("private"),
        Type.Literal("staff"),
        Type.Literal("team"),
      ], {
        description:
          "Memory visibility filter only; it never describes the business subject or data range being analyzed. 'all' includes every accessible memory (the caller's private memories plus readable staff/team memories) and is the default. 'private' means only the caller's private memories; 'staff' means only memories published to staff; 'team' means only memories published to the whole team. Omit this field or use 'all' unless the user explicitly restricts the visibility audience of the memories being listed.",
        default: "all",
      })),
      limit: Type.Optional(Type.Integer({
        minimum: 1,
        maximum: 50,
        default: 20,
        description: "Maximum memory titles in this page; pagination only.",
      })),
      offset: Type.Optional(Type.Integer({
        minimum: 0,
        default: 0,
        description: "Zero-based memory-title offset; pagination only.",
      })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("publish"),
      id: Type.String({ minLength: 1, maxLength: 128 }),
      visibility: Type.Union([Type.Literal("staff"), Type.Literal("team")]),
      confirmedByUser: Type.Literal(true),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("withdraw"),
      id: Type.String({ minLength: 1, maxLength: 128 }),
      confirmedByUser: Type.Literal(true),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("read"),
      id: Type.String({ minLength: 1, maxLength: 128 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("forget"),
      id: Type.String({ minLength: 1, maxLength: 128 }),
      confirmedByUser: Type.Literal(true),
    },
    { additionalProperties: false },
  ),
]);

// Some OpenAI-compatible providers (including DeepSeek) reject tool schemas
// whose root only contains `anyOf`. Every tool parameter schema must advertise
// an object at the top level, while the union continues to enforce the
// action-specific fields.
export const DerivedMemoryParameters: TSchema = {
  ...DerivedMemoryActionParameters,
  type: "object",
};

type DerivedMemoryParams =
  | ({ action: "save" } & SaveDerivedMemoryInput)
  | ({ action: "replace" } & ReplaceDerivedMemoryInput)
  | {
      action: "list";
      scope?: DerivedMemoryListScope;
      limit?: number;
      offset?: number;
    }
  | { action: "read"; id: string }
  | {
      action: "publish";
      id: string;
      visibility: "staff" | "team";
      confirmedByUser: true;
    }
  | { action: "withdraw"; id: string; confirmedByUser: true }
  | { action: "forget"; id: string; confirmedByUser: true };

export interface DerivedMemoryToolDetails {
  kind: "derived_memory";
  ok: boolean;
  action: DerivedMemoryParams["action"];
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface DerivedMemoryExtensionOptions {
  store: DerivedMemoryStore;
  evidenceRegistry: DerivedMemoryEvidenceRegistry;
  changeEvents: ChangeEventSource;
  freshness: FreshnessProvider;
  principal: PrincipalContext;
}

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

function validateFreshness(
  memory: DerivedMemoryWithDependencies,
  options: DerivedMemoryExtensionOptions,
  event?: DomainChangeEvent,
): "fresh" | "stale" | "unknown" {
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
        event ? { event } : {},
      );
      return "stale";
    }
    return "fresh";
  } catch {
    return "unknown";
  }
}

function canReadStaff(principal: PrincipalContext): boolean {
  return principal.role === "admin" || principal.role === "coach";
}

function accessibleScopes(principal: PrincipalContext): DerivedMemoryVisibility[] {
  return canReadStaff(principal)
    ? ["private", "staff", "team"]
    : ["private", "team"];
}

function readForScope(
  store: DerivedMemoryStore,
  principal: PrincipalContext,
  scope: DerivedMemoryVisibility,
  id: string,
): DerivedMemoryWithDependencies | undefined {
  if (scope === "private") return store.readPrivate(id, principal);
  if (scope === "staff") return store.readStaff(id, principal);
  return store.readTeam(id, principal);
}

function readAccessible(
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

function errorResult(
  action: DerivedMemoryParams["action"],
  code: string,
  message: string,
) {
  return result({ kind: "derived_memory", ok: false, action, error: { code, message } });
}

function result(details: DerivedMemoryToolDetails) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
    details,
  };
}

function saveValidationError(
  params: Extract<DerivedMemoryParams, { action: "save" | "replace" }>,
): DerivedMemoryToolDetails | undefined {
  if (!params.title?.trim() || params.title.length > MAX_TITLE_LENGTH) {
    return {
      kind: "derived_memory",
      ok: false,
      action: params.action,
      error: {
        code: "INVALID_TITLE",
        message: "title must describe the analysis represented by this memory",
      },
    };
  }
  if (!params.content?.trim() || params.content.length > MAX_CONTENT_LENGTH) {
    return {
      kind: "derived_memory",
      ok: false,
      action: params.action,
      error: {
        code: "INVALID_CONTENT",
        message: "content must contain the reusable derived conclusion",
      },
    };
  }
  if (!params.rebuildInstruction?.trim()) {
    return {
      kind: "derived_memory",
      ok: false,
      action: params.action,
      error: {
        code: "INVALID_REBUILD_INSTRUCTION",
        message: "rebuildInstruction must explain how to resolve and reanalyze future evidence",
      },
    };
  }
  return undefined;
}

function memoryReference(memory: DerivedMemoryWithDependencies) {
  return { id: memory.id, title: memory.title };
}

function staleReason(invalidations: readonly DerivedMemoryInvalidation[]): string {
  const latest = invalidations.at(-1);
  if (latest?.sourceKeys?.length) {
    return `Source data changed: ${latest.sourceKeys.join(", ")}`;
  }
  if (latest?.topics.length) {
    return `Source data changed in: ${latest.topics.join(", ")}`;
  }
  return "One or more source dependencies changed.";
}

function resolveDependencies(
  params: Extract<DerivedMemoryParams, { action: "save" | "replace" }>,
  evidenceRegistry: DerivedMemoryEvidenceRegistry,
):
  | { ok: true; dependencies: VerifiedTeamOpsEvidence[] }
  | { ok: false; result: DerivedMemoryToolDetails } {
  try {
    const dependencies = evidenceRegistry.resolveTeamOpsDependencies(
      params.dependencies,
    );
    if (dependencies.length < 2) {
      return {
        ok: false,
        result: {
          kind: "derived_memory",
          ok: false,
          action: params.action,
          error: {
            code: "INSUFFICIENT_DEPENDENCIES",
            message:
              "a derived memory requires at least two distinct successful teamops reads",
          },
        },
      };
    }
    return { ok: true, dependencies };
  } catch (error) {
    const code = error instanceof Error ? error.message : "DEPENDENCY_ERROR";
    return {
      ok: false,
      result: {
        kind: "derived_memory",
        ok: false,
        action: params.action,
        error: {
          code,
          message:
            code === "DUPLICATE_DEPENDENCY"
              ? "dependencies must contain distinct CLI commands"
              : "every dependency must exactly match a successful teamops read in the current session",
        },
      },
    };
  }
}

function replacementSourcesAreCurrent(
  dependencies: readonly VerifiedTeamOpsEvidence[],
  freshness: FreshnessProvider,
): "current" | "changed" | "unknown" {
  try {
    for (const dependency of dependencies) {
      const current = freshness.snapshot({
        args: dependency.command,
        ...(dependency.input ? { input: dependency.input } : {}),
      });
      if (current.hash !== dependency.sourceSnapshot.hash) return "changed";
    }
    return "current";
  } catch {
    return "unknown";
  }
}

export function createDerivedMemoryExtension(
  options: DerivedMemoryExtensionOptions,
): ExtensionFactory {
  return (pi) => {
    const unsubscribe = options.changeEvents.subscribe((event) => {
      for (const memory of options.store.freshMemoriesForTopics(
        options.principal.authorityId,
        event.topics,
      )) {
        validateFreshness(memory, options, event);
      }
    });
    pi.on("session_shutdown", () => {
      unsubscribe();
      options.evidenceRegistry.clear();
    });

    pi.registerTool({
      name: "derived_memory",
      label: "Derived Memory",
      description:
        "Discover and maintain reusable derived conclusions. Before any trend, comparison, diagnosis, risk, or recommendation that may require two or more authoritative reads, finish list and any candidate read calls before calling domain-data tools; never emit memory and domain calls in the same assistant batch. After a fresh read, answer directly if its content fully covers the request, otherwise read only the domain data needed for uncovered subquestions. Do not re-read covered sources merely because the memory is from an earlier session or time. Scope filters memory visibility only and must not be inferred from the business subject. Never rely on stale or unknown memories.",
      promptSnippet:
        "List memory titles, read selected content, save, replace after confirmation, publish, withdraw, or explicitly forget derived conclusions",
      parameters: DerivedMemoryParameters,
      executionMode: "sequential",

      async execute(_toolCallId, rawParams) {
        const params = rawParams as DerivedMemoryParams;
        if (params.action === "save") {
          const validationError = saveValidationError(params);
          if (validationError) return result(validationError);
          const resolved = resolveDependencies(params, options.evidenceRegistry);
          if (!resolved.ok) return result(resolved.result);
          try {
            const memory = options.store.save(
              options.principal,
              params,
              resolved.dependencies,
            );
            return result({
              kind: "derived_memory",
              ok: true,
              action: "save",
              data: memoryReference(memory),
            });
          } catch {
            return result({
              kind: "derived_memory",
              ok: false,
              action: "save",
              error: {
                code: "STORAGE_ERROR",
                message: "failed to persist the derived memory",
              },
            });
          }
        }

        if (params.action === "replace") {
          if (params.confirmedByUser !== true) {
            return errorResult(
              "replace",
              "CONFIRMATION_REQUIRED",
              "replacing a stale memory requires explicit user confirmation",
            );
          }
          const validationError = saveValidationError(params);
          if (validationError) return result(validationError);
          const previous = readAccessible(options.store, options.principal, params.id);
          if (!previous) {
            return errorResult("replace", "NOT_FOUND", `derived memory not found: ${params.id}`);
          }
          if (previous.ownerUserId !== options.principal.userId) {
            return errorResult(
              "replace",
              "FORBIDDEN",
              "only the memory owner can replace a stale memory",
            );
          }
          const previousStatus = validateFreshness(previous, options);
          if (previousStatus === "unknown") {
            return errorResult(
              "replace",
              "FRESHNESS_UNKNOWN",
              "the old memory freshness could not be verified",
            );
          }
          if (previousStatus !== "stale") {
            return errorResult(
              "replace",
              "NOT_STALE",
              "only a stale derived memory can be replaced",
            );
          }
          if (previous.supersededById) {
            return result({
              kind: "derived_memory",
              ok: false,
              action: "replace",
              data: { successorId: previous.supersededById },
              error: {
                code: "ALREADY_SUPERSEDED",
                message: `derived memory already has a replacement: ${previous.supersededById}`,
              },
            });
          }
          const resolved = resolveDependencies(params, options.evidenceRegistry);
          if (!resolved.ok) return result(resolved.result);
          const sourceStatus = replacementSourcesAreCurrent(
            resolved.dependencies,
            options.freshness,
          );
          if (sourceStatus !== "current") {
            return errorResult(
              "replace",
              sourceStatus === "changed" ? "SOURCE_CHANGED" : "FRESHNESS_UNKNOWN",
              sourceStatus === "changed"
                ? "a replacement source changed after it was read; refresh every dependency and try again"
                : "replacement source freshness could not be verified",
            );
          }
          try {
            const replaced = options.store.replace(
              options.principal,
              params,
              resolved.dependencies,
            );
            if (replaced.ok) {
              return result({
                kind: "derived_memory",
                ok: true,
                action: "replace",
                data: memoryReference(replaced.memory),
              });
            }
            return result({
              kind: "derived_memory",
              ok: false,
              action: "replace",
              ...(replaced.successorId
                ? { data: { successorId: replaced.successorId } }
                : {}),
              error: {
                code: replaced.code,
                message: replaced.code === "ALREADY_SUPERSEDED"
                  ? `derived memory already has a replacement${replaced.successorId ? `: ${replaced.successorId}` : ""}`
                  : replaced.code === "NOT_STALE"
                  ? "only a stale derived memory can be replaced"
                  : `derived memory not found: ${params.id}`,
              },
            });
          } catch {
            return errorResult(
              "replace",
              "STORAGE_ERROR",
              "failed to persist the derived memory replacement",
            );
          }
        }

        if (params.action === "list") {
          const requestedScope = params.scope ?? "all";
          if (requestedScope === "staff" && !canReadStaff(options.principal)) {
            return errorResult("list", "FORBIDDEN", "players cannot list staff memories");
          }
          const limit = params.limit ?? 20;
          const offset = params.offset ?? 0;
          if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
            return errorResult("list", "INVALID_PAGINATION", "limit must be an integer from 1 to 50");
          }
          if (!Number.isInteger(offset) || offset < 0) {
            return errorResult("list", "INVALID_PAGINATION", "offset must be a non-negative integer");
          }
          const page = options.store.listAccessiblePage(
            options.principal,
            requestedScope,
            limit,
            offset,
          );
          const memories = page.memories.map((memory) => ({
            id: memory.id,
            title: memory.title,
          }));
          return result({
            kind: "derived_memory",
            ok: true,
            action: "list",
            data: {
              memories,
              total: page.total,
              offset,
              limit,
              ...(page.nextOffset !== undefined ? { nextOffset: page.nextOffset } : {}),
            },
          });
        }

        if (params.action === "read") {
          const memory = readAccessible(options.store, options.principal, params.id);
          const effectiveStatus = memory
            ? validateFreshness(memory, options)
            : undefined;
          const invalidations = memory && effectiveStatus === "stale"
            ? options.store.invalidations(options.principal.authorityId, memory.id)
            : [];
          return memory
            ? result({
                kind: "derived_memory",
                ok: true,
                action: "read",
                data: effectiveStatus === "fresh"
                  ? {
                      id: memory.id,
                      title: memory.title,
                      status: "fresh",
                      content: memory.content,
                    }
                  : effectiveStatus === "stale"
                  ? {
                      id: memory.id,
                      title: memory.title,
                      status: "stale",
                      rebuild: {
                        reason: staleReason(invalidations),
                        instruction: memory.rebuildInstruction,
                      },
                    }
                  : {
                      id: memory.id,
                      title: memory.title,
                      status: "unknown",
                    },
              })
            : result({
                kind: "derived_memory",
                ok: false,
                action: "read",
                error: {
                  code: "NOT_FOUND",
                  message: `derived memory not found: ${params.id}`,
                },
              });
        }

        if (params.action === "publish") {
          if (params.visibility === "staff" && !canReadStaff(options.principal)) {
            return errorResult("publish", "FORBIDDEN", "players cannot publish staff memories");
          }
          const memory = options.store.publish(
            params.id,
            options.principal,
            params.visibility,
          );
          return memory
            ? result({
                kind: "derived_memory",
                ok: true,
                action: "publish",
                data: memoryReference(memory),
              })
            : errorResult("publish", "NOT_FOUND", `private derived memory not found: ${params.id}`);
        }

        if (params.action === "withdraw") {
          const visible = readAccessible(options.store, options.principal, params.id);
          if (visible && visible.visibility !== "private" && visible.ownerUserId !== options.principal.userId) {
            return errorResult("withdraw", "FORBIDDEN", "only the memory owner can withdraw it");
          }
          const memory = options.store.withdraw(params.id, options.principal);
          return memory
            ? result({
                kind: "derived_memory",
                ok: true,
                action: "withdraw",
                data: memoryReference(memory),
              })
            : errorResult("withdraw", "NOT_FOUND", `published derived memory not found: ${params.id}`);
        }

        const privateMemory = options.store.readPrivate(params.id, options.principal);
        const visibleShared = readAccessible(options.store, options.principal, params.id);
        if (
          !privateMemory &&
          visibleShared &&
          visibleShared.visibility !== "private" &&
          options.principal.role !== "admin"
        ) {
          return errorResult("forget", "FORBIDDEN", "only an administrator can delete shared memories");
        }
        const forgotten = privateMemory
          ? options.store.forgetPrivate(params.id, options.principal)
          : options.store.forgetShared(params.id, options.principal);
        return forgotten
          ? result({
              kind: "derived_memory",
              ok: true,
              action: "forget",
              data: { id: params.id, forgotten: true },
            })
          : result({
              kind: "derived_memory",
              ok: false,
              action: "forget",
              error: {
                code: "NOT_FOUND",
                message: `derived memory not found: ${params.id}`,
              },
            });
      },
    });

    pi.on("tool_result", (event) => {
      if (event.toolName !== "derived_memory") return;
      const details = event.details as DerivedMemoryToolDetails | undefined;
      if (details?.kind === "derived_memory" && !details.ok) {
        return { isError: true };
      }
    });
  };
}
