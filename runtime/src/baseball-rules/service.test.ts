import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BaseballRuleService, BaseballRuleError } from "./service.ts";
import type {
  BaseballRuleChunk,
  BaseballRuleSearchFilters,
  BaseballRuleSearchHit,
  BaseballRuleStore,
  EmbeddingProvider,
} from "./types.ts";

class DeterministicEmbedder implements EmbeddingProvider {
  readonly dimension = 6;

  async embed(texts: readonly string[]): Promise<number[][]> {
    return texts.map((text) => {
      const lower = text.toLowerCase();
      return [
        count(lower, ["infield", "内野"]),
        count(lower, ["fly", "高飞", "飞球"]),
        count(lower, ["appeal", "申诉"]),
        count(lower, ["obstruction", "妨碍"]),
        count(lower, ["force", "强迫", "封杀"]),
        1,
      ];
    });
  }
}

function count(text: string, terms: readonly string[]): number {
  return terms.reduce(
    (total, term) => total + (text.includes(term) ? 1 : 0),
    0,
  );
}

function cosineDistance(left: readonly number[], right: readonly number[]) {
  const dot = left.reduce((total, value, index) => total + value * (right[index] ?? 0), 0);
  const leftNorm = Math.sqrt(left.reduce((total, value) => total + value * value, 0));
  const rightNorm = Math.sqrt(right.reduce((total, value) => total + value * value, 0));
  if (leftNorm === 0 || rightNorm === 0) return 1;
  return 1 - dot / (leftNorm * rightNorm);
}

class MemoryRuleStore implements BaseballRuleStore {
  readonly chunks = new Map<string, BaseballRuleChunk>();

  replaceDocument(docId: string, chunks: readonly BaseballRuleChunk[]): void {
    for (const [id, chunk] of this.chunks) {
      if (chunk.docId === docId) this.chunks.delete(id);
    }
    this.upsertChunks(chunks);
  }

  upsertChunks(chunks: readonly BaseballRuleChunk[]): void {
    for (const chunk of chunks) this.chunks.set(chunk.id, chunk);
  }

  searchFts(
    queries: readonly string[],
    filters: BaseballRuleSearchFilters,
    topK: number,
  ): BaseballRuleSearchHit[] {
    return queries.flatMap((query) => {
      const terms = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      return [...this.chunks.values()]
        .filter((chunk) => matches(chunk, filters))
        .map((chunk) => ({
          chunk,
          route: "fts" as const,
          query,
          score: terms.reduce(
            (total, term) =>
              total + (chunk.searchText.toLowerCase().includes(term) ? 1 : 0),
            0,
          ),
        }))
        .filter((hit) => hit.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, topK);
    });
  }

  searchVector(
    vector: readonly number[],
    filters: BaseballRuleSearchFilters,
    topK: number,
  ): BaseballRuleSearchHit[] {
    return [...this.chunks.values()]
      .filter((chunk) => matches(chunk, filters))
      .map((chunk) => ({
        chunk,
        route: "vector" as const,
        score: cosineDistance(vector, chunk.embedding),
      }))
      .sort((left, right) => left.score - right.score)
      .slice(0, topK);
  }

  fetch(ids: readonly string[]): Map<string, BaseballRuleChunk> {
    return new Map(
      ids.flatMap((id) => {
        const chunk = this.chunks.get(id);
        return chunk ? [[id, chunk] as const] : [];
      }),
    );
  }

  optimize(): void {}
}

function matches(
  chunk: BaseballRuleChunk,
  filters: BaseballRuleSearchFilters,
): boolean {
  return (
    (!filters.source || chunk.source === filters.source) &&
    (!filters.edition || chunk.edition === filters.edition) &&
    (!filters.jurisdiction || chunk.jurisdiction === filters.jurisdiction)
  );
}

function harness(store = new MemoryRuleStore()) {
  return {
    store,
    service: new BaseballRuleService({
      store,
      embedder: new DeterministicEmbedder(),
      safeRoots: [process.cwd()],
      now: () => 100,
    }),
  };
}

const infieldMarkdown = `
# Official Baseball Rules

## Rule 5.09(a)(5) Infield Fly

An Infield Fly is a fair fly ball which can be caught by an infielder with ordinary effort, when first and second, or first, second and third bases are occupied, before two are out. The batter is out and runners may advance at their own risk.

## Rule 5.09(a)(12) Appeal Play

An appeal may be made when a runner fails to retouch a base after a fair or foul ball is legally caught.
`;

