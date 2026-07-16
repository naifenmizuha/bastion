import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DerivedMemoryStore } from "../derived-memory/store.ts";
import { ensureBaselineDatabase } from "./database.ts";
import { runEvaluation } from "./runner.ts";
import type { EvaluationConfig, QualityReview } from "./types.ts";

test("evaluation runner writes a structured passed run with a fake session", async () => {
  const repositoryRoot = join(import.meta.dirname, "../../..");
  const outputDirectory = await mkdtemp(join(tmpdir(), "bastion-eval-run-"));
  const baseline = await ensureBaselineDatabase(join(repositoryRoot, "out", "athletics-2025.sql"), join(repositoryRoot, "out", "eval-cache"));
  const config: EvaluationConfig = {
    schemaVersion: 1,
    name: "fake",
    runs: 1,
    timeoutSeconds: 20,
    agent: { thinking: "low" },
    reviewer: { provider: "fake", model: "reviewer" },
    passRules: {
      relevance: 4,
      usefulness: 4,
      groundedness: 4,
      databaseCorrectness: 4,
      executionQuality: 3,
      average: 4,
      minimumCasePassRate: 1,
      minimumSuitePassRate: 1,
    },
    scoring: { passScore: 0 },
    prompts: [{ id: "fake-read", title: "fake", tags: ["test"], text: "查询名单", turns: [{ id: "turn-1", prompt: "查询名单", expectations: [] }], sessions: [{ id: "session-1", turns: [{ id: "turn-1", prompt: "查询名单", expectations: [] }] }], expectations: [], writePermission: "deny" }],
    sourcePath: "fake.toml",
  };
  try {
    let temporaryAgentDir = "";
    const review: QualityReview = {
      scores: { relevance: 5, usefulness: 5, groundedness: 5, databaseCorrectness: 5, executionQuality: 5 },
      summary: "通过",
      strengths: ["有证据"],
      issues: [],
      confidence: "high",
      usage: { requestCount: 1, input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 },
      model: { provider: "fake", id: "reviewer" },
    };
    const result = await runEvaluation({
      config,
      outputDirectory,
      repositoryRoot,
      executablePath: join(repositoryRoot, "out", "teamops"),
      runtimeHostFactory: async (hostOptions) => {
        assert.equal(hostOptions.loadConfiguredPackages, false);
        const agentDir = String(hostOptions.agentDir);
        temporaryAgentDir = agentDir;
        await mkdir(join(agentDir, "logs"), { recursive: true });
        await writeFile(join(agentDir, "logs", "fake-session.provider-payload.jsonl"), "{\"test\":true}\n");
        const memory = new DerivedMemoryStore(join(agentDir, "derived-memory.sqlite"));
        memory.close();
        const listeners: Array<(event: unknown) => void> = [];
        const messages: unknown[] = [];
        const session = {
          sessionId: "fake-session",
          messages,
          modelRegistry: {},
          subscribe(listener: (event: unknown) => void) {
            listeners.push(listener);
            return () => listeners.splice(listeners.indexOf(listener), 1);
          },
          async prompt(text: string) {
            if (text === "/dev") return;
            messages.push({ role: "user", content: text });
            listeners.forEach((listener) => listener({ type: "message_start", message: { role: "user", content: text } }));
            listeners.forEach((listener) => listener({ type: "message_start", message: { role: "assistant", content: [] } }));
            listeners.forEach((listener) => listener({ type: "tool_execution_start", toolName: "teamops", toolCallId: "call-1", args: { args: ["player", "list"] } }));
            listeners.forEach((listener) => listener({ type: "tool_execution_end", toolName: "teamops", toolCallId: "call-1", result: { details: { kind: "teamops", ok: true, command: ["player", "list"], risk: "read" } } }));
            const answer = { role: "assistant", content: [{ type: "text", text: "名单来自 TeamOps 数据库。" }], provider: "fake", model: "agent", stopReason: "stop", usage: { input: 20, output: 8, totalTokens: 28 } };
            messages.push(answer);
            listeners.forEach((listener) => listener({ type: "message_end", message: answer }));
          },
          abort() {},
        };
        return {
          runtime: { session },
          agentDir,
          async dispose() {},
        };
      },
      reviewer: async () => review,
    });
    assert.equal(result.exitCode, 0, JSON.stringify(result.results[0]));
    assert.equal(result.summary.passed, 1);
    assert.equal(result.results[0]?.status, "passed");
    await assert.rejects(access(temporaryAgentDir));
    await assert.rejects(access(join(outputDirectory, "cases", "fake-read", "run-1", "agent")));
    await access(join(outputDirectory, "cases", "fake-read", "run-1", "provider-payload.jsonl"));
    assert.match(result.results[0]?.files["provider-payload.jsonl"] ?? "", /provider-payload\.jsonl$/);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("evaluation runner executes v2 turns in one session and scores expectations", async () => {
  const repositoryRoot = join(import.meta.dirname, "../../..");
  const outputDirectory = await mkdtemp(join(tmpdir(), "bastion-eval-v2-"));
  const config: EvaluationConfig = {
    schemaVersion: 2,
    name: "multi",
    runs: 1,
    timeoutSeconds: 20,
    agent: { thinking: "low" },
    reviewer: { provider: "fake", model: "reviewer" },
    passRules: { relevance: 4, usefulness: 4, groundedness: 4, databaseCorrectness: 4, executionQuality: 3, average: 4, minimumCasePassRate: 1, minimumSuitePassRate: 1 },
    scoring: { passScore: 80 },
    prompts: [{
      id: "multi", title: "multi", tags: ["test"], text: "查询名单", writePermission: "deny",
      turns: [
        { id: "lookup", prompt: "查询名单", expectations: [{ id: "answer", title: "故意失败的中间预期", type: "response_contains", weight: 2, value: "不存在", caseSensitive: false }] },
        { id: "followup", prompt: "说明来源", expectations: [{ id: "tool", title: "工具", type: "tool_called", weight: 2, tool: "teamops", command: ["player", "list"] }] },
      ],
      sessions: [{
        id: "session-1",
        turns: [
          { id: "lookup", prompt: "查询名单", expectations: [{ id: "answer", title: "故意失败的中间预期", type: "response_contains", weight: 2, value: "不存在", caseSensitive: false }] },
          { id: "followup", prompt: "说明来源", expectations: [{ id: "tool", title: "工具", type: "tool_called", weight: 2, tool: "teamops", command: ["player", "list"] }] },
        ],
      }],
      expectations: [
        { id: "games", title: "比赛数", type: "sql", weight: 1, database: "teamops", query: "SELECT COUNT(*) AS count FROM games", expectedRows: [{ count: 162 }] },
        { id: "creative", title: "清晰", type: "rubric", weight: 2, criteria: "表达清晰", anchors: { 1: "混乱", 3: "基本清晰", 5: "非常清晰" }, requiredFacts: [], forbidden: [] },
      ],
    }],
    sourcePath: "multi.toml",
  };
  try {
    let promptCount = 0;
    const result = await runEvaluation({
      config,
      outputDirectory,
      repositoryRoot,
      executablePath: join(repositoryRoot, "out", "teamops"),
      runtimeHostFactory: async (hostOptions) => {
        const agentDir = String(hostOptions.agentDir);
        const memory = new DerivedMemoryStore(join(agentDir, "derived-memory.sqlite"));
        memory.close();
        const listeners: Array<(event: unknown) => void> = [];
        const messages: unknown[] = [];
        const session = {
          sessionId: "multi-session", messages, modelRegistry: {},
          subscribe(listener: (event: unknown) => void) { listeners.push(listener); return () => listeners.splice(listeners.indexOf(listener), 1); },
          async prompt(text: string) {
            if (text === "/dev") return;
            promptCount += 1;
            messages.push({ role: "user", content: text });
            listeners.forEach((listener) => listener({ type: "message_start", message: { role: "user", content: text } }));
            listeners.forEach((listener) => listener({ type: "message_start", message: { role: "assistant", content: [] } }));
            listeners.forEach((listener) => listener({ type: "tool_execution_start", toolName: "teamops", toolCallId: `call-${promptCount}`, args: { args: ["player", "list"] } }));
            listeners.forEach((listener) => listener({ type: "tool_execution_end", toolName: "teamops", toolCallId: `call-${promptCount}`, result: { details: { kind: "teamops", ok: true, command: ["player", "list"], risk: "read" } } }));
            const answer = { role: "assistant", content: [{ type: "text", text: promptCount === 1 ? "名单如下" : "名单来自 TeamOps" }], provider: "fake", model: "agent", stopReason: "stop", usage: { input: 1, output: 1, totalTokens: 2 } };
            messages.push(answer);
            listeners.forEach((listener) => listener({ type: "message_end", message: answer }));
          },
          abort() {},
        };
        return { runtime: { session }, agentDir, async dispose() {} };
      },
      reviewer: async ({ evidence }) => {
        assert.equal(evidence.turns.length, 2);
        return {
          scores: { relevance: 5, usefulness: 5, groundedness: 5, databaseCorrectness: 5, executionQuality: 5 },
          scoreReasons: { relevance: { reason: "好", evidence: "回答" }, usefulness: { reason: "好", evidence: "回答" }, groundedness: { reason: "好", evidence: "工具" }, databaseCorrectness: { reason: "好", evidence: "无变化" }, executionQuality: { reason: "好", evidence: "工具" } },
          rubricResults: [{ expectationId: "creative", score: 5, reason: "清晰", evidence: "名单来自 TeamOps" }],
          summary: "通过", strengths: ["清晰"], issues: [], confidence: "high", usage: { requestCount: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 }, model: { provider: "fake", id: "reviewer" },
        };
      },
    });
    assert.equal(promptCount, 2);
    assert.equal(result.results[0]?.turns.length, 2);
    assert.equal(result.results[0]?.score.total, 83.33);
    assert.equal(result.results[0]?.status, "passed");
    assert.equal(result.results[0]?.expectationResults.find((item) => item.expectationId === "answer")?.deductedWeight, 2);
    assert.ok(result.results[0]?.checks.every((check) => check.code !== "quality.thresholds"));
    const markdown = await readFile(join(outputDirectory, "report.md"), "utf8");
    assert.match(markdown, /83\.3\/100/);
    assert.match(markdown, /扣分原因/);
    assert.match(markdown, /-2\.0/);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("evaluation runner rebuilds runtime sessions while preserving derived memory", async () => {
  const repositoryRoot = join(import.meta.dirname, "../../..");
  const outputDirectory = await mkdtemp(join(tmpdir(), "bastion-eval-v3-"));
  const turns = [
    { id: "save", prompt: "记住跨会话结论", expectations: [{ id: "saved", title: "保存完成", type: "response_contains" as const, weight: 35, value: "已记住", caseSensitive: false }] },
    { id: "recall", prompt: "之前的结论是什么？", expectations: [{ id: "recalled", title: "正确召回", type: "response_contains" as const, weight: 35, value: "跨会话仍然可见", caseSensitive: false }] },
  ];
  const config: EvaluationConfig = {
    schemaVersion: 3,
    name: "cross-session",
    runs: 1,
    timeoutSeconds: 20,
    agent: { thinking: "low" },
    reviewer: { provider: "fake", model: "reviewer" },
    passRules: { relevance: 4, usefulness: 4, groundedness: 4, databaseCorrectness: 4, executionQuality: 3, average: 4, minimumCasePassRate: 1, minimumSuitePassRate: 1 },
    scoring: { passScore: 80 },
    prompts: [{
      id: "memory-across-sessions", title: "memory", tags: ["memory"], text: turns[0]!.prompt, writePermission: "allow",
      turns,
      sessions: [{ id: "establish", turns: [turns[0]!] }, { id: "recall", turns: [turns[1]!] }],
      expectations: [],
    }],
    sourcePath: "cross-session.toml",
  };
  try {
    let hostCount = 0;
    let sharedAgentDir: string | undefined;
    let sharedDatabasePath: string | undefined;
    const result = await runEvaluation({
      config,
      outputDirectory,
      repositoryRoot,
      executablePath: join(repositoryRoot, "out", "teamops"),
      runtimeHostFactory: async (hostOptions) => {
        hostCount += 1;
        const currentHost = hostCount;
        const agentDir = String(hostOptions.agentDir);
        const databasePath = String(hostOptions.databasePath);
        sharedAgentDir ??= agentDir;
        sharedDatabasePath ??= databasePath;
        assert.equal(agentDir, sharedAgentDir);
        assert.equal(databasePath, sharedDatabasePath);
        await mkdir(join(agentDir, "logs"), { recursive: true });
        await writeFile(join(agentDir, "logs", `cross-${currentHost}.provider-payload.jsonl`), `{"session":${currentHost}}\n`);
        const initialized = new DerivedMemoryStore(join(agentDir, "derived-memory.sqlite"));
        initialized.close();
        const listeners: Array<(event: unknown) => void> = [];
        const messages: unknown[] = [];
        const session = {
          sessionId: `cross-${currentHost}`,
          messages,
          modelRegistry: {},
          subscribe(listener: (event: unknown) => void) { listeners.push(listener); return () => listeners.splice(listeners.indexOf(listener), 1); },
          async prompt(text: string) {
            if (text === "/dev") return;
            assert.equal(messages.length, 0, "a rebuilt runtime must start without prior conversation messages");
            messages.push({ role: "user", content: text });
            listeners.forEach((listener) => listener({ type: "message_start", message: { role: "user", content: text } }));
            listeners.forEach((listener) => listener({ type: "message_start", message: { role: "assistant", content: [] } }));
            const store = new DerivedMemoryStore(join(agentDir, "derived-memory.sqlite"));
            let answerText: string;
            if (currentHost === 1) {
              listeners.forEach((listener) => listener({ type: "tool_execution_start", toolName: "derived_memory", toolCallId: "memory-save", args: { action: "save" } }));
              store.save(
                { authorityId: "eval", teamId: "athletics", userId: "eval-runner", role: "admin" },
                {
                  title: "跨会话球队结论",
                  content: "跨会话仍然可见",
                  rebuildInstruction: "重新读取球队和比赛数据后复现结论。",
                  dependencies: [
                    { args: ["player", "list"] },
                    { args: ["game", "list"] },
                  ],
                },
                [
                  { command: ["player", "list"], normalizedCommandHash: "players-hash", invalidationTopics: ["player"], observedAt: 1, sourceSnapshot: { sources: [{ sourceKey: "players", updatedAt: "v1" }], hash: "players-snapshot" } },
                  { command: ["game", "list"], normalizedCommandHash: "games-hash", invalidationTopics: ["game"], observedAt: 1, sourceSnapshot: { sources: [{ sourceKey: "games", updatedAt: "v1" }], hash: "games-snapshot" } },
                ],
                2,
              );
              listeners.forEach((listener) => listener({ type: "tool_execution_end", toolName: "derived_memory", toolCallId: "memory-save", args: { action: "save" }, result: { details: { ok: true } } }));
              answerText = "已记住结论";
            } else {
              const principal = { authorityId: "eval", teamId: "athletics", userId: "eval-runner", role: "admin" as const };
              const candidate = store.listAccessiblePage(principal, "all", 20, 0).memories[0];
              answerText = candidate
                ? store.readPrivate(candidate.id, principal)?.content ?? "未找到"
                : "未找到";
            }
            store.close();
            const answer = { role: "assistant", content: [{ type: "text", text: answerText }], provider: "fake", model: "agent", stopReason: "stop", usage: { input: 1, output: 1, totalTokens: 2 } };
            messages.push(answer);
            listeners.forEach((listener) => listener({ type: "message_end", message: answer }));
          },
          abort() {},
        };
        return { runtime: { session }, agentDir, async dispose() {} };
      },
      reviewer: async ({ evidence }) => {
        assert.deepEqual(evidence.sessions.map((session) => session.sessionId), ["establish", "recall"]);
        assert.deepEqual(evidence.sessions.map((session) => session.runtimeSessionId), ["cross-1", "cross-2"]);
        assert.equal(evidence.executionFlow.steps.find((step) => step.turnId === "save")?.sessionId, "establish");
        assert.equal(evidence.executionFlow.steps.find((step) => step.turnId === "recall")?.sessionId, "recall");
        return {
          scores: { relevance: 5, usefulness: 5, groundedness: 5, databaseCorrectness: 5, executionQuality: 5 },
          scoreReasons: { relevance: { reason: "好", evidence: "回答" }, usefulness: { reason: "好", evidence: "回答" }, groundedness: { reason: "好", evidence: "记忆" }, databaseCorrectness: { reason: "好", evidence: "无误" }, executionQuality: { reason: "好", evidence: "跨会话" } },
          rubricResults: [], summary: "通过", strengths: ["跨会话"], issues: [], confidence: "high",
          usage: { requestCount: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2 }, model: { provider: "fake", id: "reviewer" },
        };
      },
    });
    assert.equal(hostCount, 2);
    assert.equal(result.results[0]?.status, "passed", JSON.stringify(result.results[0]));
    assert.equal(result.results[0]?.sessions.length, 2);
    assert.deepEqual(result.results[0]?.turns.map((turn) => turn.sessionId), ["establish", "recall"]);
    await access(join(outputDirectory, "cases", "memory-across-sessions", "run-1", "sessions", "establish", "messages.json"));
    await access(join(outputDirectory, "cases", "memory-across-sessions", "run-1", "sessions", "recall", "provider-payload.jsonl"));
    const markdown = await readFile(join(outputDirectory, "report.md"), "utf8");
    assert.match(markdown, /会话 `establish`（Runtime `cross-1`）/);
    assert.match(markdown, /会话 `recall`（Runtime `cross-2`）/);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("evaluation runner stops later sessions after a session startup failure", async () => {
  const repositoryRoot = join(import.meta.dirname, "../../..");
  const outputDirectory = await mkdtemp(join(tmpdir(), "bastion-eval-v3-failure-"));
  const firstTurn = { id: "first", prompt: "first", expectations: [{ id: "first-answer", title: "first", type: "response_contains" as const, weight: 70, value: "ok", caseSensitive: false }] };
  const secondTurn = { id: "second", prompt: "second", expectations: [] };
  const config: EvaluationConfig = {
    schemaVersion: 3, name: "failure", runs: 1, timeoutSeconds: 20,
    agent: { thinking: "low" }, reviewer: { provider: "fake", model: "reviewer" },
    passRules: { relevance: 4, usefulness: 4, groundedness: 4, databaseCorrectness: 4, executionQuality: 3, average: 4, minimumCasePassRate: 1, minimumSuitePassRate: 1 },
    scoring: { passScore: 80 },
    prompts: [{ id: "startup-failure", title: "failure", tags: [], text: "first", turns: [firstTurn, secondTurn], sessions: [{ id: "one", turns: [firstTurn] }, { id: "two", turns: [secondTurn] }], expectations: [], writePermission: "deny" }],
    sourcePath: "failure.toml",
  };
  try {
    let hostCount = 0;
    const result = await runEvaluation({
      config, outputDirectory, repositoryRoot, executablePath: join(repositoryRoot, "out", "teamops"),
      runtimeHostFactory: async (hostOptions) => {
        hostCount += 1;
        if (hostCount === 2) throw new Error("synthetic startup failure");
        const agentDir = String(hostOptions.agentDir);
        const memory = new DerivedMemoryStore(join(agentDir, "derived-memory.sqlite"));
        memory.close();
        const listeners: Array<(event: unknown) => void> = [];
        const messages: unknown[] = [];
        const session = {
          sessionId: "first-runtime", messages, modelRegistry: {},
          subscribe(listener: (event: unknown) => void) { listeners.push(listener); return () => listeners.splice(listeners.indexOf(listener), 1); },
          async prompt(text: string) {
            if (text === "/dev") return;
            messages.push({ role: "user", content: text });
            listeners.forEach((listener) => listener({ type: "message_start", message: { role: "user", content: text } }));
            listeners.forEach((listener) => listener({ type: "message_start", message: { role: "assistant", content: [] } }));
            const answer = { role: "assistant", content: [{ type: "text", text: "ok" }], provider: "fake", model: "agent", stopReason: "stop", usage: { input: 1, output: 1, totalTokens: 2 } };
            messages.push(answer);
            listeners.forEach((listener) => listener({ type: "message_end", message: answer }));
          },
          abort() {},
        };
        return { runtime: { session }, agentDir, async dispose() {} };
      },
      reviewer: async () => { throw new Error("reviewer must not run after startup failure"); },
    });
    assert.equal(hostCount, 2);
    assert.equal(result.results[0]?.status, "not_completed");
    assert.deepEqual(result.results[0]?.sessions.map((session) => session.sessionId), ["one", "two"]);
    assert.equal(result.results[0]?.sessions[1]?.runtimeSessionId, undefined);
    assert.equal(result.results[0]?.sessions[1]?.status, "not_completed");
    assert.match(result.results[0]?.errors?.[0]?.message ?? "", /会话 two 启动失败/);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
