import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LocalChangeEventBus } from "./events.ts";
import { publishTeamOpsChange } from "./teamops-change-events.ts";

describe("TeamOps derived-memory change events", () => {
  it("publishes changes for successful or possibly persisted writes", () => {
    const events = new LocalChangeEventBus();
    const received: string[][] = [];
    events.subscribe((event) => received.push(event.topics));

    publishTeamOpsChange(
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
    publishTeamOpsChange(
      "write-2",
      { args: ["game", "analysis", "generate"], input: { game_id: 1 } },
      {
        kind: "teamops",
        ok: true,
        risk: "compute_write",
        command: ["game", "analysis", "generate"],
      },
      events,
      21,
    );
    publishTeamOpsChange(
      "write-3",
      { args: ["lineup", "accept", "--id", "2"] },
      {
        kind: "teamops",
        ok: false,
        risk: "write",
        command: ["lineup", "accept", "--id", "2"],
        result: {
          envelope: { ok: true, data: { id: 2 } },
          exitCode: 0,
          stderr: "",
        },
      },
      events,
      22,
    );

    assert.deepEqual(received, [
      ["game", "game_analysis"],
      ["game_analysis"],
      ["lineup", "game"],
    ]);
  });

  it("ignores reads, cancellations, and explicit write failures", () => {
    const events = new LocalChangeEventBus();
    const received: string[][] = [];
    events.subscribe((event) => received.push(event.topics));

    publishTeamOpsChange(
      "read",
      { args: ["game", "read", "--id", "1"] },
      {
        kind: "teamops",
        ok: true,
        risk: "read",
        command: ["game", "read", "--id", "1"],
      },
      events,
    );
    publishTeamOpsChange(
      "cancelled",
      { args: ["report", "write"], input: { name: "Cancelled" } },
      {
        kind: "teamops",
        ok: false,
        risk: "write",
        command: ["report", "write"],
      },
      events,
    );
    publishTeamOpsChange(
      "failed",
      { args: ["player", "add"], input: { name: "Failed" } },
      {
        kind: "teamops",
        ok: false,
        risk: "write",
        command: ["player", "add"],
        result: {
          envelope: { ok: false, error: { code: "FAILED", message: "failed" } },
          exitCode: 1,
          stderr: "",
        },
      },
      events,
    );

    assert.deepEqual(received, []);
  });
});
