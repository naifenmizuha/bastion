import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import type { TeamOpsToolDetails } from "../teamops/types.ts";
import { projectContext } from "./projection.ts";

type AgentMessage = ContextEvent["messages"][number];

function user(text: string, timestamp = 1): AgentMessage {
  return { role: "user", content: text, timestamp };
}

function assistantText(
  text: string,
  timestamp = 4,
  withThinking = false,
): AgentMessage {
  return {
    role: "assistant",
    content: [
      ...(withThinking
        ? [{ type: "thinking" as const, thinking: "private reasoning" }]
        : []),
      { type: "text", text },
    ],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp,
  };
}

function assistantTool(
  id: string,
  name: string,
  args: Record<string, unknown>,
  timestamp = 2,
): AgentMessage {
  return {
    role: "assistant",
    content: [
      { type: "text", text: "I will check." },
      { type: "toolCall", id, name, arguments: args },
    ],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "toolUse",
    timestamp,
  };
}

function toolResult(
  id: string,
  name: string,
  text: string,
  details?: unknown,
  timestamp = 3,
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text }],
    ...(details !== undefined ? { details } : {}),
    isError: false,
    timestamp,
  };
}

function finalText(message: AgentMessage): string {
  assert.equal(message.role, "assistant");
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

describe("context projection", () => {
  it("keeps user questions and final answers while removing final reasoning", () => {
    const result = projectContext([
      user("Who played?"),
      assistantText("Alice played.", 2, true),
    ]);

    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[0]?.role, "user");
    assert.equal(finalText(result.messages[1]!), "Alice played.");
    assert.equal(result.diagnostics.completedTurnsProjected, 1);
  });

  it("removes completed generic tool traces", () => {
    const hugeResult = "x".repeat(20_000);
    const result = projectContext([
      user("Read the file"),
      assistantTool("read-1", "read", { path: "/tmp/example" }),
      toolResult("read-1", "read", hugeResult),
      assistantText("The file contains an example."),
      user("What next?", 5),
    ]);

    assert.deepEqual(
      result.messages.map((message) => message.role),
      ["user", "assistant", "user"],
    );
    assert.equal(JSON.stringify(result.messages).includes(hugeResult), false);
    assert.equal(result.diagnostics.toolCallsRemoved, 1);
    assert.equal(result.diagnostics.toolResultsRemoved, 1);
  });

  it("keeps the current unfinished tool turn unchanged", () => {
    const messages = [
      user("Read the game"),
      assistantTool("game-1", "teamops", {
        args: ["game", "read", "--id", "12"],
      }),
      toolResult(
        "game-1",
        "teamops",
        "large current result",
        {
          kind: "teamops",
          ok: true,
          command: ["game", "read", "--id", "12"],
          risk: "read",
          result: {
            envelope: { ok: true, data: { id: 12 } },
            exitCode: 0,
            stderr: "",
          },
        } satisfies TeamOpsToolDetails,
      ),
    ];

    const result = projectContext(messages);

    assert.deepEqual(result.messages, messages);
    assert.equal(result.diagnostics.completedTurnsProjected, 0);
  });

  it("projects a length-stopped turn after a later user closes it", () => {
    const hugeResult = "x".repeat(20_000);
    const truncated = {
      ...assistantText("The analysis was cut off mid-sentence.", 4),
      stopReason: "length",
    } as AgentMessage;
    const result = projectContext([
      user("Analyze recent games"),
      assistantTool("read-1", "read", { path: "/tmp/result" }),
      toolResult("read-1", "read", hugeResult),
      truncated,
      user("What about defense?", 5),
    ]);

    assert.deepEqual(
      result.messages.map((message) => message.role),
      ["user", "assistant", "user"],
    );
    assert.equal(JSON.stringify(result.messages).includes(hugeResult), false);
    assert.match(
      finalText(result.messages[1]!),
      /assistant_response_status complete="false" reason="length"/,
    );
    assert.equal(result.diagnostics.incompleteTurnsProjected, 1);
  });

  it("keeps a current length-stopped turn unchanged without a later user", () => {
    const messages = [
      user("Analyze recent games"),
      {
        ...assistantText("The analysis was cut off.", 2),
        stopReason: "length",
      } as AgentMessage,
    ];

    assert.deepEqual(projectContext(messages).messages, messages);
  });

  it("projects a closed error turn even when it has no answer text", () => {
    const failed = {
      ...assistantText("", 2),
      content: [],
      stopReason: "error",
    } as AgentMessage;
    const result = projectContext([
      user("Analyze"),
      failed,
      user("Try something else", 3),
    ]);

    assert.match(
      finalText(result.messages[1]!),
      /assistant_response_status complete="false" reason="error"/,
    );
    assert.equal(result.diagnostics.incompleteTurnsProjected, 1);
  });

  it("replaces completed Bastion read results with stale authority references", () => {
    const hugeResult = JSON.stringify({ events: "x".repeat(20_000) });
    const details: TeamOpsToolDetails = {
      kind: "teamops",
      ok: true,
      command: ["game", "read", "--id", "12"],
      risk: "read",
      result: {
        envelope: { ok: true, data: { id: 12 } },
        exitCode: 0,
        stderr: "",
      },
    };
    const result = projectContext([
      user("Analyze game 12"),
      assistantTool("game-12", "teamops", {
        args: ["game", "read", "--id", "12"],
      }),
      toolResult("game-12", "teamops", hugeResult, details),
      assistantText("We lost 1-3."),
      user("Analyze the shortstop", 5),
    ]);

    const historicalAnswer = finalText(result.messages[1]!);
    assert.match(historicalAnswer, /bastion_context_receipt/);
    assert.match(historicalAnswer, /game:12/);
    assert.match(historicalAnswer, /game","read","--id","12/);
    assert.match(historicalAnswer, /We lost 1-3/);
    assert.equal(historicalAnswer.includes("x".repeat(100)), false);
    assert.equal(result.diagnostics.receiptsAdded, 1);
  });

  it("preserves confirmed and uncertain write semantics in receipts", () => {
    const confirmed: TeamOpsToolDetails = {
      kind: "teamops",
      ok: true,
      command: ["game", "score", "set"],
      risk: "write",
      approved: true,
      result: {
        envelope: { ok: true, data: { game_id: 12 } },
        exitCode: 0,
        stderr: "",
      },
      verification: [
        {
          args: ["game", "read", "--id", "12"],
          expected: { id: 12 },
          matched: true,
          envelope: { ok: true, data: { id: 12 } },
          exitCode: 0,
          stderr: "",
        },
      ],
    };
    const uncertain: TeamOpsToolDetails = {
      kind: "teamops",
      ok: false,
      command: ["lineup", "accept", "--id", "7"],
      risk: "write",
      approved: true,
      error: {
        code: "WRITE_VERIFICATION_FAILED",
        message: "verification failed",
      },
    };
    const result = projectContext([
      user("Save these changes"),
      assistantTool("score", "teamops", {
        args: ["game", "score", "set"],
        input: { game_id: 12, own_score: 5, opponent_score: 3 },
      }),
      toolResult("score", "teamops", "large score result", confirmed),
      assistantTool(
        "lineup",
        "teamops",
        { args: ["lineup", "accept", "--id", "7"] },
        4,
      ),
      toolResult(
        "lineup",
        "teamops",
        "large lineup result",
        uncertain,
        5,
      ),
      assistantText("The score was saved; lineup state is uncertain.", 6),
      user("Continue", 7),
    ]);

    const receipt = finalText(result.messages[1]!);
    assert.match(receipt, /"outcome":"confirmed"/);
    assert.match(receipt, /"outcome":"uncertain"/);
    assert.match(receipt, /WRITE_VERIFICATION_FAILED/);
    assert.match(receipt, /read back authoritative state before replaying/);
  });

  it("keeps malformed completed turns conservatively", () => {
    const messages = [
      user("Broken turn"),
      toolResult("missing", "read", "orphan"),
      assistantText("Done."),
      user("Next", 5),
    ];
    const result = projectContext(messages);

    assert.deepEqual(result.messages, messages);
    assert.equal(result.diagnostics.conservativeTurnsKept, 1);
    assert.match(
      result.diagnostics.warnings.join("\n"),
      /ORPHAN_TOOL_RESULT/,
    );
  });

  it("preserves compaction summaries before projected turns", () => {
    const summary = {
      role: "compactionSummary",
      summary: "Previous safe checkpoint",
      tokensBefore: 50_000,
      timestamp: 0,
    } as AgentMessage;
    const result = projectContext([
      summary,
      user("Question"),
      assistantText("Answer", 2),
      user("Active", 3),
    ]);

    assert.equal(result.messages[0], summary);
    assert.deepEqual(
      result.messages.map((message) => message.role),
      ["compactionSummary", "user", "assistant", "user"],
    );
  });
});
