import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = join(runtimeRoot, "skills", "manage-bastion-team");

describe("manage-bastion-team skill", () => {
  it("loads without Pi diagnostics and keeps references valid", async () => {
    const result = loadSkillsFromDir({
      dir: skillDir,
      source: "test",
    });
    assert.equal(result.diagnostics.length, 0);
    assert.deepEqual(
      result.skills.map((skill) => skill.name),
      ["manage-bastion-team"],
    );

    const content = await readFile(join(skillDir, "SKILL.md"), "utf8");
    assert.ok(content.split(/\r?\n/).length <= 100);
    assert.match(content, /## CLI quick manual/);
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
      await readFile(join(skillDir, link), "utf8");
    }

    const players = await readFile(
      join(skillDir, "references", "players-and-reports.md"),
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
      const content = await readFile(join(skillDir, "references", file), "utf8");
      const lines = content.split(/\r?\n/).length;
      const limit = file === "games-and-analysis.md" ? 120 : 90;
      assert.ok(lines <= limit, `${file} has ${lines} lines`);
      assert.match(content, /## When to use/);
      assert.match(content, /## Commands/);
      assert.match(content, /## Minimal workflow/);
      assert.match(content, /## Required input notes/);
    }

    const games = await readFile(
      join(skillDir, "references", "games-and-analysis.md"),
      "utf8",
    );
    assert.match(games, /prefer one `game write`/);
    assert.match(games, /prefer one `batch write`/);
    assert.match(games, /game analysis generate`[\s\S]*`game analysis read/);
    assert.match(games, /`missing_required` means the fact is missing/);

    const lineups = await readFile(
      join(skillDir, "references", "lineups.md"),
      "utf8",
    );
    assert.match(lineups, /`lineup write` only saves a candidate/);
    assert.match(lineups, /call `lineup accept --id ID`/);

    const protocol = await readFile(
      join(skillDir, "references", "protocol-and-safety.md"),
      "utf8",
    );
    assert.match(protocol, /On `USER_CANCELLED`, stop immediately/);
    assert.match(protocol, /Never query SQLite or fall back to shell commands/);
  });
});
