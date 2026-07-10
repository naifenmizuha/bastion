import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadRuntimeEnv, parseRuntimeEnv } from "./env-loader.ts";

describe("runtime env loader", () => {
  it("parses comments, blank lines, unquoted values, and quoted values", () => {
    const parsed = parseRuntimeEnv(`
# comment
EMBEDDING_API_KEY = local-key
EMBEDDING_MODEL="text-embedding-v4" # inline comment
EMBEDDING_URL='https://example.test/embeddings'
EMBEDDING_DIMENSION=4096 # inline comment
not valid
`);

    assert.equal(parsed.get("EMBEDDING_API_KEY"), "local-key");
    assert.equal(parsed.get("EMBEDDING_MODEL"), "text-embedding-v4");
    assert.equal(parsed.get("EMBEDDING_URL"), "https://example.test/embeddings");
    assert.equal(parsed.get("EMBEDDING_DIMENSION"), "4096");
    assert.equal(parsed.has("not valid"), false);
  });

  it("loads .env.local before .env without overwriting existing values", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "bastion-env-"));
    try {
      const runtimeDir = join(repoRoot, "runtime");
      await mkdir(runtimeDir);
      await writeFile(
        join(runtimeDir, ".env.local"),
        [
          "EMBEDDING_API_KEY=local-key",
          "EMBEDDING_MODEL=local-model",
          "OPENAI_API_KEY=local-openai",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        join(runtimeDir, ".env"),
        [
          "EMBEDDING_API_KEY=default-key",
          "EMBEDDING_URL=https://example.test/embeddings",
          "EMBEDDING_MODEL=default-model",
        ].join("\n"),
        "utf8",
      );
      const env: NodeJS.ProcessEnv = {
        OPENAI_API_KEY: "shell-openai",
      };

      const result = loadRuntimeEnv(repoRoot, env);

      assert.equal(env.EMBEDDING_API_KEY, "local-key");
      assert.equal(env.EMBEDDING_MODEL, "local-model");
      assert.equal(env.EMBEDDING_URL, "https://example.test/embeddings");
      assert.equal(env.OPENAI_API_KEY, "shell-openai");
      assert.deepEqual(result.map((item) => item.loaded), [
        ["EMBEDDING_API_KEY", "EMBEDDING_MODEL"],
        ["EMBEDDING_URL"],
      ]);
      assert.deepEqual(result.map((item) => item.skipped), [
        ["OPENAI_API_KEY"],
        ["EMBEDDING_API_KEY", "EMBEDDING_MODEL"],
      ]);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  it("skips missing env files", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "bastion-env-"));
    try {
      const env: NodeJS.ProcessEnv = {};
      assert.deepEqual(loadRuntimeEnv(repoRoot, env), []);
      assert.deepEqual(env, {});
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
