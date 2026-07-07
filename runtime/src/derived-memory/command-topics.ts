import type { BastionCliParams } from "../bastion-cli/types.ts";

interface TopicRule {
  prefix: readonly string[];
  topics: readonly string[];
}

const READ_TOPIC_RULES: readonly TopicRule[] = [
  { prefix: ["batch"], topics: ["player", "report", "game", "game_analysis", "lineup", "drill"] },
  { prefix: ["game", "analysis"], topics: ["game", "game_analysis"] },
  { prefix: ["person", "analysis"], topics: ["player", "report", "game", "game_analysis"] },
  { prefix: ["game"], topics: ["game"] },
  { prefix: ["lineup", "validate"], topics: ["lineup", "game", "player"] },
  { prefix: ["lineup"], topics: ["lineup"] },
  { prefix: ["player"], topics: ["player"] },
  { prefix: ["report"], topics: ["report", "player"] },
  { prefix: ["drill"], topics: ["drill", "player", "report"] },
];

const WRITE_TOPIC_RULES: readonly TopicRule[] = [
  { prefix: ["batch"], topics: ["player", "report", "game", "game_analysis", "lineup", "drill"] },
  { prefix: ["game", "analysis", "generate"], topics: ["game_analysis"] },
  { prefix: ["game", "lineup"], topics: ["game", "game_analysis", "lineup"] },
  { prefix: ["game", "event"], topics: ["game", "game_analysis"] },
  { prefix: ["game", "score"], topics: ["game", "game_analysis"] },
  { prefix: ["game"], topics: ["game", "game_analysis"] },
  { prefix: ["lineup"], topics: ["lineup", "game"] },
  { prefix: ["player"], topics: ["player"] },
  { prefix: ["report"], topics: ["report", "player"] },
  { prefix: ["drill"], topics: ["drill"] },
];

function matchesPrefix(args: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((token, index) => args[index] === token);
}

function topicsFor(
  args: readonly string[],
  rules: readonly TopicRule[],
): string[] {
  const rule = rules.find((candidate) => matchesPrefix(args, candidate.prefix));
  return rule ? [...rule.topics] : [];
}

export function readDependencyTopics(args: readonly string[]): string[] {
  return topicsFor(args, READ_TOPIC_RULES);
}

export function writeChangeTopics(args: readonly string[]): string[] {
  return topicsFor(args, WRITE_TOPIC_RULES);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function normalizedCommand(params: BastionCliParams): string {
  return stableJson({
    args: params.args,
    ...(params.input !== undefined ? { input: params.input } : {}),
  });
}
