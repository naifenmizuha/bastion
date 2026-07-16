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
import { VerifiedReadLedger } from "./verified-read-ledger.ts";
import { DerivedMemoryStore } from "./store.ts";
import { sourceSnapshot } from "./freshness.ts";
import type { PrincipalContext } from "./types.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const alice: PrincipalContext = {
  authorityId: "authority-one",
  teamId: "team-one",
  userId: "alice",
  role: "coach",
};

function harness(options: {
  store?: DerivedMemoryStore;
  principal?: PrincipalContext;
} = {}) {
  let store = options.store;
  if (!store) {
    const directory = mkdtempSync(join(tmpdir(), "bastion-memory-extension-"));
    directories.push(directory);
    store = new DerivedMemoryStore(join(directory, "memory.sqlite"));
  }
  const verifiedReads = new VerifiedReadLedger();
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
  const versions = new Map<string, string>();
  let freshnessFailure = false;
  let snapshotCount = 0;
  const freshness = {
    snapshot(params: { args: string[] }) {
      snapshotCount += 1;
      if (freshnessFailure) throw new Error("database unavailable");
      const id = params.args.at(-1) ?? "unknown";
      return sourceSnapshot([{
        sourceKey: `game_analysis:${id}`,
        updatedAt: versions.get(id) ?? "v1",
      }]);
    },
    set(id: string, version: string) { versions.set(id, version); },
    fail() { freshnessFailure = true; },
    count() { return snapshotCount; },
  };
  createDerivedMemoryExtension({
    store,
    verifiedReads,
    changeEvents,
    freshness,
    principal: options.principal ?? alice,
  })({
    registerTool(value: typeof tool) {
      tool = value;
    },
    on(event: string, handler: (...args: any[]) => unknown) {
      handlers.set(event, handler);
    },
  } as never);
  assert.ok(tool);
  return { store, verifiedReads, changeEvents, freshness, tool, handlers };
}

