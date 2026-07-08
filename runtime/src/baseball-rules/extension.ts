import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { BaseballRuleError, BaseballRuleService } from "./service.ts";
import {
  BASEBALL_RULE_DETAILS_KIND,
  BASEBALL_RULE_INGEST_TOOL_NAME,
  BASEBALL_RULE_QUERY_TOOL_NAME,
  type BaseballRuleIngestParams,
  type BaseballRuleQueryParams,
  type BaseballRuleToolDetails,
  type EmbeddingProvider,
  type BaseballRuleStore,
} from "./types.ts";

const DocumentSchema = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: 256 }),
    source: Type.String({ minLength: 1, maxLength: 256 }),
    docId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    sourceUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 1024 })),
    jurisdiction: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    edition: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    language: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
    markdown: Type.Optional(Type.String({ minLength: 1 })),
    path: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  },
  { additionalProperties: false },
);

export const BaseballRuleIngestParameters: TSchema = Type.Object(
  {
    documents: Type.Array(DocumentSchema, { minItems: 1, maxItems: 20 }),
    replaceDocument: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const FiltersSchema = Type.Object(
  {
    jurisdiction: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    edition: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    source: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);

const WeightsSchema = Type.Object(
  {
    fts: Type.Optional(Type.Number({ minimum: 0 })),
    vector: Type.Optional(Type.Number({ minimum: 0 })),
    ruleRefBoost: Type.Optional(Type.Number({ minimum: 0 })),
    titleBoost: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
);

export const BaseballRuleQueryParameters: TSchema = Type.Object(
  {
    rawSituation: Type.String({ minLength: 1, maxLength: 4_000 }),
    caseFacts: Type.Object({}, { additionalProperties: true }),
    englishQueries: Type.Array(
      Type.String({ minLength: 1, maxLength: 512 }),
      { minItems: 1, maxItems: 12 },
    ),
    concepts: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
      minItems: 1,
      maxItems: 24,
    }),
    filters: Type.Optional(FiltersSchema),
    weights: Type.Optional(WeightsSchema),
    topK: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
  },
  { additionalProperties: false },
);

export interface BaseballRulesExtensionOptions {
  store: BaseballRuleStore;
  embedder: EmbeddingProvider;
  safeRoots: readonly string[];
  now?: () => number;
}

function details(
  action: BaseballRuleToolDetails["action"],
  data: unknown,
): BaseballRuleToolDetails {
  return {
    kind: BASEBALL_RULE_DETAILS_KIND,
    ok: true,
    action,
    data,
  };
}

function errorDetails(
  action: BaseballRuleToolDetails["action"],
  error: unknown,
): BaseballRuleToolDetails {
  if (error instanceof BaseballRuleError) {
    return {
      kind: BASEBALL_RULE_DETAILS_KIND,
      ok: false,
      action,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
  }
  return {
    kind: BASEBALL_RULE_DETAILS_KIND,
    ok: false,
    action,
    error: {
      code: "BASEBALL_RULE_ERROR",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function result(details: BaseballRuleToolDetails) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
    details,
  };
}

export function createBaseballRulesExtension(
  options: BaseballRulesExtensionOptions,
): ExtensionFactory {
  return (pi) => {
    const service = new BaseballRuleService(options);

    pi.registerTool({
      name: BASEBALL_RULE_INGEST_TOOL_NAME,
      label: "Baseball Rule Ingest",
      description:
        "Ingest authoritative English baseball rule Markdown into the local hybrid rule index. Provide pasted Markdown or a safe path under the workspace/agent directory.",
      promptSnippet: "Ingest authoritative baseball rule Markdown",
      parameters: BaseballRuleIngestParameters,
      executionMode: "sequential",

      async execute(_toolCallId, rawParams) {
        try {
          return result(
            details(
              "ingest",
              await service.ingest(rawParams as BaseballRuleIngestParams),
            ),
          );
        } catch (error) {
          return result(errorDetails("ingest", error));
        }
      },
    });

    pi.registerTool({
      name: BASEBALL_RULE_QUERY_TOOL_NAME,
      label: "Baseball Rule Query",
      description:
        "Run agent-planned hybrid retrieval over ingested official baseball rules. Do not pass only the user's raw Chinese question; provide rawSituation, caseFacts, English rule-term queries, and normalized concepts.",
      promptSnippet:
        "Retrieve official baseball rule evidence from an agentic search plan",
      parameters: BaseballRuleQueryParameters,
      executionMode: "sequential",

      async execute(_toolCallId, rawParams) {
        try {
          return result(
            details(
              "query",
              await service.query(rawParams as BaseballRuleQueryParams),
            ),
          );
        } catch (error) {
          return result(errorDetails("query", error));
        }
      },
    });

    pi.on("tool_result", (event) => {
      if (
        event.toolName !== BASEBALL_RULE_INGEST_TOOL_NAME &&
        event.toolName !== BASEBALL_RULE_QUERY_TOOL_NAME
      ) {
        return;
      }
      const details = event.details as BaseballRuleToolDetails | undefined;
      if (details?.kind === BASEBALL_RULE_DETAILS_KIND && !details.ok) {
        return { isError: true };
      }
    });
  };
}
