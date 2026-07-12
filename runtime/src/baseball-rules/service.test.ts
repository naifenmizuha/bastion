import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

class ThrowingEmbedder implements EmbeddingProvider {
  readonly dimension = 6;

  async embed(): Promise<number[][]> {
    throw new Error("embedder should not be called");
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

const longRuleMarkdown = `
# Official Baseball Rules

## Rule 1 Long Section

${Array.from({ length: 8 }, (_, index) =>
  `Paragraph ${index + 1} explains a related part of the same rule. ${
    "The runner, batter, fielders, and umpire must be considered together before the ruling is finalized. ".repeat(4)
  }`
).join("\n\n")}
`;

const rulingMarkdown = `
# Official Baseball Rules

## Rule 10.7.7 Runner Touched by Fair Ball

A runner is out when touched by a fair ball in fair territory before the ball has gone through or by an infielder and no other infielder has a chance to make a play. The ball is dead.

## Rule 6.27 Fair Territory and Foul Pole

Fair territory includes the foul lines and their perpendicular extension. A fair fly passing out of the playing field in flight over fair territory is a home run. The foul pole marks that boundary.

## Rule 12.1 Interference

Intent and the timing of contact determine the applicable interference penalty.
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
    assert.equal(chunks[0]?.nextChunkId, "");
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

  it("uses custom chunk strategy for ingest while preserving adjacency", async () => {
    const { service, store } = harness();
    const broad = await service.ingest({
      documents: [{
        title: "Official Baseball Rules",
        source: "OBR",
        markdown: longRuleMarkdown,
      }],
      chunkStrategy: {
        targetChars: 5_000,
        maxChars: 6_000,
        overlapChars: 100,
      },
    });
    const broadCount = broad.documents[0]?.chunks ?? 0;

    const fine = await service.ingest({
      documents: [{
        title: "Official Baseball Rules",
        source: "OBR",
        markdown: longRuleMarkdown,
      }],
      chunkStrategy: {
        targetChars: 700,
        maxChars: 1_000,
        overlapChars: 80,
      },
    });
    assert.ok((fine.documents[0]?.chunks ?? 0) > broadCount);
    const chunks = [...store.chunks.values()];
    assert.equal(chunks[0]?.nextChunkId, chunks[1]?.id);
    assert.equal(chunks[1]?.previousChunkId, chunks[0]?.id);
  });

  it("rejects invalid chunk strategy values", async () => {
    const { service } = harness();
    await assert.rejects(
      service.ingest({
        documents: [{
          title: "Official Baseball Rules",
          source: "OBR",
          markdown: infieldMarkdown,
        }],
        chunkStrategy: {
          targetChars: 200,
          maxChars: 300,
          overlapChars: 200,
        },
      }),
      (error) =>
        error instanceof BaseballRuleError &&
        error.code === "INVALID_INPUT" &&
        /overlapChars/.test(error.message),
    );
  });

  it("reports isolated headings without blocking ingest", async () => {
    const { service, store } = harness();
    const result = await service.ingest({
      documents: [{
        title: "Official Baseball Rules",
        source: "OBR",
        markdown: `## 17.3.4 The scorer records the play according to the official rule.\n\n${
          "A complete scoring sentence remains part of this rule. ".repeat(60)
        }`,
      }],
      chunkStrategy: {
        targetChars: 1_600,
        maxChars: 2_400,
        overlapChars: 250,
      },
    });
    assert.ok((result.documents[0]?.quality.isolatedHeadingChunks ?? 0) > 0);
    assert.match(
      result.documents[0]?.quality.diagnostics.join(" ") ?? "",
      /contain only a heading/,
    );
    assert.ok(store.chunks.size > 1);
  });

  it("previews chunk strategies without embedding or writing the store", async () => {
    const store = new MemoryRuleStore();
    const service = new BaseballRuleService({
      store,
      embedder: new ThrowingEmbedder(),
      safeRoots: [process.cwd()],
      now: () => 100,
    });
    const preview = await service.previewChunks({
      documents: [{
        title: "Official Baseball Rules",
        source: "OBR",
        markdown: longRuleMarkdown,
      }],
      strategies: [
        {
          name: "fine",
          targetChars: 700,
          maxChars: 1_000,
          overlapChars: 80,
        },
        {
          name: "broad",
          targetChars: 5_000,
          maxChars: 6_000,
          overlapChars: 100,
        },
      ],
    });

    assert.equal(store.chunks.size, 0);
    assert.equal(preview.documents[0]?.strategies[0]?.name, "fine");
    assert.ok(
      (preview.documents[0]?.strategies[0]?.chunks ?? 0) >
        (preview.documents[0]?.strategies[1]?.chunks ?? 0),
    );
    assert.ok((preview.documents[0]?.strategies[0]?.p95Chars ?? 0) > 0);
  });

  it("previews the real WBSC rules without empty or oversized chunks", async () => {
    const workspace = resolve(process.cwd(), "..");
    const service = new BaseballRuleService({
      store: new MemoryRuleStore(),
      embedder: new ThrowingEmbedder(),
      safeRoots: [workspace],
    });
    const preview = await service.previewChunks({
      documents: [{
        title: "WBSC Official Rules of Baseball",
        source: "WBSC",
        path: join(workspace, "material", "rules.md"),
      }],
      strategies: [
        { name: "fine", targetChars: 800, maxChars: 1_400, overlapChars: 120 },
        { name: "balanced", targetChars: 1_200, maxChars: 2_000, overlapChars: 200 },
        { name: "broad", targetChars: 1_600, maxChars: 2_400, overlapChars: 250 },
      ],
    });
    const result = preview.documents[0]!;
    assert.equal(result.contentHash.length, 64);
    assert.ok(result.characters > 100_000);
    assert.ok(result.ruleSections > 0);
    assert.ok(result.tables > 0);
    assert.ok(result.strategies.every((strategy) => strategy.minChars > 1));
    assert.ok(result.strategies.every((strategy) => strategy.oversizedChunks === 0));
    assert.ok(result.recommendedStrategy.name.length > 0);
    assert.ok(JSON.stringify(result).length < 20_000);
  });

  it("reads Markdown paths inside safe root subdirectories", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bastion-rules-"));
    try {
      const rulesDirectory = join(directory, "material");
      await mkdir(rulesDirectory);
      const rulesPath = join(rulesDirectory, "rules.md");
      await writeFile(rulesPath, infieldMarkdown, "utf8");
      const service = new BaseballRuleService({
        store: new MemoryRuleStore(),
        embedder: new ThrowingEmbedder(),
        safeRoots: [directory],
      });

      const preview = await service.previewChunks({
        documents: [{
          title: "Official Baseball Rules",
          source: "OBR",
          path: rulesPath,
        }],
        strategies: [{ name: "balanced" }],
      });

      assert.equal(preview.documents[0]?.strategies[0]?.chunks, 2);
      await assert.rejects(
        service.previewChunks({
          documents: [{
            title: "Outside Rules",
            source: "OBR",
            path: join(directory, "..", "outside.md"),
          }],
          strategies: [{ name: "balanced" }],
        }),
        (error) =>
          error instanceof BaseballRuleError &&
          error.code === "PATH_NOT_ALLOWED",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects direct raw-query retrieval without an agentic plan", async () => {
    const { service } = harness();
    await assert.rejects(
      service.query({
        rawSituation: "一出局一二垒有人，内野高飞球。",
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
      englishQueries: ["appeal retouch base"],
      concepts: ["infield_fly"],
      weights: { fts: 1, vector: 0 },
    });
    const vectorFirst = await service.query({
      rawSituation: "内野高飞球，但检索计划也要查申诉。",
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
      englishQueries: ["obstruction interference runner"],
      concepts: ["obstruction"],
    });
    assert.equal(result.answer.status, "insufficient_evidence");
  });

  it("retrieves runner-contact rule evidence without making a ruling", async () => {
    const { service } = harness();
    await service.ingest({
      documents: [{ title: "Official Baseball Rules", source: "OBR", markdown: rulingMarkdown }],
    });
    const result = await service.query({
      rawSituation: "一垒跑者被滚地球击中。",
      englishQueries: ["runner touched by fair batted ball before passing infielder"],
      concepts: ["runner interference", "batted ball touching runner"],
    });
    assert.equal(result.answer.status, "evidence_found");
    assert.equal(result.evidence[0]?.ruleRef, "10.7.7");
  });

  it("retrieves foul-pole boundary evidence without making a ruling", async () => {
    const { service } = harness();
    await service.ingest({
      documents: [{ title: "Official Baseball Rules", source: "OBR", markdown: rulingMarkdown }],
    });
    const result = await service.query({
      rawSituation: "飞球越过围墙高度并击中界标杆。",
      englishQueries: ["fair fly foul pole home run boundary"],
      concepts: ["foul pole", "home run boundary"],
    });
    assert.equal(result.answer.status, "evidence_found");
    assert.equal(result.evidence[0]?.ruleRef, "6.27");
  });
});
