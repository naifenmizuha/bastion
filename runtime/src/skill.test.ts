import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { commandSpecs } from "./teamops/command-policy.ts";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(runtimeRoot, "..");
const teamopsExecutable = join(repoRoot, "out", "teamops");
const manageSkillDir = join(runtimeRoot, "skills", "manage-bastion-team");
const knowledgeSkillDir = join(runtimeRoot, "skills", "knowledge-base-ingest");

const cliReferences = [
  "teams.md",
  "players-and-reports.md",
  "games-and-analysis.md",
  "lineups.md",
  "drills.md",
  "protocol.md",
];
const applicationReferences = [
  "team-onboarding.md",
  "game-recording.md",
  "performance-analysis.md",
  "lineup-lifecycle.md",
  "training-review.md",
];

function commandSections(content: string): Map<string, string> {
  const headings = [...content.matchAll(/^## `([^`]+)`$/gm)];
  return new Map(
    headings.map((heading, index) => {
      const start = heading.index ?? 0;
      const end = headings[index + 1]?.index ?? content.length;
      return [heading[1] ?? "", content.slice(start, end)];
    }),
  );
}

describe("manage-bastion-team skill", () => {
  it("loads as a compact two-layer router with valid direct links", async () => {
    const result = loadSkillsFromDir({ dir: manageSkillDir, source: "test" });
    assert.equal(result.diagnostics.length, 0);
    assert.deepEqual(result.skills.map((skill) => skill.name), ["manage-bastion-team"]);

    const content = await readFile(join(manageSkillDir, "SKILL.md"), "utf8");
    assert.ok(content.split(/\r?\n/).length <= 100);
    assert.match(content, /## Layer 1: CLI capabilities/);
    assert.match(content, /## Layer 2: application recipes/);
    assert.match(content, /team list/);
    assert.match(content, /player list --scope own/);
    assert.match(content, /game list --limit 1/);
    assert.match(content, /`team info` is not a command/);
    assert.match(content, /placeholders, never database facts/);
    assert.match(content, /Recipe names are not CLI commands/);
    assert.doesNotMatch(content, /Official baseball rules|chunk_preview|SiliconFlow/);
    assert.match(content, /Never include `--db`, `--format`, or\s+`--input`/);
    assert.match(content, /do not repeat a verified read-back/);
    assert.equal(content.match(/`team list`/g)?.length, 1);

    const links = [...content.matchAll(/\]\((references\/[^)]+)\)/g)].map(
      (match) => match[1],
    );
    assert.equal(links.length, cliReferences.length + applicationReferences.length);
    for (const link of links) {
      assert.ok(link);
      const referencePath = join(manageSkillDir, link);
      const reference = await readFile(referencePath, "utf8");
      const nestedLinks = [...reference.matchAll(/\]\((\.\.\/[^)]+)\)/g)].map(
        (match) => match[1],
      );
      for (const nestedLink of nestedLinks) {
        assert.ok(nestedLink);
        await readFile(resolve(dirname(referencePath), nestedLink), "utf8");
      }
    }
  });

  it("documents every registered command exactly once with flags and policy", async () => {
    const sections = new Map<string, string>();
    for (const file of cliReferences) {
      const content = await readFile(
        join(manageSkillDir, "references", "cli", file),
        "utf8",
      );
      assert.doesNotMatch(content, /## Minimal workflow/);
      for (const [command, section] of commandSections(content)) {
        assert.equal(sections.has(command), false, `${command} is documented twice`);
        sections.set(command, section);
      }
    }

    const registered = commandSpecs.map((spec) => spec.path.join(" ")).sort();
    assert.deepEqual([...sections.keys()].sort(), registered);
    for (const spec of commandSpecs) {
      const command = spec.path.join(" ");
      const section = sections.get(command);
      assert.ok(section, `${command} is undocumented`);
      assert.ok(section.includes(`- Risk: \`${spec.risk}\``), `${command} risk drifted`);
      assert.ok(section.includes(`- Input: \`${spec.input}\``), `${command} input drifted`);
      for (const flag of Object.keys(spec.flags)) {
        assert.ok(section.includes(`\`${flag}\``), `${command} omits ${flag}`);
      }
    }

    const teams = await readFile(join(manageSkillDir, "references", "cli", "teams.md"), "utf8");
    assert.match(teams, /^## `team list`$/m);
    assert.match(teams, /^## `team read`$/m);
    assert.match(teams, /`team read --name NAME`/);
    assert.doesNotMatch(teams, /^## `team info`$/m);

    const players = await readFile(
      join(manageSkillDir, "references", "cli", "players-and-reports.md"),
      "utf8",
    );
    assert.match(players, /`player list --scope own`/);
    assert.match(players, /Never fetch every league player unless explicitly requested/);
  });

  it("keeps structured input fields aligned with the CLI contract", async () => {
    const result = spawnSync(teamopsExecutable, ["--format", "json", "contract"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout) as {
      data: { commands: Array<{ command: string[]; input: { requiredFields: string[] } }> };
    };
    const allCliContent = (
      await Promise.all(
        cliReferences.map((file) =>
          readFile(join(manageSkillDir, "references", "cli", file), "utf8"),
        ),
      )
    ).join("\n");
    const sections = commandSections(allCliContent);
    for (const contract of envelope.data.commands) {
      const command = contract.command.join(" ");
      const section = sections.get(command);
      assert.ok(section, `${command} is undocumented`);
      for (const field of contract.input.requiredFields) {
        assert.ok(section.includes(`\`${field}\``), `${command} omits ${field}`);
      }
    }
  });

  it("keeps application recipes optional and limited to registered commands", async () => {
    const registered = new Set(commandSpecs.map((spec) => spec.path.join(" ")));
    for (const file of applicationReferences) {
      const content = await readFile(
        join(manageSkillDir, "references", "applications", file),
        "utf8",
      );
      assert.match(content, /not a `teamops` command/);
      assert.match(content, /batch/i);
      assert.match(content, /confirm/i);
      assert.match(content, /fail/i);
      assert.match(content, /final fact source/i);
      const commands = [...content.matchAll(/^- CLI: `([^`]+)`$/gm)].map(
        (match) => match[1] ?? "",
      );
      assert.ok(commands.length > 0, `${file} has no registered command markers`);
      for (const command of commands) {
        assert.ok(registered.has(command), `${file} invents ${command}`);
      }
      assert.equal(commands.includes("team info"), false);
    }

    const gameRecording = await readFile(
      join(manageSkillDir, "references", "applications", "game-recording.md"),
      "utf8",
    );
    assert.match(gameRecording, /`game event validate`/);
    assert.match(gameRecording, /`game analysis generate`/);
    assert.match(gameRecording, /`game analysis read`/);
    assert.match(gameRecording, /write confirmation/);
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
    assert.match(content, /`balanced=1200\/2000\/200`/);
    assert.match(content, /recommendedStrategy/);
    assert.match(content, /not automatic blockers/);
    assert.match(content, /raw situation/);
    assert.match(content, /if \.\.\. then \.\.\./);
    assert.match(content, /insufficient_evidence/);
    assert.doesNotMatch(content, /expectedContentHash|caseFacts|assumptions|unknownFacts|answer\.readiness/);
    assert.doesNotMatch(content, /about 507 chunks/);
    assert.match(content, /runtime\/\.env\.local/);
    assert.match(content, /EMBEDDING_URL=https:\/\/api\.siliconflow\.cn\/v1\/embeddings/);
    assert.match(content, /EMBEDDING_MODEL=Qwen\/Qwen3-Embedding-8B/);
    assert.match(content, /EMBEDDING_DIMENSION=4096/);
    assert.match(content, /EMBEDDING_BATCH_SIZE=10/);
    assert.match(content, /Invalid token/);
    assert.match(content, /baseball-rules\.zvec\/LOCK/);
  });
});
