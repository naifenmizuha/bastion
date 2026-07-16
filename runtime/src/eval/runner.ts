import { execFile as execFileCallback } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join, relative } from "node:path";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createBastionRuntimeHost, type BastionRuntimeHost } from "../runtime-host.ts";
import {
  copyDatabase,
  databaseChanges,
  ensureBaselineDatabase,
  inspectDatabase,
  sha256File,
} from "./database.ts";
import { ExecutionRecorder, finalAssistantAnswer, modelFromMessages, stopReason, usageFromMessages } from "./execution.ts";
import { calculateScore, evaluateDeterministicExpectation, qualityResults, rubricExpectationResults } from "./expectations.ts";
import { reviewQuality } from "./reviewer.ts";
import { checkRun, checkSummary } from "./rules.ts";
import { writeJson, writeReport } from "./report.ts";
import type {
  PromptCase,
  RunEvidence,
  RunInfo,
  RunResult,
  RunnerOptions,
  RunnerResult,
  SuiteSummary,
  TokenUsage,
  DatabaseState,
  QualityReview,
  ExpectationResult,
  SessionEvidence,
  TurnEvidence,
} from "./types.ts";
import { EMPTY_TOKEN_USAGE } from "./types.ts";

const execFile = promisify(execFileCallback);

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    requestCount: left.requestCount + right.requestCount,
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    total: left.total + right.total,
    ...(left.cost || right.cost ? {
      cost: {
        input: (left.cost?.input ?? 0) + (right.cost?.input ?? 0),
        output: (left.cost?.output ?? 0) + (right.cost?.output ?? 0),
        cacheRead: (left.cost?.cacheRead ?? 0) + (right.cost?.cacheRead ?? 0),
        cacheWrite: (left.cost?.cacheWrite ?? 0) + (right.cost?.cacheWrite ?? 0),
        total: (left.cost?.total ?? 0) + (right.cost?.total ?? 0),
      },
    } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function relativeFiles(root: string, paths: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, relative(root, path)]));
}

