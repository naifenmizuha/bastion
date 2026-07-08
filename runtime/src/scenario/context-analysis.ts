export const CONTEXT_CATEGORIES = [
  "Developer/System 提示",
  "工具 Schema",
  "用户消息",
  "模型 reasoning",
  "助手文本",
  "Context projection receipt",
  "Skill/Reference 文档内容",
  "read 调用参数",
  "teamops 调用参数",
  "teamops 结果/验证",
  "其他",
] as const;

export type ContextCategory = (typeof CONTEXT_CATEGORIES)[number];

export interface ContextCategoryStat {
  category: ContextCategory;
  characters: number;
  allocatedTokens: number;
  percentage: number;
}

export interface ProviderUsageRecord {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ProviderUsageSummary extends ProviderUsageRecord {
  promptTokens: number;
}

export interface ContextSnapshotAnalysis {
  totalCharacters: number;
  usage: ProviderUsageSummary;
  categories: ContextCategoryStat[];
  groups: {
    instructions: number;
    runtime: number;
    conversation: number;
  };
  groupTokens: {
    instructions: number;
    runtime: number;
    conversation: number;
  };
}

export interface ProviderPayloadAnalysis {
  requestCount: number;
  cumulative: ContextSnapshotAnalysis;
  finalRequest: ContextSnapshotAnalysis;
}

export interface ContextAnalysisMetadata {
  sessionId: string;
  logFilePath: string;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as JsonRecord;
}

function serializedLength(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Provider payload contains a value that cannot be serialized");
  }
  return serialized.length;
}

function emptyCounts(): Record<ContextCategory, number> {
  return Object.fromEntries(
    CONTEXT_CATEGORIES.map((category) => [category, 0]),
  ) as Record<ContextCategory, number>;
}

function add(
  counts: Record<ContextCategory, number>,
  category: ContextCategory,
  value: unknown,
): void {
  counts[category] += serializedLength(value);
}

function isSkillRead(call: JsonRecord | undefined): boolean {
  if (call?.name !== "read" || typeof call.arguments !== "string") return false;
  try {
    const args = asRecord(JSON.parse(call.arguments), "read arguments");
    return typeof args.path === "string" && args.path.includes("/skills/");
  } catch {
    return false;
  }
}

function classifyInput(
  input: unknown[],
  tools: unknown,
): Record<ContextCategory, number> {
  const counts = emptyCounts();
  if (tools !== undefined) add(counts, "工具 Schema", tools);

  const calls = new Map<string, JsonRecord>();
  for (const raw of input) {
    const item = asRecord(raw, "payload.input item");
    if (
      item.type === "function_call" &&
      typeof item.call_id === "string"
    ) {
      calls.set(item.call_id, item);
    }
  }

  for (const raw of input) {
    const item = asRecord(raw, "payload.input item");
    if (item.role === "developer") {
      add(counts, "Developer/System 提示", item);
    } else if (item.role === "user") {
      add(counts, "用户消息", item);
    } else if (item.type === "reasoning") {
      add(counts, "模型 reasoning", item);
    } else if (item.type === "message" && item.role === "assistant") {
      add(
        counts,
        JSON.stringify(item).includes("<bastion_context_receipt>")
          ? "Context projection receipt"
          : "助手文本",
        item,
      );
    } else if (item.type === "function_call") {
      add(
        counts,
        item.name === "read"
          ? "read 调用参数"
          : item.name === "teamops"
            ? "teamops 调用参数"
            : "其他",
        item,
      );
    } else if (item.type === "function_call_output") {
      const call =
        typeof item.call_id === "string" ? calls.get(item.call_id) : undefined;
      add(
        counts,
        isSkillRead(call)
          ? "Skill/Reference 文档内容"
          : call?.name === "teamops"
            ? "teamops 结果/验证"
            : "其他",
        item,
      );
    } else {
      add(counts, "其他", item);
    }
  }

  return counts;
}

function normalizedUsage(
  value: ProviderUsageRecord,
  label: string,
): ProviderUsageSummary {
  for (const field of ["input", "output", "cacheRead", "cacheWrite"] as const) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) {
      throw new Error(`${label}.${field} must be a non-negative safe integer`);
    }
  }
  const promptTokens = value.input + value.cacheRead + value.cacheWrite;
  if (promptTokens <= 0) {
    throw new Error(`${label} must contain positive prompt token usage`);
  }
  return { ...value, promptTokens };
}

