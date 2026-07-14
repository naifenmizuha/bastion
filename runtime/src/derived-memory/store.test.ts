import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";
import { DerivedMemoryStore } from "./store.ts";
import type {
  PrincipalContext,
  SaveDerivedMemoryInput,
  VerifiedTeamOpsEvidence,
} from "./types.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "bastion-derived-memory-"));
  directories.push(directory);
  return join(directory, "memory.sqlite");
}

function createStore(): DerivedMemoryStore {
  return new DerivedMemoryStore(databasePath());
}

const alice: PrincipalContext = {
  authorityId: "authority-one",
  teamId: "team-one",
  userId: "alice",
  role: "coach",
};

const bob: PrincipalContext = {
  ...alice,
  userId: "bob",
  role: "player",
  playerId: "player-bob",
};

const otherAuthority: PrincipalContext = {
  ...alice,
  authorityId: "authority-two",
};

const input: SaveDerivedMemoryInput = {
  title: "Recent offensive concentration",
  content: "Recent on-base production is concentrated in a few hitters.",
  rebuildInstruction: "Resolve and compare the two most recent completed games.",
  dependencies: [
    { args: ["game", "analysis", "read", "--game-id", "1"] },
    { args: ["game", "analysis", "read", "--game-id", "2"] },
  ],
};

const dependencies: VerifiedTeamOpsEvidence[] = [
  {
    command: ["game", "analysis", "read", "--game-id", "1"],
    normalizedCommandHash: "one",
    invalidationTopics: ["game", "game_analysis"],
    observedAt: 10,
    sourceSnapshot: {
      sources: [{ sourceKey: "game_analysis:1", updatedAt: "v1" }],
      hash: "snapshot-one",
    },
  },
  {
    command: ["game", "analysis", "read", "--game-id", "2"],
    normalizedCommandHash: "two",
    invalidationTopics: ["game", "game_analysis"],
    observedAt: 11,
    sourceSnapshot: {
      sources: [{ sourceKey: "game_analysis:2", updatedAt: "v1" }],
      hash: "snapshot-two",
    },
  },
];

