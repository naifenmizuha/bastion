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
    assert.ok(content.split(/\r?\n/).length <= 200);
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
    assert.match(players, /"args": \["player", "add"\]/);
    assert.match(players, /"input": \{/);
  });
});
