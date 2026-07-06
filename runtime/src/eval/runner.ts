import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { BastionCliExecutor } from "../bastion-cli/executor.ts";
import { createBastionRuntimeHost } from "../runtime-host.ts";
import {
  analyzeProviderPayloadLog,
  extractProviderUsage,
  renderContextAnalysisMarkdown,
} from "../scenario/context-analysis.ts";
import { renderTranscript } from "../scenario/transcript.ts";
import {
  renderManualReview,
  sessionMessagesFromJsonl,
} from "../scenario/manual-review.ts";
import { judgeAnswer } from "./judge.ts";
import {
  EMPTY_USAGE,
  extractObservation,
  isProviderFailure,
} from "./observation.ts";
import { renderEvalReport } from "./report.ts";
import { summarizeRuns, suiteExitCode } from "./summary.ts";
import type {
  EvalCase,
  EvalManifest,
  EvalRunResult,
  EvalRunnerOptions,
} from "./types.ts";

function gitMetadata(root: string): { commit: string | null; dirty: boolean } {
  const commit = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  return {
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    dirty: status.status !== 0 || Boolean(status.stdout.trim()),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function resultStatus(grades: EvalRunResult["grades"]): "passed" | "failed" {
  return grades.every((item) => item.passed) ? "passed" : "failed";
}

class AgentProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentProtocolError";
  }
}

async function persistArtifacts(
  host: Awaited<ReturnType<typeof createBastionRuntimeHost>>,
  messageStart: number,
  runDirectory: string,
  durationMs: number,
  metadata: {
    caseId: string;
    title: string;
    repetition: number;
  },
): Promise<{
  observation: ReturnType<typeof extractObservation>;
  transcriptPath: string;
  manualReviewPath: string;
  sessionPath?: string;
  providerLogPath?: string;
  contextAnalysisPath?: string;
  contextMetrics?: EvalRunResult["contextMetrics"];
}> {
  const session = host.runtime.session;
  const observation = extractObservation(
    session.messages.slice(messageStart),
    durationMs,
  );
  const transcriptPath = join(runDirectory, "transcript.md");
  await writeFile(transcriptPath, renderTranscript(observation.messages), {
    encoding: "utf8",
    mode: 0o600,
  });
  const manualReviewPath = join(runDirectory, "manual-review.md");
  await writeFile(
    manualReviewPath,
    renderManualReview(observation.messages, metadata),
    { encoding: "utf8", mode: 0o600 },
  );

  let sessionPath: string | undefined;
  if (session.sessionFile) {
    sessionPath = join(runDirectory, "session.jsonl");
    await copyFile(session.sessionFile, sessionPath);
  }

  let providerLogPath: string | undefined;
  let contextAnalysisPath: string | undefined;
  let contextMetrics: EvalRunResult["contextMetrics"];
  const sourceProviderLog = join(
    host.agentDir,
    "logs",
    `${session.sessionId}.provider-payload.jsonl`,
  );
  try {
    providerLogPath = join(runDirectory, "provider-payload.jsonl");
    await copyFile(sourceProviderLog, providerLogPath);
    const providerPayload = await readFile(providerLogPath, "utf8");
    const analysis = analyzeProviderPayloadLog(
      providerPayload,
      extractProviderUsage(observation.messages),
    );
    contextAnalysisPath = join(runDirectory, "context-analysis.md");
    await writeFile(
      contextAnalysisPath,
      renderContextAnalysisMarkdown(
        analysis,
        { sessionId: session.sessionId, logFilePath: providerLogPath },
      ),
      "utf8",
    );
    const tokens = (category: string) =>
      analysis.finalRequest.categories.find(
        (item) => item.category === category,
      )?.allocatedTokens ?? 0;
    contextMetrics = {
      finalSkillReferenceTokens: tokens("Skill/Reference 文档内容"),
      finalToolSchemaTokens: tokens("工具 Schema"),
      failedGameEventWrites: observation.toolCalls.filter(
        (call) =>
          !call.details.ok &&
          call.args[0] === "game" &&
          call.args[1] === "event" &&
          call.args[2] === "write",
      ).length,
    };
  } catch {
    providerLogPath = undefined;
    contextAnalysisPath = undefined;
  }
  return {
    observation,
    transcriptPath,
    manualReviewPath,
    sessionPath,
    providerLogPath,
    contextAnalysisPath,
    contextMetrics,
  };
}

