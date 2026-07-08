import { createHash } from "node:crypto";
import type { BaseballRuleChunk, BaseballRuleDocumentInput } from "./types.ts";

const TARGET_CHARS = 1_200;
const MAX_CHARS = 1_800;
const OVERLAP_CHARS = 200;

interface Section {
  headingPath: string[];
  body: string;
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

function splitSection(section: Section): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const block of paragraphs(section)) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= TARGET_CHARS || current.length === 0) {
      current = candidate;
      continue;
    }
    chunks.push(current);
    const overlap = current.slice(Math.max(0, current.length - OVERLAP_CHARS));
    current = `${overlap}\n\n${block}`;
    if (current.length > MAX_CHARS) {
      chunks.push(current.slice(0, MAX_CHARS));
      current = current.slice(Math.max(0, current.length - OVERLAP_CHARS));
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
): BaseballRuleChunk[] {
  const docId = stableDocId(document);
  const rawChunks = rawMarkdownChunks(document, markdown);
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
): number {
  return rawMarkdownChunks(document, markdown).length;
}

export function markdownChunkTexts(
  document: BaseballRuleDocumentInput,
  markdown: string,
): string[] {
  return rawMarkdownChunks(document, markdown).map((chunk) =>
    [
      document.title,
      document.source,
      chunk.section.headingPath.join(" "),
      chunk.content,
    ].filter(Boolean).join("\n"),
  );
}

function rawMarkdownChunks(
  document: BaseballRuleDocumentInput,
  markdown: string,
): Array<{ section: Section; content: string }> {
  return extractSections(markdown, document.title).flatMap((section) =>
    splitSection(section).map((content) => ({
      section,
      content: content.trim(),
    })),
  );
}
