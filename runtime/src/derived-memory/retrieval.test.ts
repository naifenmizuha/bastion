import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { sourceSnapshot } from "./freshness.ts";
import {
  freshMemoryCandidates,
  searchAccessibleMemories,
} from "./retrieval.ts";
import { DerivedMemoryStore } from "./store.ts";
import type { PrincipalContext, SuccessfulReadObservation } from "./types.ts";

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

function setup(principal = alice) {
  const directory = mkdtempSync(join(tmpdir(), "bastion-memory-retrieval-"));
  directories.push(directory);
  const store = new DerivedMemoryStore(join(directory, "memory.sqlite"));
  const versions = new Map<string, string>();
  let unavailable = false;
  const freshness = {
    snapshot(params: { args: string[] }) {
      if (unavailable) throw new Error("unavailable");
      const id = params.args.at(-1) ?? "unknown";
      return sourceSnapshot([{
        sourceKey: `game_analysis:${id}`,
        updatedAt: versions.get(id) ?? "v1",
      }]);
    },
  };
  return {
    store,
    versions,
    failFreshness() { unavailable = true; },
    retrieval: { store, freshness, principal },
  };
}

function dependencies(prefix: string): SuccessfulReadObservation[] {
  return ["1", "2"].map((suffix) => {
    const id = `${prefix}-${suffix}`;
    const snapshot = sourceSnapshot([{
      sourceKey: `game_analysis:${id}`,
      updatedAt: "v1",
    }]);
    return {
      command: ["game", "analysis", "read", "--game-id", id],
      normalizedCommandHash: `hash-${id}`,
      invalidationTopics: ["game_analysis"],
      observedAt: 1,
      sourceSnapshot: snapshot,
    };
  });
}

function save(
  store: DerivedMemoryStore,
  principal: PrincipalContext,
  id: string,
  conclusion: string,
  now: number,
) {
  return store.save(
    principal,
    {
      kind: `${id}-analysis`,
      subjectKeys: [`team:${principal.teamId}`],
      topics: id.includes("offense") ? ["offense", "slump"] : [id],
      conclusion,
      limitations: ["sample limitation"],
      dependencies: dependencies(id).map((dependency) => ({ args: dependency.command })),
    },
    dependencies(id),
    now,
  );
}

describe("derived-memory retrieval", () => {
  it("ranks all fresh accessible memories before applying the three-candidate limit", () => {
    const { store, retrieval } = setup();
    const oldest = save(store, alice, "memory-oldest", "最近五场比赛进攻很弱。", 100);
    const second = save(store, alice, "memory-second", "最近五场比赛进攻很弱。", 200);
    const third = save(store, alice, "memory-third", "最近五场比赛进攻很弱。", 300);
    const newest = save(store, alice, "memory-newest", "最近五场比赛进攻很弱。", 400);

    const candidates = freshMemoryCandidates(
      retrieval,
      "我们最近五场比赛进攻为什么这么弱？",
    );

    assert.equal(candidates.length, 3);
    assert.deepEqual(candidates.map((candidate) => candidate.id), [newest.id, third.id, second.id]);
    assert.equal(candidates.some((candidate) => candidate.id === oldest.id), false);
    assert.ok(candidates.every((candidate) => candidate.status === "fresh"));
    store.close();
  });

  it("does not inject unrelated fresh memories merely to fill the candidate limit", () => {
    const { store, retrieval } = setup();
    save(store, alice, "pitching", "先发投手近期局数不足。", 300);

    assert.deepEqual(freshMemoryCandidates(retrieval, "球队的差旅预算是多少？"), []);
    store.close();
  });

  it("bounds summaries and excludes stale or unknown memories without deleting unknown state", () => {
    const { store, retrieval, versions, failFreshness } = setup();
    const long = save(store, alice, "offense-long", `${"进攻分析".repeat(120)}END_MARKER`, 100);
    let candidates = freshMemoryCandidates(retrieval, "进攻分析");
    assert.equal(candidates[0]?.summary.length, 400);
    assert.doesNotMatch(candidates[0]!.summary, /END_MARKER/);

    versions.set("offense-long-1", "v2");
    candidates = freshMemoryCandidates(retrieval, "进攻分析");
    assert.deepEqual(candidates, []);
    assert.equal(store.readPrivate(long.id, alice)?.status, "stale");

    const unknown = save(store, alice, "offense-unknown", "另一条进攻分析。", 200);
    failFreshness();
    const searched = searchAccessibleMemories(retrieval, {});
    assert.deepEqual(searched.memories, []);
    assert.equal(searched.unknownCount, 1);
    assert.equal(store.readPrivate(unknown.id, alice)?.status, "fresh");
    store.close();
  });

  it("respects private, team, staff, and authority boundaries for automatic candidates", () => {
    const { store, retrieval: ownerRetrieval } = setup();
    const privateMemory = save(store, alice, "offense-private", "私人进攻结论。", 100);
    const teamMemory = save(store, alice, "offense-team", "全队可见进攻结论。", 200);
    store.publish(teamMemory.id, alice, "team", 201);
    const staffMemory = save(store, alice, "offense-staff", "教练可见进攻结论。", 300);
    store.publish(staffMemory.id, alice, "staff", 301);

    const bob = { ...alice, userId: "bob", role: "player" as const };
    const otherAuthority = { ...alice, authorityId: "authority-two", userId: "other" };
    const freshness = ownerRetrieval.freshness;
    const bobCandidates = freshMemoryCandidates({ store, freshness, principal: bob }, "进攻结论", 10);
    assert.deepEqual(bobCandidates.map((candidate) => candidate.id), [teamMemory.id]);
    assert.equal(bobCandidates.some((candidate) => candidate.id === privateMemory.id), false);
    const coachCandidates = freshMemoryCandidates(ownerRetrieval, "进攻结论", 10);
    assert.deepEqual(
      new Set(coachCandidates.map((candidate) => candidate.id)),
      new Set([privateMemory.id, teamMemory.id, staffMemory.id]),
    );
    assert.deepEqual(
      freshMemoryCandidates({ store, freshness, principal: otherAuthority }, "进攻结论", 10),
      [],
    );
    store.close();
  });
});
