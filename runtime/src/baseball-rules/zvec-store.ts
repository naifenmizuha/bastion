import { existsSync } from "node:fs";
import {
  ZVecCreateAndOpen,
  ZVecCollectionSchema,
  ZVecDataType,
  ZVecIndexType,
  ZVecMetricType,
  ZVecOpen,
  type ZVecCollection,
  type ZVecDoc,
  type ZVecDocInput,
} from "@zvec/zvec";
import type {
  BaseballRuleChunk,
  BaseballRuleSearchFilters,
  BaseballRuleSearchHit,
  BaseballRuleStore,
} from "./types.ts";

const OUTPUT_FIELDS = [
  "doc_id",
  "title",
  "source",
  "source_url",
  "jurisdiction",
  "edition",
  "language",
  "section_id",
  "rule_ref",
  "heading_path",
  "chunk_index",
  "previous_chunk_id",
  "next_chunk_id",
  "content",
  "search_text",
  "content_hash",
  "ingested_at",
];

function schema(dimension: number): ZVecCollectionSchema {
  return new ZVecCollectionSchema({
    name: "baseball_rules",
    vectors: {
      name: "embedding",
      dataType: ZVecDataType.VECTOR_FP32,
      dimension,
      indexParams: {
        indexType: ZVecIndexType.FLAT,
        metricType: ZVecMetricType.COSINE,
      },
    },
    fields: [
      indexedString("doc_id"),
      stringField("title"),
      indexedString("source"),
      stringField("source_url"),
      indexedString("jurisdiction"),
      indexedString("edition"),
      indexedString("language"),
      indexedString("section_id"),
      indexedString("rule_ref"),
      { name: "heading_path", dataType: ZVecDataType.ARRAY_STRING },
      {
        name: "chunk_index",
        dataType: ZVecDataType.INT32,
        indexParams: { indexType: ZVecIndexType.INVERT },
      },
      stringField("previous_chunk_id"),
      stringField("next_chunk_id"),
      stringField("content"),
      {
        name: "search_text",
        dataType: ZVecDataType.STRING,
        indexParams: {
          indexType: ZVecIndexType.FTS,
          tokenizerName: "standard",
          filters: ["lowercase"],
        },
      },
      stringField("content_hash"),
      { name: "ingested_at", dataType: ZVecDataType.INT64 },
    ],
  });
}

function stringField(name: string) {
  return { name, dataType: ZVecDataType.STRING };
}

