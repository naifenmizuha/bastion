export const BASEBALL_RULE_INGEST_TOOL_NAME = "ingest";
export const BASEBALL_RULE_CHUNK_PREVIEW_TOOL_NAME = "chunk_preview";
export const BASEBALL_RULE_QUERY_TOOL_NAME = "retrieve";
export const BASEBALL_RULE_DETAILS_KIND = "baseball_rules";

export interface BaseballRuleDocumentInput {
  title: string;
  source: string;
  docId?: string;
  sourceUrl?: string;
  jurisdiction?: string;
  edition?: string;
  language?: string;
  markdown?: string;
  path?: string;
}

export interface BaseballRuleIngestParams {
  documents: BaseballRuleDocumentInput[];
  replaceDocument?: boolean;
  chunkStrategy?: BaseballRuleChunkStrategy;
}

export interface BaseballRuleChunkStrategy {
  targetChars?: number;
  maxChars?: number;
  overlapChars?: number;
}

export interface BaseballRuleNamedChunkStrategy extends BaseballRuleChunkStrategy {
  name?: string;
}

export interface BaseballRuleChunkPreviewParams {
  documents: BaseballRuleDocumentInput[];
  strategies: BaseballRuleNamedChunkStrategy[];
}

export interface BaseballRuleChunkPreviewData {
  documents: Array<{
    title: string;
    source: string;
    docId: string;
    contentHash: string;
    characters: number;
    headingLevels: Record<string, number>;
    tables: number;
    ruleSections: number;
    strategies: Array<{
      name: string;
      chunkStrategy: Required<BaseballRuleChunkStrategy>;
      chunks: number;
      minChars: number;
      avgChars: number;
      maxChars: number;
      p50Chars: number;
      p95Chars: number;
      tinyChunks: number;
      tinyChunkRatio: number;
      oversizedChunks: number;
      isolatedHeadingChunks: number;
      smallestSamples: BaseballRuleChunkSample[];
      largestSamples: BaseballRuleChunkSample[];
      qualityScore: number;
      diagnostics: string[];
    }>;
    recommendedStrategy: {
      name: string;
      chunkStrategy: Required<BaseballRuleChunkStrategy>;
      reason: string;
    };
  }>;
}

export interface BaseballRuleChunkSample {
  characters: number;
  headingPath: string[];
}

export interface BaseballRuleQueryWeights {
  fts?: number;
  vector?: number;
  ruleRefBoost?: number;
  titleBoost?: number;
}

export interface BaseballRuleQueryParams {
  rawSituation: string;
  englishQueries: string[];
  concepts: string[];
  filters?: {
    jurisdiction?: string;
    edition?: string;
    source?: string;
  };
  weights?: BaseballRuleQueryWeights;
  topK?: number;
}

export interface BaseballRuleChunk {
  id: string;
  docId: string;
  title: string;
  source: string;
  sourceUrl: string;
  jurisdiction: string;
  edition: string;
  language: string;
  sectionId: string;
  ruleRef: string;
  headingPath: string[];
  chunkIndex: number;
  previousChunkId: string;
  nextChunkId: string;
  content: string;
  searchText: string;
  contentHash: string;
  ingestedAt: number;
  embedding: number[];
}

export interface BaseballRuleSearchFilters {
  jurisdiction?: string;
  edition?: string;
  source?: string;
}

export interface BaseballRuleSearchHit {
  chunk: BaseballRuleChunk;
  route: "fts" | "vector";
  score: number;
  query?: string;
}

export interface BaseballRuleEvidence {
  id: string;
  docId: string;
  title: string;
  source: string;
  sourceUrl: string;
  jurisdiction: string;
  edition: string;
  language: string;
  ruleRef: string;
  headingPath: string[];
  excerpt: string;
  context: string[];
  scores: {
    fts: number;
    vector: number;
    final: number;
  };
  matchedBy: string[];
  hitReasons: string[];
}

export interface BaseballRuleQueryData {
  rawSituation: string;
  concepts: string[];
  evidence: BaseballRuleEvidence[];
  answer: {
    status: "evidence_found" | "insufficient_evidence";
  };
}

export interface BaseballRuleToolDetails {
  kind: typeof BASEBALL_RULE_DETAILS_KIND;
  ok: boolean;
  action: "ingest" | "query" | "chunk_preview";
  data?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface BaseballRuleStore {
  replaceDocument(docId: string, chunks: readonly BaseballRuleChunk[]): void;
  upsertChunks(chunks: readonly BaseballRuleChunk[]): void;
  searchFts(
    queries: readonly string[],
    filters: BaseballRuleSearchFilters,
    topK: number,
  ): BaseballRuleSearchHit[];
  searchVector(
    vector: readonly number[],
    filters: BaseballRuleSearchFilters,
    topK: number,
  ): BaseballRuleSearchHit[];
  fetch(ids: readonly string[]): Map<string, BaseballRuleChunk>;
  optimize(): void;
  close?(): void;
}

export interface EmbeddingProvider {
  readonly dimension: number;
  embed(texts: readonly string[]): Promise<number[][]>;
}
