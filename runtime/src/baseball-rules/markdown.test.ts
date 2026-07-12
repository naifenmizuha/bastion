import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chunkMarkdownDocument,
  previewMarkdownChunks,
} from "./markdown.ts";

const document = { title: "Official Rules", source: "Test" };

function chunks(markdown: string, maxChars = 240) {
  const preview = previewMarkdownChunks(document, markdown, {
    targetChars: Math.min(180, maxChars),
    maxChars,
    overlapChars: 40,
  });
  return chunkMarkdownDocument(
    document,
    markdown,
    Array.from({ length: preview.chunks }, () => [1, 0]),
    1,
    { targetChars: Math.min(180, maxChars), maxChars, overlapChars: 40 },
  );
}

describe("baseball rule Markdown chunking", () => {
  it("strictly bounds long prose without cutting normal words or rule references", () => {
    const markdown = `## Rule 10.7.7 Runner Hit\n\n${
      "A fair ball touches the runner before passing an infielder. ".repeat(30)
    }`;
    const result = chunks(markdown);
    assert.ok(result.length > 2);
    assert.ok(result.every((chunk) => chunk.content.length <= 240));
    assert.ok(result.every((chunk) => !/^\w*$/.test(chunk.content) || !chunk.content));
    assert.equal(result[0]?.ruleRef, "10.7.7");
  });

  it("splits oversized tables only between complete rows", () => {
    const rows = Array.from({ length: 18 }, (_, index) =>
      `| ${index + 1} | complete table row ${index + 1} | ruling text |`
    ).join("\n");
    const result = chunks(`## Rule 6 Table\n\n| No | Situation | Result |\n|---|---|---|\n${rows}`, 220);
    assert.ok(result.every((chunk) => chunk.content.length <= 220));
    for (const chunk of result) {
      for (const line of chunk.content.split("\n").filter((line) => line.startsWith("|"))) {
        assert.ok(line.endsWith("|"));
      }
    }
  });

  it("merges isolated headings and keeps adjacency inside a section", () => {
    const result = chunks(`## Rule 1 Short\n\nShort ruling.\n\n## Rule 2 Long\n\n${
      "Complete sentence about the second rule. ".repeat(20)
    }`);
    assert.ok(result.every((chunk) => !/^##[^\n]+$/.test(chunk.content)));
    assert.equal(result[0]?.nextChunkId, "");
    const secondSection = result.filter((chunk) => chunk.ruleRef === "2");
    assert.ok(secondSection.length > 1);
    assert.equal(secondSection[0]?.nextChunkId, secondSection[1]?.id);
    assert.equal(secondSection[1]?.previousChunkId, secondSection[0]?.id);
  });
});
