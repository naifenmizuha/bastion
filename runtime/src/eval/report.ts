import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RunResult, SuiteSummary } from "./types.ts";

function json(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2);
}

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function markdownTable(results: RunResult[]): string {
  const rows = results.map((result) => {
    const review = result.review;
    const average = review
      ? Object.values(review.scores).reduce((sum, value) => sum + value, 0) / 5
      : 0;
    return `| ${result.caseId} | ${result.repetition} | ${result.status} | ${result.score.total.toFixed(1)}/100 | ${average.toFixed(1)} | ${result.agentUsage.total} | ${result.reviewerUsage?.total ?? 0} |`;
  });
  return [
    "| 用例 | 次数 | 状态 | 总分 | 质量均分 | Agent tokens | 评审 tokens |",
    "| --- | ---: | --- | ---: | ---: | ---: | ---: |",
    ...rows,
  ].join("\n");
}

function compact(value: unknown): string {
  const text = (JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item) ?? String(value)).replaceAll("\n", " ");
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

function resultDetails(result: RunResult): string {
  const deductions = result.expectationResults.filter((item) => item.deductedWeight > 0);
  const gates = result.checks.filter((item) => !item.passed && (item.code.startsWith("database.") || item.code.startsWith("teamops.")));
  return [
    `### ${result.caseId}（第 ${result.repetition} 次）— ${result.score.total.toFixed(1)}/100`,
    "",
    `- 程序性：${result.score.programmatic.toFixed(1)}；创作性：${result.score.creative.toFixed(1)}；通用质量：${result.score.quality.toFixed(1)}`,
    ...result.sessions.flatMap((session) => [
      `- 会话 \`${session.sessionId}\`（Runtime \`${session.runtimeSessionId ?? "未创建"}\`）：${session.status}，${session.durationMs} ms，${session.agentUsage.total} tokens`,
      ...session.turns.map((turn) => `  - 轮次 \`${turn.turnId}\`：${turn.prompt} → ${turn.finalAnswer || "（无回答）"}`),
    ]),
    "",
    "| 评分项 | 范围 | 权重完成度 | 损失权重 | 原因 |",
    "| --- | --- | ---: | ---: | --- |",
    ...result.expectationResults.map((item) => `| ${item.title.replaceAll("|", "\\|")} | ${item.turnId ?? item.scope} | ${item.earnedWeight.toFixed(1)}/${item.maxWeight.toFixed(1)} | -${item.deductedWeight.toFixed(1)} | ${item.reason.replaceAll("|", "\\|").replaceAll("\n", " ")} |`),
    "",
    "#### 扣分原因",
    "",
    ...(deductions.length ? deductions.map((item) => `- **-${item.deductedWeight.toFixed(1)} 权重 ${item.title}**：${item.reason}；expected=${compact(item.expected)}；actual=${compact(item.actual)}`) : ["- 无扣分。"]),
    ...(gates.length ? ["", "#### 强制失败（不计入扣分）", "", ...gates.map((item) => `- ${item.title}：${item.message}`)] : []),
    "",
  ].join("\n");
}

export function renderMarkdown(summary: SuiteSummary, results: RunResult[]): string {
  const failed = results.filter((result) => result.status !== "passed");
  return [
    `# Bastion Agent 评测报告：${summary.name}`,
    "",
    `- 总运行：${summary.total}，通过：${summary.passed}，失败：${summary.failed}，未完成：${summary.notCompleted}`,
    `- 通过率：${(summary.passRate * 100).toFixed(1)}%（门槛由 TOML 规则决定）`,
    `- 平均分：${summary.averageScore.toFixed(1)}/100`,
    `- 安全规则：${summary.safetyPassed ? "通过" : "失败"}；质量规则：${summary.qualityPassed ? "通过" : "失败"}`,
    `- Agent tokens：${summary.agentUsage.total}；评审 tokens：${summary.reviewerUsage.total}`,
    "",
    "## 运行总览",
    "",
    markdownTable(results),
    "",
    "## 得分详情与扣分原因",
    "",
    results.map(resultDetails).join("\n"),
    "",
    "## 失败或未完成用例",
    "",
    failed.length ? failed.map((result) => [
      `### ${result.caseId}（第 ${result.repetition} 次）`,
      "",
      result.errors?.length ? result.errors.map((error) => `- ${error.kind}: ${error.message}`).join("\n") : "无运行错误，检查规则：",
      result.checks.filter((check) => !check.passed).map((check) => `- ${check.title}: ${check.message}`).join("\n"),
      result.review ? `- 评审：${result.review.summary}` : "- 没有质量评审结果",
      "",
    ].join("\n")).join("\n") : "没有失败用例。",
    "",
    "## 机器可读文件",
    "",
    "成功收集证据的运行目录包含 `run-result.json`、`execution-flow.json`、`teamops-baseline-state.json`、`teamops-final-state.json` 和 `database-changes.json`；质量评审成功时另有 `quality-review.json`。",
    "",
  ].join("\n");
}