describe("derived memory store", () => {
  it("persists scoped memories and dependencies across store instances", () => {
    const path = databasePath();
    const first = new DerivedMemoryStore(path);
    const saved = first.save(alice, input, dependencies, 20);
    first.close();

    const second = new DerivedMemoryStore(path);
    const loaded = second.readPrivate(saved.id, alice);
    assert.equal(loaded?.ownerUserId, "alice");
    assert.equal(loaded?.visibility, "private");
    assert.deepEqual(
      loaded?.dependencies.map((dependency) => dependency.command),
      dependencies.map((dependency) => dependency.command),
    );
    second.close();
  });

  it("isolates private memories and keeps authority and team scopes separate", () => {
    const store = createStore();
    const saved = store.save(alice, input, dependencies, 20);
    assert.equal(store.listPrivate(alice).length, 1);
    assert.equal(store.listPrivate(bob).length, 0);
    assert.equal(store.listPrivate(otherAuthority).length, 0);
    assert.equal(store.readPrivate(saved.id, bob), undefined);
    store.close();
  });

  it("merges accessible scopes with global ordering and includes stale leaves", () => {
    const store = createStore();
    const oldest = store.save(alice, { ...input, title: "Oldest" }, dependencies, 20);
    const shared = store.save(alice, { ...input, title: "Shared" }, dependencies, 30);
    store.publish(shared.id, alice, "team", 35);
    const newest = store.save(alice, { ...input, title: "Newest" }, dependencies, 40);
    store.invalidateFromFreshness(
      alice.authorityId,
      newest.id,
      ["game_analysis:1"],
      { now: 45 },
    );

    assert.deepEqual(
      store.listAccessible(alice).map((memory) => [memory.id, memory.status]),
      [[newest.id, "stale"], [shared.id, "fresh"], [oldest.id, "fresh"]],
    );
    assert.deepEqual(
      store.listAccessible(bob).map((memory) => memory.id),
      [shared.id],
    );
    assert.deepEqual(
      store.listAccessible(alice, "private").map((memory) => memory.id),
      [newest.id, oldest.id],
    );
    const firstPage = store.listAccessiblePage(alice, "all", 2, 0);
    assert.deepEqual(firstPage.memories.map((memory) => memory.id), [newest.id, shared.id]);
    assert.equal(firstPage.total, 3);
    assert.equal(firstPage.nextOffset, 2);
    assert.ok(firstPage.nextOffset !== undefined);
    const secondPage = store.listAccessiblePage(alice, "all", 2, firstPage.nextOffset);
    assert.deepEqual(secondPage.memories.map((memory) => memory.id), [oldest.id]);
    assert.equal(secondPage.total, 3);
    assert.equal(secondPage.nextOffset, undefined);
    store.close();
  });

  it("publishes and withdraws one record without copying its dependencies", () => {
    const store = createStore();
    const saved = store.save(alice, input, dependencies, 20);
    const published = store.publish(saved.id, alice, "team", 30);
    assert.equal(published?.visibility, "team");
    assert.equal(store.readPrivate(saved.id, alice), undefined);
    assert.equal(store.readTeam(saved.id, bob)?.dependencies.length, 2);
    assert.equal(store.sharingEvents(saved.id)[0]?.action, "publish");

    const withdrawn = store.withdraw(saved.id, alice, 40);
    assert.equal(withdrawn?.visibility, "private");
    assert.equal(store.readTeam(saved.id, bob), undefined);
    assert.equal(store.readPrivate(saved.id, alice)?.dependencies.length, 2);
    assert.deepEqual(
      store.sharingEvents(saved.id).map((event) => event.action),
      ["publish", "withdraw"],
    );
    store.close();
  });

  it("scopes invalidation to one authority", () => {
    const store = createStore();
    const first = store.save(alice, input, dependencies, 20);
    const second = store.save(otherAuthority, input, dependencies, 21);
    assert.equal(store.invalidate(alice.authorityId, {
      id: "event-1",
      topics: ["game_analysis"],
      occurredAt: 30,
    }), 1);
    assert.equal(store.readPrivate(first.id, alice)?.status, "stale");
    assert.equal(store.readPrivate(second.id, otherAuthority)?.status, "fresh");
    assert.equal(store.invalidations(alice.authorityId, first.id).length, 1);
    store.close();
  });

  it("selects fresh invalidation candidates by authority and dependency topic", () => {
    const store = createStore();
    const gameMemory = store.save(alice, input, dependencies, 20);
    store.save(otherAuthority, input, dependencies, 21);
    const playerDependencies = dependencies.map((dependency, index) => ({
      ...dependency,
      command: ["player", "read", "--id", String(index + 1)],
      normalizedCommandHash: `player-${index}`,
      invalidationTopics: ["player"],
    }));
    const playerMemory = store.save(
      alice,
      {
        ...input,
        title: "Player trend",
        dependencies: playerDependencies.map(({ command }) => ({ args: command })),
      },
      playerDependencies,
      22,
    );

    assert.deepEqual(
      store.freshMemoriesForTopics(alice.authorityId, ["game"])
        .map((memory) => memory.id),
      [gameMemory.id],
    );
    assert.deepEqual(
      store.freshMemoriesForTopics(alice.authorityId, ["player"])
        .map((memory) => memory.id),
      [playerMemory.id],
    );
    assert.deepEqual(store.freshMemoriesForTopics(alice.authorityId, []), []);
    store.close();
  });

  it("replaces a stale memory with one private linked successor", () => {
    const store = createStore();
    const original = store.save(alice, input, dependencies, 20);
    store.publish(original.id, alice, "team", 21);
    store.invalidateFromFreshness(
      alice.authorityId,
      original.id,
      ["game_analysis:1"],
      { now: 30 },
    );

    const replaced = store.replace(
      alice,
      {
        ...input,
        id: original.id,
        content: "The rebuilt conclusion uses the latest two games.",
        confirmedByUser: true,
      },
      dependencies,
      40,
    );
    assert.equal(replaced.ok, true);
    if (!replaced.ok) throw new Error("replacement failed");
    assert.equal(replaced.memory.visibility, "private");
    assert.equal(replaced.memory.supersedesId, original.id);
    assert.equal(store.readTeam(original.id, alice)?.supersededById, replaced.memory.id);
    assert.deepEqual(
      store.listTeam(alice).map((memory) => memory.id),
      [],
    );
    assert.deepEqual(
      store.listPrivate(alice).map((memory) => memory.id),
      [replaced.memory.id],
    );

    const duplicate = store.replace(
      alice,
      { ...input, id: original.id, confirmedByUser: true },
      dependencies,
      50,
    );
    assert.deepEqual(duplicate, {
      ok: false,
      code: "ALREADY_SUPERSEDED",
      successorId: replaced.memory.id,
    });
    store.close();
  });

  it("only replaces stale memories owned in the same authority and team", () => {
    const store = createStore();
    const fresh = store.save(alice, input, dependencies, 20);
    assert.deepEqual(
      store.replace(
        alice,
        { ...input, id: fresh.id, confirmedByUser: true },
        dependencies,
        30,
      ),
      { ok: false, code: "NOT_STALE" },
    );
    store.invalidateFromFreshness(
      alice.authorityId,
      fresh.id,
      ["game_analysis:1"],
      { now: 40 },
    );
    assert.deepEqual(
      store.replace(
        bob,
        { ...input, id: fresh.id, confirmedByUser: true },
        dependencies,
        50,
      ),
      { ok: false, code: "NOT_FOUND" },
    );
    assert.deepEqual(
      store.replace(
        otherAuthority,
        { ...input, id: fresh.id, confirmedByUser: true },
        dependencies,
        50,
      ),
      { ok: false, code: "NOT_FOUND" },
    );
    store.close();
  });

  it("deletes private and shared records with durable sharing audit", () => {
    const store = createStore();
    const privateMemory = store.save(alice, input, dependencies, 20);
    assert.equal(store.forgetPrivate(privateMemory.id, bob), false);
    assert.equal(store.forgetPrivate(privateMemory.id, alice, 30), true);
    assert.equal(store.sharingEvents(privateMemory.id)[0]?.action, "delete");

    const shared = store.save(alice, input, dependencies, 40);
    store.publish(shared.id, alice, "staff", 41);
    assert.equal(store.readStaff(shared.id, bob), undefined);
    assert.equal(store.listStaff(bob).length, 0);
    assert.equal(store.forgetShared(shared.id, alice), false);
    const admin = { ...alice, userId: "admin", role: "admin" as const };
    assert.equal(store.forgetShared(shared.id, admin, 50), true);
    assert.deepEqual(
      store.sharingEvents(shared.id).map((event) => event.action),
      ["publish", "delete"],
    );
    store.close();
  });

  it("fails fast for an unsupported schema instead of migrating it", () => {
    const path = databasePath();
    const legacy = new DatabaseSync(path);
    legacy.exec("PRAGMA user_version = 2");
    legacy.close();
    assert.throws(
      () => new DerivedMemoryStore(path),
      /delete the derived-memory database and restart/,
    );
  });
});
