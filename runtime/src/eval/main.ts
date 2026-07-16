#!/usr/bin/env node

import { mkdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readEvaluationConfig } from "./config.ts";
import { defaultEvaluationOutputDirectory } from "./paths.ts";
import { runEvaluation } from "./runner.ts";

function usage(): string {
  return [
    "用法: pnpm eval -- --config <file.toml> [选项]",
    "",
    "选项:",
    "  --config <path>       评测 TOML（必填）",
    "  --output <path>       输出目录，默认 eval-results/<时间>",
    "  --case <id>           只运行指定用例，可重复传入",
    "  --tag <tag>           只运行含指定标签的用例，可重复传入",
    "  --help                显示帮助",
  ].join("\n");
}

function values(argv: string[], flag: string): string[] {
  const output: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${flag} 需要值`);
      output.push(value);
      index += 1;
    }
  }
  return output;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return 0;
  }
  const configValue = values(argv, "--config")[0];
  if (!configValue) throw new Error("缺少 --config；请提供 TOML 评测文件\n\n" + usage());
  const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const configPath = isAbsolute(configValue) ? configValue : resolve(repositoryRoot, configValue);
  const config = await readEvaluationConfig(configPath);
  const defaultOutput = defaultEvaluationOutputDirectory(repositoryRoot);
  const outputValue = values(argv, "--output")[0];
  const outputDirectory = outputValue
    ? (isAbsolute(outputValue) ? outputValue : resolve(repositoryRoot, outputValue))
    : defaultOutput;
  await mkdir(outputDirectory, { recursive: true });
  const result = await runEvaluation({
    config,
    outputDirectory,
    repositoryRoot,
    executablePath: join(repositoryRoot, "out", "teamops"),
    selectedCaseIds: values(argv, "--case"),
    selectedTags: values(argv, "--tag"),
    onProgress: (message) => console.error(`[eval] ${message}`),
  });
  console.log(`评测完成：${result.summary.passed}/${result.summary.total} 通过；平均分 ${result.summary.averageScore.toFixed(1)}/100；输出：${outputDirectory}`);
  console.log(`Markdown 报告：${join(outputDirectory, "report.md")}`);
  return result.exitCode;
}

main().then((code) => {
  process.exitCode = code;
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 2;
});
