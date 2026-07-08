import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commandSpecs, parseCommand } from "./command-policy.ts";

function validParamsFor(spec: (typeof commandSpecs)[number]) {
  const args = [...spec.path];
  for (const [name, flag] of Object.entries(spec.flags)) {
    if (flag.required) args.push(name, "1");
  }
  return {
    args,
    ...(spec.input === "required" ? { input: {} } : {}),
  };
}

describe("command policy", () => {
  it("registers and accepts every current CLI command", () => {
    assert.equal(commandSpecs.length, 31);
    for (const spec of commandSpecs) {
      const parsed = parseCommand(validParamsFor(spec));
      assert.equal(parsed.spec, spec);
    }
  });

  it("accepts registered optional flags", () => {
    const parsed = parseCommand({
      args: [
        "drill",
        "recommend",
        "list",
        "--name",
        "张三",
        "--status",
        "pending",
      ],
    });
    assert.equal(parsed.flags.get("--name"), "张三");
    assert.equal(parsed.flags.get("--status"), "pending");
  });

  it("rejects unknown commands and global protocol flags", () => {
    assert.throws(
      () => parseCommand({ args: ["report", "list"] }),
      /not registered/,
    );
    assert.throws(
      () =>
        parseCommand({
          args: ["player", "list", "--db", "/tmp/other.db"],
        }),
      /not allowed/,
    );
    assert.throws(
      () =>
        parseCommand({
          args: ["player", "list", "--format", "text"],
        }),
      /not allowed/,
    );
    assert.throws(
      () =>
        parseCommand({
          args: ["player", "add", "--input", "/tmp/player.json"],
          input: {},
        }),
      /not allowed/,
    );
  });

  it("rejects missing, duplicate, and malformed flags", () => {
    assert.throws(
      () => parseCommand({ args: ["player", "read"] }),
      /missing required flag/,
    );
    assert.throws(
      () =>
        parseCommand({
          args: [
            "player",
            "read",
            "--name",
            "张三",
            "--name",
            "李四",
          ],
        }),
      /duplicate flag/,
    );
    assert.throws(
      () => parseCommand({ args: ["player", "read", "--name"] }),
      /requires a value/,
    );
    assert.throws(
      () =>
        parseCommand({
          args: ["player", "read", "--name", "--db"],
        }),
      /requires a value/,
    );
  });

  it("enforces structured input boundaries", () => {
    assert.throws(
      () => parseCommand({ args: ["report", "write"] }),
      /requires input/,
    );
    assert.throws(
      () => parseCommand({ args: ["report", "write"], input: [] }),
      /JSON object/,
    );
    assert.throws(
      () => parseCommand({ args: ["player", "list"], input: {} }),
      /does not accept input/,
    );
  });
});
