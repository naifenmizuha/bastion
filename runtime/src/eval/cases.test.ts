import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { BastionCliExecutor } from "../bastion-cli/executor.ts";
import { CORE_EVAL_CASES } from "./cases.ts";
import { EMPTY_USAGE } from "./observation.ts";
import type { GradeDimension } from "./types.ts";

describe("core eval case fixtures", () => {
  it("prepares every case in an isolated authoritative database", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const parent = await mkdtemp(join(tmpdir(), "bastion-eval-cases-"));
    for (const caseDefinition of CORE_EVAL_CASES) {
      const runDirectory = join(parent, caseDefinition.id);
      const agentDir = join(runDirectory, "agent");
      const databasePath = join(runDirectory, "bastion.db");
      await mkdir(agentDir, { recursive: true });
      const executor = new BastionCliExecutor({
        executablePath: join(root, "out", "bastion"),
        databasePath,
        timeoutMs: 30_000,
      });
      const context = {
        executor,
        databasePath,
        agentDir,
        runDirectory,
      };
      await caseDefinition.setup?.(context);
      const grades = await caseDefinition.grade({
        ...context,
        observation: {
          messages: [],
          finalAnswer: "",
          toolCalls: [],
          allToolCalls: [],
          usage: EMPTY_USAGE,
          durationMs: 0,
        },
      });
      const dimensions = new Set(grades.map((item) => item.dimension));
      for (const dimension of [
        "task",
        "safety",
        "trajectory",
        "answer",
      ] satisfies GradeDimension[]) {
        if (!dimensions.has(dimension)) {
          throw new Error(
            `${caseDefinition.id} is missing ${dimension} grading`,
          );
        }
      }
    }
  });
});
