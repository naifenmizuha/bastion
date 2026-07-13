import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { TeamOpsParams } from "../teamops/types.ts";
import type { SourceSnapshot, SourceSnapshotEntry } from "./types.ts";

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function flag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function stableEntries(entries: readonly SourceSnapshotEntry[]): SourceSnapshotEntry[] {
  return [...new Map(entries.map((entry) => [entry.sourceKey, entry])).values()]
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
}

export function sourceSnapshot(entries: readonly SourceSnapshotEntry[]): SourceSnapshot {
  const sources = stableEntries(entries);
  return {
    sources,
    hash: createHash("sha256").update(JSON.stringify(sources)).digest("hex"),
  };
}

export interface FreshnessProvider {
  snapshot(params: TeamOpsParams): SourceSnapshot;
}

type Row = { source_key: string; updated_at: string };

export class SqliteFreshnessProvider implements FreshnessProvider {
  #db?: DatabaseSync;
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  close(): void {
    this.#db?.close();
  }

  #rows(sql: string, ...values: any[]): SourceSnapshotEntry[] {
    this.#db ??= new DatabaseSync(this.#path, { readOnly: true });
    return (this.#db.prepare(sql).all(...values) as unknown as Row[]).map((row) => ({
      sourceKey: row.source_key,
      updatedAt: row.updated_at,
    }));
  }

  #players(names?: readonly string[]): SourceSnapshotEntry[] {
    if (names && names.length === 0) return [];
    const where = names ? `WHERE name IN (${names.map(() => "?").join(",")})` : "";
    return this.#rows(
      `SELECT 'player:' || name AS source_key, updated_at FROM players ${where}`,
      ...(names ?? []),
    );
  }

  snapshot(params: TeamOpsParams): SourceSnapshot {
    return sourceSnapshot(this.#snapshotEntries(params));
  }

  #snapshotEntries(params: TeamOpsParams): SourceSnapshotEntry[] {
    const args = params.args;
    const key = args.slice(0, 3).join(" ");
    if (args[0] === "batch" && args[1] === "read") {
      const operations = object(params.input)?.operations;
      if (!Array.isArray(operations)) throw new Error("INVALID_FRESHNESS_INPUT");
      return operations.flatMap((value) => {
        const operation = object(value);
        if (!operation || !Array.isArray(operation.args)) throw new Error("INVALID_FRESHNESS_INPUT");
        return this.#snapshotEntries({
          args: operation.args as string[],
          ...(operation.input !== undefined ? { input: operation.input } : {}),
        });
      });
    }
    if (args[0] === "team" && args[1] === "read") {
      return this.#rows(
        `SELECT 'team:' || id AS source_key, updated_at FROM teams WHERE name = ?`,
        flag(args, "--name") ?? "",
      );
    }
    if (args[0] === "team" && args[1] === "list") {
      return this.#rows(`SELECT 'team:' || id AS source_key, updated_at FROM teams`);
    }
    if (key.startsWith("player read")) {
      return this.#players([flag(args, "--name") ?? ""]);
    }
    if (key.startsWith("player list")) return this.#players();
    if (key.startsWith("report read")) {
      return this.#rows(
        `SELECT 'report:' || name || ':' || date AS source_key, updated_at
         FROM training_reports WHERE name = ? AND date = ?`,
        flag(args, "--name") ?? "", flag(args, "--date") ?? "",
      );
    }
    if (key === "game event validate") {
      const gameID = object(params.input)?.game_id;
      return this.#rows(`SELECT 'game:' || id AS source_key, updated_at FROM games WHERE id = ?`, gameID);
    }
    if (key === "game analysis read") {
      const id = flag(args, "--game-id") ?? "";
      return [
        ...this.#rows(`SELECT 'game:' || id AS source_key, updated_at FROM games WHERE id = ?`, id),
        ...this.#rows(`SELECT 'game_analysis:' || game_id AS source_key, updated_at FROM game_analyses WHERE game_id = ?`, id),
      ];
    }
    if (key === "game analysis list") {
      return [
        ...this.#rows(`SELECT 'game_analysis:' || game_id AS source_key, updated_at FROM game_analyses`),
        ...this.#rows(`SELECT 'game:' || g.id AS source_key, g.updated_at FROM games g JOIN game_analyses a ON a.game_id = g.id`),
      ];
    }
    if (args[0] === "game" && args[1] === "read") {
      return this.#rows(`SELECT 'game:' || id AS source_key, updated_at FROM games WHERE id = ?`, flag(args, "--id") ?? "");
    }
    if (args[0] === "game" && args[1] === "list") {
      const date = flag(args, "--date");
      return this.#rows(
        `SELECT 'game:' || id AS source_key, updated_at FROM games ${date ? "WHERE date = ?" : ""}`,
        ...(date ? [date] : []),
      );
    }
    if (args[0] === "lineup" && args[1] === "validate") {
      const input = object(params.input);
      const names = [input?.starters, input?.bench, input?.pitching_plan]
        .flatMap((value) => Array.isArray(value) ? value : [])
        .flatMap((value) => typeof object(value)?.player === "string" ? [object(value)!.player as string] : []);
      return [
        ...this.#rows(`SELECT 'game:' || id AS source_key, updated_at FROM games WHERE id = ?`, input?.game_id),
        ...this.#players([...new Set(names)]),
      ];
    }
    if (args[0] === "lineup" && args[1] === "read") {
      return this.#rows(`SELECT 'lineup:' || id AS source_key, updated_at FROM lineups WHERE id = ?`, flag(args, "--id") ?? "");
    }
    if (args[0] === "lineup" && args[1] === "list") {
      const gameID = flag(args, "--game-id");
      const status = flag(args, "--status");
      const statusValue = status === undefined ? undefined : statusMap[status as keyof typeof statusMap];
      const conditions: string[] = [];
      const values: unknown[] = [];
      if (gameID) { conditions.push("game_id = ?"); values.push(gameID); }
      if (statusValue !== undefined) { conditions.push("status = ?"); values.push(statusValue); }
      return this.#rows(`SELECT 'lineup:' || id AS source_key, updated_at FROM lineups ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}`, ...values);
    }
    if (args[0] === "drill" && (args[1] === "recommend" || args[1] === "training")) {
      if (args[2] === "read") {
        return this.#rows(`SELECT 'drill:' || id AS source_key, updated_at FROM drill_recommendations WHERE id = ? AND is_approved = 1`, flag(args, "--recommendation-id") ?? "");
      }
      const conditions: string[] = [];
      const values: unknown[] = [];
      const name = flag(args, "--name");
      if (name) { conditions.push("name = ?"); values.push(name); }
      const type = flag(args, "--type");
      const drillTypes: Record<string, number> = { pitching: 0, catching: 1, hitting: 2, strength: 3, baserunning: 4, infield: 5, outfield: 6 };
      if (type !== undefined) { conditions.push("type = ?"); values.push(drillTypes[type]); }
      const status = flag(args, "--status");
      if (args[1] === "training") conditions.push("is_approved = 1");
      else if (status === "pending") conditions.push("reviewed_at IS NULL");
      else if (status === "approved") conditions.push("is_approved = 1");
      else if (status === "rejected") conditions.push("is_approved = 0 AND reviewed_at IS NOT NULL");
      return this.#rows(`SELECT 'drill:' || id AS source_key, updated_at FROM drill_recommendations ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}`, ...values);
    }
    if (key === "person analysis read") {
      const name = flag(args, "--name") ?? "";
      const from = flag(args, "--from") ?? "";
      const to = flag(args, "--to") ?? "";
      return [
        ...this.#players([name]),
        ...this.#rows(`SELECT 'game:' || id AS source_key, updated_at FROM games WHERE date >= ? AND date <= ? AND is_final = 1`, from, to),
        ...this.#rows(`SELECT 'game_analysis:' || a.game_id AS source_key, a.updated_at FROM game_analyses a JOIN games g ON g.id = a.game_id WHERE g.date >= ? AND g.date <= ?`, from, to),
      ];
    }
    throw new Error(`UNSUPPORTED_FRESHNESS_COMMAND: ${args.join(" ")}`);
  }
}

const statusMap = { validated: 0, accepted: 1, rejected: 2, superseded: 3 } as const;
