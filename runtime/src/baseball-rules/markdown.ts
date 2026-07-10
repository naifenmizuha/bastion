import { createHash } from "node:crypto";
import type {
  BaseballRuleChunk,
  BaseballRuleChunkStrategy,
  BaseballRuleDocumentInput,
} from "./types.ts";

export const DEFAULT_CHUNK_STRATEGY = {
  targetChars: 1_200,
  maxChars: 1_800,
  overlapChars: 200,
} satisfies Required<BaseballRuleChunkStrategy>;

export interface BaseballRuleChunkStats {
  chunks: number;
  minChars: number;
  avgChars: number;
  maxChars: number;
  p95Chars: number;
}

interface Section {
  headingPath: string[];
  body: string;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function normalizeChunkStrategy(
  input: BaseballRuleChunkStrategy | undefined,
): Required<BaseballRuleChunkStrategy> {
  const strategy = { ...DEFAULT_CHUNK_STRATEGY, ...input };
  if (!positiveInteger(strategy.targetChars)) {
    throw new Error("chunkStrategy.targetChars must be a positive integer");
  }
  if (!positiveInteger(strategy.maxChars)) {
    throw new Error("chunkStrategy.maxChars must be a positive integer");
  }
  if (!nonNegativeInteger(strategy.overlapChars)) {
    throw new Error("chunkStrategy.overlapChars must be a non-negative integer");
  }
  if (strategy.maxChars < strategy.targetChars) {
    throw new Error("chunkStrategy.maxChars must be greater than or equal to targetChars");
  }
  if (strategy.overlapChars >= strategy.targetChars) {
    throw new Error("chunkStrategy.overlapChars must be less than targetChars");
  }
  return strategy;
}

function slug(value: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "document";
}

export function stableDocId(document: BaseballRuleDocumentInput): string {
  if (document.docId?.trim()) return slug(document.docId);
  const hash = createHash("sha256")
    .update([document.source, document.title, document.edition ?? ""].join("\n"))
    .digest("hex")
    .slice(0, 12);
  return `${slug(document.source)}-${slug(document.title)}-${hash}`;
}

function contentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function extractSections(markdown: string, title: string): Section[] {
  const sections: Section[] = [];
  const headings: string[] = [title];
  let current: Section = { headingPath: [title], body: "" };

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (current.body.trim()) sections.push(current);
      const level = match[1]!.length;
      const heading = match[2]!.trim();
      headings.length = Math.max(1, level);
      headings[level - 1] = heading;
      current = {
        headingPath: headings.filter(Boolean),
        body: "",
      };
      continue;
    }
    current.body += `${line}\n`;
  }

  if (current.body.trim()) sections.push(current);
  if (sections.length === 0 && markdown.trim()) {
    sections.push({ headingPath: [title], body: markdown });
  }
  return sections;
}

function paragraphs(section: Section): string[] {
  const heading = section.headingPath.at(-1);
  const blocks = section.body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (!heading) return blocks;
  return [`## ${heading}`, ...blocks];
}

function splitSection(
  section: Section,
  strategy: Required<BaseballRuleChunkStrategy>,
): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const block of paragraphs(section)) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= strategy.targetChars || current.length === 0) {
      current = candidate;
      continue;
    }
    chunks.push(current);
    const overlap = current.slice(Math.max(0, current.length - strategy.overlapChars));
    current = `${overlap}\n\n${block}`;
    if (current.length > strategy.maxChars) {
      chunks.push(current.slice(0, strategy.maxChars));
      current = current.slice(Math.max(0, current.length - strategy.overlapChars));
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

function inferRuleRef(headingPath: readonly string[], content: string): string {
  const text = [...headingPath, content.slice(0, 300)].join("\n");
  const patterns = [
    /\bRule\s+([0-9]+(?:\.[0-9]+)*(?:\([a-z0-9]+\))*)/i,
    /\b([0-9]+(?:\.[0-9]+)+(?:\([a-z0-9]+\))*)\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1];
  }
  return "";
}

