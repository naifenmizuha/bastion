import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONTEXT_CATEGORIES,
  analyzeProviderPayloadLog,
  extractProviderUsage,
  renderContextAnalysisMarkdown,
} from "./context-analysis.ts";

function line(input: unknown[], tools: unknown[] = [{ name: "tool" }]): string {
  return JSON.stringify({
    source: "agent",
    payload: { input, tools },
  });
}

function stat(
  analysis: ReturnType<typeof analyzeProviderPayloadLog>,
  category: (typeof CONTEXT_CATEGORIES)[number],
  scope: "cumulative" | "finalRequest" = "cumulative",
): number {
  return (
    analysis[scope].categories.find((item) => item.category === category)
      ?.characters ?? 0
  );
}

describe("provider payload context analysis", () => {
  it("classifies cumulative and final request context", () => {
    const skillCall = {
      type: "function_call",
      call_id: "skill-1",
      name: "read",
      arguments: '{"path":"/repo/runtime/skills/team/SKILL.md"}',
    };
    const cliCall = {
      type: "function_call",
      call_id: "cli-1",
      name: "bastion_cli",
      arguments: '{"args":["player","list"]}',
    };
    const first = [
      { role: "developer", content: "system secret" },
      { role: "user", content: "user secret" },
      { type: "reasoning", summary: "reasoning secret" },
      { type: "message", role: "assistant", content: "assistant secret" },
      skillCall,
      {
        type: "function_call_output",
        call_id: "skill-1",
        output: "skill secret",
      },
      cliCall,
      {
        type: "function_call_output",
        call_id: "cli-1",
        output: "cli secret",
      },
    ];
    const second = [
      {
        type: "message",
        role: "assistant",
        content: "<bastion_context_receipt>receipt secret</bastion_context_receipt>",
      },
      {
        type: "function_call",
        call_id: "other-read",
        name: "read",
        arguments: '{"path":"/repo/README.md"}',
      },
      {
        type: "function_call_output",
        call_id: "other-read",
        output: "other read secret",
      },
    ];
    const analysis = analyzeProviderPayloadLog(
      `${line(first)}\n${line(second, [])}\n`,
      [
        { input: 80, cacheRead: 20, cacheWrite: 0, output: 5 },
        { input: 50, cacheRead: 0, cacheWrite: 0, output: 7 },
      ],
    );

    assert.equal(analysis.requestCount, 2);
    for (const category of CONTEXT_CATEGORIES) {
      assert.ok(stat(analysis, category) > 0 || category === "其他");
    }
    assert.ok(stat(analysis, "其他") > 0);
    assert.ok(stat(analysis, "Context projection receipt", "finalRequest") > 0);
    assert.equal(stat(analysis, "用户消息", "finalRequest"), 0);
    assert.equal(
      analysis.cumulative.categories.reduce(
        (total, item) => total + item.characters,
        0,
      ),
      analysis.cumulative.totalCharacters,
    );
    assert.deepEqual(analysis.cumulative.usage, {
      input: 130,
      cacheRead: 20,
      cacheWrite: 0,
      output: 12,
      promptTokens: 150,
    });
    assert.equal(analysis.finalRequest.usage.promptTokens, 50);
    assert.equal(
      analysis.cumulative.categories.reduce(
        (total, item) => total + item.allocatedTokens,
        0,
      ),
      150,
    );
    assert.equal(
      analysis.cumulative.groups.instructions +
        analysis.cumulative.groups.runtime +
        analysis.cumulative.groups.conversation,
      analysis.cumulative.totalCharacters,
    );
    const percentage = analysis.cumulative.categories.reduce(
      (total, item) => total + item.percentage,
      0,
    );
    assert.ok(Math.abs(percentage - 100) < 0.000001);
  });

  it("validates malformed and missing agent payloads", () => {
    assert.throws(() => analyzeProviderPayloadLog("", []), /empty/);
    assert.throws(
      () => analyzeProviderPayloadLog("{", []),
      /line 1.*invalid JSON/,
    );
    assert.throws(
      () =>
        analyzeProviderPayloadLog('{"source":"agent","payload":{}}', []),
      /payload\.input must be an array/,
    );
    assert.throws(
      () =>
        analyzeProviderPayloadLog(
          '{"source":"compaction","payload":{"input":[]}}',
          [],
        ),
      /no agent requests/,
    );
    assert.throws(
      () =>
        analyzeProviderPayloadLog(
          line([{ role: "user", content: "hello" }]),
          [],
        ),
      /count mismatch/,
    );
    assert.throws(
      () =>
        analyzeProviderPayloadLog(
          line([{ role: "user", content: "hello" }]),
          [{ input: 0, cacheRead: 0, cacheWrite: 0, output: 1 }],
        ),
      /positive prompt token usage/,
    );
  });

  it("renders statistics without copying payload content", () => {
    const analysis = analyzeProviderPayloadLog(
      line([
        { role: "developer", content: "system secret" },
        { role: "user", content: "user secret" },
      ]),
      [{ input: 90, cacheRead: 10, cacheWrite: 0, output: 12 }],
    );
    const report = renderContextAnalysisMarkdown(analysis, {
      sessionId: "session-1",
      logFilePath: "/tmp/session.provider-payload.jsonl",
    });

    assert.match(report, /累计传输/);
    assert.match(report, /最后一次请求/);
    assert.match(report, /Developer\/System 提示/);
    assert.match(report, /精确 Provider Usage/);
    assert.match(report, /Prompt 合计 \\| 100/);
    assert.match(report, /校准分摊 Token/);
    assert.match(report, /分类本身是近似归因/);
    assert.doesNotMatch(report, /system secret|user secret/);
  });

  it("extracts provider usage from assistant messages only", () => {
    assert.deepEqual(
      extractProviderUsage([
        { role: "user", content: "hello" },
        {
          role: "assistant",
          usage: {
            input: 20,
            output: 3,
            cacheRead: 4,
            cacheWrite: 1,
            totalTokens: 28,
          },
        },
        { role: "assistant", content: "no usage" },
      ]),
      [{ input: 20, output: 3, cacheRead: 4, cacheWrite: 1 }],
    );
  });
});