async function runCase(
  options: EvalRunnerOptions,
  caseDefinition: EvalCase,
  repetition: number,
): Promise<EvalRunResult> {
  const startedAt = new Date().toISOString();
  const runDirectory = join(
    options.outputDirectory,
    "runs",
    caseDefinition.id,
    String(repetition).padStart(2, "0"),
  );
  const agentDir = join(runDirectory, "agent");
  const databasePath = join(runDirectory, "bastion.db");
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const executor = new BastionCliExecutor({
    executablePath: options.executablePath,
    databasePath,
    timeoutMs: 30_000,
  });
  const caseContext = { executor, databasePath, agentDir, runDirectory };
  const started = performance.now();
  let host: Awaited<ReturnType<typeof createBastionRuntimeHost>> | undefined;
  let messageStart = 0;

  try {
    await caseDefinition.setup?.(caseContext);
    host = await (options.runtimeHostFactory ?? createBastionRuntimeHost)({
      databasePath,
      agentDir,
      confirmWrite: caseDefinition.confirmWrite ?? (async () => true),
    });
    const session = host.runtime.session;
    session.setThinkingLevel("low");
    await session.prompt("/dev");
    messageStart = session.messages.length;
    for (const turn of caseDefinition.turns) {
      const turnStart = session.messages.length;
      await session.prompt(turn.prompt);
      if (
        turn.requireSuccessfulTool &&
        !extractObservation(session.messages.slice(turnStart), 0).toolCalls.some(
          (call) => call.details.ok,
        )
      ) {
        throw new AgentProtocolError(
          `Turn completed without a successful Bastion tool call in ${caseDefinition.id}`,
        );
      }
    }
    const durationMs = performance.now() - started;
    const artifacts = await persistArtifacts(
      host,
      messageStart,
      runDirectory,
      durationMs,
      {
        caseId: caseDefinition.id,
        title: caseDefinition.title,
        repetition,
      },
    );
    const { observation } = artifacts;
    const grades = await caseDefinition.grade({
      ...caseContext,
      observation,
    });
    let judge;
    let judgeError: string | undefined;
    if (options.judge) {
      try {
        judge = await judgeAnswer({
          config: options.judge,
          modelRegistry: session.modelRegistry,
          caseDefinition,
          observation,
        });
      } catch (error) {
        judgeError = errorMessage(error).split("\n")[0];
      }
    }
    return {
      caseId: caseDefinition.id,
      title: caseDefinition.title,
      category: caseDefinition.category,
      repetition,
      status: resultStatus(grades),
      startedAt,
      durationMs,
      model: observation.model,
      stopReason: observation.stopReason,
      grades,
      usage: observation.usage,
      toolCallCount: observation.toolCalls.length,
      transcriptPath: artifacts.transcriptPath,
      manualReviewPath: artifacts.manualReviewPath,
      sessionPath: artifacts.sessionPath,
      providerLogPath: artifacts.providerLogPath,
      contextAnalysisPath: artifacts.contextAnalysisPath,
      contextMetrics: artifacts.contextMetrics,
      judge,
      ...(judgeError ? { judgeError } : {}),
    };
  } catch (error) {
    const durationMs = performance.now() - started;
    const providerFailure = isProviderFailure(error);
    const protocolFailure = error instanceof AgentProtocolError;
    const artifacts = host
      ? await persistArtifacts(host, messageStart, runDirectory, durationMs, {
          caseId: caseDefinition.id,
          title: caseDefinition.title,
          repetition,
        })
      : undefined;
    return {
      caseId: caseDefinition.id,
      title: caseDefinition.title,
      category: caseDefinition.category,
      repetition,
      status: protocolFailure ? "failed" : "incomplete",
      startedAt,
      durationMs,
      model: artifacts?.observation.model,
      stopReason: artifacts?.observation.stopReason,
      grades: [],
      usage: artifacts?.observation.usage ?? EMPTY_USAGE,
      toolCallCount: artifacts?.observation.toolCalls.length ?? 0,
      transcriptPath: artifacts?.transcriptPath,
      manualReviewPath: artifacts?.manualReviewPath,
      sessionPath: artifacts?.sessionPath,
      providerLogPath: artifacts?.providerLogPath,
      contextAnalysisPath: artifacts?.contextAnalysisPath,
      contextMetrics: artifacts?.contextMetrics,
      error: {
        kind: protocolFailure
          ? "agent_protocol"
          : providerFailure
            ? "provider"
            : "infrastructure",
        message: errorMessage(error),
      },
    };
  } finally {
    await host?.dispose();
  }
}

