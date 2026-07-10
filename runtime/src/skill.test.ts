import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manageSkillDir = join(runtimeRoot, "skills", "manage-bastion-team");
const knowledgeSkillDir = join(runtimeRoot, "skills", "knowledge-base-ingest");

describe("manage-bastion-team skill", () => {
  it("loads without Pi diagnostics and keeps references valid", async () => {
    const result = loadSkillsFromDir({
      dir: manageSkillDir,
      source: "test",
    });
    assert.equal(result.diagnostics.length, 0);
    assert.deepEqual(
      result.skills.map((skill) => skill.name),
      ["manage-bastion-team"],
    );

    const content = await readFile(join(manageSkillDir, "SKILL.md"), "utf8");
    assert.ok(content.split(/\r?\n/).length <= 100);
    assert.match(content, /## CLI quick manual/);
    assert.doesNotMatch(content, /Official baseball rules/);
    assert.doesNotMatch(content, /chunk_preview/);
    assert.doesNotMatch(content, /SiliconFlow/);
    assert.match(content, /"args":\["player","read","--name","张三"\]/);
    assert.match(content, /"args":\["report","write"\]/);
    assert.match(content, /"args":\["batch","read"\]/);
    assert.match(content, /"args":\["batch","write"\]/);
    assert.match(content, /Never include `--db`, `--format`, or `--input`/);
    assert.match(content, /do not repeat a verified read-back/);
    const links = [...content.matchAll(/\]\((references\/[^)]+)\)/g)].map(
      (match) => match[1],
    );
    assert.equal(links.length, 5);
    for (const link of links) {
      assert.ok(link);
      await readFile(join(manageSkillDir, link), "utf8");
    }

    const players = await readFile(
      join(manageSkillDir, "references", "players-and-reports.md"),
      "utf8",
    );
    assert.match(players, /## When to use/);
    assert.match(players, /## Commands/);
    assert.match(players, /## Minimal workflow/);
    assert.match(players, /## Required input notes/);
    assert.match(players, /"args":\["player","add"\]/);
    assert.match(players, /"input":\{/);
  });

  it("keeps references focused and preserves critical CLI guidance", async () => {
    const references = [
      "players-and-reports.md",
      "games-and-analysis.md",
      "lineups.md",
      "drills.md",
      "protocol-and-safety.md",
    ];
    for (const file of references) {
      const content = await readFile(join(manageSkillDir, "references", file), "utf8");
      const lines = content.split(/\r?\n/).length;
      const limit = file === "games-and-analysis.md" ? 120 : 90;
      assert.ok(lines <= limit, `${file} has ${lines} lines`);
      assert.match(content, /## When to use/);
      assert.match(content, /## Commands/);
      assert.match(content, /## Minimal workflow/);
      assert.match(content, /## Required input notes/);
    }

    const games = await readFile(
      join(manageSkillDir, "references", "games-and-analysis.md"),
      "utf8",
    );
    assert.match(games, /prefer one `game write`/);
    assert.match(games, /prefer one `batch write`/);
    assert.match(games, /game analysis generate`[\s\S]*`game analysis read/);
    assert.match(games, /`missing_required` means the fact is missing/);

    const lineups = await readFile(
      join(manageSkillDir, "references", "lineups.md"),
      "utf8",
    );
    assert.match(lineups, /`lineup write` only saves a candidate/);
    assert.match(lineups, /call `lineup accept --id ID`/);

    const protocol = await readFile(
      join(manageSkillDir, "references", "protocol-and-safety.md"),
      "utf8",
    );
    assert.match(protocol, /On `USER_CANCELLED`, stop immediately/);
    assert.match(protocol, /Never query SQLite or fall back to shell commands/);
  });
});

describe("knowledge-base-ingest skill", () => {
  it("loads without Pi diagnostics and owns baseball rule ingestion guidance", async () => {
    const result = loadSkillsFromDir({
      dir: knowledgeSkillDir,
      source: "test",
    });
    assert.equal(result.diagnostics.length, 0);
    assert.deepEqual(
      result.skills.map((skill) => skill.name),
      ["knowledge-base-ingest"],
    );

    const content = await readFile(join(knowledgeSkillDir, "SKILL.md"), "utf8");
    assert.ok(content.split(/\r?\n/).length <= 80);
    assert.match(content, /# 知识库录入/);
    assert.match(content, /`chunk_preview`/);
    assert.match(content, /`ingest`/);
    assert.match(content, /`retrieve`/);
    assert.match(content, /EMBEDDING_URL=https:\/\/api\.siliconflow\.cn\/v1\/embeddings/);
    assert.match(content, /EMBEDDING_MODEL=Qwen\/Qwen3-Embedding-8B/);
    assert.match(content, /EMBEDDING_DIMENSION=4096/);
  });
});
