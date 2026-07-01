import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  DerivedMemory,
  DerivedMemoryDependency,
  DerivedMemoryInvalidation,
  DerivedMemoryWithDependencies,
  DomainChangeEvent,
  SaveDerivedMemoryInput,
  SearchDerivedMemoryInput,
  SuccessfulReadObservation,
} from "./types.ts";

interface MemoryRow {
  id: string;
  kind: string;
  subject_keys: string;
  topics: string;
  conclusion: string;
  limitations: string;
  status: "fresh" | "stale";
  created_at: number;
  updated_at: number;
  invalidated_at: number | null;
  invalidated_by_event_id: string | null;
}

interface DependencyRow {
  memory_id: string;
  command_json: string;
  input_json: string | null;
  command_hash: string;
  observed_at: number;
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
    ? parsed
    : [];
}

function toMemory(row: MemoryRow): DerivedMemory {
  return {
    id: row.id,
    kind: row.kind,
    subjectKeys: parseStringArray(row.subject_keys),
    topics: parseStringArray(row.topics),
    conclusion: row.conclusion,
    limitations: parseStringArray(row.limitations),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.invalidated_at !== null
      ? { invalidatedAt: row.invalidated_at }
      : {}),
    ...(row.invalidated_by_event_id !== null
      ? { invalidatedByEventId: row.invalidated_by_event_id }
      : {}),
  };
}

