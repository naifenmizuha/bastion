import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LocalChangeEventBus } from "./events.ts";
import { VerifiedReadLedger } from "./verified-read-ledger.ts";
import { sourceSnapshot } from "./freshness.ts";

describe("verified TeamOps read ledger", () => {
  it("resolves exact successful reads and rejects duplicates or unknown commands", () => {
    const verifiedReads = new VerifiedReadLedger();
    const events = new LocalChangeEventBus();
    verifiedReads.record(
      "read-1",
      { args: ["game", "read", "--id", "1"] },
      {
        kind: "teamops",
        ok: true,
        risk: "read",
        command: ["game", "read", "--id", "1"],
        freshness: sourceSnapshot([{ sourceKey: "game:1", updatedAt: "v1" }]),
      },
      events,
      10,
    );
    verifiedReads.record(
      "read-2",
      { args: ["game", "analysis", "read", "--game-id", "1"] },
      {
        kind: "teamops",
        ok: true,
        risk: "read",
        command: ["game", "analysis", "read", "--game-id", "1"],
        freshness: sourceSnapshot([{ sourceKey: "game_analysis:1", updatedAt: "v1" }]),
      },
      events,
      11,
    );

    assert.equal(
      verifiedReads.resolveDependencies([
        { args: ["game", "read", "--id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "1"] },
      ]).length,
      2,
    );
    assert.throws(
      () =>
        verifiedReads.resolveDependencies([
          { args: ["game", "read", "--id", "1"] },
          { args: ["game", "read", "--id", "1"] },
        ]),
      /DUPLICATE_DEPENDENCY/,
    );
    assert.throws(
      () =>
        verifiedReads.resolveDependencies([
          { args: ["game", "read", "--id", "2"] },
        ]),
      /UNOBSERVED_DEPENDENCY/,
    );
  });

  it("publishes domain changes only for successful writes", () => {
    const verifiedReads = new VerifiedReadLedger();
    const events = new LocalChangeEventBus();
    const received: string[][] = [];
    events.subscribe((event) => received.push(event.topics));

    verifiedReads.record(
      "write-1",
      { args: ["game", "score", "set"], input: { game_id: 1 } },
      {
        kind: "teamops",
        ok: true,
        risk: "write",
        command: ["game", "score", "set"],
      },
      events,
      20,
    );
    verifiedReads.record(
      "write-2",
      { args: ["lineup", "accept", "--id", "2"] },
      {
        kind: "teamops",
        ok: false,
        risk: "write",
        command: ["lineup", "accept", "--id", "2"],
      },
      events,
      21,
    );

    assert.deepEqual(received, [["game", "game_analysis"]]);
  });
});
