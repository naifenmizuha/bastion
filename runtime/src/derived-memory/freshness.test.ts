import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";
import { SqliteFreshnessProvider } from "./freshness.ts";
import { commandSpecs } from "../teamops/command-policy.ts";
import type { TeamOpsParams } from "../teamops/types.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function database() {
  const directory = mkdtempSync(join(tmpdir(), "bastion-freshness-"));
  directories.push(directory);
  const path = join(directory, "team.db");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE players (id INTEGER PRIMARY KEY, player_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE games (id INTEGER PRIMARY KEY, date TEXT, is_final INTEGER, updated_at TEXT NOT NULL);
    CREATE TABLE game_analyses (game_id INTEGER PRIMARY KEY, updated_at TEXT NOT NULL);
    CREATE TABLE training_reports (name TEXT, date TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE lineups (id INTEGER PRIMARY KEY, game_id INTEGER, status INTEGER, updated_at TEXT NOT NULL);
    CREATE TABLE drill_recommendations (id INTEGER PRIMARY KEY, name TEXT, type INTEGER, is_approved INTEGER, reviewed_at TEXT, updated_at TEXT NOT NULL);
  `);
  return { db, path };
}

describe("authoritative freshness snapshots", () => {
  it("isolates entity reads and detects list membership changes", () => {
    const { db, path } = database();
    db.exec(`INSERT INTO players VALUES (1, 'ply_one', 'one', 'v1')`);
    const provider = new SqliteFreshnessProvider(path);
    const entity = provider.snapshot({ args: ["player", "read", "--name", "one"] });
    db.exec(`INSERT INTO players VALUES (2, 'ply_two', 'two', 'v1')`);
    assert.equal(
      provider.snapshot({ args: ["player", "read", "--name", "one"] }).hash,
      entity.hash,
    );
    assert.notEqual(provider.snapshot({ args: ["player", "list"] }).hash, entity.hash);
    provider.close();
    db.close();
  });

  it("tracks both a game and its generated analysis", () => {
    const { db, path } = database();
    db.exec(`
      INSERT INTO games VALUES (1, '2026-01-01', 1, 'game-v1');
      INSERT INTO game_analyses VALUES (1, 'analysis-v1');
    `);
    const provider = new SqliteFreshnessProvider(path);
    const before = provider.snapshot({
      args: ["game", "analysis", "read", "--game-id", "1"],
    });
    db.exec(`UPDATE game_analyses SET updated_at = 'analysis-v2' WHERE game_id = 1`);
    const after = provider.snapshot({
      args: ["game", "analysis", "read", "--game-id", "1"],
    });
    assert.notEqual(after.hash, before.hash);
    assert.deepEqual(after.sources.map((source) => source.sourceKey), [
      "game_analysis:1",
      "game:1",
    ]);
    provider.close();
    db.close();
  });

  it("supports every registered read command", () => {
    const { db, path } = database();
    const provider = new SqliteFreshnessProvider(path);
    const samples: Record<string, TeamOpsParams> = {
      "team read": { args: ["team", "read", "--name", "Bastion"] },
      "team list": { args: ["team", "list"] },
      "batch read": { args: ["batch", "read"], input: { operations: [{ args: ["player", "list"] }] } },
      "player read": { args: ["player", "read", "--name", "one"] },
      "player list": { args: ["player", "list"] },
      "report read": { args: ["report", "read", "--name", "one", "--date", "2026-01-01"] },
      "game event validate": { args: ["game", "event", "validate"], input: { game_id: 1, events: [] } },
      "game lineup list": { args: ["game", "lineup", "list", "--game-id", "1"] },
      "game event list": { args: ["game", "event", "list", "--game-id", "1"] },
      "game analysis read": { args: ["game", "analysis", "read", "--game-id", "1"] },
      "game analysis list": { args: ["game", "analysis", "list"] },
      "game read": { args: ["game", "read", "--id", "1"] },
      "game list": { args: ["game", "list", "--date", "2026-01-01"] },
      "lineup validate": { args: ["lineup", "validate"], input: { game_id: 1, starters: [{ player: "one" }], bench: [], pitching_plan: [] } },
      "lineup read": { args: ["lineup", "read", "--id", "1"] },
      "lineup list": { args: ["lineup", "list", "--game-id", "1", "--status", "validated"] },
      "drill recommend list": { args: ["drill", "recommend", "list", "--name", "one", "--type", "pitching", "--status", "pending"] },
      "drill training list": { args: ["drill", "training", "list", "--name", "one", "--type", "pitching"] },
      "drill training read": { args: ["drill", "training", "read", "--recommendation-id", "1"] },
      "person analysis read": { args: ["person", "analysis", "read", "--name", "one", "--from", "2026-01-01", "--to", "2026-01-31"] },
    };
    for (const spec of commandSpecs.filter((candidate) => candidate.risk === "read")) {
      const key = spec.path.join(" ");
      assert.ok(samples[key], `missing freshness sample for ${key}`);
      assert.doesNotThrow(() => provider.snapshot(samples[key]!));
    }
    provider.close();
    db.close();
  });
});
