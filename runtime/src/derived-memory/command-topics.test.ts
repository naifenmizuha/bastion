import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commandSpecs } from "../bastion-cli/command-policy.ts";
import {
  readDependencyTopics,
  writeChangeTopics,
} from "./command-topics.ts";

describe("derived memory command topics", () => {
  it("maps every registered read to at least one dependency topic", () => {
    for (const spec of commandSpecs.filter((candidate) => candidate.risk === "read")) {
      assert.notEqual(
        readDependencyTopics(spec.path).length,
        0,
        `missing read topics for ${spec.path.join(" ")}`,
      );
    }
  });

  it("maps every registered write or compute-write to change topics", () => {
    for (const spec of commandSpecs.filter((candidate) => candidate.risk !== "read")) {
      assert.notEqual(
        writeChangeTopics(spec.path).length,
        0,
        `missing write topics for ${spec.path.join(" ")}`,
      );
    }
  });

  it("declares cross-domain dependencies for aggregate analyses", () => {
    assert.deepEqual(
      readDependencyTopics(["person", "analysis", "read"]),
      ["player", "report", "game", "game_analysis"],
    );
    assert.deepEqual(
      writeChangeTopics(["game", "event", "write"]),
      ["game", "game_analysis"],
    );
  });
});
