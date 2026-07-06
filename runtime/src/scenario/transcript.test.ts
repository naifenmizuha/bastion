import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SCENARIO_PROMPTS } from "./fixture.ts";
import { renderTranscript } from "./transcript.ts";

describe("runtime scenario fixture", () => {
  it("keeps the four fixed user turns in the intended order", () => {
    assert.equal(SCENARIO_PROMPTS.length, 4);
    assert.match(SCENARIO_PROMPTS[0], /名单/);
    assert.match(SCENARIO_PROMPTS[1], /海港队/);
    assert.match(SCENARIO_PROMPTS[2], /比赛过程/);
    assert.match(SCENARIO_PROMPTS[3], /林晨/);
  });

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
    assert.doesNotMatch(transcript, /中间回复|raw tool payload|bastion_cli/);
  });
});
