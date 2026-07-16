import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { defaultEvaluationOutputDirectory } from "./paths.ts";

test("default evaluation output is outside runtime at the repository root", () => {
  const repositoryRoot = join("tmp", "bastion");
  const now = new Date("2026-07-15T12:34:56.789Z");

  assert.equal(
    defaultEvaluationOutputDirectory(repositoryRoot, now),
    join(repositoryRoot, "eval-results", "2026-07-15T12-34-56-789Z"),
  );
});