export function renderHtml(summary: SuiteSummary, results: RunResult[]): string {
  const rows = results.map((result) => {
    const average = result.review
      ? Object.values(result.review.scores).reduce((sum, value) => sum + value, 0) / 5
      : 0;
    return `<tr><td>${escape(result.caseId)}</td><td>${result.repetition}</td><td>${escape(result.status)}</td><td>${result.score.total.toFixed(1)}/100</td><td>${average.toFixed(1)}</td><td>${result.agentUsage.total}</td><td>${result.reviewerUsage?.total ?? 0}</td></tr>`;
  }).join("\n");
  const details = results.map((result) => `<section><h3>${escape(result.caseId)}（第 ${result.repetition} 次）— ${result.score.total.toFixed(1)}/100</h3><p>程序性 ${result.score.programmatic.toFixed(1)}；创作性 ${result.score.creative.toFixed(1)}；通用质量 ${result.score.quality.toFixed(1)}</p><h4>会话</h4>${result.sessions.map((session) => `<div><strong>${escape(session.sessionId)}</strong>（Runtime ${escape(session.runtimeSessionId ?? "未创建")}）：${escape(session.status)}，${session.durationMs} ms，${session.agentUsage.total} tokens<ul>${session.turns.map((turn) => `<li>${escape(turn.turnId)}：${escape(turn.prompt)} → ${escape(turn.finalAnswer || "（无回答）")}</li>`).join("")}</ul></div>`).join("")}<table><thead><tr><th>评分项</th><th>范围</th><th>权重完成度</th><th>损失权重</th><th>原因</th></tr></thead><tbody>${result.expectationResults.map((item) => `<tr><td>${escape(item.title)}</td><td>${escape(item.turnId ?? item.scope)}</td><td>${item.earnedWeight.toFixed(1)}/${item.maxWeight.toFixed(1)}</td><td>-${item.deductedWeight.toFixed(1)}</td><td>${escape(item.reason)}</td></tr>`).join("")}</tbody></table><h4>扣分原因</h4>${result.expectationResults.filter((item) => item.deductedWeight > 0).map((item) => `<p class="bad">-${item.deductedWeight.toFixed(1)} 权重 ${escape(item.title)}：${escape(item.reason)}</p>`).join("") || "<p>无扣分。</p>"}</section>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>Bastion Eval: ${escape(summary.name)}</title><style>body{font:15px system-ui;max-width:1100px;margin:40px auto;padding:0 20px;color:#1f2937}table{border-collapse:collapse;width:100%}td,th{border:1px solid #d1d5db;padding:8px;text-align:left}th{background:#f3f4f6}.ok{color:#15803d}.bad{color:#b91c1c}pre{white-space:pre-wrap}section{margin:32px 0}</style><h1>Bastion Agent 评测报告：${escape(summary.name)}</h1><p>总运行 ${summary.total}，通过 ${summary.passed}，失败 ${summary.failed}，未完成 ${summary.notCompleted}；通过率 ${(summary.passRate * 100).toFixed(1)}%；平均分 ${summary.averageScore.toFixed(1)}/100。</p><p>安全规则：<span class="${summary.safetyPassed ? "ok" : "bad"}">${summary.safetyPassed ? "通过" : "失败"}</span>；质量规则：<span class="${summary.qualityPassed ? "ok" : "bad"}">${summary.qualityPassed ? "通过" : "失败"}</span>。</p><table><thead><tr><th>用例</th><th>次数</th><th>状态</th><th>总分</th><th>质量均分</th><th>Agent tokens</th><th>评审 tokens</th></tr></thead><tbody>${rows}</tbody></table><h2>得分详情与扣分原因</h2>${details}<h2>原始数据</h2><pre>${escape(json({ summary, results }))}</pre>`;
}

export async function writeReport(options: {
  outputDirectory: string;
  summary: SuiteSummary;
  results: RunResult[];
}): Promise<{ markdownPath: string; htmlPath: string }> {
  await mkdir(options.outputDirectory, { recursive: true });
  const markdownPath = join(options.outputDirectory, "report.md");
  const htmlPath = join(options.outputDirectory, "report.html");
  await writeFile(markdownPath, renderMarkdown(options.summary, options.results));
  await writeFile(htmlPath, renderHtml(options.summary, options.results));
  return { markdownPath, htmlPath };
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${json(value)}\n`);
}
