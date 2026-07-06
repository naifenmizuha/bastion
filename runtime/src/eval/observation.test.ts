import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractObservation } from "./observation.ts";

describe("eval observation", () => {
  it("extracts final answer, Bastion trajectory, model, usage, and generic tools", () => {
    const observation = extractObservation(
      [
        {
          role: "assistant",
          provider: "provider",
          model: "model",
          stopReason: "toolUse",
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "bastion_cli",
              arguments: { args: ["player", "list"] },
            },
          ],
          usage: {
            input: 10,
            output: 2,
            cacheRead: 3,
            cacheWrite: 0,
            totalTokens: 15,
            cost: {
              input: 0.1,
              output: 0.2,
              cacheRead: 0.03,
              cacheWrite: 0,
              total: 0.33,
            },
          },
        },
        {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "bastion_cli",
          input: { args: ["player", "list"] },
          details: {
            kind: "bastion_cli",
            ok: true,
            command: ["player", "list"],
            risk: "read",
          },
        },
        {
          role: "toolResult",
          toolCallId: "memory-1",
          toolName: "derived_memory",
          input: { operation: "search" },
          details: { ok: true },
        },
        {
          role: "assistant",
          provider: "provider",
          model: "model",
          stopReason: "stop",
          content: [{ type: "text", text: "最终答案" }],
          usage: {
            input: 20,
            output: 4,
            cacheRead: 0,
            cacheWrite: 1,
            totalTokens: 25,
            cost: {
              input: 0.2,
              output: 0.4,
              cacheRead: 0,
              cacheWrite: 0.01,
              total: 0.61,
            },
          },
        },
      ],
      123,
    );

    assert.equal(observation.finalAnswer, "最终答案");
    assert.deepEqual(observation.model, { provider: "provider", id: "model" });
    assert.equal(observation.stopReason, "stop");
    assert.equal(observation.toolCalls.length, 1);
    assert.deepEqual(observation.toolCalls[0]?.args, ["player", "list"]);
    assert.deepEqual(
      observation.allToolCalls.map((item) => item.name),
      ["bastion_cli", "derived_memory"],
    );
    assert.deepEqual(observation.usage, {
      input: 30,
      output: 6,
      cacheRead: 3,
      cacheWrite: 1,
      totalTokens: 40,
      cost: {
        input: 0.30000000000000004,
        output: 0.6000000000000001,
        cacheRead: 0.03,
        cacheWrite: 0.01,
        total: 0.94,
      },
    });
    assert.equal(observation.durationMs, 123);
  });
});
