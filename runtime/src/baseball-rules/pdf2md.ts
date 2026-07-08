import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

export interface Pdf2MdMetadata {
  title: string;
  source: string;
  edition?: string;
  language?: string;
  sourceUrl?: string;
}

export interface Pdf2MdOptions {
  metadata: Pdf2MdMetadata;
  inputPdf?: string;
  inputRawText?: string;
  outputMarkdown: string;
  outputRawText?: string;
  keepRaw?: boolean;
}

const HEADER_PATTERNS = [
  /^2025-2026\s*\|\s*WBSC OFFICIAL RULES OF BASEBALL$/i,
  /^WBSC OFFICIAL RULES OF BASEBALL$/i,
];

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function frontmatter(metadata: Pdf2MdMetadata): string {
  const lines = [
    "---",
    `title: ${yamlString(metadata.title)}`,
    `source: ${yamlString(metadata.source)}`,
    metadata.edition ? `edition: ${yamlString(metadata.edition)}` : "",
    `language: ${yamlString(metadata.language ?? "en")}`,
    metadata.sourceUrl ? `source_url: ${yamlString(metadata.sourceUrl)}` : "",
    "---",
    "",
  ].filter((line) => line !== "");
  return `${lines.join("\n")}\n`;
}

function compactTitle(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+\d+$/, "")
    .trim();
}

function isPageJunk(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/^\d+$/.test(trimmed)) return true;
  return HEADER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isLikelyParagraphContinuation(line: string): boolean {
  if (!line) return false;
  if (/^[-*]\s+/.test(line)) return false;
  if (/^(#{1,6})\s+/.test(line)) return false;
  if (/^(Rule|Chapter)\b/i.test(line)) return false;
  if (/^[A-Z]\d+(?:\.\d+)*\b/.test(line)) return false;
  if (/^\d+(?:\.\d+)+\b/.test(line)) return false;
  return /^[a-z(]/.test(line) || /^(and|or|to|with|when|while|except)\b/i.test(line);
}

function headingLine(line: string): string | undefined {
  const chapter = /^CHAPTER\s+([0-9A-Z]+)\.?\s+(.+)$/i.exec(line);
  if (chapter?.[1] && chapter[2]) {
    return `# Chapter ${chapter[1]}. ${compactTitle(chapter[2])}`;
  }

  const rule = /^RULE\s+([A-Z0-9.]+)\.?\s+(.+)$/i.exec(line);
  if (rule?.[1] && rule[2]) {
    return `## Rule ${rule[1].replace(/\.$/, "")}. ${compactTitle(rule[2])}`;
  }

  const numbered = /^([0-9]+(?:\.[0-9]+)+)\s+(.+)$/i.exec(line);
  if (numbered?.[1] && numbered[2]) {
    return `### ${numbered[1]} ${compactTitle(numbered[2])}`;
  }

  const appendix = /^(APPENDIX\s+\d+)\s+(.+)$/i.exec(line);
  if (appendix?.[1] && appendix[2]) {
    return `# ${appendix[1].toUpperCase()} ${compactTitle(appendix[2])}`;
  }

  const appendixSection = /^([A-Z]\d+(?:\.\d+)*)\s+(.+)$/i.exec(line);
  if (appendixSection?.[1] && appendixSection[2]) {
    return `## ${appendixSection[1]} ${compactTitle(appendixSection[2])}`;
  }

  return undefined;
}

function flushParagraph(output: string[], paragraph: string[]): void {
  if (paragraph.length === 0) return;
  output.push(paragraph.join(" ").replace(/\s+/g, " ").trim());
  paragraph.length = 0;
}

export function rawTextToMarkdown(
  rawText: string,
  metadata: Pdf2MdMetadata,
): string {
  const output: string[] = [];
  const paragraph: string[] = [];
  const lines = rawText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !isPageJunk(line));

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line) {
      flushParagraph(output, paragraph);
      continue;
    }

    if (
      /^CHAPTER$/i.test(line) &&
      /^[0-9A-Z]+\.?$/.test(lines[index + 1] ?? "") &&
      lines[index + 2]
    ) {
      flushParagraph(output, paragraph);
      output.push(
        `# Chapter ${lines[index + 1]!.replace(/\.$/, "")}. ${compactTitle(lines[index + 2]!)}`,
      );
      index += 2;
      continue;
    }

    const heading = headingLine(line);
    if (heading) {
      flushParagraph(output, paragraph);
      output.push(heading);
      continue;
    }

    if (isLikelyParagraphContinuation(line) || paragraph.length > 0) {
      paragraph.push(line);
    } else {
      flushParagraph(output, paragraph);
      paragraph.push(line);
    }
  }
  flushParagraph(output, paragraph);

  return `${frontmatter(metadata)}${output.join("\n\n").trim()}\n`;
}