async function gitInfo(repositoryRoot: string): Promise<{ commit: string | null; dirty: boolean }> {
  try {
    const commit = (await execFile("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })).stdout.trim();
    const status = (await execFile("git", ["status", "--porcelain"], { cwd: repositoryRoot })).stdout.trim();
    return { commit: commit || null, dirty: Boolean(status) };
  } catch {
    return { commit: null, dirty: false };
  }
}

async function optionalHash(path: string): Promise<string | null> {
  try {
    await stat(path);
    return await sha256File(path);
  } catch {
    return null;
  }
}

function timed<T>(promise: Promise<T>, timeoutMs: number): Promise<{ value?: T; timedOut: boolean }> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ timedOut: boolean }>((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout({ timedOut: true }), timeoutMs);
  });
  return Promise.race([
    promise.then((value) => ({ value, timedOut: false })),
    timeout,
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function eventToolInfo(event: AgentSessionEvent): { toolName?: string; toolCallId?: string; result?: JsonObject } | undefined {
  const raw = event as unknown as JsonObject;
  if (raw.type !== "tool_execution_end") return undefined;
  const result = record(raw.result);
  return {
    toolName: typeof raw.toolName === "string" ? raw.toolName : undefined,
    toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : undefined,
    result,
  };
}

function commandFromDetails(details: JsonObject | undefined): string | undefined {
  const command = details?.command;
  return Array.isArray(command) ? command.map(String).join(" ") : undefined;
}

function shouldInspectMemory(raw: JsonObject | undefined): boolean {
  const args = raw?.args;
  const action = record(args)?.action;
  return action === "save" || action === "publish" || action === "withdraw" || action === "forget";
}

interface HostRun {
  host: BastionRuntimeHost;
  session: AgentSession;
}

async function createHost(options: RunnerOptions, hostOptions: Record<string, unknown>): Promise<HostRun> {
  if (options.runtimeHostFactory) {
    const created = await options.runtimeHostFactory(hostOptions);
    const runtime = created.runtime as { session?: AgentSession };
    if (!runtime.session) throw new Error("runtimeHostFactory must return a runtime with session");
    return { host: created as unknown as BastionRuntimeHost, session: runtime.session };
  }
  const host = await createBastionRuntimeHost(hostOptions as Parameters<typeof createBastionRuntimeHost>[0]);
  return { host, session: host.runtime.session };
}

async function runOne(
  options: RunnerOptions,
  prompt: PromptCase,
  repetition: number,
  baseline: { path: string; state: DatabaseState },
  outputDirectory: string,
): Promise<RunResult> {
  const runDirectory = join(outputDirectory, "cases", prompt.id, `run-${repetition}`);
  const databasePath = join(runDirectory, "teamops.db");
  await mkdir(runDirectory, { recursive: true });
  const agentDir = await mkdtemp(join(tmpdir(), `bastion-eval-${prompt.id}-${repetition}-`));
  try {
    return await runOneInDirectory(
      options,
      prompt,
      repetition,
      baseline,
      outputDirectory,
      runDirectory,
      databasePath,
      agentDir,
    );
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
}

async function runOneInDirectory(
  options: RunnerOptions,
  prompt: PromptCase,
  repetition: number,
  baseline: { path: string; state: DatabaseState },
  outputDirectory: string,
  runDirectory: string,
  databasePath: string,
  agentDir: string,
): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  await copyDatabase(baseline.path, databasePath);
  const memoryPath = join(agentDir, "derived-memory.sqlite");
  let host: BastionRuntimeHost | undefined;
  let reviewSession: AgentSession | undefined;
  let evidence: RunEvidence | undefined;
  let qualityReview: QualityReview | undefined;
  let initialTeamopsState: DatabaseState | undefined;
  let initialMemoryState: DatabaseState | undefined;
  const errors: RunResult["errors"] = [];
  let timedOut = false;
  let executionFailed = false;
  const deterministicResults: ExpectationResult[] = [];
  try {
    const operationChanges: RunEvidence["operationChanges"] = [];
    const turns: TurnEvidence[] = [];
    const sessions: SessionEvidence[] = [];
    const messages: unknown[] = [];
    const recorder = new ExecutionRecorder();
    let initialTeamops: ReturnType<typeof inspectDatabase> | undefined;
    let initialMemory: ReturnType<typeof inspectDatabase> | undefined;
    let latestTeamops: ReturnType<typeof inspectDatabase> | undefined;
    let latestMemory: ReturnType<typeof inspectDatabase> | undefined;

    for (let sessionIndex = 0; sessionIndex < prompt.sessions.length; sessionIndex += 1) {
      const sessionConfig = prompt.sessions[sessionIndex]!;
      const sessionStartedAt = new Date().toISOString();
      const sessionStarted = Date.now();
      let hostRun: HostRun;
      try {
        hostRun = await createHost(options, {
          databasePath,
          executablePath: options.executablePath,
          agentDir,
          loadConfiguredPackages: false,
          confirmWrite: async () => prompt.writePermission === "allow",
          principal: {
            authorityId: "eval",
            teamId: "athletics",
            userId: "eval-runner",
            role: "admin",
          },
          ...(options.config.agent.provider && options.config.agent.model
            ? { model: { provider: options.config.agent.provider, id: options.config.agent.model } }
            : {}),
          thinkingLevel: options.config.agent.thinking,
        });
      } catch (error) {
        executionFailed = true;
        errors.push({ kind: "provider", message: `会话 ${sessionConfig.id} 启动失败: ${errorMessage(error)}` });
        sessions.push({
          sessionId: sessionConfig.id,
          status: "not_completed",
          startedAt: sessionStartedAt,
          durationMs: Date.now() - sessionStarted,
          finalAnswer: "",
          messages: [],
          turns: [],
          agentUsage: { ...EMPTY_TOKEN_USAGE },
        });
        break;
      }
      host = hostRun.host;
      const session = hostRun.session;
      reviewSession = session;
      if (session.messages.length !== 0) {
        executionFailed = true;
        errors.push({ kind: "protocol", message: `会话 ${sessionConfig.id} 启动时包含 ${session.messages.length} 条历史消息` });
        sessions.push({
          sessionId: sessionConfig.id,
          runtimeSessionId: session.sessionId,
          status: "not_completed",
          startedAt: sessionStartedAt,
          durationMs: Date.now() - sessionStarted,
          finalAnswer: "",
          messages: [...session.messages] as unknown[],
          turns: [],
          agentUsage: usageFromMessages([...session.messages] as unknown[]),
        });
        try {
          await host.dispose();
        } catch (error) {
          errors.push({ kind: "infrastructure", message: `释放会话 ${sessionConfig.id} 运行时失败: ${errorMessage(error)}` });
        } finally {
          host = undefined;
        }
        break;
      }
      if (!initialTeamops || !initialMemory) {
        initialTeamops = inspectDatabase(databasePath, "teamops");
        initialMemory = inspectDatabase(memoryPath, "derived-memory");
        initialTeamopsState = initialTeamops.state;
        initialMemoryState = initialMemory.state;
        latestTeamops = initialTeamops;
        latestMemory = initialMemory;
      }
      recorder.setSession(sessionConfig.id);
      await session.prompt("/dev");
      const sessionTurns: TurnEvidence[] = [];
      const unsubscribe = session.subscribe((event) => {
        recorder.onEvent(event);
        const info = eventToolInfo(event);
        if (!info) return;
        const raw = event as unknown as JsonObject;
        const result = info.result;
        const details = record(result?.details);
        const isTeamops = info.toolName === "teamops" || info.toolName === "bastion_cli" || info.toolName === "team-ops";
        if (isTeamops && details?.risk !== "read") {
          try {
            const current = inspectDatabase(databasePath, "teamops");
            const changes = databaseChanges(latestTeamops!, current);
            recorder.addDatabaseChange(changes, recorder.lastTeamOpsStepId);
            operationChanges.push({ databaseName: "teamops", stepId: recorder.lastTeamOpsStepId, toolCallId: info.toolCallId, command: commandFromDetails(details), changes });
            latestTeamops = current;
          } catch (error) {
            errors.push({ kind: "infrastructure", message: `读取 TeamOps 数据库变化失败: ${errorMessage(error)}` });
          }
        }
        if (info.toolName === "derived_memory" && shouldInspectMemory(raw)) {
          try {
            const current = inspectDatabase(memoryPath, "derived-memory");
            const changes = databaseChanges(latestMemory!, current);
            recorder.addDatabaseChange(changes, recorder.lastMemoryStepId);
            operationChanges.push({ databaseName: "derived-memory", stepId: recorder.lastMemoryStepId, toolCallId: info.toolCallId, command: String(record(raw.args)?.action ?? "memory"), changes });
            latestMemory = current;
          } catch (error) {
            errors.push({ kind: "infrastructure", message: `读取派生记忆数据库变化失败: ${errorMessage(error)}` });
          }
        }
      });
      for (const turn of sessionConfig.turns) {
        recorder.setTurn(turn.id);
        const messageStart = session.messages.length;
        const stepStart = recorder.flow.steps.length;
        const beforeTeamops = inspectDatabase(databasePath, "teamops");
        const beforeMemory = inspectDatabase(memoryPath, "derived-memory");
        let outcome: { value?: void; timedOut: boolean } | undefined;
        try {
          outcome = await timed(session.prompt(turn.prompt, { source: "rpc" }), options.config.timeoutSeconds * 1000);
        } catch (error) {
          executionFailed = true;
          errors.push({ kind: "provider", message: `会话 ${sessionConfig.id} 的轮次 ${turn.id} 执行失败: ${errorMessage(error)}` });
        }
        if (outcome?.timedOut) {
          timedOut = true;
          executionFailed = true;
          await session.abort();
          errors.push({ kind: "infrastructure", message: `会话 ${sessionConfig.id} 的轮次 ${turn.id} 超过 timeout_seconds=${options.config.timeoutSeconds}` });
        }
        const afterTeamops = inspectDatabase(databasePath, "teamops");
        const afterMemory = inspectDatabase(memoryPath, "derived-memory");
        const sessionMessages = [...session.messages] as unknown[];
        const currentSteps = recorder.flow.steps.slice(stepStart);
        const answer = finalAssistantAnswer(sessionMessages.slice(messageStart));
        const turnEvidence: TurnEvidence = {
          sessionId: sessionConfig.id,
          turnId: turn.id,
          prompt: turn.prompt,
          finalAnswer: answer,
          messageStart,
          messageEnd: sessionMessages.length,
          stepIds: currentSteps.map((step) => step.stepId),
          teamopsChanges: databaseChanges(beforeTeamops, afterTeamops),
          memoryChanges: databaseChanges(beforeMemory, afterMemory),
        };
        turns.push(turnEvidence);
        sessionTurns.push(turnEvidence);
        for (const expectation of turn.expectations) {
          if (expectation.type === "rubric") continue;
          deterministicResults.push(evaluateDeterministicExpectation({ expectation, scope: { kind: "turn", turnId: turn.id, answer, steps: currentSteps }, databasePaths: { teamops: databasePath, "derived-memory": memoryPath } }));
        }
        if (executionFailed) break;
      }
      recorder.setTurn(undefined);
      unsubscribe();
      const sessionMessages = [...session.messages] as unknown[];
      messages.push(...sessionMessages);
      sessions.push({
        sessionId: sessionConfig.id,
        runtimeSessionId: session.sessionId,
        status: executionFailed ? "not_completed" : "completed",
        startedAt: sessionStartedAt,
        durationMs: Date.now() - sessionStarted,
        finalAnswer: finalAssistantAnswer(sessionMessages),
        messages: sessionMessages,
        turns: sessionTurns,
        agentUsage: usageFromMessages(sessionMessages),
        ...(stopReason(sessionMessages) ? { stopReason: stopReason(sessionMessages) } : {}),
      });
      const isLastSession = sessionIndex === prompt.sessions.length - 1;
      if (!isLastSession || executionFailed) {
        try {
          await host.dispose();
        } catch (error) {
          executionFailed = true;
          errors.push({ kind: "infrastructure", message: `释放会话 ${sessionConfig.id} 运行时失败: ${errorMessage(error)}` });
        } finally {
          host = undefined;
        }
      }
      if (executionFailed) break;
    }
    recorder.setTurn(undefined);
    recorder.setSession(undefined);
    if (!initialTeamops || !initialMemory) throw new Error("评测未能启动任何会话");
    const finalTeamops = inspectDatabase(databasePath, "teamops");
    const finalMemory = inspectDatabase(memoryPath, "derived-memory");
    const teamopsChanges = databaseChanges(initialTeamops, finalTeamops);
    const memoryChanges = databaseChanges(initialMemory, finalMemory);
    if (teamopsChanges.beforeHash !== teamopsChanges.afterHash && latestTeamops!.state.databaseHash !== finalTeamops.state.databaseHash) {
      recorder.addDatabaseChange(databaseChanges(latestTeamops!, finalTeamops), recorder.lastTeamOpsStepId);
    }
    if (memoryChanges.beforeHash !== memoryChanges.afterHash && latestMemory!.state.databaseHash !== finalMemory.state.databaseHash) {
      recorder.addDatabaseChange(databaseChanges(latestMemory!, finalMemory), recorder.lastMemoryStepId);
    }
    const reviewEvidence: RunEvidence = {
      prompt,
      sessions,
      turns,
      finalAnswer: finalAssistantAnswer(messages),
      messages,
      executionFlow: recorder.flow,
      agentModel: modelFromMessages(messages),
      stopReason: stopReason(messages),
      durationMs: Date.now() - started,
      agentUsage: usageFromMessages(messages),
      teamopsChanges,
      memoryChanges,
      teamopsState: finalTeamops.state,
      memoryState: finalMemory.state,
      operationChanges,
    };
    evidence = reviewEvidence;
    for (const expectation of prompt.expectations) {
      if (expectation.type === "rubric") continue;
      deterministicResults.push(evaluateDeterministicExpectation({
        expectation,
        scope: { kind: "case", answer: reviewEvidence.finalAnswer, steps: reviewEvidence.executionFlow.steps },
        databasePaths: { teamops: databasePath, "derived-memory": memoryPath },
      }));
    }
    if (!executionFailed && reviewSession) {
      try {
        qualityReview = await (options.reviewer ?? reviewQuality)({
          session: reviewSession,
          provider: options.config.reviewer.provider,
          modelId: options.config.reviewer.model,
          evidence: reviewEvidence,
        });
      } catch (error) {
        errors.push({ kind: "provider", message: `质量评审失败: ${errorMessage(error)}` });
      }
    }
  } catch (error) {
    errors.push({ kind: "provider", message: errorMessage(error) });
  } finally {
    if (host) {
      try {
        await host.dispose();
      } catch (error) {
        executionFailed = true;
        errors.push({ kind: "infrastructure", message: `释放运行时失败: ${errorMessage(error)}` });
      }
    }
  }
  const base: RunResult = {
    schemaVersion: "3.0",
    caseId: prompt.id,
    title: prompt.title,
    repetition,
    status: executionFailed || !evidence ? "not_completed" : "failed",
    startedAt,
    durationMs: Date.now() - started,
    prompt: prompt.turns.map((turn) => turn.prompt).join("\n\n"),
    sessions: evidence?.sessions.map((session) => ({
      sessionId: session.sessionId,
      ...(session.runtimeSessionId ? { runtimeSessionId: session.runtimeSessionId } : {}),
      status: session.status,
      startedAt: session.startedAt,
      durationMs: session.durationMs,
      finalAnswer: session.finalAnswer,
      agentUsage: session.agentUsage,
      ...(session.stopReason ? { stopReason: session.stopReason } : {}),
      turns: session.turns.map((turn) => ({ sessionId: turn.sessionId, turnId: turn.turnId, prompt: turn.prompt, finalAnswer: turn.finalAnswer, stepIds: turn.stepIds })),
    })) ?? [],
    turns: evidence?.turns.map((turn) => ({ sessionId: turn.sessionId, turnId: turn.turnId, prompt: turn.prompt, finalAnswer: turn.finalAnswer, stepIds: turn.stepIds })) ?? [],
    finalAnswer: evidence?.finalAnswer ?? "",
    ...(evidence?.agentModel ? { agentModel: evidence.agentModel } : {}),
    ...(evidence?.stopReason ? { stopReason: evidence.stopReason } : {}),
    agentUsage: evidence?.agentUsage ?? { ...EMPTY_TOKEN_USAGE },
    ...(errors.length ? { errors } : {}),
    checks: [],
    expectationResults: [],
    score: { programmatic: 0, creative: 0, quality: 0, total: 0, maximum: 100, passScore: options.config.scoring.passScore },
    files: {},
  };
  if (evidence) {
    if (qualityReview) {
      base.review = qualityReview;
      base.reviewerUsage = qualityReview.usage;
      evidence.review = qualityReview;
    }
    if (errors.length) base.errors = errors;
    const checks = checkRun(evidence, options.config.passRules, { teamops: evidence.teamopsState, memory: evidence.memoryState })
      .filter((check) => options.config.schemaVersion === 1 || check.code !== "quality.thresholds");
    base.checks = checks;
    const rubricScopes = [
      ...prompt.turns.flatMap((turn) => turn.expectations.filter((item) => item.type === "rubric").map((expectation) => {
        const turnEvidence = evidence!.turns.find((item) => item.turnId === turn.id);
        const steps = evidence!.executionFlow.steps.filter((step) => step.turnId === turn.id);
        return { expectation, scope: { kind: "turn" as const, turnId: turn.id, answer: turnEvidence?.finalAnswer ?? "", steps } };
      })),
      ...prompt.expectations.filter((item) => item.type === "rubric").map((expectation) => ({ expectation, scope: { kind: "case" as const, answer: evidence!.finalAnswer, steps: evidence!.executionFlow.steps } })),
    ];
    const expectationResults = options.config.schemaVersion >= 2
      ? [...deterministicResults, ...rubricExpectationResults({ rubrics: rubricScopes, review: base.review }), ...qualityResults(base.review)]
      : qualityResults(base.review);
    base.expectationResults = expectationResults;
    base.score = calculateScore(expectationResults, options.config.schemaVersion >= 2 ? options.config.scoring.passScore : 0);
    const checked = checkSummary(checks, prompt);
    const status = options.config.schemaVersion >= 2
      ? checked.safetyPassed && base.score.total >= options.config.scoring.passScore && Boolean(base.review) && errors.length === 0
      : checked.passed && Boolean(base.review) && errors.length === 0;
    base.status = executionFailed ? "not_completed" : status ? "passed" : "failed";
  }
  const pathMap: Record<string, string> = {
    "run-result.json": join(runDirectory, "run-result.json"),
  };
  if (evidence) {
    pathMap["execution-flow.json"] = join(runDirectory, "execution-flow.json");
    pathMap["messages.json"] = join(runDirectory, "messages.json");
    pathMap["teamops-baseline-state.json"] = join(runDirectory, "teamops-baseline-state.json");
    pathMap["teamops-final-state.json"] = join(runDirectory, "teamops-final-state.json");
    pathMap["memory-baseline-state.json"] = join(runDirectory, "memory-baseline-state.json");
    pathMap["memory-final-state.json"] = join(runDirectory, "memory-final-state.json");
    pathMap["database-changes.json"] = join(runDirectory, "database-changes.json");
    if (base.review) pathMap["quality-review.json"] = join(runDirectory, "quality-review.json");
    for (const sessionEvidence of evidence.sessions) {
      await mkdir(join(runDirectory, "sessions", sessionEvidence.sessionId), { recursive: true });
      const messagesKey = `sessions/${sessionEvidence.sessionId}/messages.json`;
      pathMap[messagesKey] = join(runDirectory, messagesKey);
      if (sessionEvidence.runtimeSessionId) {
        const providerKey = `sessions/${sessionEvidence.sessionId}/provider-payload.jsonl`;
        const providerLogPath = join(agentDir, "logs", `${sessionEvidence.runtimeSessionId}.provider-payload.jsonl`);
        try {
          await stat(providerLogPath);
          await copyFile(providerLogPath, join(runDirectory, providerKey));
          pathMap[providerKey] = join(runDirectory, providerKey);
        } catch {
          // Developer mode logging is best-effort; the structured execution flow remains authoritative.
        }
      }
    }
    if (evidence.sessions.length === 1) {
      const sessionProviderKey = `sessions/${evidence.sessions[0]!.sessionId}/provider-payload.jsonl`;
      if (pathMap[sessionProviderKey]) {
        const retainedProviderLogPath = join(runDirectory, "provider-payload.jsonl");
        await copyFile(pathMap[sessionProviderKey], retainedProviderLogPath);
        pathMap["provider-payload.jsonl"] = retainedProviderLogPath;
      }
    }
    for (const step of evidence.executionFlow.steps) {
      if (step.kind === "database_change") step.resultFiles = ["database-changes.json"];
      if (step.kind === "assistant_answer") step.resultFiles = ["messages.json"];
    }
    for (const check of base.checks) {
      check.resultFiles = ["run-result.json"];
      if (check.code.startsWith("database.")) check.resultFiles.push("database-changes.json");
      if (check.code.startsWith("quality.")) check.resultFiles.push("quality-review.json");
    }
    await writeJson(pathMap["execution-flow.json"], evidence.executionFlow);
    await writeJson(pathMap["messages.json"], evidence.messages);
    for (const sessionEvidence of evidence.sessions) {
      await writeJson(pathMap[`sessions/${sessionEvidence.sessionId}/messages.json`]!, sessionEvidence.messages);
    }
    await writeJson(pathMap["teamops-baseline-state.json"], initialTeamopsState ?? { databaseName: "teamops" });
    await writeJson(pathMap["teamops-final-state.json"], evidence.teamopsState);
    await writeJson(pathMap["memory-baseline-state.json"], initialMemoryState ?? { databaseName: "derived-memory" });
    await writeJson(pathMap["memory-final-state.json"], evidence.memoryState);
    await writeJson(pathMap["database-changes.json"], {
      teamops: evidence.teamopsChanges,
      memory: evidence.memoryChanges,
      operations: evidence.operationChanges,
    });
    if (base.review) await writeJson(pathMap["quality-review.json"]!, base.review);
  }
  base.files = relativeFiles(outputDirectory, pathMap);
  await writeJson(pathMap["run-result.json"]!, base);
  return base;
}

export async function runEvaluation(options: RunnerOptions): Promise<RunnerResult> {
  const selected = options.config.prompts.filter((prompt) =>
    (!options.selectedCaseIds?.length || options.selectedCaseIds.includes(prompt.id)) &&
    (!options.selectedTags?.length || prompt.tags.some((tag) => options.selectedTags?.includes(tag))),
  );
  if (!selected.length) throw new Error("没有匹配的评测用例");
  await mkdir(options.outputDirectory, { recursive: true });
  const sqlPath = join(options.repositoryRoot, "out", "athletics-2025.sql");
  const baseline = await ensureBaselineDatabase(sqlPath, join(options.repositoryRoot, "out", "eval-cache"));
  const teamopsBinaryHash = await optionalHash(options.executablePath);
  const git = await gitInfo(options.repositoryRoot);
  const runInfo: RunInfo = {
    schemaVersion: "3.0",
    name: options.config.name,
    configPath: options.config.sourcePath,
    startedAt: new Date().toISOString(),
    gitCommit: git.commit,
    dirty: git.dirty,
    ...(options.config.agent.provider && options.config.agent.model ? { agent: { provider: options.config.agent.provider, model: options.config.agent.model, thinking: options.config.agent.thinking } } : {}),
    reviewer: options.config.reviewer,
    selectedCases: selected.map((prompt) => prompt.id),
    runs: options.config.runs,
    athleticsSqlHash: baseline.sqlHash,
    baselineDatabaseHash: baseline.state.databaseHash,
    teamopsBinaryHash,
  };
  await writeJson(join(options.outputDirectory, "run-info.json"), runInfo);
  const results: RunResult[] = [];
  for (const prompt of selected) {
    const repetitions = prompt.runs ?? options.config.runs;
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      options.onProgress?.(`${prompt.id} (${repetition}/${repetitions})`);
      results.push(await runOne(options, prompt, repetition, baseline, options.outputDirectory));
    }
  }
  const agentUsage = results.reduce((usage, result) => addUsage(usage, result.agentUsage), { ...EMPTY_TOKEN_USAGE });
  const reviewerUsage = results.reduce((usage, result) => addUsage(usage, result.reviewerUsage ?? EMPTY_TOKEN_USAGE), { ...EMPTY_TOKEN_USAGE });
  const cases = selected.map((prompt) => {
    const caseResults = results.filter((result) => result.caseId === prompt.id);
    const passed = caseResults.filter((result) => result.status === "passed").length;
    const failed = caseResults.filter((result) => result.status === "failed").length;
    const notCompleted = caseResults.filter((result) => result.status === "not_completed").length;
    const passRate = caseResults.length ? passed / caseResults.length : 0;
    return { caseId: prompt.id, title: prompt.title, attempts: caseResults.length, passed, failed, notCompleted, passRate, meetsRule: passRate >= options.config.passRules.minimumCasePassRate };
  });
  const total = results.length;
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const notCompleted = results.filter((result) => result.status === "not_completed").length;
  const safetyPassed = total > 0 && results.every((result) => result.status !== "not_completed" && result.checks.filter((item) => item.code.startsWith("database.") || item.code.startsWith("teamops.")).every((item) => item.passed));
  const qualityPassed = total > 0 && (options.config.schemaVersion >= 2
    ? results.every((result) => Boolean(result.review))
    : results.every((result) => result.checks.some((item) => item.code === "quality.thresholds" && item.passed)));
  const summary: SuiteSummary = {
    schemaVersion: "3.0",
    name: options.config.name,
    total,
    passed,
    failed,
    notCompleted,
    completed: total - notCompleted,
    passRate: total ? passed / total : 0,
    averageScore: total ? Math.round((results.reduce((sum, result) => sum + result.score.total, 0) / total) * 100) / 100 : 0,
    safetyPassed,
    rulesPassed: cases.every((item) => item.meetsRule) && total > 0,
    qualityPassed,
    passedGate: cases.every((item) => item.meetsRule) && (total ? passed / total : 0) >= options.config.passRules.minimumSuitePassRate && safetyPassed && qualityPassed,
    agentUsage,
    reviewerUsage,
    durationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
    cases,
  };
  await writeJson(join(options.outputDirectory, "summary.json"), summary);
  await writeJson(join(options.outputDirectory, "results.json"), results);
  await writeReport({ outputDirectory: options.outputDirectory, summary, results });
  return { runInfo, results, summary, exitCode: summary.passedGate ? 0 : 1 };
}
