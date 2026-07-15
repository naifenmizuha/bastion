import { join } from "node:path";

export function defaultEvaluationOutputDirectory(
  repositoryRoot: string,
  now = new Date(),
): string {
  return join(
    repositoryRoot,
    "eval-results",
    now.toISOString().replaceAll(/[:.]/g, "-"),
  );
}
