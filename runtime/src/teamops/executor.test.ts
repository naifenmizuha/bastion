import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { TeamOpsExecutor } from "./executor.ts";

let fixtureDir: string;

before(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), "bastion-executor-test-"));
});

after(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

async function executable(name: string, body: string): Promise<string> {
  const path = join(fixtureDir, name);
  await writeFile(path, `#!/usr/bin/env node\n${body}\n`, "utf8");
  await chmod(path, 0o755);
  return path;
}

function createExecutor(path: string, timeoutMs = 1_000) {
  return new TeamOpsExecutor({
    executablePath: path,
    databasePath: join(fixtureDir, "test.db"),
    timeoutMs,
  });
}

describe("TeamOpsExecutor", () => {
  it("loads and selects the CLI-owned command input contract", async () => {
    const path = await executable(
      "contract.mjs",
      `if (!process.argv.includes("contract")) process.exit(2);
process.stdout.write(JSON.stringify({ok:true,data:{commands:[{
  command:["player","add"],
  input:{
    required:true,
    type:"object",
    additionalProperties:false,
    requiredFields:["name","number","bat","throw","positions"],
    properties:{name:{type:"string"},number:{type:"integer"},bat:{type:"string"},throw:{type:"string"},positions:{type:"string"}},
    example:{name:"张三",number:18,bat:"right",throw:"right",positions:"pitcher"}
  }
}]}}));`,
    );
    const contract = await createExecutor(path, 3_000).inputContract([
      "player",
      "add",
    ]);
    assert.deepEqual(contract?.command, ["player", "add"]);
    assert.deepEqual(contract?.input.requiredFields, [
      "name",
      "number",
      "bat",
      "throw",
      "positions",
    ]);
  });

  it("parses a successful JSON envelope", async () => {
    const path = await executable(
      "success.mjs",
      'process.stdout.write(JSON.stringify({ok:true,data:{players:[]}}));',
    );
    const result = await createExecutor(path).run(
      ["player", "list"],
      undefined,
    );
    assert.deepEqual(result.envelope, { ok: true, data: { players: [] } });
    assert.equal(result.exitCode, 0);
  });

  it("preserves structured CLI business errors", async () => {
    const path = await executable(
      "business-error.mjs",
      'process.stdout.write(JSON.stringify({ok:false,error:{code:"not_found",message:"missing"}})); process.exitCode=3;',
    );
    const result = await createExecutor(path).run(
      ["player", "read", "--name", "nobody"],
      undefined,
    );
    assert.equal(result.envelope.ok, false);
    if (!result.envelope.ok) {
      assert.equal(result.envelope.error.code, "not_found");
    }
    assert.equal(result.exitCode, 3);
  });

  it("rejects invalid JSON and inconsistent exit codes", async () => {
    const invalid = await executable(
      "invalid.mjs",
      'process.stdout.write("not json");',
    );
    await assert.rejects(
      createExecutor(invalid).run(["player", "list"], undefined),
      /valid JSON/,
    );

    const inconsistent = await executable(
      "inconsistent.mjs",
      'process.stdout.write(JSON.stringify({ok:true,data:{}})); process.exitCode=2;',
    );
    await assert.rejects(
      createExecutor(inconsistent).run(["player", "list"], undefined),
      /exited with 2/,
    );
  });

  it("times out and responds to AbortSignal", async () => {
    const path = await executable(
      "slow.mjs",
      "setTimeout(() => process.stdout.write(JSON.stringify({ok:true,data:{}})), 2000);",
    );
    await assert.rejects(
      createExecutor(path, 30).run(["player", "list"], undefined),
      /timed out/,
    );

    const controller = new AbortController();
    const pending = createExecutor(path).run(
      ["player", "list"],
      undefined,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending, /aborted/);
  });
});
