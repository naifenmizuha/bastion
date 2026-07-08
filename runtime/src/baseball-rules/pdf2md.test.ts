import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  convertPdfOrTextToMarkdown,
  rawTextToMarkdown,
  runPdf2MdCli,
} from "./pdf2md.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const metadata = {
  title: "WBSC Official Rules of Baseball",
  source: "WBSC",
  edition: "2025-2026",
  language: "en",
  sourceUrl:
    "https://static.wbsc.org/uploads/federations/0/cms/documents/d3d36a7c-4a8a-1cca-adc1-d4edff1efc30.pdf",
};

describe("pdf2md", () => {
  it("cleans WBSC-style raw text into structured Markdown", () => {
    const markdown = rawTextToMarkdown(
      `
2025-2026 | WBSC OFFICIAL RULES OF BASEBALL
9
CHAPTER
01.
INTRODUCTION

RULE 1. OBJECTIVES
1.1 The offensive team's objective is to have its batter's become
runners and its runners advance to home plate.

RULE 10 BASE RUNNING
10.7 When Runners are Out
A runner is out when tagged while off base.
`,
      metadata,
    );

    assert.match(markdown, /^---\ntitle: "WBSC Official Rules of Baseball"/);
    assert.match(markdown, /# Chapter 01\. INTRODUCTION/);
    assert.match(markdown, /## Rule 1\. OBJECTIVES/);
    assert.match(markdown, /### 10\.7 When Runners are Out/);
    assert.match(markdown, /### 1\.1 The offensive team's objective/);
    assert.match(markdown, /runners and its runners advance to home plate\./);
    assert.doesNotMatch(markdown, /WBSC OFFICIAL RULES|^9$/m);
  });

  it("converts an existing raw text extraction file", () => {
    const directory = mkdtempSync(join(tmpdir(), "bastion-pdf2md-"));
    directories.push(directory);
    const raw = join(directory, "rules.txt");
    const out = join(directory, "rules.md");
    writeFileSync(raw, "RULE 8 BALL IN PLAY\n8.1 Live Ball\nThe ball is live.", "utf8");

    convertPdfOrTextToMarkdown({
      inputRawText: raw,
      outputMarkdown: out,
      metadata,
    });

    const markdown = readFileSync(out, "utf8");
    assert.match(markdown, /## Rule 8\. BALL IN PLAY/);
    assert.match(markdown, /### 8\.1 Live Ball/);
  });

  it("accepts the pnpm -- argument separator", () => {
    const directory = mkdtempSync(join(tmpdir(), "bastion-pdf2md-"));
    directories.push(directory);
    const raw = join(directory, "rules.txt");
    const out = join(directory, "rules.md");
    writeFileSync(raw, "RULE 1 OBJECTIVES\nBaseball text.", "utf8");
    const originalLog = console.log;
    try {
      console.log = () => {};
      runPdf2MdCli([
        "--",
        "--raw-txt",
        raw,
        "--out",
        out,
        "--title",
        "WBSC Official Rules of Baseball",
        "--source",
        "WBSC",
      ]);
    } finally {
      console.log = originalLog;
    }
    assert.match(readFileSync(out, "utf8"), /## Rule 1\. OBJECTIVES/);
  });
});
