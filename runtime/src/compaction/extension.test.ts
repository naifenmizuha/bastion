import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBastionCompactionExtension } from "./extension.ts";
import type { NarrativeSummarizer } from "./narrative.ts";
import type { BastionNarrativeState } from "./types.ts";

const narrative: BastionNarrativeState = {
  goals: ["Manage game 12"],
  constraints: [],
  decisions: [],
  completed: [],
  inProgress: ["Resolve score"],
  blocked: [],
  nextSteps: ["Read game 12"],
};

function setup(
  summarize: NarrativeSummarizer,
  onProviderPayload?: NonNullable<
    Parameters<typeof createBastionCompactionExtension>[0]
  >["onProviderPayload"],
) {
  const handlers = new Map<
    string,
    (event: any, context: any) => unknown | Promise<unknown>
  >();
  const factory = createBastionCompactionExtension({
    summarize,
    now: () => 100,
    onProviderPayload,
  });
  factory({
    on(event: string, handler: (event: any, context: any) => unknown) {
      handlers.set(event, handler);
    },
  } as never);
  return handlers;
}

function event() {
  return {
    preparation: {
      messagesToSummarize: [
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "write-1",
              name: "teamops",
              arguments: {
                args: ["game", "score", "set"],
                input: {
                  game_id: 12,
                  own_score: 5,
                  opponent_score: 3,
                },
              },
            },
          ],
          timestamp: 1,
        },
        {
          role: "toolResult",
          toolCallId: "write-1",
          toolName: "teamops",
          content: [{ type: "text", text: "{}" }],
          details: {
            kind: "teamops",
            ok: false,
            command: ["game", "score", "set"],
            risk: "write",
            error: {
              code: "WRITE_VERIFICATION_FAILED",
              message: "verification failed",
            },
            verification: [
              {
                args: ["game", "read", "--id", "12"],
                expected: { id: 12 },
                matched: false,
                envelope: {
                  ok: false,
                  error: { code: "not_found", message: "not found" },
                },
                exitCode: 1,
                stderr: "",
              },
            ],
          },
          isError: true,
          timestamp: 2,
        },
      ],
      turnPrefixMessages: [],
      firstKeptEntryId: "keep-1",
      tokensBefore: 50_000,
      previousSummary: "Legacy Pi summary",
      fileOps: {
        read: new Set<string>(),
        written: new Set<string>(),
        edited: new Set<string>(),
      },
    },
    branchEntries: [],
    reason: "threshold",
    willRetry: false,
    signal: new AbortController().signal,
  };
}

function context(notifications: string[]) {
  return {
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
    },
    sessionManager: {
      getBranch: () => [],
    },
  };
}

describe("Bastion compaction extension", () => {
  it("returns a custom Pi compaction with deterministic safety details", async () => {
    const handlers = setup(async () => narrative);
    const result = (await handlers.get("session_before_compact")!(
      event(),
      context([]),
    )) as {
      compaction: {
        summary: string;
        firstKeptEntryId: string;
        tokensBefore: number;
        details: {
          kind: string;
          operations: Array<{ outcome: string }>;
        };
      };
    };

    assert.equal(result.compaction.firstKeptEntryId, "keep-1");
    assert.equal(result.compaction.tokensBefore, 50_000);
    assert.equal(result.compaction.details.kind, "bastion-compaction");
    assert.equal(result.compaction.details.operations[0]?.outcome, "uncertain");
    assert.match(result.compaction.summary, /Uncertain Writes/);
    assert.match(result.compaction.summary, /game read --id 12/);
  });

  it("uses an emergency checkpoint when narrative summarization fails", async () => {
    const handlers = setup(async () => {
      throw new Error("provider unavailable");
    });
    const notifications: string[] = [];
    const result = (await handlers.get("session_before_compact")!(
      event(),
      context(notifications),
    )) as {
      compaction: {
        details: {
          diagnostics: { fallbackUsed: boolean; warnings: string[] };
        };
      };
    };

    assert.equal(result.compaction.details.diagnostics.fallbackUsed, true);
    assert.match(
      result.compaction.details.diagnostics.warnings.join("\n"),
      /NARRATIVE_FALLBACK:provider unavailable/,
    );
    assert.match(
      result.compaction.details.diagnostics.warnings.join("\n"),
      /LEGACY_SUMMARY_MIGRATED/,
    );
    assert.equal(notifications.length, 1);
  });

  it("passes the compaction provider payload observer to the summarizer", async () => {
    const payloads: unknown[] = [];
    const contexts: unknown[] = [];
    const model = { provider: "test", id: "summary-model" };
    const ctx = context([]);
    const handlers = setup(
      async (request) => {
        await request.onProviderPayload?.({ prompt: "serialized" }, model as never);
        return narrative;
      },
      (payload, observedModel, observedContext) => {
        payloads.push(payload);
        assert.equal(observedModel, model);
        contexts.push(observedContext);
      },
    );

    await handlers.get("session_before_compact")!(event(), ctx);

    assert.deepEqual(payloads, [{ prompt: "serialized" }]);
    assert.deepEqual(contexts, [ctx]);
  });
});