describe("baseball rule service", () => {
  it("ingests Markdown chunks with metadata, rule refs, adjacency, and replacement", async () => {
    const { service, store } = harness();
    const first = await service.ingest({
      documents: [{
        title: "Official Baseball Rules",
        source: "OBR",
        edition: "2026",
        markdown: infieldMarkdown,
      }],
    });
    assert.equal(first.documents[0]?.chunks, 2);
    const chunks = [...store.chunks.values()];
    assert.equal(chunks[0]?.ruleRef, "5.09(a)(5)");
    assert.equal(chunks[0]?.nextChunkId, chunks[1]?.id);
    assert.deepEqual(chunks[0]?.headingPath, [
      "Official Baseball Rules",
      "Rule 5.09(a)(5) Infield Fly",
    ]);

    await service.ingest({
      documents: [{
        title: "Official Baseball Rules",
        source: "OBR",
        edition: "2026",
        markdown: "# Official Baseball Rules\n\n## Rule 6.01 Obstruction\n\nObstruction text.",
      }],
    });
    assert.equal(store.chunks.size, 1);
    assert.equal([...store.chunks.values()][0]?.ruleRef, "6.01");
  });

  it("rejects direct raw-query retrieval without an agentic plan", async () => {
    const { service } = harness();
    await assert.rejects(
      service.query({
        rawSituation: "一出局一二垒有人，内野高飞球。",
        caseFacts: {},
        englishQueries: [],
        concepts: [],
      }),
      (error) =>
        error instanceof BaseballRuleError &&
        error.code === "INVALID_INPUT",
    );
  });

  it("retrieves English rule evidence through FTS and vector routes", async () => {
    const { service } = harness();
    await service.ingest({
      documents: [{
        title: "Official Baseball Rules",
        source: "OBR",
        markdown: infieldMarkdown,
      }],
    });
    const result = await service.query({
      rawSituation: "一出局，一二垒有人，击球员打出内野高飞球。",
      caseFacts: {
        outs: 1,
        runners: ["1B", "2B"],
        battedBall: "fly_ball",
      },
      englishQueries: [
        "infield fly runners on first and second before two are out batter out",
      ],
      concepts: ["infield_fly"],
    });
    assert.equal(result.answer.status, "evidence_found");
    assert.equal(result.evidence[0]?.ruleRef, "5.09(a)(5)");
    assert.deepEqual(result.evidence[0]?.matchedBy, ["fts", "vector"]);
    assert.match(result.evidence[0]?.excerpt ?? "", /Infield Fly/);
  });

  it("lets retrieval weights change the final ranking", async () => {
    const { service } = harness();
    await service.ingest({
      documents: [{
        title: "Official Baseball Rules",
        source: "OBR",
        markdown: infieldMarkdown,
      }],
    });
    const ftsFirst = await service.query({
      rawSituation: "内野高飞球，但检索计划也要查申诉。",
      caseFacts: { outs: 1, runners: ["1B", "2B"], battedBall: "fly_ball" },
      englishQueries: ["appeal retouch base"],
      concepts: ["infield_fly"],
      weights: { fts: 1, vector: 0 },
    });
    const vectorFirst = await service.query({
      rawSituation: "内野高飞球，但检索计划也要查申诉。",
      caseFacts: { outs: 1, runners: ["1B", "2B"], battedBall: "fly_ball" },
      englishQueries: ["appeal retouch base"],
      concepts: ["infield_fly"],
      weights: { fts: 0, vector: 1 },
    });
    assert.match(ftsFirst.evidence[0]?.excerpt ?? "", /appeal/i);
    assert.match(vectorFirst.evidence[0]?.excerpt ?? "", /Infield Fly/);
  });

  it("returns insufficient evidence without inventing a ruling", async () => {
    const { service } = harness();
    const result = await service.query({
      rawSituation: "跑者疑似妨碍。",
      caseFacts: { runners: ["1B"] },
      englishQueries: ["obstruction interference runner"],
      concepts: ["obstruction"],
    });
    assert.equal(result.answer.status, "insufficient_evidence");
    assert.match(result.answer.draftConclusion, /No sufficient/);
    assert.deepEqual(result.answer.missingFacts, [
      "who impeded whom and when the act occurred",
    ]);
  });
});