function sectionId(docId: string, headingPath: readonly string[]): string {
  const suffix = createHash("sha1").update(headingPath.join("\n")).digest("hex")
    .slice(0, 10);
  return `${docId}:section:${suffix}`;
}

function chunkId(docId: string, index: number): string {
  return `${docId}-${String(index + 1).padStart(6, "0")}`;
}

export function chunkMarkdownDocument(
  document: BaseballRuleDocumentInput,
  markdown: string,
  embeddings: readonly number[][],
  now = Date.now(),
  strategyInput?: BaseballRuleChunkStrategy,
): BaseballRuleChunk[] {
  const docId = stableDocId(document);
  const rawChunks = rawMarkdownChunks(document, markdown, strategyInput);
  if (rawChunks.length !== embeddings.length) {
    throw new Error("embedding count must match chunk count");
  }

  return rawChunks.map((raw, index) => {
    const ruleRef = inferRuleRef(raw.section.headingPath, raw.content);
    const id = chunkId(docId, index);
    const headingPath = [...raw.section.headingPath];
    const searchText = [
      document.title,
      document.source,
      ruleRef ? `Rule ${ruleRef}` : "",
      headingPath.join(" "),
      raw.content,
    ].filter(Boolean).join("\n");
    return {
      id,
      docId,
      title: document.title,
      source: document.source,
      sourceUrl: document.sourceUrl ?? "",
      jurisdiction: document.jurisdiction ?? "",
      edition: document.edition ?? "",
      language: document.language ?? "en",
      sectionId: sectionId(docId, headingPath),
      ruleRef,
      headingPath,
      chunkIndex: index + 1,
      previousChunkId: index > 0 ? chunkId(docId, index - 1) : "",
      nextChunkId: index < rawChunks.length - 1 ? chunkId(docId, index + 1) : "",
      content: raw.content,
      searchText,
      contentHash: contentHash(raw.content),
      ingestedAt: now,
      embedding: [...embeddings[index]!],
    };
  });
}

export function countMarkdownChunks(
  document: BaseballRuleDocumentInput,
  markdown: string,
  strategy?: BaseballRuleChunkStrategy,
): number {
  return rawMarkdownChunks(document, markdown, strategy).length;
}

export function markdownChunkTexts(
  document: BaseballRuleDocumentInput,
  markdown: string,
  strategy?: BaseballRuleChunkStrategy,
): string[] {
  return rawMarkdownChunks(document, markdown, strategy).map((chunk) =>
    [
      document.title,
      document.source,
      chunk.section.headingPath.join(" "),
      chunk.content,
    ].filter(Boolean).join("\n"),
  );
}

export function previewMarkdownChunks(
  document: BaseballRuleDocumentInput,
  markdown: string,
  strategy?: BaseballRuleChunkStrategy,
): BaseballRuleChunkStats {
  const lengths = rawMarkdownChunks(document, markdown, strategy)
    .map((chunk) => chunk.content.length)
    .sort((left, right) => left - right);
  if (lengths.length === 0) {
    return {
      chunks: 0,
      minChars: 0,
      avgChars: 0,
      maxChars: 0,
      p95Chars: 0,
    };
  }
  const total = lengths.reduce((sum, value) => sum + value, 0);
  const p95Index = Math.max(0, Math.ceil(lengths.length * 0.95) - 1);
  return {
    chunks: lengths.length,
    minChars: lengths[0]!,
    avgChars: Math.round(total / lengths.length),
    maxChars: lengths[lengths.length - 1]!,
    p95Chars: lengths[p95Index]!,
  };
}

function rawMarkdownChunks(
  document: BaseballRuleDocumentInput,
  markdown: string,
  strategyInput?: BaseballRuleChunkStrategy,
): Array<{ section: Section; content: string }> {
  const strategy = normalizeChunkStrategy(strategyInput);
  return extractSections(markdown, document.title).flatMap((section) =>
    splitSection(section, strategy).map((content) => ({
      section,
      content: content.trim(),
    })),
  );
}
