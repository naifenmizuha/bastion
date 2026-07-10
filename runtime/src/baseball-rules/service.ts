import { readFileSync } from "node:fs";
import { isAbsolute, resolve, relative } from "node:path";
import {
  chunkMarkdownDocument,
  countMarkdownChunks,
  markdownChunkTexts,
  normalizeChunkStrategy,
  previewMarkdownChunks,
  stableDocId,
} from "./markdown.ts";
import type {
  BaseballRuleChunk,
  BaseballRuleChunkPreviewData,
  BaseballRuleChunkPreviewParams,
  BaseballRuleChunkStrategy,
  BaseballRuleEvidence,
  BaseballRuleIngestParams,
  BaseballRuleQueryData,
  BaseballRuleQueryParams,
  BaseballRuleQueryWeights,
  BaseballRuleSearchFilters,
  BaseballRuleSearchHit,
  BaseballRuleStore,
  EmbeddingProvider,
} from "./types.ts";

const DEFAULT_WEIGHTS = {
  fts: 0.6,
  vector: 0.4,
  ruleRefBoost: 0.1,
  titleBoost: 0.05,
};

const MAX_TOP_K = 12;

export class BaseballRuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeWeights(
  input: BaseballRuleQueryWeights | undefined,
): Required<BaseballRuleQueryWeights> {
  const weights = { ...DEFAULT_WEIGHTS, ...input };
  for (const [name, value] of Object.entries(weights)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new BaseballRuleError(
        "INVALID_INPUT",
        `weight ${name} must be a non-negative number`,
      );
    }
  }
  return weights;
}

function validateQueryParams(params: BaseballRuleQueryParams): void {
  if (!nonEmptyString(params.rawSituation)) {
    throw new BaseballRuleError(
      "INVALID_INPUT",
      "rawSituation is required for audit and final explanation",
    );
  }
  if (!isObject(params.caseFacts) || Object.keys(params.caseFacts).length === 0) {
    throw new BaseballRuleError(
      "INVALID_INPUT",
      "caseFacts must contain structured umpiring facts before retrieval",
    );
  }
  if (
    !Array.isArray(params.englishQueries) ||
    params.englishQueries.filter(nonEmptyString).length === 0
  ) {
    throw new BaseballRuleError(
      "INVALID_INPUT",
      "englishQueries must contain rule-term English retrieval queries",
    );
  }
  if (
    !Array.isArray(params.concepts) ||
    params.concepts.filter(nonEmptyString).length === 0
  ) {
    throw new BaseballRuleError(
      "INVALID_INPUT",
      "concepts must contain normalized baseball rule concepts",
    );
  }
}

