import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import type {
  BastionRuntimeHostOptions,
  createBastionRuntimeHost,
} from "../runtime-host.ts";
import { grade } from "./graders.ts";
import { runEvalSuite } from "./runner.ts";
import type { EvalCase } from "./types.ts";

function fakeHostFactory(
  agentDirs: string[],
  failure?: Error,
): typeof createBastionRuntimeHost {
  return (async (options?: BastionRuntimeHostOptions) => {
    if (!options?.agentDir) throw new Error("fake host requires agentDir");
    const agentDir = options.agentDir!;
    agentDirs.push(agentDir);
    const sessionId = `session-${agentDirs.length}`;
    const sessionFile = join(agentDir, "session-source.jsonl");
    const logDirectory = join(agentDir, "logs");
    const logFile = join(logDirectory, `${sessionId}.provider-payload.jsonl`);
    await mkdir(logDirectory, { recursive: true });
    await writeFile(sessionFile, '{"type":"session"}\n', "utf8");
    const messages: unknown[] = [];
    const session = {
      sessionId,
      sessionFile,
      messages,
      modelRegistry: {},
      setThinkingLevel() {},
      async prompt(prompt: string) {
        if (prompt === "/dev") return;
        if (failure) throw failure;
        messages.push(
          { role: "user", content: prompt, timestamp: 1 },
          {
            role: "assistant",
            provider: "fake",
            model: "fake-model",
            stopReason: "stop",
            content: [{ type: "text", text: "完成" }],
            usage: {
              input: 10,
              output: 2,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 12,
              cost: {
                input: 0.01,
                output: 0.02,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0.03,
              },
            },
          },
        );
        await writeFile(
          logFile,
          `${JSON.stringify({
            source: "agent",
            payload: {
              input: [{ role: "user", content: prompt }],
              tools: [],
            },
          })}\n`,
          "utf8",
        );
      },
    };
    return {
      runtime: { session },
      agentDir,
      async dispose() {},
    };
  }) as unknown as typeof createBastionRuntimeHost;
}

const passingCase: EvalCase = {
  id: "fake-case",
  title: "Fake case",
  category: "domain",
  turns: [{ prompt: "run fake case" }],
  grade() {
    return [
      grade("task", "task", true, "ok"),
      grade("safety", "safety", true, "ok"),
      grade("trajectory", "trajectory", true, "ok"),
      grade("answer", "answer", true, "ok"),
    ];
  },
};

describe("eval runner", () => {
  it("isolates repeated runs and writes complete artifacts without a provider", async () => {
    const output = await mkdtemp(join(tmpdir(), "bastion-eval-runner-"));
    const agentDirs: string[] = [];
    const result = await runEvalSuite({
      suite: "test",
      cases: [passingCase],
      runs: 2,
      outputDirectory: output,
      repositoryRoot: resolve(import.meta.dirname, "../../.."),
      executablePath: resolve(import.meta.dirname, "../../../out/bastion"),
      runtimeHostFactory: fakeHostFactory(agentDirs),
      judge: { provider: "missing", model: "missing" },
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.summary.passed, 2);
    assert.ok(result.results.every((run) => run.judgeError));
    assert.equal(new Set(agentDirs).size, 2);
    assert.ok(agentDirs.every((path) => path.startsWith(output)));
    for (const run of result.results) {
      assert.ok(run.transcriptPath);
      assert.ok(run.manualReviewPath);
      assert.ok(run.sessionPath);
      assert.ok(run.providerLogPath);
      assert.ok(run.contextAnalysisPath);
      assert.match(await readFile(run.transcriptPath, "utf8"), /完成/);
      assert.match(
        await readFile(run.manualReviewPath, "utf8"),
        /人工评价（请填写）/,
      );
    }
    const report = await readFile(join(output, "report.md"), "utf8");
    assert.match(report, /Bastion Agent 评测材料与自动结果/);
    assert.match(report, /测试介绍/);
    assert.match(report, /\| 最终门禁 \| \*\*通过\*\* \|/);
    assert.equal(
      (await readFile(join(output, "results.jsonl"), "utf8"))
        .trim()
        .split("\n").length,
      2,
    );
  });

  it("classifies provider failures as incomplete", async () => {
    const output = await mkdtemp(join(tmpdir(), "bastion-eval-provider-"));
    const result = await runEvalSuite({
      suite: "test",
      cases: [passingCase],
      runs: 1,
      outputDirectory: output,
      repositoryRoot: resolve(import.meta.dirname, "../../.."),
      executablePath: resolve(import.meta.dirname, "../../../out/bastion"),
      runtimeHostFactory: fakeHostFactory(
        [],
        new Error("No API key is available for fake provider"),
      ),
    });
    assert.equal(result.results[0]?.status, "incomplete");
    assert.equal(result.results[0]?.error?.kind, "provider");
    assert.equal(result.exitCode, 2);
  });

  it("classifies missing required tool use as an agent failure and keeps artifacts", async () => {
    const output = await mkdtemp(join(tmpdir(), "bastion-eval-protocol-"));
    const result = await runEvalSuite({
      suite: "test",
      cases: [
        {
          ...passingCase,
          turns: [{ prompt: "must use a tool", requireSuccessfulTool: true }],
        },
      ],
      runs: 1,
      outputDirectory: output,
      repositoryRoot: resolve(import.meta.dirname, "../../.."),
      executablePath: resolve(import.meta.dirname, "../../../out/bastion"),
      runtimeHostFactory: fakeHostFactory([]),
    });
    assert.equal(result.results[0]?.status, "failed");
    assert.equal(result.results[0]?.error?.kind, "agent_protocol");
    assert.ok(result.results[0]?.transcriptPath);
    assert.ok(result.results[0]?.sessionPath);
    assert.match(
      await readFile(result.results[0]!.transcriptPath!, "utf8"),
      /完成/,
    );
    assert.equal(result.exitCode, 1);
  });
});