function indexedString(name: string) {
  return {
    name,
    dataType: ZVecDataType.STRING,
    indexParams: { indexType: ZVecIndexType.INVERT },
  };
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function filterExpression(filters: BaseballRuleSearchFilters): string {
  return [
    filters.jurisdiction ? `jurisdiction = ${quote(filters.jurisdiction)}` : "",
    filters.edition ? `edition = ${quote(filters.edition)}` : "",
    filters.source ? `source = ${quote(filters.source)}` : "",
  ].filter(Boolean).join(" AND ");
}

function toDocInput(chunk: BaseballRuleChunk): ZVecDocInput {
  return {
    id: chunk.id,
    vectors: { embedding: chunk.embedding },
    fields: {
      doc_id: chunk.docId,
      title: chunk.title,
      source: chunk.source,
      source_url: chunk.sourceUrl,
      jurisdiction: chunk.jurisdiction,
      edition: chunk.edition,
      language: chunk.language,
      section_id: chunk.sectionId,
      rule_ref: chunk.ruleRef,
      heading_path: chunk.headingPath,
      chunk_index: chunk.chunkIndex,
      previous_chunk_id: chunk.previousChunkId,
      next_chunk_id: chunk.nextChunkId,
      content: chunk.content,
      search_text: chunk.searchText,
      content_hash: chunk.contentHash,
      ingested_at: chunk.ingestedAt,
    },
  };
}

function stringValue(fields: Record<string, unknown>, name: string): string {
  const value = fields[name];
  return typeof value === "string" ? value : "";
}

function intValue(fields: Record<string, unknown>, name: string): number {
  const value = fields[name];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : 0;
}

function arrayStringValue(
  fields: Record<string, unknown>,
  name: string,
): string[] {
  const value = fields[name];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : [];
}

function chunkFromDoc(doc: ZVecDoc): BaseballRuleChunk {
  const fields = doc.fields as Record<string, unknown>;
  const vector = doc.vectors.embedding;
  return {
    id: doc.id,
    docId: stringValue(fields, "doc_id"),
    title: stringValue(fields, "title"),
    source: stringValue(fields, "source"),
    sourceUrl: stringValue(fields, "source_url"),
    jurisdiction: stringValue(fields, "jurisdiction"),
    edition: stringValue(fields, "edition"),
    language: stringValue(fields, "language"),
    sectionId: stringValue(fields, "section_id"),
    ruleRef: stringValue(fields, "rule_ref"),
    headingPath: arrayStringValue(fields, "heading_path"),
    chunkIndex: intValue(fields, "chunk_index"),
    previousChunkId: stringValue(fields, "previous_chunk_id"),
    nextChunkId: stringValue(fields, "next_chunk_id"),
    content: stringValue(fields, "content"),
    searchText: stringValue(fields, "search_text"),
    contentHash: stringValue(fields, "content_hash"),
    ingestedAt: intValue(fields, "ingested_at"),
    embedding: Array.isArray(vector) ? [...vector] : [],
  };
}

function assertStatuses(statuses: unknown): void {
  const values = Array.isArray(statuses) ? statuses : [statuses];
  const failed = values.find(
    (status): status is { ok: boolean; code: string; message: string } =>
      typeof status === "object" &&
      status !== null &&
      "ok" in status &&
      (status as { ok: unknown }).ok !== true,
  );
  if (failed) {
    throw new Error(`Zvec write failed: ${failed.code} ${failed.message}`);
  }
}

export class ZvecBaseballRuleStore implements BaseballRuleStore {
  readonly #collection: ZVecCollection;

  constructor(path: string, dimension: number) {
    this.#collection = existsSync(path)
      ? ZVecOpen(path)
      : ZVecCreateAndOpen(path, schema(dimension));
  }

  replaceDocument(
    docId: string,
    chunks: readonly BaseballRuleChunk[],
  ): void {
    this.#collection.deleteByFilterSync(`doc_id = ${quote(docId)}`);
    this.upsertChunks(chunks);
  }

  upsertChunks(chunks: readonly BaseballRuleChunk[]): void {
    if (chunks.length === 0) return;
    assertStatuses(this.#collection.upsertSync(chunks.map(toDocInput)));
  }

  searchFts(
    queries: readonly string[],
    filters: BaseballRuleSearchFilters,
    topK: number,
  ): BaseballRuleSearchHit[] {
    const filter = filterExpression(filters);
    return queries.flatMap((query) =>
      this.#collection
        .querySync({
          fieldName: "search_text",
          fts: { matchString: query },
          topk: topK,
          filter,
          includeVector: false,
          outputFields: OUTPUT_FIELDS,
          params: { indexType: ZVecIndexType.FTS, defaultOperator: "OR" },
        })
        .map((doc) => ({
          chunk: chunkFromDoc(doc),
          route: "fts" as const,
          score: doc.score,
          query,
        })),
    );
  }

  searchVector(
    vector: readonly number[],
    filters: BaseballRuleSearchFilters,
    topK: number,
  ): BaseballRuleSearchHit[] {
    return this.#collection.querySync({
      fieldName: "embedding",
      vector: [...vector],
      topk: topK,
      filter: filterExpression(filters),
      includeVector: false,
      outputFields: OUTPUT_FIELDS,
    }).map((doc) => ({
      chunk: chunkFromDoc(doc),
      route: "vector" as const,
      score: doc.score,
    }));
  }

  fetch(ids: readonly string[]): Map<string, BaseballRuleChunk> {
    if (ids.length === 0) return new Map();
    const docs = this.#collection.fetchSync({
      ids: [...ids],
      outputFields: OUTPUT_FIELDS,
      includeVector: false,
    });
    return new Map(
      Object.values(docs).map((doc) => [doc.id, chunkFromDoc(doc)]),
    );
  }

  optimize(): void {
    this.#collection.optimizeSync();
  }

  close(): void {
    this.#collection.closeSync();
  }
}
