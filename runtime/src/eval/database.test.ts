import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { ensureBaselineDatabase, inspectDatabase } from "./database.ts";

test("Athletics baseline is cached and has 2025 games", async () => {
  const repositoryRoot = join(import.meta.dirname, "../../..");
  const baseline = await ensureBaselineDatabase(
    join(repositoryRoot, "out", "athletics-2025.sql"),
    join(repositoryRoot, "out", "eval-cache"),
  );
  assert.equal(baseline.state.tables.games?.rowCount, 162);
  assert.equal(baseline.state.integrityPassed, true);
  assert.equal(inspectDatabase(baseline.path, "teamops").state.databaseHash, baseline.state.databaseHash);
});
