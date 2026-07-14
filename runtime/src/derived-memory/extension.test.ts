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
import { DerivedMemoryEvidenceRegistry } from "./evidence-registry.ts";
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

const memoryCard = {
  title: "Recent offensive concentration",
  content: "Recent on-base production is concentrated; the sample is limited.",
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
  const evidenceRegistry = new DerivedMemoryEvidenceRegistry();
  const changeEvents = new LocalChangeEventBus();
  let tool:
    | {
        description: string;
        execute(
          toolCallId: string,
          params: unknown,
        ): Promise<{ details: DerivedMemoryToolDetails }>;
      }
    | undefined;
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const versions = new Map<string, string>();
  let freshnessFailure = false;
  let freshnessCalls = 0;
  const freshness = {
    snapshot(params: { args: string[] }) {
      freshnessCalls += 1;
      if (freshnessFailure) throw new Error("database unavailable");
      const id = params.args.at(-1) ?? "unknown";
      return sourceSnapshot([{
        sourceKey: `game_analysis:${id}`,
        updatedAt: versions.get(id) ?? "v1",
      }]);
    },
    set(id: string, version: string) { versions.set(id, version); },
    fail() { freshnessFailure = true; },
    calls() { return freshnessCalls; },
  };
  createDerivedMemoryExtension({
    store,
    evidenceRegistry,
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
  return { store, evidenceRegistry, changeEvents, freshness, tool, handlers };
}

function recordReads(
  evidenceRegistry: DerivedMemoryEvidenceRegistry,
  versions: Record<string, string> = {},
) {
  for (const gameId of ["1", "2"]) {
    evidenceRegistry.registerTeamOpsRead(
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
          updatedAt: versions[gameId] ?? "v1",
        }]),
      },
    );
  }
}

