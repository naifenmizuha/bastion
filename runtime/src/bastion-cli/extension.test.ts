import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BastionCliParameters,
  createBastionCliExtension,
  modelContent,
  prepareBastionCliArguments,
} from "./extension.ts";
import type { CommandInputContract } from "./types.ts";

describe("bastion_cli model content", () => {
  it("advertises input as an object and decodes provider JSON strings before validation", () => {
    const properties = (
      BastionCliParameters as unknown as {
        properties: Record<string, Record<string, unknown>>;
      }
    ).properties;
    assert.equal(properties.input?.type, "object");

    const prepared = prepareBastionCliArguments({
      args: ["player", "add"],
      input:
        '{"name":"张三","number":18,"bat":"right","throw":"right","positions":"pitcher"}',
    });
    assert.deepEqual(prepared, {
      args: ["player", "add"],
      input: {
        name: "张三",
        number: 18,
        bat: "right",
        throw: "right",
        positions: "pitcher",
      },
    });
  });

  it("reports completed tool results to lifecycle hooks", () => {
    let handler: ((event: Record<string, unknown>) => unknown) | undefined;
    let observed: Record<string, unknown> | undefined;
    createBastionCliExtension(
      {
        executablePath: "/unused",
        databasePath: "/unused",
        timeoutMs: 1_000,
      },
      {
        onResult: (event) => {
          observed = event;
        },
      },
    )({
      registerTool() {},
      on(event: string, value: typeof handler) {
        assert.equal(event, "tool_result");
        handler = value;
      },
    } as never);
    assert.ok(handler);
    handler({
      toolName: "bastion_cli",
      toolCallId: "read-1",
      input: { args: ["game", "read", "--id", "1"] },
      details: {
        kind: "bastion_cli",
        ok: true,
        risk: "read",
        command: ["game", "read", "--id", "1"],
      },
    });

    assert.deepEqual(observed, {
      toolCallId: "read-1",
      params: { args: ["game", "read", "--id", "1"] },
      details: {
        kind: "bastion_cli",
        ok: true,
        risk: "read",
        command: ["game", "read", "--id", "1"],
      },
    });
  });

  it("does not reinterpret malformed JSON strings or JSON primitives as objects", () => {
    assert.equal(
      prepareBastionCliArguments({
        args: ["player", "add"],
        input: "not json",
      }).input,
      "not json",
    );
    assert.equal(
      prepareBastionCliArguments({
        args: ["player", "add"],
        input: '"text"',
      }).input,
      '"text"',
    );
  });

  it("preserves command contracts in error details", () => {
    const contract: CommandInputContract = {
      command: ["game", "analysis", "generate"],
      input: {
        required: true,
        type: "object",
        additionalProperties: false,
        requiredFields: ["game_id"],
        properties: { game_id: { type: "integer", minimum: 1 } },
        example: { game_id: 1 },
      },
    };
    const content = JSON.parse(
      modelContent({
        kind: "bastion_cli",
        ok: false,
        command: ["game", "analysis", "generate"],
        error: {
          code: "INVALID_INPUT",
          message:
            "game analysis generate requires input to be a JSON object",
          details: {
            reason: "MISSING_INPUT",
            contract,
          },
        },
      }),
    ) as Record<string, unknown>;

    assert.deepEqual(content.error, {
      code: "INVALID_INPUT",
      message:
        "game analysis generate requires input to be a JSON object",
      details: {
        reason: "MISSING_INPUT",
        contract,
      },
    });
  });

  it("keeps verification evidence compact in model-visible content", () => {
    const fullReadback = {
      ok: true as const,
      data: {
        game: { id: 1, own_score: 2, opponent_score: 1 },
        events: [{ description: "large sensitive event payload" }],
        lineups: [{ player: "张三" }],
      },
    };
    const details = {
      kind: "bastion_cli" as const,
      ok: true,
      command: ["game", "score", "set"],
      risk: "write" as const,
      result: {
        envelope: {
          ok: true as const,
          data: { game_id: 1, own_score: 2, opponent_score: 1 },
        },
        exitCode: 0,
        stderr: "",
      },
      verification: [
        {
          args: ["game", "read", "--id", "1"],
          expected: { own_score: 2, opponent_score: 1 },
          matched: true,
          envelope: fullReadback,
          exitCode: 0,
          stderr: "",
        },
      ],
    };

    const content = JSON.parse(modelContent(details)) as {
      cli: unknown;
      verification: Array<Record<string, unknown>>;
    };
    assert.deepEqual(content.cli, details.result.envelope);
    assert.deepEqual(content.verification, [
      {
        command: ["game", "read", "--id", "1"],
        ok: true,
        matched: true,
        expected: { own_score: 2, opponent_score: 1 },
      },
    ]);
    assert.doesNotMatch(
      JSON.stringify(content.verification),
      /large sensitive event payload|lineups|result/,
    );
    assert.deepEqual(details.verification[0]?.envelope, fullReadback);
  });

  it("preserves compact mismatch evidence and uncertainty errors", () => {
    const content = JSON.parse(
      modelContent({
        kind: "bastion_cli",
        ok: false,
        command: ["game", "score", "set"],
        risk: "write",
        result: {
          envelope: {
            ok: true,
            data: { game_id: 1, own_score: 2, opponent_score: 1 },
          },
          exitCode: 0,
          stderr: "",
        },
        verification: [
          {
            args: ["game", "read", "--id", "1"],
            expected: { own_score: 2, opponent_score: 1 },
            matched: false,
            envelope: {
              ok: true,
              data: {
                game: { id: 1, own_score: 0, opponent_score: 0 },
                events: [{ description: "must not reach the model" }],
              },
            },
            exitCode: 0,
            stderr: "",
          },
        ],
        error: {
          code: "WRITE_VERIFICATION_FAILED",
          message:
            "The write returned success, but authoritative read-back verification failed; the write may have taken effect",
        },
      }),
    ) as Record<string, unknown>;

    assert.deepEqual(content.verification, [
      {
        command: ["game", "read", "--id", "1"],
        ok: true,
        matched: false,
        expected: { own_score: 2, opponent_score: 1 },
      },
    ]);
    assert.deepEqual(content.error, {
      code: "WRITE_VERIFICATION_FAILED",
      message:
        "The write returned success, but authoritative read-back verification failed; the write may have taken effect",
    });
    assert.doesNotMatch(JSON.stringify(content), /must not reach the model/);
  });

  it("exposes cancelled approval without CLI payload noise", () => {
    const content = JSON.parse(
      modelContent({
        kind: "bastion_cli",
        ok: false,
        command: ["report", "write"],
        risk: "write",
        approved: false,
        error: {
          code: "USER_CANCELLED",
          message: "The user cancelled the Bastion write",
        },
      }),
    ) as Record<string, unknown>;
    assert.equal(content.approved, false);
    assert.equal((content.error as { code: string }).code, "USER_CANCELLED");
  });
});