function sumUsage(records: readonly ProviderUsageRecord[]): ProviderUsageSummary {
  const result = records.reduce<ProviderUsageRecord>(
    (total, usage) => ({
      input: total.input + usage.input,
      output: total.output + usage.output,
      cacheRead: total.cacheRead + usage.cacheRead,
      cacheWrite: total.cacheWrite + usage.cacheWrite,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  );
  return normalizedUsage(result, "cumulative usage");
}

function allocateTokens(
  counts: Record<ContextCategory, number>,
  totalCharacters: number,
  promptTokens: number,
): Record<ContextCategory, number> {
  const allocations = emptyCounts();
  const fractions: Array<{ category: ContextCategory; fraction: number }> = [];
  let allocated = 0;
  for (const category of CONTEXT_CATEGORIES) {
    const exact = (counts[category] / totalCharacters) * promptTokens;
    const base = Math.floor(exact);
    allocations[category] = base;
    allocated += base;
    fractions.push({ category, fraction: exact - base });
  }
  fractions.sort(
    (left, right) =>
      right.fraction - left.fraction ||
      CONTEXT_CATEGORIES.indexOf(left.category) -
        CONTEXT_CATEGORIES.indexOf(right.category),
  );
  for (let index = 0; allocated < promptTokens; index += 1) {
    allocations[fractions[index % fractions.length]!.category] += 1;
    allocated += 1;
  }
  return allocations;
}

function snapshot(
  counts: Record<ContextCategory, number>,
  usage: ProviderUsageSummary,
): ContextSnapshotAnalysis {
  const totalCharacters = Object.values(counts).reduce(
    (total, value) => total + value,
    0,
  );
  if (totalCharacters === 0) {
    throw new Error("Agent provider payload contains no classifiable context");
  }
  const allocatedTokens = allocateTokens(
    counts,
    totalCharacters,
    usage.promptTokens,
  );
  const categories = CONTEXT_CATEGORIES.map((category) => ({
    category,
    characters: counts[category],
    allocatedTokens: allocatedTokens[category],
    percentage: (allocatedTokens[category] / usage.promptTokens) * 100,
  })).sort((left, right) => right.characters - left.characters);

  const sum = (...categoriesToSum: ContextCategory[]) =>
    categoriesToSum.reduce((total, category) => total + counts[category], 0);
  return {
    totalCharacters,
    usage,
    categories,
    groups: {
      instructions: sum(
        "Developer/System 提示",
        "工具 Schema",
        "Skill/Reference 文档内容",
      ),
      runtime: sum(
        "Context projection receipt",
        "read 调用参数",
        "teamops 调用参数",
        "teamops 结果/验证",
        "其他",
      ),
      conversation: sum("用户消息", "模型 reasoning", "助手文本"),
    },
    groupTokens: {
      instructions:
        allocatedTokens["Developer/System 提示"] +
        allocatedTokens["工具 Schema"] +
        allocatedTokens["Skill/Reference 文档内容"],
      runtime:
        allocatedTokens["Context projection receipt"] +
        allocatedTokens["read 调用参数"] +
        allocatedTokens["teamops 调用参数"] +
        allocatedTokens["teamops 结果/验证"] +
        allocatedTokens["其他"],
      conversation:
        allocatedTokens["用户消息"] +
        allocatedTokens["模型 reasoning"] +
        allocatedTokens["助手文本"],
    },
  };
}

export function analyzeProviderPayloadLog(
  text: string,
  usageRecords: readonly ProviderUsageRecord[],
): ProviderPayloadAnalysis {
  if (!text.trim()) throw new Error("Provider payload log is empty");

  const requests: Array<Record<ContextCategory, number>> = [];
  for (const [index, line] of text.trim().split("\n").entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Provider payload log line ${index + 1} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const record = asRecord(parsed, `Provider payload log line ${index + 1}`);
    if (record.source !== "agent") continue;
    const payload = asRecord(
      record.payload,
      `Provider payload log line ${index + 1} payload`,
    );
    if (!Array.isArray(payload.input)) {
      throw new Error(
        `Provider payload log line ${index + 1} payload.input must be an array`,
      );
    }
    if (payload.tools !== undefined && !Array.isArray(payload.tools)) {
      throw new Error(
        `Provider payload log line ${index + 1} payload.tools must be an array`,
      );
    }
    requests.push(classifyInput(payload.input, payload.tools));
  }

  if (requests.length === 0) {
    throw new Error("Provider payload log contains no agent requests");
  }
  if (usageRecords.length !== requests.length) {
    throw new Error(
      `Provider request/usage count mismatch: ${requests.length} requests, ${usageRecords.length} usage records`,
    );
  }
  const usage = usageRecords.map((record, index) =>
    normalizedUsage(record, `usage record ${index + 1}`),
  );

  const cumulative = emptyCounts();
  for (const request of requests) {
    for (const category of CONTEXT_CATEGORIES) {
      cumulative[category] += request[category];
    }
  }
  return {
    requestCount: requests.length,
    cumulative: snapshot(cumulative, sumUsage(usage)),
    finalRequest: snapshot(requests.at(-1)!, usage.at(-1)!),
  };
}

export function extractProviderUsage(
  messages: readonly unknown[],
): ProviderUsageRecord[] {
  const records: ProviderUsageRecord[] = [];
  for (const raw of messages) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const message = raw as JsonRecord;
    if (message.role !== "assistant" || message.usage === undefined) continue;
    const usage = asRecord(message.usage, "assistant usage");
    records.push({
      input: usage.input as number,
      output: usage.output as number,
      cacheRead: usage.cacheRead as number,
      cacheWrite: usage.cacheWrite as number,
    });
  }
  return records;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function renderTable(snapshotAnalysis: ContextSnapshotAnalysis): string {
  const rows = snapshotAnalysis.categories.map(
    (stat) =>
      `| ${stat.category} | ${formatNumber(stat.characters)} | ${formatNumber(stat.allocatedTokens)} | ${stat.percentage.toFixed(2)}% |`,
  );
  return [
    "| 分类 | 序列化字符数 | 校准分摊 Token | 占比 |",
    "|---|---:|---:|---:|",
    ...rows,
    `| **合计** | **${formatNumber(snapshotAnalysis.totalCharacters)}** | **${formatNumber(snapshotAnalysis.usage.promptTokens)}** | **100.00%** |`,
  ].join("\n");
}

function renderGroups(snapshotAnalysis: ContextSnapshotAnalysis): string {
  const rows = [
    [
      "指令与能力定义",
      snapshotAnalysis.groups.instructions,
      snapshotAnalysis.groupTokens.instructions,
    ],
    [
      "运行状态与工具轨迹",
      snapshotAnalysis.groups.runtime,
      snapshotAnalysis.groupTokens.runtime,
    ],
    [
      "实际对话内容",
      snapshotAnalysis.groups.conversation,
      snapshotAnalysis.groupTokens.conversation,
    ],
  ] as const;
  return [
    "| 汇总组 | 序列化字符数 | 校准分摊 Token | 占比 |",
    "|---|---:|---:|---:|",
    ...rows.map(
      ([label, characters, tokens]) =>
        `| ${label} | ${formatNumber(characters)} | ${formatNumber(tokens)} | ${((tokens / snapshotAnalysis.usage.promptTokens) * 100).toFixed(2)}% |`,
    ),
  ].join("\n");
}

function renderUsage(usage: ProviderUsageSummary): string {
  return [
    "| 精确 Provider Usage | Token |",
    "|---|---:|",
    `| Prompt 合计 | ${formatNumber(usage.promptTokens)} |`,
    `| 未缓存输入 | ${formatNumber(usage.input)} |`,
    `| Cache Read | ${formatNumber(usage.cacheRead)} |`,
    `| Cache Write | ${formatNumber(usage.cacheWrite)} |`,
    `| 输出 | ${formatNumber(usage.output)} |`,
  ].join("\n");
}

export function renderContextAnalysisMarkdown(
  analysis: ProviderPayloadAnalysis,
  metadata: ContextAnalysisMetadata,
): string {
  return `# Bastion Runtime 上下文分类分析

- Session: \`${metadata.sessionId}\`
- Dev log: \`${metadata.logFilePath}\`
- Agent 请求数: ${analysis.requestCount}
- 口径: Prompt 合计和缓存/输出来自 provider usage，是精确值；分类 Token 按序列化字符权重校准分摊，分类本身是近似归因。

## 累计传输

${renderUsage(analysis.cumulative.usage)}

${renderTable(analysis.cumulative)}

${renderGroups(analysis.cumulative)}

## 最后一次请求

${renderUsage(analysis.finalRequest.usage)}

${renderTable(analysis.finalRequest)}

${renderGroups(analysis.finalRequest)}
`;
}