export async function runEvalSuite(options: EvalRunnerOptions): Promise<{
  manifest: EvalManifest;
  results: EvalRunResult[];
  summary: ReturnType<typeof summarizeRuns>;
  exitCode: number;
}> {
  if (!Number.isSafeInteger(options.runs) || options.runs <= 0) {
    throw new Error("runs must be a positive integer");
  }
  if (!options.cases.length) throw new Error("at least one eval case is required");
  await mkdir(options.outputDirectory, { recursive: true, mode: 0o700 });
  const metadata = gitMetadata(options.repositoryRoot);
  const manifest: EvalManifest = {
    schemaVersion: "1.0",
    suite: options.suite,
    runsPerCase: options.runs,
    selectedCases: options.cases.map((item) => item.id),
    startedAt: new Date().toISOString(),
    commit: metadata.commit,
    dirty: metadata.dirty,
    judge: options.judge
      ? { provider: options.judge.provider, model: options.judge.model }
      : null,
  };
  await writeFile(
    join(options.outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const results: EvalRunResult[] = [];
  const resultsPath = join(options.outputDirectory, "results.jsonl");
  await writeFile(resultsPath, "", "utf8");
  for (const caseDefinition of options.cases) {
    for (let repetition = 1; repetition <= options.runs; repetition += 1) {
      options.onProgress?.(
        `[${results.length + 1}/${options.cases.length * options.runs}] ${caseDefinition.id} #${repetition}`,
      );
      const result = await runCase(options, caseDefinition, repetition);
      results.push(result);
      await appendFile(resultsPath, `${JSON.stringify(result)}\n`, "utf8");
    }
  }

  const summary = summarizeRuns(options.suite, options.runs, results);
  const report = renderEvalReport(manifest, summary, results);
  await writeFile(
    join(options.outputDirectory, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(options.outputDirectory, "report.md"), report, "utf8");
  if (options.publishSummaryPath) {
    await mkdir(dirname(options.publishSummaryPath), { recursive: true });
    await writeFile(options.publishSummaryPath, report, "utf8");
  }
  return { manifest, results, summary, exitCode: suiteExitCode(summary) };
}

export async function loadEvalResults(path: string): Promise<EvalRunResult[]> {
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EvalRunResult);
}

async function ensureManualReviewArtifacts(
  outputDirectory: string,
  results: readonly EvalRunResult[],
): Promise<void> {
  for (const result of results) {
    const runDirectory = join(
      outputDirectory,
      "runs",
      result.caseId,
      String(result.repetition).padStart(2, "0"),
    );
    const manualReviewPath = join(runDirectory, "manual-review.md");
    try {
      await readFile(manualReviewPath, "utf8");
      continue;
    } catch {
      // Missing historical artifact: reconstruct it from the immutable Session.
    }
    const sessionPath =
      result.sessionPath ?? join(runDirectory, "session.jsonl");
    try {
      const messages = sessionMessagesFromJsonl(
        await readFile(sessionPath, "utf8"),
      );
      await writeFile(
        manualReviewPath,
        renderManualReview(messages, {
          caseId: result.caseId,
          title: result.title,
          repetition: result.repetition,
        }),
        { encoding: "utf8", mode: 0o600 },
      );
    } catch {
      // A run without a Session cannot provide trustworthy manual evidence.
    }
  }
}

export async function rerenderEvalDirectory(
  outputDirectory: string,
): Promise<{ manifest: EvalManifest; results: EvalRunResult[] }> {
  const manifest = JSON.parse(
    await readFile(join(outputDirectory, "manifest.json"), "utf8"),
  ) as EvalManifest;
  const results = await loadEvalResults(join(outputDirectory, "results.jsonl"));
  await ensureManualReviewArtifacts(outputDirectory, results);
  const summary = summarizeRuns(manifest.suite, manifest.runsPerCase, results);
  await writeFile(
    join(outputDirectory, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(outputDirectory, "report.md"),
    renderEvalReport(manifest, summary, results),
    "utf8",
  );
  return { manifest, results };
}
