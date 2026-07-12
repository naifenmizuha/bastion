import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import type { CliObservationLedger } from "./ledger.ts";
import type { DerivedMemoryStore } from "./store.ts";
import type { ChangeEventSource, SaveDerivedMemoryInput } from "./types.ts";

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
      includeStale: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
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
      includeStale?: boolean;
      limit?: number;
    }
  | { action: "read"; id: string }
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
    const unsubscribe = options.changeEvents.subscribe((event) => {
      options.store.invalidate(event);
    });
    pi.on("session_shutdown", () => {
      unsubscribe();
      options.ledger.clear();
    });

    pi.registerTool({
      name: "derived_memory",
      label: "Derived Memory",
      description:
        "Save and retrieve reusable conclusions derived from at least two successful teamops reads. This is not authoritative data. Search before repeating complex analysis; never rely on stale memories. Forget only when the user explicitly requests deletion.",
      promptSnippet:
        "Search, save, read, or explicitly forget dependency-backed derived conclusions",
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
            const memory = options.store.save(params, dependencies);
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
          const memories = options.store.search(params).map((memory) => ({
            id: memory.id,
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
            data: { memories },
          });
        }

        if (params.action === "read") {
          const memory = options.store.read(params.id);
          return memory
            ? result({
                kind: "derived_memory",
                ok: true,
                action: "read",
                data: {
                  ...memory,
                  ...(memory.status === "stale"
                    ? {
                        warning:
                          "Do not rely on this conclusion. Re-run every dependency before deriving a replacement.",
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

        const forgotten = options.store.forget(params.id);
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
