import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { BastionCliExecutor } from "./executor.ts";
import { BastionCliService } from "./service.ts";
import { commandSpecs } from "./command-policy.ts";
import { BastionCliError } from "./errors.ts";
import { prepareBastionCliArguments } from "./extension.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const executable = join(repoRoot, "out", "bastion");
let tempDir: string;
let databasePath: string;

before(async () => {
  await access(executable);
  tempDir = await mkdtemp(join(tmpdir(), "bastion-cli-integration-"));
  databasePath = join(tempDir, "bastion.db");
});

after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("bastion_cli integration", () => {
  it("returns the matching CLI-owned contract for every structured command", async () => {
    const service = new BastionCliService(
      new BastionCliExecutor({
        executablePath: executable,
        databasePath,
        timeoutMs: 10_000,
      }),
    );
    for (const spec of commandSpecs.filter(
      (candidate) => candidate.input === "required",
    )) {
      await assert.rejects(
        service.execute({ args: [...spec.path] }),
        (error: unknown) => {
          assert.ok(error instanceof BastionCliError);
          assert.equal(error.code, "INVALID_INPUT");
          const details = error.details as {
            reason?: string;
            contract?: { command?: string[] };
          };
          assert.equal(details.reason, "MISSING_INPUT");
          assert.deepEqual(details.contract?.command, spec.path);
          return true;
        },
      );
    }
  });

  it("decodes provider-stringified input and completes the CLI write/read-back path", async () => {
    const service = new BastionCliService(
      new BastionCliExecutor({
        executablePath: executable,
        databasePath,
        timeoutMs: 10_000,
      }),
    );
    const params = prepareBastionCliArguments({
      args: ["player", "add"],
      input:
        '{"name":"线缆测试","number":99,"bat":"right","throw":"right","positions":"pitcher"}',
    });
    const result = await service.execute(params, {
      confirmWrite: async () => true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.verification?.[0]?.matched, true);
  });

  it("executes confirmed writes, cancellation, validation, and derived analysis", async () => {
    const service = new BastionCliService(
      new BastionCliExecutor({
        executablePath: executable,
        databasePath,
        timeoutMs: 10_000,
      }),
    );
    let confirmations = 0;
    const approve = async () => {
      confirmations += 1;
      return true;
    };

    const player = await service.execute(
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
      { confirmWrite: approve },
    );
    assert.equal(player.ok, true);
    assert.equal(player.verification?.[0]?.matched, true);

    const report = await service.execute(
      {
        args: ["report", "write"],
        input: {
          name: "张三",
          date: "2026-06-30",
          content: "打击训练 100 球",
          reflection: "外角球仍需加强",
        },
      },
      { confirmWrite: approve },
    );
    assert.equal(report.ok, true);

    const drill = await service.execute(
      {
        args: ["drill", "recommend", "write"],
        input: {
          name: "张三",
          url: "https://example.com/drill/1",
          reason: "改善投球动作",
          type: "pitching",
          summary: "投球发力链训练",
        },
      },
      { confirmWrite: approve },
    );
    assert.equal(drill.ok, true);
    const drillEnvelope = drill.result?.envelope;
    const drillId =
      drillEnvelope?.ok &&
      typeof drillEnvelope.data === "object" &&
      drillEnvelope.data !== null
        ? (drillEnvelope.data as { id: number }).id
        : 0;
    assert.ok(drillId > 0);

    const approvedDrill = await service.execute(
      {
        args: [
          "drill",
          "review",
          "approve",
          "--recommendation-id",
          String(drillId),
          "--coach",
          "王教练",
          "--summary",
          "适合当前阶段",
          "--note",
          "下次训练采用",
        ],
      },
      { confirmWrite: approve },
    );
    assert.equal(approvedDrill.ok, true);
    assert.equal(approvedDrill.verification?.length, 2);

    await assert.rejects(
      service.execute(
        {
          args: ["player", "add"],
          input: {
            name: "李四",
            number: 2,
            bat: "left",
            throw: "right",
            positions: "outfield",
          },
        },
        { confirmWrite: async () => false },
      ),
      /cancelled/,
    );
    const roster = await service.execute({ args: ["player", "list"] });
    assert.equal(
      JSON.stringify(roster.result?.envelope).includes("李四"),
      false,
    );

    let unexpectedConfirmation = false;
    const invalidLineup = await service.execute(
      {
        args: ["lineup", "validate"],
        input: { schema_version: "1.0", game_id: 999, starters: [] },
      },
      {
        confirmWrite: async () => {
          unexpectedConfirmation = true;
          return true;
        },
      },
    );
    assert.equal(unexpectedConfirmation, false);
    assert.equal(invalidLineup.ok, true);
    const validationEnvelope = invalidLineup.result?.envelope;
    assert.equal(validationEnvelope?.ok, true);
    if (validationEnvelope?.ok) {
      assert.equal(
        (validationEnvelope.data as { valid?: boolean }).valid,
        false,
      );
    }

    const game = await service.execute(
      {
        args: ["game", "write"],
        input: {
          date: "2026-06-30",
          start_time: "19:00",
          opponent: "海港队",
          batting_side: "top",
          own_score: 1,
          opponent_score: 0,
          raw: "分析测试比赛",
          lineups: [
            {
              team: "own",
              player: "张三",
              batting_order: 1,
              starting_position: "P",
            },
          ],
          events: [
            {
              inning: 1,
              half: "bottom",
              play_no: 1,
              sequence: 1,
              event_kind: "plate_result",
              player: "对手甲",
              team: "opponent",
              result: "strikeout",
              related_player: "张三",
              pitch_sequence: "S,S,S",
              outs_on_play: 1,
              description: "张三三振对手",
            },
          ],
        },
      },
      { confirmWrite: approve },
    );
    assert.equal(game.ok, true);
    const gameEnvelope = game.result?.envelope;
    assert.equal(gameEnvelope?.ok, true);
    const gameId =
      gameEnvelope?.ok &&
      typeof gameEnvelope.data === "object" &&
      gameEnvelope.data !== null
        ? (gameEnvelope.data as { id: number }).id
        : 0;
    assert.ok(gameId > 0);

    const invalidSavedLineup = await service.execute(
      {
        args: ["lineup", "write"],
        input: {
          schema_version: "1.0",
          game_id: gameId,
          starters: [],
        },
      },
      { confirmWrite: approve },
    );
    assert.equal(invalidSavedLineup.ok, true);
    assert.equal(invalidSavedLineup.verification, undefined);
    const invalidSavedEnvelope = invalidSavedLineup.result?.envelope;
    assert.equal(invalidSavedEnvelope?.ok, true);
    if (invalidSavedEnvelope?.ok) {
      assert.equal(
        (invalidSavedEnvelope.data as { valid?: boolean }).valid,
        false,
      );
    }

    const confirmationsBeforeAnalysis = confirmations;
    const analysis = await service.execute({
      args: ["game", "analysis", "generate"],
      input: { game_id: gameId },
    });
    assert.equal(analysis.ok, true);
    assert.equal(confirmations, confirmationsBeforeAnalysis);
  });
});