export class DerivedMemoryStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#migrate();
  }

  #migrate(): void {
    const version = this.#db.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (version.user_version >= 1) return;
    this.#db.exec(`
      BEGIN;
      CREATE TABLE derived_memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        subject_keys TEXT NOT NULL,
        topics TEXT NOT NULL,
        conclusion TEXT NOT NULL,
        limitations TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('fresh', 'stale')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        invalidated_at INTEGER,
        invalidated_by_event_id TEXT
      );
      CREATE TABLE derived_memory_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL REFERENCES derived_memories(id) ON DELETE CASCADE,
        command_json TEXT NOT NULL,
        input_json TEXT,
        command_hash TEXT NOT NULL,
        observed_at INTEGER NOT NULL,
        UNIQUE(memory_id, command_hash)
      );
      CREATE TABLE derived_memory_dependency_topics (
        dependency_id INTEGER NOT NULL REFERENCES derived_memory_dependencies(id) ON DELETE CASCADE,
        memory_id TEXT NOT NULL REFERENCES derived_memories(id) ON DELETE CASCADE,
        topic TEXT NOT NULL,
        PRIMARY KEY(dependency_id, topic)
      );
      CREATE INDEX derived_memory_dependency_topic_idx
        ON derived_memory_dependency_topics(topic, memory_id);
      CREATE TABLE derived_memory_invalidations (
        memory_id TEXT NOT NULL REFERENCES derived_memories(id) ON DELETE CASCADE,
        event_id TEXT NOT NULL,
        topics TEXT NOT NULL,
        invalidated_at INTEGER NOT NULL,
        PRIMARY KEY(memory_id, event_id)
      );
      CREATE TABLE derived_memory_processed_events (
        event_id TEXT PRIMARY KEY,
        topics TEXT NOT NULL,
        occurred_at INTEGER NOT NULL
      );
      PRAGMA user_version = 1;
      COMMIT;
    `);
  }

  markFreshMemoriesStaleOnStartup(now = Date.now()): number {
    const eventId = `runtime-startup:${randomUUID()}`;
    const rows = this.#db
      .prepare("SELECT id FROM derived_memories WHERE status = 'fresh'")
      .all() as Array<{ id: string }>;
    if (rows.length === 0) return 0;
    this.#db.exec("BEGIN");
    try {
      const update = this.#db.prepare(`
        UPDATE derived_memories
        SET status = 'stale', updated_at = ?, invalidated_at = ?,
            invalidated_by_event_id = ?
        WHERE id = ? AND status = 'fresh'
      `);
      const audit = this.#db.prepare(`
        INSERT OR IGNORE INTO derived_memory_invalidations
          (memory_id, event_id, topics, invalidated_at)
        VALUES (?, ?, ?, ?)
      `);
      for (const row of rows) {
        update.run(now, now, eventId, row.id);
        audit.run(row.id, eventId, JSON.stringify(["runtime_restart"]), now);
      }
      this.#db.exec("COMMIT");
      return rows.length;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  save(
    input: SaveDerivedMemoryInput,
    dependencies: readonly SuccessfulReadObservation[],
    now = Date.now(),
  ): DerivedMemoryWithDependencies {
    const id = `dmem_${randomUUID()}`;
    this.#db.exec("BEGIN");
    try {
      this.#db.prepare(`
        INSERT INTO derived_memories
          (id, kind, subject_keys, topics, conclusion, limitations,
           status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'fresh', ?, ?)
      `).run(
        id,
        input.kind,
        JSON.stringify(input.subjectKeys),
        JSON.stringify(input.topics),
        input.conclusion,
        JSON.stringify(input.limitations),
        now,
        now,
      );
      const insertDependency = this.#db.prepare(`
        INSERT INTO derived_memory_dependencies
          (memory_id, command_json, input_json, command_hash, observed_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      const insertTopic = this.#db.prepare(`
        INSERT INTO derived_memory_dependency_topics
          (dependency_id, memory_id, topic)
        VALUES (?, ?, ?)
      `);
      for (const dependency of dependencies) {
        const result = insertDependency.run(
          id,
          JSON.stringify(dependency.command),
          dependency.input === undefined
            ? null
            : JSON.stringify(dependency.input),
          dependency.normalizedCommandHash,
          dependency.observedAt,
        );
        for (const topic of dependency.invalidationTopics) {
          insertTopic.run(Number(result.lastInsertRowid), id, topic);
        }
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return this.read(id)!;
  }

  search(input: SearchDerivedMemoryInput): DerivedMemory[] {
    const rows = this.#db.prepare(`
      SELECT * FROM derived_memories
      WHERE (? = 1 OR status = 'fresh')
      ORDER BY updated_at DESC
    `).all(input.includeStale ? 1 : 0) as unknown as MemoryRow[];
    const query = input.query?.trim().toLocaleLowerCase();
    return rows
      .map(toMemory)
      .filter((memory) => !input.kind || memory.kind === input.kind)
      .filter(
        (memory) =>
          !input.subject || memory.subjectKeys.includes(input.subject),
      )
      .filter((memory) => !input.topic || memory.topics.includes(input.topic))
      .filter(
        (memory) =>
          !query ||
          [
            memory.kind,
            memory.conclusion,
            ...memory.subjectKeys,
            ...memory.topics,
            ...memory.limitations,
          ]
            .join("\n")
            .toLocaleLowerCase()
            .includes(query),
      )
      .slice(0, input.limit ?? 10);
  }

  read(id: string): DerivedMemoryWithDependencies | undefined {
    const row = this.#db
      .prepare("SELECT * FROM derived_memories WHERE id = ?")
      .get(id) as unknown as MemoryRow | undefined;
    if (!row) return undefined;
    const dependencyRows = this.#db.prepare(`
      SELECT memory_id, command_json, input_json, command_hash, observed_at
      FROM derived_memory_dependencies
      WHERE memory_id = ?
      ORDER BY id
    `).all(id) as unknown as DependencyRow[];
    const topicStatement = this.#db.prepare(`
      SELECT topic
      FROM derived_memory_dependency_topics topics
      JOIN derived_memory_dependencies dependencies
        ON dependencies.id = topics.dependency_id
      WHERE dependencies.memory_id = ? AND dependencies.command_hash = ?
      ORDER BY topic
    `);
    const dependencies: DerivedMemoryDependency[] = dependencyRows.map(
      (dependency) => {
        const input = dependency.input_json === null
          ? undefined
          : (JSON.parse(dependency.input_json) as Record<string, unknown>);
        return {
          memoryId: dependency.memory_id,
          command: parseStringArray(dependency.command_json),
          ...(input ? { input } : {}),
          normalizedCommandHash: dependency.command_hash,
          invalidationTopics: (
            topicStatement.all(id, dependency.command_hash) as Array<{
              topic: string;
            }>
          ).map(({ topic }) => topic),
          observedAt: dependency.observed_at,
        };
      },
    );
    return { ...toMemory(row), dependencies };
  }

  forget(id: string): boolean {
    return Number(
      this.#db.prepare("DELETE FROM derived_memories WHERE id = ?").run(id)
        .changes,
    ) > 0;
  }

  invalidate(event: DomainChangeEvent): number {
    this.#db.exec("BEGIN");
    try {
      const inserted = this.#db.prepare(`
        INSERT OR IGNORE INTO derived_memory_processed_events
          (event_id, topics, occurred_at)
        VALUES (?, ?, ?)
      `).run(event.id, JSON.stringify(event.topics), event.occurredAt);
      if (Number(inserted.changes) === 0 || event.topics.length === 0) {
        this.#db.exec("COMMIT");
        return 0;
      }
      const placeholders = event.topics.map(() => "?").join(", ");
      const affected = this.#db.prepare(`
        SELECT DISTINCT memories.id
        FROM derived_memories memories
        JOIN derived_memory_dependency_topics topics
          ON topics.memory_id = memories.id
        WHERE memories.status = 'fresh'
          AND topics.topic IN (${placeholders})
      `).all(...event.topics) as Array<{ id: string }>;
      if (affected.length === 0) {
        this.#db.exec("COMMIT");
        return 0;
      }
      const update = this.#db.prepare(`
        UPDATE derived_memories
        SET status = 'stale', updated_at = ?, invalidated_at = ?,
            invalidated_by_event_id = ?
        WHERE id = ? AND status = 'fresh'
      `);
      const audit = this.#db.prepare(`
        INSERT OR IGNORE INTO derived_memory_invalidations
          (memory_id, event_id, topics, invalidated_at)
        VALUES (?, ?, ?, ?)
      `);
      for (const { id } of affected) {
        update.run(event.occurredAt, event.occurredAt, event.id, id);
        audit.run(
          id,
          event.id,
          JSON.stringify(event.topics),
          event.occurredAt,
        );
      }
      this.#db.exec("COMMIT");
      return affected.length;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  invalidations(memoryId: string): DerivedMemoryInvalidation[] {
    const rows = this.#db.prepare(`
      SELECT memory_id, event_id, topics, invalidated_at
      FROM derived_memory_invalidations
      WHERE memory_id = ?
      ORDER BY invalidated_at
    `).all(memoryId) as Array<{
      memory_id: string;
      event_id: string;
      topics: string;
      invalidated_at: number;
    }>;
    return rows.map((row) => ({
      memoryId: row.memory_id,
      eventId: row.event_id,
      topics: parseStringArray(row.topics),
      invalidatedAt: row.invalidated_at,
    }));
  }

  close(): void {
    this.#db.close();
  }
}
