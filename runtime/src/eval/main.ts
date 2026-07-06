#!/usr/bin/env node

import { resolve } from "node:path";
import { CORE_EVAL_CASES, selectEvalCases } from "./cases.ts";
import { runEvalSuite } from "./runner.ts";

interface CliOptions {
  suite: string;
  runs: number;
  cases: string[];
  output?: string;
  judgeProvider?: string;
  judgeModel?: string;
  publishSummary?: string;
}

function usage(): string {
  return `Usage: just rt-eval [options]

Options:
  --suite core                 Evaluation suite (default: core)
  --runs N                     Repetitions per case (default: 3)
  --case ID[,ID...]            Run selected cases; repeatable
  --output PATH                Artifact directory
  --judge-provider PROVIDER    Independent Judge provider
  --judge-model MODEL          Independent Judge model
  --publish-summary PATH       Write a sanitized Markdown summary
  --help                       Show this help

Available core cases:
${CORE_EVAL_CASES.map((item) => `  ${item.id}`).join("\n")}
`;
}

function value(args: string[], index: number, flag: string): string {
  const candidate = args[index + 1];
  if (!candidate || candidate.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return candidate;
}

export function parseEvalArgs(args: string[]): CliOptions {
  const options: CliOptions = { suite: "core", runs: 3, cases: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--help") {
      process.stdout.write(usage());
      return { ...options, runs: 0 };
    }
    if (arg === "--suite") options.suite = value(args, index++, arg);
    else if (arg === "--runs") {
      const raw = value(args, index++, arg);
      options.runs = Number(raw);
      if (!Number.isSafeInteger(options.runs) || options.runs <= 0) {
        throw new Error("--runs must be a positive integer");
      }
    } else if (arg === "--case") {
      options.cases.push(
        ...value(args, index++, arg)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      );
    } else if (arg === "--output") options.output = value(args, index++, arg);
    else if (arg === "--judge-provider") {
      options.judgeProvider = value(args, index++, arg);
    } else if (arg === "--judge-model") {
      options.judgeModel = value(args, index++, arg);
    } else if (arg === "--publish-summary") {
      options.publishSummary = value(args, index++, arg);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (options.suite !== "core") {
    throw new Error(`Unknown eval suite: ${options.suite}`);
  }
  if (Boolean(options.judgeProvider) !== Boolean(options.judgeModel)) {
    throw new Error("--judge-provider and --judge-model must be provided together");
  }
  return options;
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const cli = parseEvalArgs(args);
  if (cli.runs === 0) return 0;
  const root = resolve(import.meta.dirname, "../../..");
  const outputDirectory = resolve(
    root,
    cli.output ?? `runtime/eval-results/${timestamp()}`,
  );
  const result = await runEvalSuite({
    suite: cli.suite,
    cases: selectEvalCases(cli.cases),
    runs: cli.runs,
    outputDirectory,
    repositoryRoot: root,
    executablePath: resolve(root, "out/bastion"),
    ...(cli.judgeProvider && cli.judgeModel
      ? {
          judge: {
            provider: cli.judgeProvider,
            model: cli.judgeModel,
          },
        }
      : {}),
    ...(cli.publishSummary
      ? { publishSummaryPath: resolve(root, cli.publishSummary) }
      : {}),
    onProgress: (message) => process.stdout.write(`${message}\n`),
  });
  process.stdout.write(
    `\n${result.summary.passedGate ? "PASS" : "FAIL"}: ${result.summary.passed}/${result.summary.scoredRuns} scored runs passed\n`,
  );
  process.stdout.write(`Report: ${resolve(outputDirectory, "report.md")}\n`);
  return result.exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : error);
      process.exitCode = 2;
    },
  );
}
