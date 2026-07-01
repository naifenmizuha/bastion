import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { DerivedMemoryStore } from "./store.ts";
import type {
  SaveDerivedMemoryInput,
  SuccessfulReadObservation,
} from "./types.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createStore(): DerivedMemoryStore {
  const directory = mkdtempSync(join(tmpdir(), "bastion-derived-memory-"));
  directories.push(directory);
  return new DerivedMemoryStore(join(directory, "memory.sqlite"));
}

const input: SaveDerivedMemoryInput = {
  kind: "recent_offense",
  subjectKeys: ["team:bastion"],
  topics: ["offense"],
  conclusion: "Recent on-base production is concentrated in a few hitters.",
  limitations: ["Only two games were observed."],
  dependencies: [
    { args: ["game", "analysis", "read", "--game-id", "1"] },
    { args: ["game", "analysis", "read", "--game-id", "2"] },
  ],
};

const dependencies: SuccessfulReadObservation[] = [
  {
    command: ["game", "analysis", "read", "--game-id", "1"],
    normalizedCommandHash: "one",
    invalidationTopics: ["game", "game_analysis"],
    observedAt: 10,
  },
  {
    command: ["game", "analysis", "read", "--game-id", "2"],
    normalizedCommandHash: "two",
    invalidationTopics: ["game", "game_analysis"],
    observedAt: 11,
  },
];

describe("derived memory store", () => {
  it("persists memories and dependencies across store instances", () => {
    const directory = mkdtempSync(join(tmpdir(), "bastion-derived-memory-"));
    directories.push(directory);
    const path = join(directory, "memory.sqlite");
    const first = new DerivedMemoryStore(path);
    const saved = first.save(input, dependencies, 20);
    first.close();

    const second = new DerivedMemoryStore(path);
    const loaded = second.read(saved.id);
    assert.equal(loaded?.conclusion, input.conclusion);
    assert.deepEqual(
      loaded?.dependencies.map((dependency) => dependency.command),
      dependencies.map((dependency) => dependency.command),
    );
    second.close();
  });

  it("searches fresh memories by metadata and omits stale by default", () => {
    const store = createStore();
    const saved = store.save(input, dependencies, 20);
    assert.equal(store.search({ topic: "offense" }).length, 1);
    assert.equal(store.search({ query: "ON-BASE" })[0]?.id, saved.id);

    store.invalidate({
      id: "event-1",
      topics: ["game"],
      occurredAt: 30,
    });
    assert.equal(store.search({ topic: "offense" }).length, 0);
    assert.equal(
      store.search({ topic: "offense", includeStale: true })[0]?.status,
      "stale",
    );
    store.close();
  });

  it("invalidates by dependency topic and processes each event once", () => {
    const store = createStore();
    const saved = store.save(input, dependencies, 20);
    assert.equal(
      store.invalidate({
        id: "event-1",
        topics: ["lineup"],
        occurredAt: 30,
      }),
      0,
    );
    assert.equal(store.read(saved.id)?.status, "fresh");
    assert.equal(
      store.invalidate({
        id: "event-2",
        topics: ["game_analysis"],
        occurredAt: 40,
      }),
      1,
    );
    assert.equal(
      store.invalidate({
        id: "event-2",
        topics: ["game_analysis"],
        occurredAt: 40,
      }),
      0,
    );
    assert.equal(store.read(saved.id)?.invalidatedByEventId, "event-2");
    assert.equal(store.invalidations(saved.id).length, 1);
    store.close();
  });

  it("marks all fresh memories stale exactly when startup policy runs", () => {
    const store = createStore();
    const saved = store.save(input, dependencies, 20);
    assert.equal(store.markFreshMemoriesStaleOnStartup(50), 1);
    assert.equal(store.markFreshMemoriesStaleOnStartup(60), 0);
    assert.equal(store.read(saved.id)?.status, "stale");
    assert.deepEqual(store.invalidations(saved.id)[0]?.topics, [
      "runtime_restart",
    ]);
    store.close();
  });

  it("forgets a memory and its dependency records", () => {
    const store = createStore();
    const saved = store.save(input, dependencies, 20);
    assert.equal(store.forget(saved.id), true);
    assert.equal(store.read(saved.id), undefined);
    assert.equal(store.forget(saved.id), false);
    store.close();
  });
});
