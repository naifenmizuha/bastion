#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hyperlink } from "@earendil-works/pi-tui";
import { CORE_EVAL_CASES } from "../eval/cases.ts";
import { runEvalSuite } from "../eval/runner.ts";
import { repositoryRoot } from "../runtime-host.ts";

function link(path: string): string {
  return hyperlink(path, pathToFileURL(path).href);
}

export async function runScenario(): Promise<void> {
  const scenario = CORE_EVAL_CASES.find(
    (item) => item.id === "complete-game-flow",
  );
  if (!scenario) throw new Error("complete-game-flow eval case is missing");
  const outputDirectory = join(
    "/tmp",
    `bastion-runtime-scenario-${Date.now()}`,
  );
  const result = await runEvalSuite({
    suite: "scenario",
    cases: [scenario],
    runs: 1,
    outputDirectory,
    repositoryRoot: repositoryRoot(),
    executablePath: resolve(repositoryRoot(), "out", "bastion"),
  });
  const run = result.results[0];
  if (!run) throw new Error("Scenario produced no result");
  if (run.status !== "passed") {
    throw new Error(
      `Scenario ${run.status}: ${
        run.error?.message ??
        run.grades
          .filter((item) => !item.passed)
          .map((item) => `${item.name}: ${item.message}`)
          .join("; ")
      }`,
    );
  }
  if (
    !run.transcriptPath ||
    !run.sessionPath ||
    !run.providerLogPath ||
    !run.contextAnalysisPath
  ) {
    throw new Error("Scenario did not produce all required artifacts");
  }
  const transcript = await readFile(run.transcriptPath, "utf8");
  const contextAnalysis = await readFile(run.contextAnalysisPath, "utf8");
  process.stdout.write(`\n${transcript}\n`);
  process.stdout.write(`\n${contextAnalysis}\n`);
  process.stdout.write(`对话 Markdown: ${link(run.transcriptPath)}\n`);
  process.stdout.write(`Session JSONL: ${link(run.sessionPath)}\n`);
  process.stdout.write(`Dev payload JSONL: ${link(run.providerLogPath)}\n`);
  process.stdout.write(`上下文分析报告: ${link(run.contextAnalysisPath)}\n`);
  process.stdout.write(`评测报告: ${link(join(outputDirectory, "report.md"))}\n`);
}

runScenario().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Runtime scenario test failed:\n${message}`);
  process.exitCode = 1;
});