function safePath(path: string, roots: readonly string[]): string {
  const resolved = resolve(path);
  const allowed = roots.some((root) => {
    const rel = relative(resolve(root), resolved);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
  if (!allowed) {
    throw new BaseballRuleError(
      "PATH_NOT_ALLOWED",
      "rule documents can only be read from the workspace or agent directory",
      { path },
    );
  }
  return resolved;
}

function validateIngest(input: BaseballRuleIngestParams): void {
  validateRuleDocuments(input.documents);
}

function validateRuleDocuments(documents: unknown): asserts documents is BaseballRuleIngestParams["documents"] {
  if (!Array.isArray(documents) || documents.length === 0) {
    throw new BaseballRuleError(
      "INVALID_INPUT",
      "documents must contain at least one rule document",
    );
  }
  for (const [index, document] of documents.entries()) {
    if (!nonEmptyString(document.title) || !nonEmptyString(document.source)) {
      throw new BaseballRuleError(
        "INVALID_INPUT",
        "each document requires title and source",
        { index },
      );
    }
    const sources = [nonEmptyString(document.markdown), nonEmptyString(document.path)]
      .filter(Boolean).length;
    if (sources !== 1) {
      throw new BaseballRuleError(
        "INVALID_INPUT",
        "each document must provide exactly one of markdown or path",
        { index },
      );
    }
  }
}

function validateChunkPreview(input: BaseballRuleChunkPreviewParams): void {
  validateRuleDocuments(input.documents);
  if (!Array.isArray(input.strategies) || input.strategies.length === 0) {
    throw new BaseballRuleError(
      "INVALID_INPUT",
      "strategies must contain at least one chunk strategy",
    );
  }
}

function normalizeRuleChunkStrategy(
  input: BaseballRuleChunkStrategy | undefined,
): Required<BaseballRuleChunkStrategy> {
  try {
    return normalizeChunkStrategy(input);
  } catch (error) {
    throw new BaseballRuleError(
      "INVALID_INPUT",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function readRuleMarkdown(
  document: BaseballRuleIngestParams["documents"][number],
  roots: readonly string[],
): string {
  return nonEmptyString(document.markdown)
    ? document.markdown
    : readFileSync(safePath(document.path!, roots), "utf8");
}

function excerpt(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length <= 700 ? compact : `${compact.slice(0, 697)}...`;
}

function missingFacts(params: BaseballRuleQueryParams): string[] {
  const facts = params.caseFacts;
  const concepts = new Set(params.concepts.map((item) => item.toLowerCase()));
  const missing: string[] = [];
  if (
    (concepts.has("infield_fly") || concepts.has("force_play")) &&
    typeof facts.outs !== "number"
  ) {
    missing.push("number of outs");
  }
  if (
    (concepts.has("infield_fly") || concepts.has("force_play")) &&
    !Array.isArray(facts.runners)
  ) {
    missing.push("occupied bases before the play");
  }
  if (concepts.has("infield_fly") && !nonEmptyString(facts.battedBall)) {
    missing.push("batted-ball type and whether ordinary effort applies");
  }
  if (
    (concepts.has("interference") || concepts.has("obstruction")) &&
    !Array.isArray(facts.actions)
  ) {
    missing.push("who impeded whom and when the act occurred");
  }
  if (concepts.has("appeal_play") && !Array.isArray(facts.actions)) {
    missing.push("appeal action and base being appealed");
  }
  return [...new Set(missing)];
}

interface CombinedHit {
  chunk: BaseballRuleChunk;
  ftsRaw: number;
  vectorRaw: number;
  fts: number;
  vector: number;
  final: number;
  matchedBy: Set<string>;
  queries: Set<string>;
}

function mergeHits(
  hits: readonly BaseballRuleSearchHit[],
  weights: Required<BaseballRuleQueryWeights>,
  params: BaseballRuleQueryParams,
): CombinedHit[] {
  const byId = new Map<string, CombinedHit>();
  for (const hit of hits) {
    const existing = byId.get(hit.chunk.id) ?? {
      chunk: hit.chunk,
      ftsRaw: 0,
      vectorRaw: 0,
      fts: 0,
      vector: 0,
      final: 0,
      matchedBy: new Set<string>(),
      queries: new Set<string>(),
    };
    existing.matchedBy.add(hit.route);
    if (hit.query) existing.queries.add(hit.query);
    if (hit.route === "fts") {
      existing.ftsRaw = Math.max(existing.ftsRaw, hit.score);
    } else {
      existing.vectorRaw = Math.max(existing.vectorRaw, 1 / (1 + Math.max(0, hit.score)));
    }
    byId.set(hit.chunk.id, existing);
  }

  const values = [...byId.values()];
  const maxFts = Math.max(0, ...values.map((hit) => hit.ftsRaw));
  const maxVector = Math.max(0, ...values.map((hit) => hit.vectorRaw));
  const queryText = [
    ...params.englishQueries,
    ...params.concepts,
  ].join(" ").toLowerCase();

  for (const hit of values) {
    hit.fts = maxFts > 0 ? hit.ftsRaw / maxFts : 0;
    hit.vector = maxVector > 0 ? hit.vectorRaw / maxVector : 0;
    const ruleRefBoost =
      hit.chunk.ruleRef && queryText.includes(hit.chunk.ruleRef.toLowerCase())
        ? weights.ruleRefBoost
        : 0;
    const titleBoost = headingOverlap(hit.chunk.headingPath, queryText)
      ? weights.titleBoost
      : 0;
    hit.final =
      weights.fts * hit.fts +
      weights.vector * hit.vector +
      ruleRefBoost +
      titleBoost;
  }

  return values.sort((left, right) =>
    right.final - left.final ||
    right.fts - left.fts ||
    right.vector - left.vector ||
    left.chunk.id.localeCompare(right.chunk.id),
  );
}

function headingOverlap(headingPath: readonly string[], queryText: string): boolean {
  const words = new Set(
    queryText.split(/[^a-z0-9]+/).filter((word) => word.length >= 4),
  );
  return headingPath.some((heading) =>
    heading
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((word) => words.has(word)),
  );
}

function contextIds(chunk: BaseballRuleChunk): string[] {
  return [
    chunk.previousChunkId,
    chunk.nextChunkId,
  ].filter(nonEmptyString);
}

function evidenceFromHits(
  hits: readonly CombinedHit[],
  store: BaseballRuleStore,
  topK: number,
): BaseballRuleEvidence[] {
  const selected = hits.slice(0, topK);
  const context = store.fetch([
    ...new Set(selected.flatMap((hit) => contextIds(hit.chunk))),
  ]);
  return selected.map((hit) => {
    const adjacent = contextIds(hit.chunk)
      .map((id) => context.get(id))
      .filter((chunk): chunk is BaseballRuleChunk => chunk !== undefined)
      .map((chunk) => excerpt(chunk.content));
    const hitReasons = [
      hit.matchedBy.has("fts") ? "matched English rules full-text search" : "",
      hit.matchedBy.has("vector") ? "matched cross-language vector search" : "",
      hit.chunk.ruleRef ? `rule reference ${hit.chunk.ruleRef}` : "",
    ].filter(Boolean);
    return {
      id: hit.chunk.id,
      docId: hit.chunk.docId,
      title: hit.chunk.title,
      source: hit.chunk.source,
      sourceUrl: hit.chunk.sourceUrl,
      jurisdiction: hit.chunk.jurisdiction,
      edition: hit.chunk.edition,
      language: hit.chunk.language,
      ruleRef: hit.chunk.ruleRef,
      headingPath: hit.chunk.headingPath,
      excerpt: excerpt(hit.chunk.content),
      context: [
        hit.chunk.headingPath.join(" > "),
        ...adjacent,
      ].filter(Boolean),
      scores: {
        fts: Number(hit.fts.toFixed(6)),
        vector: Number(hit.vector.toFixed(6)),
        final: Number(hit.final.toFixed(6)),
      },
      matchedBy: [...hit.matchedBy].sort(),
      hitReasons,
    };
  });
}

async function embedTexts(
  provider: EmbeddingProvider,
  texts: readonly string[],
): Promise<number[][]> {
  try {
    return await provider.embed(texts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new BaseballRuleError(
      message.includes("not configured")
        ? "EMBEDDING_UNAVAILABLE"
        : "EMBEDDING_FAILED",
      message,
    );
  }
}

export interface BaseballRuleServiceOptions {
  store: BaseballRuleStore;
  embedder: EmbeddingProvider;
  safeRoots: readonly string[];
  now?: () => number;
}

export class BaseballRuleService {
  constructor(private readonly options: BaseballRuleServiceOptions) {}

  async ingest(params: BaseballRuleIngestParams): Promise<{
    documents: Array<{ docId: string; chunks: number; title: string; source: string }>;
  }> {
    validateIngest(params);
    const replace = params.replaceDocument ?? true;
    const chunkStrategy = normalizeRuleChunkStrategy(params.chunkStrategy);
    const documents = [];
    for (const document of params.documents) {
      const markdown = readRuleMarkdown(document, this.options.safeRoots);
      const chunkCount = countMarkdownChunks(document, markdown, chunkStrategy);
      if (chunkCount === 0) {
        throw new BaseballRuleError(
          "EMPTY_DOCUMENT",
          "rule document did not contain ingestible Markdown content",
          { title: document.title },
        );
      }
      const embeddings = await embedTexts(
        this.options.embedder,
        markdownChunkTexts(document, markdown, chunkStrategy),
      );
      const chunks = chunkMarkdownDocument(
        document,
        markdown,
        embeddings,
        this.options.now?.() ?? Date.now(),
        chunkStrategy,
      );
      const docId = stableDocId(document);
      if (replace) {
        this.options.store.replaceDocument(docId, chunks);
      } else {
        this.options.store.upsertChunks(chunks);
      }
      documents.push({
        docId,
        chunks: chunks.length,
        title: document.title,
        source: document.source,
      });
    }
    this.options.store.optimize();
    return { documents };
  }

  async previewChunks(
    params: BaseballRuleChunkPreviewParams,
  ): Promise<BaseballRuleChunkPreviewData> {
    validateChunkPreview(params);
    return {
      documents: params.documents.map((document) => {
        const markdown = readRuleMarkdown(document, this.options.safeRoots);
        return {
          title: document.title,
          source: document.source,
          docId: stableDocId(document),
          strategies: params.strategies.map((strategy, index) => {
            const normalized = normalizeRuleChunkStrategy(strategy);
            const stats = previewMarkdownChunks(document, markdown, normalized);
            return {
              name: nonEmptyString(strategy.name)
                ? strategy.name.trim()
                : `strategy-${index + 1}`,
              ...stats,
            };
          }),
        };
      }),
    };
  }

  async query(params: BaseballRuleQueryParams): Promise<BaseballRuleQueryData> {
    validateQueryParams(params);
    const topK = Math.min(MAX_TOP_K, Math.max(1, params.topK ?? 6));
    const weights = normalizeWeights(params.weights);
    const filters: BaseballRuleSearchFilters = params.filters ?? {};
    const englishQueries = params.englishQueries
      .map((query) => query.trim())
      .filter(Boolean);
    const vectorQuery = [
      params.rawSituation,
      ...params.concepts,
      ...englishQueries,
    ].join("\n");
    const [vector] = await embedTexts(this.options.embedder, [vectorQuery]);
    if (!vector) {
      throw new BaseballRuleError(
        "EMBEDDING_UNAVAILABLE",
        "embedding provider did not return a query vector",
      );
    }
    const hits = [
      ...this.options.store.searchFts(englishQueries, filters, topK * 2),
      ...this.options.store.searchVector(vector, filters, topK * 2),
    ];
    const evidence = evidenceFromHits(
      mergeHits(hits, weights, params),
      this.options.store,
      topK,
    );
    const missing = missingFacts(params);
    return {
      rawSituation: params.rawSituation,
      caseFacts: params.caseFacts,
      concepts: params.concepts,
      evidence,
      answer: {
        status: evidence.length > 0 ? "evidence_found" : "insufficient_evidence",
        draftConclusion: evidence.length > 0
          ? "Relevant official rule evidence was found. Answer in Chinese using only the cited excerpts, and state any assumptions from caseFacts."
          : "No sufficient official rule evidence was found for this planned retrieval. Ask for missing facts or broaden the retrieval plan before ruling.",
        missingFacts: missing,
      },
    };
  }
}
