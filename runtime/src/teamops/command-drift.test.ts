import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { commandSpecs } from "./command-policy.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const executable = join(repoRoot, "out", "teamops");

describe("CLI command registry drift", () => {
  it("keeps CLI-owned contracts aligned with every structured command", () => {
    const result = spawnSync(
      executable,
      ["--format", "json", "contract"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const envelope = JSON.parse(result.stdout) as {
      ok: boolean;
      data: {
        commands: Array<{
          command: string[];
          input: {
            requiredFields: string[];
            properties: Record<string, unknown>;
          };
        }>;
      };
    };
    assert.equal(envelope.ok, true);

    const actual = new Map(
      envelope.data.commands.map((contract) => [
        contract.command.join(" "),
        contract,
      ]),
    );
    const expected = commandSpecs.filter(
      (spec) => spec.input === "required",
    );
    assert.deepEqual(
      [...actual.keys()].sort(),
      expected.map((spec) => spec.path.join(" ")).sort(),
    );
    for (const spec of expected) {
      const contract = actual.get(spec.path.join(" "));
      assert.ok(contract);
      for (const field of contract.input.requiredFields) {
        assert.ok(
          field in contract.input.properties,
          `${spec.path.join(" ")} is missing property ${field}`,
        );
      }
    }
  });

  it("keeps every registered command path and flag in the Go CLI", () => {
    for (const spec of commandSpecs) {
      const result = spawnSync(executable, [...spec.path, "--help"], {
        encoding: "utf8",
      });
      assert.equal(
        result.status,
        0,
        `${spec.path.join(" ")} is missing:\n${result.stderr}`,
      );
      const help = `${result.stdout}\n${result.stderr}`;
      for (const flag of Object.keys(spec.flags)) {
        assert.match(
          help,
          new RegExp(flag.replaceAll("-", "\\-")),
          `${spec.path.join(" ")} no longer exposes ${flag}`,
        );
      }
      if (spec.input === "required") {
        assert.match(
          help,
          /--input/,
          `${spec.path.join(" ")} no longer accepts structured input`,
        );
      }
    }
  });
});
