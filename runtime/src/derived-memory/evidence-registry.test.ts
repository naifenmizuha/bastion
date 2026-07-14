import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DerivedMemoryEvidenceRegistry } from "./evidence-registry.ts";
import { sourceSnapshot } from "./freshness.ts";

describe("derived memory evidence registry", () => {
  it("resolves exact successful TeamOps reads and rejects duplicates or unknown commands", () => {
    const registry = new DerivedMemoryEvidenceRegistry();
    registry.registerTeamOpsRead(
      { args: ["game", "read", "--id", "1"] },
      {
        kind: "teamops",
        ok: true,
        risk: "read",
        command: ["game", "read", "--id", "1"],
        freshness: sourceSnapshot([{ sourceKey: "game:1", updatedAt: "v1" }]),
      },
      10,
    );
    registry.registerTeamOpsRead(
      { args: ["game", "analysis", "read", "--game-id", "1"] },
      {
        kind: "teamops",
        ok: true,
        risk: "read",
        command: ["game", "analysis", "read", "--game-id", "1"],
        freshness: sourceSnapshot([{ sourceKey: "game_analysis:1", updatedAt: "v1" }]),
      },
      11,
    );

    assert.equal(
      registry.resolveTeamOpsDependencies([
        { args: ["game", "read", "--id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "1"] },
      ]).length,
      2,
    );
    assert.throws(
      () => registry.resolveTeamOpsDependencies([
        { args: ["game", "read", "--id", "1"] },
        { args: ["game", "read", "--id", "1"] },
      ]),
      /DUPLICATE_DEPENDENCY/,
    );
    assert.throws(
      () => registry.resolveTeamOpsDependencies([
        { args: ["game", "read", "--id", "2"] },
      ]),
      /UNOBSERVED_DEPENDENCY/,
    );
  });

  it("ignores failed, non-read, or snapshot-less results and clears at session end", () => {
    const registry = new DerivedMemoryEvidenceRegistry();
    const params = { args: ["game", "read", "--id", "1"] };
    registry.registerTeamOpsRead(params, {
      kind: "teamops",
      ok: false,
      risk: "read",
      command: params.args,
    });
    registry.registerTeamOpsRead(params, {
      kind: "teamops",
      ok: true,
      risk: "write",
      command: params.args,
    });
    registry.registerTeamOpsRead(params, {
      kind: "teamops",
      ok: true,
      risk: "read",
      command: params.args,
    });
    assert.throws(
      () => registry.resolveTeamOpsDependencies([params]),
      /UNOBSERVED_DEPENDENCY/,
    );

    registry.registerTeamOpsRead(params, {
      kind: "teamops",
      ok: true,
      risk: "read",
      command: params.args,
      freshness: sourceSnapshot([{ sourceKey: "game:1", updatedAt: "v1" }]),
    });
    assert.equal(registry.resolveTeamOpsDependencies([params]).length, 1);
    registry.clear();
    assert.throws(
      () => registry.resolveTeamOpsDependencies([params]),
      /UNOBSERVED_DEPENDENCY/,
    );
  });
});