function runPdftotext(pdf: string, rawText: string): void {
  const result = spawnSync("pdftotext", ["-layout", pdf, rawText], {
    encoding: "utf8",
  });
  if (result.error && "code" in result.error && result.error.code === "ENOENT") {
    throw new Error(
      "pdftotext was not found. Install Poppler or run with --raw-txt from an existing text extraction.",
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `pdftotext failed: ${result.stderr || result.error?.message || "unknown error"}`,
    );
  }
}

export function convertPdfOrTextToMarkdown(options: Pdf2MdOptions): void {
  if (!options.inputPdf && !options.inputRawText) {
    throw new Error("provide either inputPdf or inputRawText");
  }
  if (options.inputPdf && options.inputRawText) {
    throw new Error("provide only one of inputPdf or inputRawText");
  }

  let rawPath = options.inputRawText ? resolve(options.inputRawText) : "";
  let temporaryDirectory = "";
  if (options.inputPdf) {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "bastion-pdf2md-"));
    rawPath = options.outputRawText
      ? resolve(options.outputRawText)
      : join(temporaryDirectory, `${basename(options.inputPdf)}.txt`);
    runPdftotext(resolve(options.inputPdf), rawPath);
  }

  try {
    const markdown = rawTextToMarkdown(
      readFileSync(rawPath, "utf8"),
      options.metadata,
    );
    const output = resolve(options.outputMarkdown);
    writeFileSync(output, markdown, "utf8");
    if (options.outputRawText && options.inputRawText) {
      writeFileSync(resolve(options.outputRawText), readFileSync(rawPath), "utf8");
    }
  } finally {
    if (temporaryDirectory && !options.keepRaw && !options.outputRawText) {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

function usage(): string {
  return `Usage:
  pnpm pdf2md -- --pdf input.pdf --out output.md --title "WBSC Official Rules of Baseball" --source WBSC --edition 2025-2026
  pnpm pdf2md -- --raw-txt extracted.txt --out output.md --title "WBSC Official Rules of Baseball" --source WBSC --edition 2025-2026

Options:
  --pdf PATH          PDF to extract with pdftotext -layout
  --raw-txt PATH      Existing raw text extraction to clean
  --out PATH          Markdown output path
  --raw-out PATH      Optional raw text output path
  --title TEXT        Document title
  --source TEXT       Source name, e.g. WBSC
  --edition TEXT      Edition string
  --language TEXT     Language, defaults to en
  --source-url URL    Original official PDF URL
  --keep-raw          Keep temporary raw extraction
`;
}

function parseArgs(argv: readonly string[]): Pdf2MdOptions {
  const args = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--") continue;
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    if (token === "--keep-raw") {
      args.set(token, true);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    args.set(token, value);
    index += 1;
  }

  const outputMarkdown = args.get("--out");
  const title = args.get("--title");
  const source = args.get("--source");
  if (typeof outputMarkdown !== "string" || typeof title !== "string" || typeof source !== "string") {
    throw new Error("--out, --title, and --source are required");
  }

  return {
    inputPdf: typeof args.get("--pdf") === "string" ? args.get("--pdf") as string : undefined,
    inputRawText: typeof args.get("--raw-txt") === "string" ? args.get("--raw-txt") as string : undefined,
    outputMarkdown,
    outputRawText: typeof args.get("--raw-out") === "string" ? args.get("--raw-out") as string : undefined,
    keepRaw: args.get("--keep-raw") === true,
    metadata: {
      title,
      source,
      edition: typeof args.get("--edition") === "string" ? args.get("--edition") as string : undefined,
      language: typeof args.get("--language") === "string" ? args.get("--language") as string : undefined,
      sourceUrl: typeof args.get("--source-url") === "string" ? args.get("--source-url") as string : undefined,
    },
  };
}

export function runPdf2MdCli(argv = process.argv.slice(2)): void {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return;
  }
  try {
    const options = parseArgs(argv);
    convertPdfOrTextToMarkdown(options);
    console.log(`Wrote ${resolve(options.outputMarkdown)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error(usage());
    process.exitCode = 1;
  }
}
