import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BastionCliService, type BastionCliRunner } from "./service.ts";
import { BastionCliError } from "./errors.ts";
import type { CommandInputContract, ProcessResult } from "./types.ts";

function success(data: unknown): ProcessResult {
  return {
    envelope: { ok: true, data },
    exitCode: 0,
    stderr: "",
  };
}

describe("BastionCliService", () => {
  it("returns the matching command contract for invalid structured input without execution or approval", async () => {
    let runs = 0;
    let confirmations = 0;
    const contract: CommandInputContract = {
      command: ["player", "add"],
      input: {
        required: true,
        type: "object",
        additionalProperties: false,
        requiredFields: ["name", "number", "bat", "throw", "positions"],
        properties: {
          name: { type: "string" },
          number: { type: "integer" },
          bat: { type: "string" },
          throw: { type: "string" },
          positions: { type: "string" },
        },
        example: {
          name: "张三",
          number: 18,
          bat: "right",
          throw: "right",
          positions: "pitcher",
        },
      },
    };
    const runner: BastionCliRunner = {
      async run() {
        runs += 1;
        return success({});
      },
      async inputContract() {
        return contract;
      },
    };

    await assert.rejects(
      new BastionCliService(runner).execute(
        { args: ["player", "add"] },
        {
          confirmWrite: async () => {
            confirmations += 1;
            return true;
          },
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof BastionCliError);
        assert.equal(error.code, "INVALID_INPUT");
        assert.deepEqual(error.details, {
          reason: "MISSING_INPUT",
          contract,
        });
        return true;
      },
    );
    assert.equal(runs, 0);
    assert.equal(confirmations, 0);
  });

  it("requires and respects write approval before execution", async () => {
    let calls = 0;
    const runner: BastionCliRunner = {
      async run() {
        calls += 1;
        return success({});
      },
    };
    const service = new BastionCliService(runner);

    await assert.rejects(
      service.execute({
        args: ["player", "add"],
        input: {
          name: "张三",
          number: 1,
          bat: "right",
          throw: "right",
          positions: "pitcher",
        },
      }),
      /interactive confirmation/,
    );
    const cancelled = await service.execute(
      {
        args: ["player", "add"],
        input: {
          name: "张三",
          number: 1,
          bat: "right",
          throw: "right",
          positions: "pitcher",
        },
      },
      { confirmWrite: async () => false },
    );
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.approved, false);
    assert.equal(cancelled.error?.code, "USER_CANCELLED");
    assert.equal(calls, 0);
  });

  it("preflights game events before approval and returns compact issues", async () => {
    let confirmations = 0;
    let calls = 0;
    const runner: BastionCliRunner = {
      async run(args) {
        calls += 1;
        assert.deepEqual(args, ["game", "event", "validate"]);
        return success({
          valid: false,
          issues: [
            {
              eventIndex: 0,
              field: "pitch_sequence",
              code: "missing_required",
              expected: "reported pitch sequence",
            },
          ],
        });
      },
    };
    const details = await new BastionCliService(runner).execute(
      {
        args: ["game", "event", "write"],
        input: { game_id: 1, events: [{}] },
      },
      {
        confirmWrite: async () => {
          confirmations += 1;
          return true;
        },
      },
    );
    assert.equal(details.ok, false);
    assert.equal(details.error?.code, "INVALID_INPUT");
    assert.deepEqual(details.error?.details, {
      issues: [
        {
          eventIndex: 0,
          field: "pitch_sequence",
          code: "missing_required",
          expected: "reported pitch sequence",
        },
      ],
    });
    assert.equal(calls, 1);
    assert.equal(confirmations, 0);
  });

  it("preflights game events inside batch writes before approval", async () => {
    let confirmations = 0;
    let calls = 0;
    const runner: BastionCliRunner = {
      async run(args) {
        calls += 1;
        assert.deepEqual(args, ["game", "event", "validate"]);
        return success({
          valid: false,
          issues: [{ eventIndex: 0, field: "player", code: "missing_required" }],
        });
      },
    };
    const details = await new BastionCliService(runner).execute(
      {
        args: ["batch", "write"],
        input: {
          operations: [
            {
              args: ["game", "event", "write"],
              input: { game_id: 1, events: [{}] },
            },
          ],
        },
      },
      {
        confirmWrite: async () => {
          confirmations += 1;
          return true;
        },
      },
    );
    assert.equal(details.ok, false);
    assert.equal(details.error?.code, "INVALID_INPUT");
    assert.deepEqual(details.error?.details, {
      index: 0,
      issues: [{ eventIndex: 0, field: "player", code: "missing_required" }],
    });
    assert.equal(calls, 1);
    assert.equal(confirmations, 0);
  });

  it("does not confirm derived analysis and verifies it", async () => {
    const calls: string[][] = [];
    const runner: BastionCliRunner = {
      async run(args) {
        calls.push(args);
        return calls.length === 1
          ? success({ resource: "game_analysis", id: 2, game_id: 7 })
          : success({ analysis: { game_id: 7 } });
      },
    };
    const service = new BastionCliService(runner);
    const details = await service.execute({
      args: ["game", "analysis", "generate"],
      input: { game_id: 7 },
    });
    assert.equal(details.ok, true);
    assert.deepEqual(calls[1], [
      "game",
      "analysis",
      "read",
      "--game-id",
      "7",
    ]);
  });

  it("marks a successful write as uncertain when verification mismatches", async () => {
    let calls = 0;
    const runner: BastionCliRunner = {
      async run() {
        calls += 1;
        return calls === 1
          ? success({ resource: "player", name: "张三" })
          : success({ player: { name: "李四" } });
      },
    };
    const details = await new BastionCliService(runner).execute(
      {
        args: ["player", "add"],
        input: {
          name: "张三",
          number: 1,
          bat: "right",
          throw: "right",
          positions: "pitcher",
        },
      },
      { confirmWrite: async () => true },
    );
    assert.equal(details.ok, false);
    assert.equal(details.error?.code, "WRITE_VERIFICATION_FAILED");
    assert.equal(details.verification?.[0]?.matched, false);
  });

  it("verifies every write inside a successful batch write", async () => {
    const calls: string[][] = [];
    const runner: BastionCliRunner = {
      async run(args) {
        calls.push(args);
        if (calls.length === 1) {
          return success({
            resource: "batch",
            mode: "write",
            count: 2,
            operations: [
              {
                index: 0,
                args: ["player", "add"],
                ok: true,
                data: { resource: "player", name: "张三" },
              },
              {
                index: 1,
                args: ["report", "write"],
                ok: true,
                data: { resource: "report", name: "张三", date: "2026-07-01" },
              },
            ],
          });
        }
        if (calls.length === 2) return success({ player: { name: "张三" } });
        return success({ report: { name: "张三", date: "2026-07-01" } });
      },
    };

    const details = await new BastionCliService(runner).execute(
      {
        args: ["batch", "write"],
        input: {
          operations: [
            {
              args: ["player", "add"],
              input: {
                name: "张三",
                number: 18,
                bat: "right",
                throw: "right",
                positions: "pitcher",
              },
            },
            {
              args: ["report", "write"],
              input: {
                name: "张三",
                date: "2026-07-01",
                content: "打击训练",
                reflection: "稳定",
              },
            },
          ],
        },
      },
      { confirmWrite: async () => true },
    );

    assert.equal(details.ok, true);
    assert.deepEqual(calls, [
      ["batch", "write"],
      ["player", "read", "--name", "张三"],
      ["report", "read", "--name", "张三", "--date", "2026-07-01"],
    ]);
    assert.equal(details.verification?.length, 2);
  });
});
