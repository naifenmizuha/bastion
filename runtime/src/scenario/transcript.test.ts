import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderTranscript } from "./transcript.ts";

describe("runtime transcript renderer", () => {
  it("renders only user and assistant text", () => {
    const transcript = renderTranscript([
      { role: "user", content: [{ type: "text", text: "固定输入" }] },
      {
        role: "assistant",
        content: [{ type: "text", text: "中间回复" }],
      },
      {
        role: "toolResult",
        content: [{ type: "text", text: "raw tool payload" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "最终回复" }],
      },
    ]);
    assert.match(transcript, /固定输入/);
    assert.match(transcript, /最终回复/);
    assert.doesNotMatch(transcript, /中间回复|raw tool payload|teamops/);
  });
});
