import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import type { CliObservationLedger } from "./ledger.ts";
import type { DerivedMemoryStore } from "./store.ts";
import type {
  ChangeEventSource,
  DerivedMemorySearchScope,
  DerivedMemoryVisibility,
  DerivedMemoryWithDependencies,
  PrincipalContext,
  SaveDerivedMemoryInput,
} from "./types.ts";
import type { FreshnessProvider } from "./freshness.ts";

const MAX_CONCLUSION_LENGTH = 4_000;
const MAX_LABEL_LENGTH = 128;
const MAX_LABELS = 16;
const MAX_DEPENDENCIES = 12;

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
      kind: Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH }),
      subjectKeys: Type.Array(
        Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH }),
        { minItems: 1, maxItems: MAX_LABELS },
      ),
      topics: Type.Array(
        Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH }),
        { minItems: 1, maxItems: MAX_LABELS },
      ),
      conclusion: Type.String({
        minLength: 1,
        maxLength: MAX_CONCLUSION_LENGTH,
      }),
      limitations: Type.Array(
        Type.String({ minLength: 1, maxLength: 512 }),
        { maxItems: MAX_LABELS },
      ),
      dependencies: Type.Array(DependencySchema, {
        minItems: 2,
        maxItems: MAX_DEPENDENCIES,
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("search"),
      kind: Type.Optional(
        Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH }),
      ),
      subject: Type.Optional(
        Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH }),
      ),
      topic: Type.Optional(
        Type.String({ minLength: 1, maxLength: MAX_LABEL_LENGTH }),
      ),
      query: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
      scope: Type.Optional(Type.Union([
        Type.Literal("all"),
        Type.Literal("private"),
        Type.Literal("staff"),
        Type.Literal("team"),
      ])),
      includeStale: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
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
  | {
      action: "search";
      kind?: string;
      subject?: string;
      topic?: string;
      query?: string;
      scope?: DerivedMemorySearchScope;
      includeStale?: boolean;
      limit?: number;
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
  ledger: CliObservationLedger;
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

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function saveValidationError(
  params: Extract<DerivedMemoryParams, { action: "save" }>,
): DerivedMemoryToolDetails | undefined {
  if (!unique(params.subjectKeys) || !unique(params.topics)) {
    return {
      kind: "derived_memory",
      ok: false,
      action: "save",
      error: {
        code: "DUPLICATE_LABEL",
        message: "subjectKeys and topics must not contain duplicates",
      },
    };
  }
  return undefined;
}

export function createDerivedMemoryExtension(
  options: DerivedMemoryExtensionOptions,
): ExtensionFactory {
  return (pi) => {
    const unsubscribe = options.changeEvents.subscribe(() => {
      for (const memory of options.store.freshMemories(options.principal.authorityId)) {
        validateFreshness(memory, options);
      }
    });
    pi.on("session_shutdown", () => {
      unsubscribe();
      options.ledger.clear();
    });

    pi.registerTool({
      name: "derived_memory",
      label: "Derived Memory",
      description:
        "Save and retrieve reusable conclusions derived from at least two successful teamops reads. Memories are private by default and may be explicitly published to staff or team scope. This is not authoritative data. Never rely on stale memories.",
      promptSnippet:
        "Search, save, read, publish, withdraw, or explicitly forget dependency-backed derived conclusions",
      parameters: DerivedMemoryParameters,
      executionMode: "sequential",

      async execute(_toolCallId, rawParams) {
        const params = rawParams as DerivedMemoryParams;
        if (params.action === "save") {
          const validationError = saveValidationError(params);
          if (validationError) return result(validationError);
          let dependencies;
          try {
            dependencies = options.ledger.resolveDependencies(
              params.dependencies,
            );
            if (dependencies.length < 2) {
              return result({
                kind: "derived_memory",
                ok: false,
                action: "save",
                error: {
                  code: "INSUFFICIENT_DEPENDENCIES",
                  message:
                    "a derived memory requires at least two distinct successful teamops reads",
                },
              });
            }
          } catch (error) {
            const code =
              error instanceof Error ? error.message : "DEPENDENCY_ERROR";
            return result({
              kind: "derived_memory",
              ok: false,
              action: "save",
              error: {
                code,
                message:
                  code === "DUPLICATE_DEPENDENCY"
                    ? "dependencies must contain distinct CLI commands"
                    : "every dependency must exactly match a successful teamops read in the current session",
              },
            });
          }
          try {
            const memory = options.store.save(options.principal, params, dependencies);
            return result({
              kind: "derived_memory",
              ok: true,
              action: "save",
              data: memory,
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

        if (params.action === "search") {
          const requestedScope = params.scope ?? "all";
          if (requestedScope === "staff" && !canReadStaff(options.principal)) {
            return errorResult("search", "FORBIDDEN", "players cannot search staff memories");
          }
          const scopes = requestedScope === "all"
            ? accessibleScopes(options.principal)
            : [requestedScope];
          let unknownCount = 0;
          const candidates = scopes.flatMap((scope) => {
            if (scope === "private") return options.store.searchPrivate(options.principal, params);
            if (scope === "staff") return options.store.searchStaff(options.principal, params);
            return options.store.searchTeam(options.principal, params);
          });
          const validated = candidates.flatMap((memory) => {
            const full = readForScope(
              options.store,
              options.principal,
              memory.visibility,
              memory.id,
            )!;
            const status = validateFreshness(full, options);
            if (status === "unknown") unknownCount += 1;
            if (status === "unknown" || (!params.includeStale && status === "stale")) return [];
            return [{ ...memory, status }];
          });
          const uniqueMemories = [...new Map(
            validated
              .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
              .map((memory) => [memory.id, memory]),
          ).values()].slice(0, params.limit ?? 10);
          const memories = uniqueMemories.map((memory) => ({
            id: memory.id,
            ownerUserId: memory.ownerUserId,
            visibility: memory.visibility,
            kind: memory.kind,
            subjectKeys: memory.subjectKeys,
            topics: memory.topics,
            conclusion:
              memory.conclusion.length <= 400
                ? memory.conclusion
                : `${memory.conclusion.slice(0, 399)}…`,
            limitations: memory.limitations,
            status: memory.status,
            updatedAt: memory.updatedAt,
          }));
          return result({
            kind: "derived_memory",
            ok: true,
            action: "search",
            data: {
              memories,
              ...(unknownCount > 0 ? { unknownCount } : {}),
            },
          });
        }

        if (params.action === "read") {
          const memory = readAccessible(options.store, options.principal, params.id);
          const effectiveStatus = memory
            ? validateFreshness(memory, options)
            : undefined;
          return memory
            ? result({
                kind: "derived_memory",
                ok: true,
                action: "read",
                data: {
                  ...memory,
                  status: effectiveStatus,
                  ...(effectiveStatus === "stale"
                    ? {
                        warning:
                          "Do not rely on this conclusion. Re-run every dependency before deriving a replacement.",
                      }
                    : effectiveStatus === "unknown"
                    ? {
                        warning:
                          "Freshness could not be verified. Do not rely on this conclusion until its dependencies can be checked.",
                      }
                    : {}),
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
            ? result({ kind: "derived_memory", ok: true, action: "publish", data: memory })
            : errorResult("publish", "NOT_FOUND", `private derived memory not found: ${params.id}`);
        }

        if (params.action === "withdraw") {
          const visible = readAccessible(options.store, options.principal, params.id);
          if (visible && visible.visibility !== "private" && visible.ownerUserId !== options.principal.userId) {
            return errorResult("withdraw", "FORBIDDEN", "only the memory owner can withdraw it");
          }
          const memory = options.store.withdraw(params.id, options.principal);
          return memory
            ? result({ kind: "derived_memory", ok: true, action: "withdraw", data: memory })
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
