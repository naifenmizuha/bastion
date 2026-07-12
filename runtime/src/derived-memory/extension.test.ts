import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { LocalChangeEventBus } from "./events.ts";
import {
  createDerivedMemoryExtension,
  DerivedMemoryParameters,
  type DerivedMemoryToolDetails,
} from "./extension.ts";
import { CliObservationLedger } from "./ledger.ts";
import { DerivedMemoryStore } from "./store.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function harness() {
  const directory = mkdtempSync(join(tmpdir(), "bastion-memory-extension-"));
  directories.push(directory);
  const store = new DerivedMemoryStore(join(directory, "memory.sqlite"));
  const ledger = new CliObservationLedger();
  const changeEvents = new LocalChangeEventBus();
  let tool:
    | {
        execute(
          toolCallId: string,
          params: unknown,
        ): Promise<{ details: DerivedMemoryToolDetails }>;
      }
    | undefined;
  const handlers = new Map<string, (...args: any[]) => unknown>();
  createDerivedMemoryExtension({ store, ledger, changeEvents })({
    registerTool(value: typeof tool) {
      tool = value;
    },
    on(event: string, handler: (...args: any[]) => unknown) {
      handlers.set(event, handler);
    },
  } as never);
  assert.ok(tool);
  return { store, ledger, changeEvents, tool, handlers };
}

function recordReads(ledger: CliObservationLedger, bus: LocalChangeEventBus) {
  for (const gameId of ["1", "2"]) {
    ledger.record(
      `read-${gameId}`,
      {
        args: ["game", "analysis", "read", "--game-id", gameId],
      },
      {
        kind: "teamops",
        ok: true,
        risk: "read",
        command: ["game", "analysis", "read", "--game-id", gameId],
      },
      bus,
    );
  }
}

describe("derived_memory extension", () => {
  it("exposes an object-rooted schema for strict OpenAI-compatible providers", () => {
    const schema = DerivedMemoryParameters as unknown as {
      type?: string;
      anyOf?: unknown[];
    };
    assert.equal(schema.type, "object");
    assert.ok(Array.isArray(schema.anyOf));
  });

  it("saves from verified reads, searches, reads, and forgets", async () => {
    const { store, ledger, changeEvents, tool } = harness();
    recordReads(ledger, changeEvents);
    const saved = await tool.execute("memory-1", {
      action: "save",
      kind: "recent_offense",
      subjectKeys: ["team:bastion"],
      topics: ["offense"],
      conclusion: "On-base production is concentrated.",
      limitations: ["Two-game sample."],
      dependencies: [
        {
          args: ["game", "analysis", "read", "--game-id", "1"],
        },
        {
          args: ["game", "analysis", "read", "--game-id", "2"],
        },
      ],
    });
    assert.equal(saved.details.ok, true);
    const id = (saved.details.data as { id: string }).id;

    const search = await tool.execute("memory-2", {
      action: "search",
      topic: "offense",
    });
    assert.equal(
      (search.details.data as { memories: unknown[] }).memories.length,
      1,
    );
    const read = await tool.execute("memory-3", { action: "read", id });
    assert.equal(
      (read.details.data as { dependencies: unknown[] }).dependencies.length,
      2,
    );
    const forgotten = await tool.execute("memory-4", {
      action: "forget",
      id,
      confirmedByUser: true,
    });
    assert.equal(forgotten.details.ok, true);
    assert.equal(store.read(id), undefined);
    store.close();
  });

  it("rejects dependencies not observed in the current session", async () => {
    const { store, tool } = harness();
    const saved = await tool.execute("memory-1", {
      action: "save",
      kind: "recent_offense",
      subjectKeys: ["team:bastion"],
      topics: ["offense"],
      conclusion: "Unsupported conclusion.",
      limitations: [],
      dependencies: [
        { args: ["game", "read", "--id", "1"] },
        { args: ["game", "read", "--id", "2"] },
      ],
    });
    assert.equal(saved.details.ok, false);
    assert.equal(saved.details.error?.code, "UNOBSERVED_DEPENDENCY");
    store.close();
  });

  it("hides a memory from default search after a change event", async () => {
    const { store, ledger, changeEvents, tool } = harness();
    recordReads(ledger, changeEvents);
    const saved = await tool.execute("memory-1", {
      action: "save",
      kind: "recent_offense",
      subjectKeys: ["team:bastion"],
      topics: ["offense"],
      conclusion: "On-base production is concentrated.",
      limitations: [],
      dependencies: [
        {
          args: ["game", "analysis", "read", "--game-id", "1"],
        },
        {
          args: ["game", "analysis", "read", "--game-id", "2"],
        },
      ],
    });
    const id = (saved.details.data as { id: string }).id;
    changeEvents.publish({
      id: "game-changed",
      topics: ["game"],
      occurredAt: Date.now(),
    });

    const search = await tool.execute("memory-2", {
      action: "search",
      topic: "offense",
    });
    assert.deepEqual(
      (search.details.data as { memories: unknown[] }).memories,
      [],
    );
    const read = await tool.execute("memory-3", { action: "read", id });
    assert.equal((read.details.data as { status: string }).status, "stale");
    assert.match(
      (read.details.data as { warning: string }).warning,
      /Do not rely/,
    );
    store.close();
  });
});
