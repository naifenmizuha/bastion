import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  renderManualReview,
  sessionMessagesFromJsonl,
} from "./manual-review.ts";

describe("manual review artifact", () => {
  it("renders every turn, tool call, tool result, and editable review fields", () => {
    const report = renderManualReview(
      [
        { role: "user", content: [{ type: "text", text: "查询球员" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "先查询" },
            {
              type: "toolCall",
              name: "bastion_cli",
              arguments: { args: ["player", "list"] },
            },
          ],
        },
        {
          role: "toolResult",
          toolName: "bastion_cli",
          content: [{ type: "text", text: '{"ok":true}' }],
          details: { ok: true },
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "查询完成" }],
        },
      ],
      { caseId: "player-read", title: "查询球员", repetition: 1 },
    );
    assert.match(report, /结论：未评价/);
    assert.match(report, /评分（0–100）：/);
    assert.match(report, /助手过程 1/);
    assert.match(report, /工具调用 1：`bastion_cli`/);
    assert.match(report, /工具结果 1：`bastion_cli`/);
    assert.match(report, /助手最终回答/);
  });

  it("extracts message payloads from a session JSONL", () => {
    const messages = sessionMessagesFromJsonl(
      [
        '{"type":"session"}',
        '{"type":"message","message":{"role":"user","content":"hello"}}',
      ].join("\n"),
    );
    assert.deepEqual(messages, [{ role: "user", content: "hello" }]);
  });
});
