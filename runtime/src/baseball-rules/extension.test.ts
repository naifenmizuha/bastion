import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASEBALL_RULE_CHUNK_PREVIEW_TOOL_NAME,
  BASEBALL_RULE_INGEST_TOOL_NAME,
  BASEBALL_RULE_QUERY_TOOL_NAME,
  type BaseballRuleStore,
  type EmbeddingProvider,
} from "./types.ts";
import {
  BaseballRuleChunkPreviewParameters,
  BaseballRuleIngestParameters,
  BaseballRuleQueryParameters,
  createBaseballRulesExtension,
} from "./extension.ts";

describe("baseball rules extension", () => {
  it("registers ingest and query tools and marks failed results as errors", async () => {
    const tools = new Map<string, { execute(id: string, input: unknown): Promise<{ details: unknown }> }>();
    let resultHandler:
      | ((event: { toolName: string; details: unknown }) => unknown)
      | undefined;
    createBaseballRulesExtension({
      store: emptyStore(),
      embedder: throwingEmbedder(),
      safeRoots: [process.cwd()],
    })({
      registerTool(tool: { name: string; execute(id: string, input: unknown): Promise<{ details: unknown }> }) {
        tools.set(tool.name, tool);
      },
      on(event: string, handler: typeof resultHandler) {
        if (event === "tool_result") resultHandler = handler;
      },
    } as never);

    assert.ok(tools.has(BASEBALL_RULE_INGEST_TOOL_NAME));
    assert.ok(tools.has(BASEBALL_RULE_CHUNK_PREVIEW_TOOL_NAME));
    assert.ok(tools.has(BASEBALL_RULE_QUERY_TOOL_NAME));
    const queryProperties =
      (BaseballRuleQueryParameters as unknown as { properties: Record<string, unknown> })
        .properties;
    const ingestProperties =
      (BaseballRuleIngestParameters as unknown as { properties: Record<string, unknown> })
        .properties;
    assert.equal(queryProperties.caseFacts, undefined);
    assert.equal(queryProperties.assumptions, undefined);
    assert.equal(queryProperties.unknownFacts, undefined);
    assert.equal(ingestProperties.expectedContentHash, undefined);
    assert.equal(
      (BaseballRuleIngestParameters as unknown as { properties: Record<string, unknown> })
        .properties.chunkStrategy !== undefined,
      true,
    );
    assert.equal(
      (BaseballRuleChunkPreviewParameters as unknown as { properties: Record<string, unknown> })
        .properties.strategies !== undefined,
      true,
    );

    const failed = await tools.get(BASEBALL_RULE_QUERY_TOOL_NAME)!.execute("q1", {
      rawSituation: "一出局一二垒有人。",
      englishQueries: [],
      concepts: [],
    });
    assert.deepEqual(
      resultHandler?.({
        toolName: BASEBALL_RULE_QUERY_TOOL_NAME,
        details: failed.details,
      }),
      { isError: true },
    );
  });
});

function throwingEmbedder(): EmbeddingProvider {
  return {
    dimension: 3,
    async embed() {
      throw new Error("unused");
    },
  };
}

function emptyStore(): BaseballRuleStore {
  return {
    replaceDocument() {},
    upsertChunks() {},
    searchFts() {
      return [];
    },
    searchVector() {
      return [];
    },
    fetch() {
      return new Map();
    },
    optimize() {},
  };
}