function recordReads(verifiedReads: VerifiedReadLedger, bus: LocalChangeEventBus) {
  for (const gameId of ["1", "2"]) {
    verifiedReads.record(
      `read-${gameId}`,
      {
        args: ["game", "analysis", "read", "--game-id", gameId],
      },
      {
        kind: "teamops",
        ok: true,
        risk: "read",
        command: ["game", "analysis", "read", "--game-id", gameId],
        freshness: sourceSnapshot([{
          sourceKey: `game_analysis:${gameId}`,
          updatedAt: "v1",
        }]),
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
    const serialized = JSON.stringify(schema);
    assert.doesNotMatch(serialized, /userId|teamId|authorityId|playerId/);
  });

  it("saves from verified reads, searches, reads, and forgets", async () => {
    const { store, verifiedReads, changeEvents, freshness, tool } = harness();
    recordReads(verifiedReads, changeEvents);
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
    freshness.set("99", "v2");
    changeEvents.publish({
      id: "unrelated-game-changed",
      topics: ["game"],
      occurredAt: Date.now(),
    });

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
    assert.equal(store.readPrivate(id, alice), undefined);
    store.close();
  });

  it("injects a hidden bounded fresh candidate catalog before non-command turns", async () => {
    const { store, verifiedReads, changeEvents, freshness, tool, handlers } = harness();
    recordReads(verifiedReads, changeEvents);
    const conclusion = `${"最近五场比赛进攻疲软。".repeat(50)}FULL_END`;
    const saved = await tool.execute("memory-1", {
      action: "save",
      kind: "recent_offense",
      subjectKeys: ["team:bastion"],
      topics: ["offense"],
      conclusion,
      limitations: ["Five-game sample."],
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
    });
    const id = (saved.details.data as { id: string }).id;
    const handler = handlers.get("before_agent_start");
    assert.ok(handler);

    const injected = handler({
      prompt: "我们最近五场比赛进攻为什么这么弱？",
    }) as { message: { customType: string; content: string; display: boolean; details: { candidateIds: string[] } } };
    assert.equal(injected.message.customType, "bastion-derived-memory-candidates");
    assert.equal(injected.message.display, false);
    assert.deepEqual(injected.message.details.candidateIds, [id]);
    assert.match(injected.message.content, /derived_memory read/);
    assert.match(injected.message.content, /do not call teamops/);
    assert.match(injected.message.content, /explicitly requests a fresh re-check/);
    assert.match(injected.message.content, /authoritative write/);
    assert.doesNotMatch(injected.message.content, /FULL_END/);
    const read = await tool.execute("memory-read", { action: "read", id });
    assert.equal(read.details.ok, true);
    assert.equal(freshness.count(), 4, "candidate injection and full read must each revalidate two dependencies");
    assert.equal(handler({ prompt: "/dev" }), undefined);
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
    const { store, verifiedReads, changeEvents, freshness, tool } = harness();
    recordReads(verifiedReads, changeEvents);
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
    freshness.set("1", "v2");
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

  it("fails closed with unknown without permanently staling the memory", async () => {
    const { store, verifiedReads, changeEvents, freshness, tool } = harness();
    recordReads(verifiedReads, changeEvents);
    const saved = await tool.execute("memory-1", {
      action: "save",
      kind: "recent_offense",
      subjectKeys: ["team:bastion"],
      topics: ["offense"],
      conclusion: "On-base production is concentrated.",
      limitations: [],
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
    });
    const id = (saved.details.data as { id: string }).id;
    freshness.fail();
    const search = await tool.execute("memory-2", { action: "search" });
    assert.deepEqual((search.details.data as { memories: unknown[] }).memories, []);
    assert.equal((search.details.data as { unknownCount: number }).unknownCount, 1);
    const read = await tool.execute("memory-3", { action: "read", id });
    assert.equal((read.details.data as { status: string }).status, "unknown");
    assert.equal(store.readPrivate(id, alice)?.status, "fresh");
    store.close();
  });

  it("keeps private memories isolated and merges explicitly published team memories", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bastion-memory-shared-"));
    directories.push(directory);
    const store = new DerivedMemoryStore(join(directory, "memory.sqlite"));
    const aliceHarness = harness({ store, principal: alice });
    const bob: PrincipalContext = {
      ...alice,
      userId: "bob",
      role: "player",
      playerId: "player-bob",
    };
    const bobHarness = harness({ store, principal: bob });
    recordReads(aliceHarness.verifiedReads, aliceHarness.changeEvents);
    const saved = await aliceHarness.tool.execute("save", {
      action: "save",
      kind: "recent_offense",
      subjectKeys: ["team:bastion"],
      topics: ["offense"],
      conclusion: "A private conclusion.",
      limitations: [],
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
    });
    const id = (saved.details.data as { id: string }).id;
    const beforePublish = await bobHarness.tool.execute("search-before", {
      action: "search",
    });
    assert.deepEqual(
      (beforePublish.details.data as { memories: unknown[] }).memories,
      [],
    );

    const forbiddenStaff = await bobHarness.tool.execute("publish-staff", {
      action: "publish",
      id,
      visibility: "staff",
      confirmedByUser: true,
    });
    assert.equal(forbiddenStaff.details.error?.code, "FORBIDDEN");
    const published = await aliceHarness.tool.execute("publish-team", {
      action: "publish",
      id,
      visibility: "team",
      confirmedByUser: true,
    });
    assert.equal(published.details.ok, true);
    const afterPublish = await bobHarness.tool.execute("search-after", {
      action: "search",
      limit: 1,
    });
    const memories = (afterPublish.details.data as {
      memories: Array<{ id: string; visibility: string }>;
    }).memories;
    assert.deepEqual(memories.map((memory) => memory.id), [id]);
    assert.equal(memories[0]?.visibility, "team");

    const withdrawn = await aliceHarness.tool.execute("withdraw", {
      action: "withdraw",
      id,
      confirmedByUser: true,
    });
    assert.equal(withdrawn.details.ok, true);
    const afterWithdraw = await bobHarness.tool.execute("search-withdrawn", {
      action: "search",
    });
    assert.deepEqual(
      (afterWithdraw.details.data as { memories: unknown[] }).memories,
      [],
    );
    store.close();
  });

  it("restricts staff memories to coaches and administrators", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bastion-memory-staff-"));
    directories.push(directory);
    const store = new DerivedMemoryStore(join(directory, "memory.sqlite"));
    const ownerHarness = harness({ store, principal: alice });
    const playerHarness = harness({
      store,
      principal: { ...alice, userId: "player", role: "player" },
    });
    const coachHarness = harness({
      store,
      principal: { ...alice, userId: "coach", role: "coach" },
    });
    const adminHarness = harness({
      store,
      principal: { ...alice, userId: "admin", role: "admin" },
    });
    recordReads(ownerHarness.verifiedReads, ownerHarness.changeEvents);
    const saved = await ownerHarness.tool.execute("save", {
      action: "save",
      kind: "player_risk",
      subjectKeys: ["player:one"],
      topics: ["risk"],
      conclusion: "Staff-only assessment.",
      limitations: [],
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
    });
    const id = (saved.details.data as { id: string }).id;
    await ownerHarness.tool.execute("publish", {
      action: "publish",
      id,
      visibility: "staff",
      confirmedByUser: true,
    });

    const playerSearch = await playerHarness.tool.execute("player-search", {
      action: "search",
      scope: "staff",
    });
    assert.equal(playerSearch.details.error?.code, "FORBIDDEN");
    const playerRead = await playerHarness.tool.execute("player-read", {
      action: "read",
      id,
    });
    assert.equal(playerRead.details.error?.code, "NOT_FOUND");
    const coachSearch = await coachHarness.tool.execute("coach-search", {
      action: "search",
    });
    assert.equal(
      (coachSearch.details.data as { memories: unknown[] }).memories.length,
      1,
    );
    const coachDelete = await coachHarness.tool.execute("coach-delete", {
      action: "forget",
      id,
      confirmedByUser: true,
    });
    assert.equal(coachDelete.details.error?.code, "FORBIDDEN");
    const adminDelete = await adminHarness.tool.execute("admin-delete", {
      action: "forget",
      id,
      confirmedByUser: true,
    });
    assert.equal(adminDelete.details.ok, true);
    assert.equal(store.sharingEvents(id).at(-1)?.actorUserId, "admin");
    store.close();
  });
});
