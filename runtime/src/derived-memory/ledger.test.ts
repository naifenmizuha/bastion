import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LocalChangeEventBus } from "./events.ts";
import { CliObservationLedger } from "./ledger.ts";

describe("CLI observation ledger", () => {
  it("resolves exact successful reads and rejects duplicates or unknown commands", () => {
    const ledger = new CliObservationLedger();
    const events = new LocalChangeEventBus();
    ledger.record(
      "read-1",
      { args: ["game", "read", "--id", "1"] },
      {
        kind: "bastion_cli",
        ok: true,
        risk: "read",
        command: ["game", "read", "--id", "1"],
      },
      events,
      10,
    );
    ledger.record(
      "read-2",
      { args: ["game", "analysis", "read", "--game-id", "1"] },
      {
        kind: "bastion_cli",
        ok: true,
        risk: "read",
        command: ["game", "analysis", "read", "--game-id", "1"],
      },
      events,
      11,
    );

    assert.equal(
      ledger.resolveDependencies([
        { args: ["game", "read", "--id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "1"] },
      ]).length,
      2,
    );
    assert.throws(
      () =>
        ledger.resolveDependencies([
          { args: ["game", "read", "--id", "1"] },
          { args: ["game", "read", "--id", "1"] },
        ]),
      /DUPLICATE_DEPENDENCY/,
    );
    assert.throws(
      () =>
        ledger.resolveDependencies([
          { args: ["game", "read", "--id", "2"] },
        ]),
      /UNOBSERVED_DEPENDENCY/,
    );
  });

  it("publishes domain changes only for successful writes", () => {
    const ledger = new CliObservationLedger();
    const events = new LocalChangeEventBus();
    const received: string[][] = [];
    events.subscribe((event) => received.push(event.topics));

    ledger.record(
      "write-1",
      { args: ["game", "score", "set"], input: { game_id: 1 } },
      {
        kind: "bastion_cli",
        ok: true,
        risk: "write",
        command: ["game", "score", "set"],
      },
      events,
      20,
    );
    ledger.record(
      "write-2",
      { args: ["lineup", "accept", "--id", "2"] },
      {
        kind: "bastion_cli",
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
