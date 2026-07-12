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
  p50Chars: number;
  p95Chars: number;
  tinyChunks: number;
  tinyChunkRatio: number;
  oversizedChunks: number;
  isolatedHeadingChunks: number;
  smallestSamples: Array<{ characters: number; headingPath: string[] }>;
  largestSamples: Array<{ characters: number; headingPath: string[] }>;
  qualityScore: number;
  diagnostics: string[];
}

export interface BaseballRuleDocumentStats {
  contentHash: string;
  characters: number;
  headingLevels: Record<string, number>;
  tables: number;
  ruleSections: number;
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

export function markdownContentHash(value: string): string {
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

function splitWords(value: string, maxChars: number): string[] {
  const words = value.match(/\S+\s*/g) ?? [];
  const result: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (current.trim()) result.push(current.trim());
      current = "";
      for (let index = 0; index < word.length; index += maxChars) {
        result.push(word.slice(index, index + maxChars).trim());
      }
      continue;
    }
    if (current && current.length + word.length > maxChars) {
      result.push(current.trim());
      current = word;
    } else {
      current += word;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function splitBlock(block: string, maxChars: number): string[] {
  if (block.length <= maxChars) return [block];
  const lines = block.split("\n").filter((line) => line.trim());
  const atoms = lines.flatMap((line) => {
    if (line.length <= maxChars) return [line];
    const sentences = line.match(/[^.!?。！？]+[.!?。！？]+(?:\s+|$)|[^.!?。！？]+$/g) ?? [line];
    return sentences.flatMap((sentence) =>
      sentence.trim().length <= maxChars
        ? [sentence.trim()]
        : splitWords(sentence, maxChars)
    );
  });
  const result: string[] = [];
  let current = "";
  for (const atom of atoms) {
    const separator = current ? "\n" : "";
    if (current && current.length + separator.length + atom.length > maxChars) {
      result.push(current);
      current = atom;
    } else {
      current += `${separator}${atom}`;
    }
  }
  if (current) result.push(current);
  return result;
}

function completeOverlap(value: string, limit: number): string {
  if (limit === 0) return "";
  const units = value.split(/(?<=[.!?。！？])\s+|\n+/).map((item) => item.trim())
    .filter(Boolean);
  const selected: string[] = [];
  let length = 0;
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index]!;
    const nextLength = length + unit.length + (selected.length ? 1 : 0);
    if (nextLength > limit) break;
    selected.unshift(unit);
    length = nextLength;
  }
  return selected.join("\n");
}

function splitSection(
  section: Section,
  strategy: Required<BaseballRuleChunkStrategy>,
): string[] {
  const units = paragraphs(section).flatMap((block) =>
    splitBlock(block, strategy.maxChars)
  );
  const chunks: string[] = [];
  let current = "";
  for (const block of units) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (
      candidate.length <= strategy.maxChars &&
      (candidate.length <= strategy.targetChars || /^##[^\n]+$/.test(current.trim()))
    ) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(current);
      const overlap = completeOverlap(current, strategy.overlapChars);
      current = overlap && overlap.length + 2 + block.length <= strategy.maxChars
        ? `${overlap}\n\n${block}`
        : block;
    } else {
      current = block;
    }
  }
  if (current.trim()) chunks.push(current);
  if (
    chunks.length > 1 &&
    chunks.at(-1)!.length < 200 &&
    chunks.at(-2)!.length + 2 + chunks.at(-1)!.length <= strategy.maxChars
  ) {
    chunks.splice(-2, 2, `${chunks.at(-2)}\n\n${chunks.at(-1)}`);
  }
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
    const previous = rawChunks[index - 1];
    const next = rawChunks[index + 1];
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
      previousChunkId: previous?.section === raw.section ? chunkId(docId, index - 1) : "",
      nextChunkId: next?.section === raw.section ? chunkId(docId, index + 1) : "",
      content: raw.content,
      searchText,
      contentHash: markdownContentHash(raw.content),
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
  const normalized = normalizeChunkStrategy(strategy);
  const raw = rawMarkdownChunks(document, markdown, normalized);
  const ordered = raw.map((chunk) => ({
    characters: chunk.content.length,
    headingPath: [...chunk.section.headingPath],
    isolatedHeading: /^##[^\n]+$/.test(chunk.content.trim()),
  })).sort((left, right) => left.characters - right.characters);
  const lengths = ordered.map((chunk) => chunk.characters);
  if (lengths.length === 0) {
    return {
      chunks: 0,
      minChars: 0,
      avgChars: 0,
      maxChars: 0,
      p50Chars: 0,
      p95Chars: 0,
      tinyChunks: 0,
      tinyChunkRatio: 0,
      oversizedChunks: 0,
      isolatedHeadingChunks: 0,
      smallestSamples: [],
      largestSamples: [],
      qualityScore: 0,
      diagnostics: ["document produced no chunks"],
    };
  }
  const total = lengths.reduce((sum, value) => sum + value, 0);
  const p50Index = Math.max(0, Math.ceil(lengths.length * 0.5) - 1);
  const p95Index = Math.max(0, Math.ceil(lengths.length * 0.95) - 1);
  const tinyChunks = lengths.filter((length) => length < 200).length;
  const oversizedChunks = lengths.filter((length) => length > normalized.maxChars).length;
  const isolatedHeadingChunks = ordered.filter((chunk) => chunk.isolatedHeading).length;
  const tinyChunkRatio = tinyChunks / lengths.length;
  const diagnostics = [
    oversizedChunks ? `${oversizedChunks} chunks exceed maxChars` : "",
    tinyChunkRatio > 0.1 ? `${Math.round(tinyChunkRatio * 100)}% of chunks are under 200 characters` : "",
    isolatedHeadingChunks ? `${isolatedHeadingChunks} chunks contain only a heading` : "",
  ].filter(Boolean);
  const qualityScore = Math.max(0, Math.round(
    100 - oversizedChunks * 30 - tinyChunkRatio * 100 - isolatedHeadingChunks * 10,
  ));
  return {
    chunks: lengths.length,
    minChars: lengths[0]!,
    avgChars: Math.round(total / lengths.length),
    maxChars: lengths[lengths.length - 1]!,
    p50Chars: lengths[p50Index]!,
    p95Chars: lengths[p95Index]!,
    tinyChunks,
    tinyChunkRatio: Number(tinyChunkRatio.toFixed(4)),
    oversizedChunks,
    isolatedHeadingChunks,
    smallestSamples: ordered.slice(0, 2).map(({ characters, headingPath }) => ({ characters, headingPath })),
    largestSamples: ordered.slice(-2).reverse().map(({ characters, headingPath }) => ({ characters, headingPath })),
    qualityScore,
    diagnostics: diagnostics.length ? diagnostics : ["no chunk quality issues detected"],
  };
}

export function inspectMarkdownDocument(markdown: string): BaseballRuleDocumentStats {
  const headingLevels: Record<string, number> = {};
  for (const match of markdown.matchAll(/^(#{1,6})\s+/gm)) {
    const key = `h${match[1]!.length}`;
    headingLevels[key] = (headingLevels[key] ?? 0) + 1;
  }
  let tables = 0;
  let inTable = false;
  for (const line of markdown.split(/\r?\n/)) {
    const tableLine = /^\s*\|.*\|\s*$/.test(line);
    if (tableLine && !inTable) tables += 1;
    inTable = tableLine;
  }
  return {
    contentHash: markdownContentHash(markdown),
    characters: markdown.length,
    headingLevels,
    tables,
    ruleSections: [...markdown.matchAll(/^#{1,6}\s+.*\b(?:RULE|Rule)\s+[0-9]+/gm)].length,
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