describe("derived_memory extension", () => {
  it("advertises the cross-domain discovery gate", () => {
    const { store, tool } = harness();
    assert.match(
      tool.description,
      /Before any trend, comparison, diagnosis, risk, or recommendation/,
    );
    assert.match(tool.description, /finish list and any candidate read calls before calling domain-data tools/);
    assert.match(tool.description, /never emit memory and domain calls in the same assistant batch/);
    assert.match(tool.description, /answer directly if its content fully covers the request/);
    assert.match(tool.description, /only the domain data needed for uncovered subquestions/);
    assert.match(tool.description, /Do not re-read covered sources/);
    store.close();
  });

  it("exposes an object-rooted schema for strict OpenAI-compatible providers", () => {
    const schema = DerivedMemoryParameters as unknown as {
      type?: string;
      anyOf?: unknown[];
    };
    assert.equal(schema.type, "object");
    assert.ok(Array.isArray(schema.anyOf));
    const serialized = JSON.stringify(schema);
    assert.doesNotMatch(serialized, /userId|teamId|authorityId|playerId/);
    assert.match(serialized, /"const":"list"/);
    assert.doesNotMatch(serialized, /"const":"search"/);
    assert.match(serialized, /Memory visibility filter only/);
    assert.match(serialized, /never describes the business subject or data range/);
    assert.match(serialized, /unless the user explicitly restricts the visibility audience/);
    assert.match(serialized, /Maximum memory titles in this page/);
    assert.match(serialized, /Zero-based memory-title offset/);
    assert.match(serialized, /"content"/);
    assert.doesNotMatch(serialized, /"summary"|"conclusion"|"subjectKeys"|"topics"/);
  });

  it("saves, lists bounded cards, reads full content, and forgets", async () => {
    const { store, evidenceRegistry, changeEvents, freshness, tool } = harness();
    recordReads(evidenceRegistry);
    const saved = await tool.execute("memory-1", {
      action: "save",
      ...memoryCard,
      content: "On-base production is concentrated.",
      rebuildInstruction: "Resolve and compare the two most recent completed games.",
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

    const callsBeforeList = freshness.calls();
    const listed = await tool.execute("memory-2", { action: "list" });
    const listData = listed.details.data as {
      memories: Array<Record<string, unknown>>;
      total: number;
      offset: number;
      limit: number;
      nextOffset?: number;
    };
    assert.equal(listData.memories.length, 1);
    assert.equal(freshness.calls(), callsBeforeList);
    assert.deepEqual(Object.keys(listData.memories[0]!).sort(), ["id", "title"]);
    assert.deepEqual(
      { total: listData.total, offset: listData.offset, limit: listData.limit },
      { total: 1, offset: 0, limit: 20 },
    );
    assert.equal(listData.nextOffset, undefined);
    const read = await tool.execute("memory-3", { action: "read", id });
    assert.deepEqual(read.details.data, {
      id,
      title: memoryCard.title,
      status: "fresh",
      content: "On-base production is concentrated.",
    });
    const forgotten = await tool.execute("memory-4", {
      action: "forget",
      id,
      confirmedByUser: true,
    });
    assert.equal(forgotten.details.ok, true);
    assert.equal(store.readPrivate(id, alice), undefined);
    store.close();
  });

  it("rejects dependencies not observed in the current session", async () => {
    const { store, tool } = harness();
    const saved = await tool.execute("memory-1", {
      action: "save",
      ...memoryCard,
      content: "Unsupported conclusion.",
      rebuildInstruction: "Re-read both games and compare their offense.",
      dependencies: [
        { args: ["game", "read", "--id", "1"] },
        { args: ["game", "read", "--id", "2"] },
      ],
    });
    assert.equal(saved.details.ok, false);
    assert.equal(saved.details.error?.code, "UNOBSERVED_DEPENDENCY");
    store.close();
  });

  it("requires a rebuild instruction for every saved memory", async () => {
    const { store, evidenceRegistry, changeEvents, tool } = harness();
    recordReads(evidenceRegistry);
    const saved = await tool.execute("memory-1", {
      action: "save",
      ...memoryCard,
      content: "A conclusion without a reproducible rebuild plan.",
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
    });
    assert.equal(saved.details.error?.code, "INVALID_REBUILD_INSTRUCTION");
    assert.deepEqual(store.listPrivate(alice), []);
    store.close();
  });

  it("rejects missing or oversized titles and content", async () => {
    const { store, evidenceRegistry, changeEvents, tool } = harness();
    recordReads(evidenceRegistry);
    const base = {
      action: "save",
      content: "Conclusion.",
      rebuildInstruction: "Rebuild the same comparison from current evidence.",
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
    };
    const missingTitle = await tool.execute("missing-title", {
      ...base,
      title: " ",
    });
    assert.equal(missingTitle.details.error?.code, "INVALID_TITLE");
    const longTitle = await tool.execute("long-title", {
      ...base,
      title: "x".repeat(129),
    });
    assert.equal(longTitle.details.error?.code, "INVALID_TITLE");
    const missingContent = await tool.execute("missing-content", {
      ...base,
      title: "Title",
      content: " ",
    });
    assert.equal(missingContent.details.error?.code, "INVALID_CONTENT");
    const longContent = await tool.execute("long-content", {
      ...base,
      title: "Title",
      content: "x".repeat(4_001),
    });
    assert.equal(longContent.details.error?.code, "INVALID_CONTENT");
    assert.deepEqual(store.listPrivate(alice), []);
    store.close();
  });

  it("paginates all accessible leaf cards without semantic filters", async () => {
    const { store, evidenceRegistry, changeEvents, tool } = harness();
    recordReads(evidenceRegistry);
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const saved = await tool.execute(`save-${index}`, {
        action: "save",
        title: `Memory ${index}`,
        content: `Conclusion ${index}`,
        rebuildInstruction: `Rebuild memory ${index} from current evidence.`,
        dependencies: [
          { args: ["game", "analysis", "read", "--game-id", "1"] },
          { args: ["game", "analysis", "read", "--game-id", "2"] },
        ],
      });
      ids.push((saved.details.data as { id: string }).id);
    }
    const first = await tool.execute("list-1", {
      action: "list",
      limit: 2,
      offset: 0,
    });
    const firstData = first.details.data as {
      memories: Array<{ id: string }>;
      total: number;
      nextOffset: number;
    };
    assert.equal(firstData.total, 3);
    assert.equal(firstData.memories.length, 2);
    assert.equal(firstData.nextOffset, 2);
    const second = await tool.execute("list-2", {
      action: "list",
      limit: 2,
      offset: firstData.nextOffset,
    });
    const secondData = second.details.data as {
      memories: Array<{ id: string }>;
      total: number;
      nextOffset?: number;
    };
    assert.equal(secondData.total, 3);
    assert.equal(secondData.memories.length, 1);
    assert.equal(secondData.nextOffset, undefined);
    assert.deepEqual(
      new Set([...firstData.memories, ...secondData.memories].map(({ id }) => id)),
      new Set(ids),
    );
    store.close();
  });

  it("rejects invalid pagination when called without schema validation", async () => {
    const { store, tool } = harness();
    const excessive = await tool.execute("list-too-large", {
      action: "list",
      limit: 51,
    });
    assert.equal(excessive.details.error?.code, "INVALID_PAGINATION");
    const negative = await tool.execute("list-negative", {
      action: "list",
      offset: -1,
    });
    assert.equal(negative.details.error?.code, "INVALID_PAGINATION");
    store.close();
  });

  it("keeps stale titles discoverable and validates freshness on read", async () => {
    const { store, evidenceRegistry, changeEvents, freshness, tool } = harness();
    recordReads(evidenceRegistry);
    const saved = await tool.execute("memory-1", {
      action: "save",
      ...memoryCard,
      content: "On-base production is concentrated.",
      rebuildInstruction: "Resolve and compare the two most recent completed games.",
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
    const event = {
      id: "game-changed",
      topics: ["game"],
      occurredAt: Date.now(),
    };
    changeEvents.publish(event);
    const callsAfterInvalidation = freshness.calls();
    changeEvents.publish(event);
    assert.equal(freshness.calls(), callsAfterInvalidation);

    const search = await tool.execute("memory-2", { action: "list" });
    assert.deepEqual(
      (search.details.data as { memories: unknown[] }).memories,
      [{ id, title: memoryCard.title }],
    );
    const read = await tool.execute("memory-3", { action: "read", id });
    const readData = read.details.data as {
      id: string;
      title: string;
      status: string;
      rebuild: { reason: string; instruction: string };
    };
    assert.deepEqual(Object.keys(readData).sort(), ["id", "rebuild", "status", "title"]);
    assert.equal(readData.status, "stale");
    assert.match(readData.rebuild.reason, /game_analysis:1/);
    assert.match(readData.rebuild.instruction, /two most recent completed games/);
    store.close();
  });

  it("prefilters change events and keeps same-topic unchanged sources fresh", async () => {
    const { store, evidenceRegistry, changeEvents, freshness, tool } = harness();
    recordReads(evidenceRegistry);
    const saved = await tool.execute("memory-1", {
      action: "save",
      ...memoryCard,
      content: "On-base production is concentrated.",
      rebuildInstruction: "Resolve and compare the two most recent completed games.",
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
    });
    const id = (saved.details.data as { id: string }).id;

    const callsBeforeUnrelated = freshness.calls();
    changeEvents.publish({
      id: "player-changed",
      topics: ["player"],
      occurredAt: Date.now(),
    });
    assert.equal(freshness.calls(), callsBeforeUnrelated);

    changeEvents.publish({
      id: "other-game-changed",
      topics: ["game"],
      occurredAt: Date.now(),
    });
    assert.equal(freshness.calls(), callsBeforeUnrelated + 2);
    assert.equal(store.readPrivate(id, alice)?.status, "fresh");
    assert.deepEqual(store.invalidations(alice.authorityId, id), []);
    store.close();
  });

  it("fails closed with unknown without permanently staling the memory", async () => {
    const { store, evidenceRegistry, changeEvents, freshness, tool } = harness();
    recordReads(evidenceRegistry);
    const saved = await tool.execute("memory-1", {
      action: "save",
      ...memoryCard,
      content: "On-base production is concentrated.",
      rebuildInstruction: "Resolve and compare the two most recent completed games.",
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
    });
    const id = (saved.details.data as { id: string }).id;
    freshness.fail();
    changeEvents.publish({
      id: "game-changed-while-freshness-unavailable",
      topics: ["game"],
      occurredAt: Date.now(),
    });
    assert.equal(store.readPrivate(id, alice)?.status, "fresh");
    const callsBeforeList = freshness.calls();
    const search = await tool.execute("memory-2", { action: "list" });
    assert.equal((search.details.data as { memories: unknown[] }).memories.length, 1);
    assert.equal(freshness.calls(), callsBeforeList);
    const read = await tool.execute("memory-3", { action: "read", id });
    assert.deepEqual(read.details.data, {
      id,
      title: memoryCard.title,
      status: "unknown",
    });
    assert.equal(store.readPrivate(id, alice)?.status, "fresh");
    store.close();
  });

  it("replaces an owned stale memory after fresh reads and explicit confirmation", async () => {
    const { store, evidenceRegistry, changeEvents, freshness, tool } = harness();
    recordReads(evidenceRegistry);
    const saved = await tool.execute("save", {
      action: "save",
      ...memoryCard,
      content: "Old conclusion.",
      rebuildInstruction: "Resolve and compare the two most recent completed games.",
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
    });
    const oldId = (saved.details.data as { id: string }).id;
    freshness.set("1", "v2");
    changeEvents.publish({
      id: "old-source-changed",
      topics: ["game_analysis"],
      occurredAt: Date.now(),
    });
    recordReads(evidenceRegistry, { "1": "v2" });

    const unconfirmed = await tool.execute("replace-unconfirmed", {
      action: "replace",
      id: oldId,
      ...memoryCard,
      content: "New conclusion.",
      rebuildInstruction: "Resolve and compare the two most recent completed games.",
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
    });
    assert.equal(unconfirmed.details.error?.code, "CONFIRMATION_REQUIRED");

    const replaced = await tool.execute("replace", {
      action: "replace",
      id: oldId,
      title: "Rebuilt recent offensive concentration",
      content: "New conclusion.",
      rebuildInstruction: "Resolve and compare the two most recent completed games.",
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
      confirmedByUser: true,
    });
    assert.equal(replaced.details.ok, true);
    const replacement = replaced.details.data as {
      id: string;
      title: string;
    };
    assert.equal(replacement.title, "Rebuilt recent offensive concentration");
    assert.equal(store.readPrivate(replacement.id, alice)?.visibility, "private");
    assert.equal(store.readPrivate(oldId, alice)?.supersededById, replacement.id);

    const search = await tool.execute("list", { action: "list" });
    assert.deepEqual(
      (search.details.data as { memories: Array<{ id: string }> }).memories.map(
        (memory) => memory.id,
      ),
      [replacement.id],
    );
    const duplicate = await tool.execute("replace-again", {
      action: "replace",
      id: oldId,
      ...memoryCard,
      content: "Another conclusion.",
      rebuildInstruction: "Resolve and compare the two most recent completed games.",
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
      confirmedByUser: true,
    });
    assert.equal(duplicate.details.error?.code, "ALREADY_SUPERSEDED");
    assert.equal(
      (duplicate.details.data as { successorId: string }).successorId,
      replacement.id,
    );
    store.close();
  });

  it("rejects replacement when a newly read source changes before persistence", async () => {
    const { store, evidenceRegistry, changeEvents, freshness, tool } = harness();
    recordReads(evidenceRegistry);
    const saved = await tool.execute("save", {
      action: "save",
      ...memoryCard,
      content: "Old conclusion.",
      rebuildInstruction: "Compare the latest evidence.",
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
    });
    const oldId = (saved.details.data as { id: string }).id;
    freshness.set("1", "v2");
    changeEvents.publish({ id: "change-1", topics: ["game"], occurredAt: Date.now() });
    recordReads(evidenceRegistry, { "1": "v2" });
    freshness.set("1", "v3");

    const replaced = await tool.execute("replace", {
      action: "replace",
      id: oldId,
      ...memoryCard,
      content: "New conclusion.",
      rebuildInstruction: "Compare the latest evidence.",
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
      confirmedByUser: true,
    });
    assert.equal(replaced.details.error?.code, "SOURCE_CHANGED");
    assert.equal(store.readPrivate(oldId, alice)?.supersededById, undefined);
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
    recordReads(aliceHarness.evidenceRegistry);
    const saved = await aliceHarness.tool.execute("save", {
      action: "save",
      ...memoryCard,
      content: "A private conclusion.",
      rebuildInstruction: "Resolve and compare the two most recent completed games.",
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
    });
    const id = (saved.details.data as { id: string }).id;
    const beforePublish = await bobHarness.tool.execute("search-before", {
      action: "list",
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
      action: "list",
      limit: 1,
    });
    const memories = (afterPublish.details.data as {
      memories: Array<{ id: string; title: string }>;
    }).memories;
    assert.deepEqual(memories.map((memory) => memory.id), [id]);
    assert.deepEqual(Object.keys(memories[0]!).sort(), ["id", "title"]);

    store.invalidateFromFreshness(alice.authorityId, id, ["game_analysis:1"]);
    recordReads(bobHarness.evidenceRegistry);
    const forbiddenReplacement = await bobHarness.tool.execute("replace-team", {
      action: "replace",
      id,
      ...memoryCard,
      content: "Bob's rebuilt conclusion.",
      rebuildInstruction: "Resolve and compare the two most recent completed games.",
      dependencies: [
        { args: ["game", "analysis", "read", "--game-id", "1"] },
        { args: ["game", "analysis", "read", "--game-id", "2"] },
      ],
      confirmedByUser: true,
    });
    assert.equal(forbiddenReplacement.details.error?.code, "FORBIDDEN");

    const withdrawn = await aliceHarness.tool.execute("withdraw", {
      action: "withdraw",
      id,
      confirmedByUser: true,
    });
    assert.equal(withdrawn.details.ok, true);
    const afterWithdraw = await bobHarness.tool.execute("search-withdrawn", {
      action: "list",
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
    recordReads(ownerHarness.evidenceRegistry);
    const saved = await ownerHarness.tool.execute("save", {
      action: "save",
      ...memoryCard,
      content: "Staff-only assessment.",
      rebuildInstruction: "Re-read the player evidence and reassess the risk.",
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
      action: "list",
      scope: "staff",
    });
    assert.equal(playerSearch.details.error?.code, "FORBIDDEN");
    const playerRead = await playerHarness.tool.execute("player-read", {
      action: "read",
      id,
    });
    assert.equal(playerRead.details.error?.code, "NOT_FOUND");
    const coachSearch = await coachHarness.tool.execute("coach-search", {
      action: "list",
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
