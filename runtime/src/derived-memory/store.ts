import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type {
  DerivedMemory,
  DerivedMemoryDependency,
  DerivedMemoryInvalidation,
  DerivedMemoryListScope,
  DerivedMemorySharingEvent,
  DerivedMemoryVisibility,
  DerivedMemoryWithDependencies,
  DomainChangeEvent,
  PrincipalContext,
  ReplaceDerivedMemoryInput,
  SaveDerivedMemoryInput,
  VerifiedTeamOpsEvidence,
} from "./types.ts";

const SCHEMA_VERSION = 5;

interface MemoryRow {
  id: string;
  authority_id: string;
  team_id: string;
  owner_user_id: string;
  visibility: DerivedMemoryVisibility;
  title: string;
  summary: string;
  kind: string;
  subject_keys: string;
  topics: string;
  conclusion: string;
  limitations: string;
  rebuild_instruction: string;
  status: "fresh" | "stale";
  created_at: number;
  updated_at: number;
  published_at: number | null;
  invalidated_at: number | null;
  invalidated_by_event_id: string | null;
  supersedes_id: string | null;
  superseded_by_id: string | null;
}

interface DependencyRow {
  memory_id: string;
  command_json: string;
  input_json: string | null;
  command_hash: string;
  observed_at: number;
  source_snapshot_json: string;
  source_snapshot_hash: string;
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
    authorityId: row.authority_id,
    teamId: row.team_id,
    ownerUserId: row.owner_user_id,
    visibility: row.visibility,
    title: row.title,
    content: row.conclusion,
    rebuildInstruction: row.rebuild_instruction,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.published_at !== null ? { publishedAt: row.published_at } : {}),
    ...(row.invalidated_at !== null
      ? { invalidatedAt: row.invalidated_at }
      : {}),
    ...(row.invalidated_by_event_id !== null
      ? { invalidatedByEventId: row.invalidated_by_event_id }
      : {}),
    ...(row.supersedes_id !== null ? { supersedesId: row.supersedes_id } : {}),
    ...(row.superseded_by_id !== null
      ? { supersededById: row.superseded_by_id }
      : {}),
  };
}

export class DerivedMemoryStore {
  readonly #db: DatabaseSync;

  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#initialize();
  }

  #initialize(): void {
    const { user_version: version } = this.#db
      .prepare("PRAGMA user_version").get() as { user_version: number };
    if (version === SCHEMA_VERSION) return;
    if (version !== 0) {
      this.#db.close();
      throw new Error(
        `unsupported derived-memory schema version ${version}; delete the derived-memory database and restart`,
      );
    }
    this.#db.exec(`
      BEGIN;
      CREATE TABLE derived_memories (
        id TEXT PRIMARY KEY,
        authority_id TEXT NOT NULL,
        team_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        visibility TEXT NOT NULL CHECK (visibility IN ('private', 'staff', 'team')),
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        kind TEXT NOT NULL,
        subject_keys TEXT NOT NULL,
        topics TEXT NOT NULL,
        conclusion TEXT NOT NULL,
        limitations TEXT NOT NULL,
        rebuild_instruction TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('fresh', 'stale')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        published_at INTEGER,
        invalidated_at INTEGER,
        invalidated_by_event_id TEXT,
        supersedes_id TEXT UNIQUE REFERENCES derived_memories(id) ON DELETE SET NULL,
        superseded_by_id TEXT UNIQUE REFERENCES derived_memories(id) ON DELETE SET NULL
      );
      CREATE INDEX derived_memory_private_list_idx
        ON derived_memories(authority_id, team_id, owner_user_id, visibility, status, updated_at DESC);
      CREATE INDEX derived_memory_staff_list_idx
        ON derived_memories(authority_id, team_id, visibility, status, updated_at DESC);
      CREATE INDEX derived_memory_team_list_idx
        ON derived_memories(authority_id, team_id, visibility, status, updated_at DESC);
      CREATE TABLE derived_memory_dependencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL REFERENCES derived_memories(id) ON DELETE CASCADE,
        command_json TEXT NOT NULL,
        input_json TEXT,
        command_hash TEXT NOT NULL,
        observed_at INTEGER NOT NULL,
        source_snapshot_json TEXT NOT NULL,
        source_snapshot_hash TEXT NOT NULL,
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
        source_keys TEXT,
        PRIMARY KEY(memory_id, event_id)
      );
      CREATE TABLE derived_memory_processed_events (
        authority_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        topics TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        PRIMARY KEY(authority_id, event_id)
      );
      CREATE TABLE derived_memory_sharing_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('publish', 'withdraw', 'delete')),
        from_visibility TEXT NOT NULL CHECK (from_visibility IN ('private', 'staff', 'team')),
        to_visibility TEXT CHECK (to_visibility IN ('private', 'staff', 'team')),
        occurred_at INTEGER NOT NULL
      );
      CREATE INDEX derived_memory_sharing_event_idx
        ON derived_memory_sharing_events(memory_id, occurred_at);
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
  }

  save(
    principal: PrincipalContext,
    input: SaveDerivedMemoryInput,
    dependencies: readonly VerifiedTeamOpsEvidence[],
    now = Date.now(),
  ): DerivedMemoryWithDependencies {
    const id = `dmem_${randomUUID()}`;
    this.#db.exec("BEGIN");
    try {
      this.#insert(id, principal, input, dependencies, now);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return this.readPrivate(id, principal)!;
  }

  replace(
    principal: PrincipalContext,
    input: ReplaceDerivedMemoryInput,
    dependencies: readonly VerifiedTeamOpsEvidence[],
    now = Date.now(),
  ):
    | { ok: true; memory: DerivedMemoryWithDependencies }
    | { ok: false; code: "NOT_FOUND" | "NOT_STALE" | "ALREADY_SUPERSEDED"; successorId?: string } {
    this.#db.exec("BEGIN");
    try {
      const previous = this.#db.prepare(`
        SELECT status, superseded_by_id
        FROM derived_memories
        WHERE id = ? AND authority_id = ? AND team_id = ? AND owner_user_id = ?
      `).get(
        input.id,
        principal.authorityId,
        principal.teamId,
        principal.userId,
      ) as { status: "fresh" | "stale"; superseded_by_id: string | null } | undefined;
      if (!previous) {
        this.#db.exec("ROLLBACK");
        return { ok: false, code: "NOT_FOUND" };
      }
      if (previous.status !== "stale") {
        this.#db.exec("ROLLBACK");
        return { ok: false, code: "NOT_STALE" };
      }
      if (previous.superseded_by_id) {
        this.#db.exec("ROLLBACK");
        return {
          ok: false,
          code: "ALREADY_SUPERSEDED",
          successorId: previous.superseded_by_id,
        };
      }

      const id = `dmem_${randomUUID()}`;
      this.#insert(id, principal, input, dependencies, now, input.id);
      const linked = this.#db.prepare(`
        UPDATE derived_memories
        SET superseded_by_id = ?, updated_at = ?
        WHERE id = ? AND authority_id = ? AND team_id = ? AND owner_user_id = ?
          AND status = 'stale' AND superseded_by_id IS NULL
      `).run(
        id,
        now,
        input.id,
        principal.authorityId,
        principal.teamId,
        principal.userId,
      );
      if (Number(linked.changes) === 0) {
        this.#db.exec("ROLLBACK");
        return { ok: false, code: "ALREADY_SUPERSEDED" };
      }
      this.#db.exec("COMMIT");
      return { ok: true, memory: this.readPrivate(id, principal)! };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #insert(
    id: string,
    principal: PrincipalContext,
    input: SaveDerivedMemoryInput,
    dependencies: readonly VerifiedTeamOpsEvidence[],
    now: number,
    supersedesId?: string,
  ): void {
    this.#db.prepare(`
      INSERT INTO derived_memories
        (id, authority_id, team_id, owner_user_id, visibility, title, summary, kind,
         subject_keys, topics, conclusion, limitations, rebuild_instruction,
         status, created_at, updated_at, supersedes_id)
      VALUES (?, ?, ?, ?, 'private', ?, ?, ?, ?, ?, ?, ?, ?, 'fresh', ?, ?, ?)
    `).run(
      id,
      principal.authorityId,
      principal.teamId,
      principal.userId,
      input.title,
      input.title,
      "derived-memory",
      "[]",
      "[]",
      input.content,
      "[]",
      input.rebuildInstruction,
      now,
      now,
      supersedesId ?? null,
    );
    const insertDependency = this.#db.prepare(`
      INSERT INTO derived_memory_dependencies
        (memory_id, command_json, input_json, command_hash, observed_at,
         source_snapshot_json, source_snapshot_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertTopic = this.#db.prepare(`
      INSERT INTO derived_memory_dependency_topics
        (dependency_id, memory_id, topic) VALUES (?, ?, ?)
    `);
    for (const dependency of dependencies) {
      const result = insertDependency.run(
        id,
        JSON.stringify(dependency.command),
        dependency.input === undefined ? null : JSON.stringify(dependency.input),
        dependency.normalizedCommandHash,
        dependency.observedAt,
        JSON.stringify(dependency.sourceSnapshot.sources),
        dependency.sourceSnapshot.hash,
      );
      for (const topic of dependency.invalidationTopics) {
        insertTopic.run(Number(result.lastInsertRowid), id, topic);
      }
    }
  }

  #list(sql: string, values: readonly any[]): DerivedMemory[] {
    const rows = this.#db.prepare(sql).all(...values) as unknown as MemoryRow[];
    return rows.map(toMemory);
  }

  listPrivate(principal: PrincipalContext): DerivedMemory[] {
    return this.#list(`
      SELECT * FROM derived_memories
      WHERE authority_id = ? AND team_id = ? AND owner_user_id = ?
        AND visibility = 'private' AND superseded_by_id IS NULL
      ORDER BY updated_at DESC, id ASC
    `, [principal.authorityId, principal.teamId, principal.userId]);
  }

  listStaff(principal: PrincipalContext): DerivedMemory[] {
    if (principal.role === "player") return [];
    return this.#list(`
      SELECT * FROM derived_memories
      WHERE authority_id = ? AND team_id = ? AND visibility = 'staff'
        AND superseded_by_id IS NULL
      ORDER BY updated_at DESC, id ASC
    `, [principal.authorityId, principal.teamId]);
  }

  listTeam(principal: PrincipalContext): DerivedMemory[] {
    return this.#list(`
      SELECT * FROM derived_memories
      WHERE authority_id = ? AND team_id = ? AND visibility = 'team'
        AND superseded_by_id IS NULL
      ORDER BY updated_at DESC, id ASC
    `, [principal.authorityId, principal.teamId]);
  }

  listAccessible(
    principal: PrincipalContext,
    scope: DerivedMemoryListScope = "all",
  ): DerivedMemory[] {
    const scopes: DerivedMemoryVisibility[] = scope === "all"
      ? principal.role === "player"
        ? ["private", "team"]
        : ["private", "staff", "team"]
      : [scope];
    const memories = scopes.flatMap((candidate) =>
      candidate === "private"
        ? this.listPrivate(principal)
        : candidate === "staff"
        ? this.listStaff(principal)
        : this.listTeam(principal)
    );
    return [...new Map(memories.map((memory) => [memory.id, memory])).values()]
      .sort((left, right) =>
        right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
      );
  }

  listAccessiblePage(
    principal: PrincipalContext,
    scope: DerivedMemoryListScope = "all",
    limit = 20,
    offset = 0,
  ): {
    memories: DerivedMemory[];
    total: number;
    nextOffset?: number;
  } {
    const accessible = this.listAccessible(principal, scope);
    const memories = accessible.slice(offset, offset + limit);
    const nextOffset = offset + memories.length < accessible.length
      ? offset + memories.length
      : undefined;
    return {
      memories,
      total: accessible.length,
      ...(nextOffset !== undefined ? { nextOffset } : {}),
    };
  }

  freshMemoriesForTopics(
    authorityId: string,
    topics: readonly string[],
  ): DerivedMemoryWithDependencies[] {
    if (topics.length === 0) return [];
    const placeholders = topics.map(() => "?").join(", ");
    const rows = this.#db.prepare(`
      SELECT DISTINCT memories.id, memories.updated_at
      FROM derived_memories memories
      JOIN derived_memory_dependency_topics dependency_topics
        ON dependency_topics.memory_id = memories.id
      WHERE memories.authority_id = ? AND memories.status = 'fresh'
        AND memories.superseded_by_id IS NULL
        AND dependency_topics.topic IN (${placeholders})
      ORDER BY memories.updated_at DESC, memories.id ASC
    `).all(authorityId, ...topics) as Array<{ id: string; updated_at: number }>;
    return rows.map(({ id }) => this.#read(id, "authority_id = ?", [authorityId])!);
  }

  readPrivate(id: string, principal: PrincipalContext): DerivedMemoryWithDependencies | undefined {
    return this.#read(
      id,
      "authority_id = ? AND team_id = ? AND owner_user_id = ? AND visibility = 'private'",
      [principal.authorityId, principal.teamId, principal.userId],
    );
  }

  readStaff(id: string, principal: PrincipalContext): DerivedMemoryWithDependencies | undefined {
    if (principal.role === "player") return undefined;
    return this.#read(
      id,
      "authority_id = ? AND team_id = ? AND visibility = 'staff'",
      [principal.authorityId, principal.teamId],
    );
  }

  readTeam(id: string, principal: PrincipalContext): DerivedMemoryWithDependencies | undefined {
    return this.#read(
      id,
      "authority_id = ? AND team_id = ? AND visibility = 'team'",
      [principal.authorityId, principal.teamId],
    );
  }

  #read(
    id: string,
    scopeSql: string,
    scopeValues: readonly any[],
  ): DerivedMemoryWithDependencies | undefined {
    const row = this.#db.prepare(
      `SELECT * FROM derived_memories WHERE id = ? AND ${scopeSql}`,
    ).get(id, ...scopeValues) as unknown as MemoryRow | undefined;
    if (!row) return undefined;
    const dependencyRows = this.#db.prepare(`
      SELECT memory_id, command_json, input_json, command_hash, observed_at,
             source_snapshot_json, source_snapshot_hash
      FROM derived_memory_dependencies WHERE memory_id = ? ORDER BY id
    `).all(id) as unknown as DependencyRow[];
    const topicStatement = this.#db.prepare(`
      SELECT topic
      FROM derived_memory_dependency_topics topics
      JOIN derived_memory_dependencies dependencies ON dependencies.id = topics.dependency_id
      WHERE dependencies.memory_id = ? AND dependencies.command_hash = ?
      ORDER BY topic
    `);
    const dependencies: DerivedMemoryDependency[] = dependencyRows.map((dependency) => ({
      memoryId: dependency.memory_id,
      command: parseStringArray(dependency.command_json),
      ...(dependency.input_json === null
        ? {}
        : { input: JSON.parse(dependency.input_json) as Record<string, unknown> }),
      normalizedCommandHash: dependency.command_hash,
      invalidationTopics: (
        topicStatement.all(id, dependency.command_hash) as Array<{ topic: string }>
      ).map(({ topic }) => topic),
      observedAt: dependency.observed_at,
      sourceSnapshot: {
        sources: JSON.parse(dependency.source_snapshot_json),
        hash: dependency.source_snapshot_hash,
      },
    }));
    return { ...toMemory(row), dependencies };
  }

  publish(
    id: string,
    principal: PrincipalContext,
    visibility: Exclude<DerivedMemoryVisibility, "private">,
    now = Date.now(),
  ): DerivedMemoryWithDependencies | undefined {
    if (visibility === "staff" && principal.role === "player") return undefined;
    this.#db.exec("BEGIN");
    try {
      const changed = this.#db.prepare(`
        UPDATE derived_memories
        SET visibility = ?, published_at = ?, updated_at = ?
        WHERE id = ? AND authority_id = ? AND team_id = ?
          AND owner_user_id = ? AND visibility = 'private'
      `).run(
        visibility,
        now,
        now,
        id,
        principal.authorityId,
        principal.teamId,
        principal.userId,
      );
      if (Number(changed.changes) === 0) {
        this.#db.exec("ROLLBACK");
        return undefined;
      }
      this.#recordSharing(id, principal.userId, "publish", "private", visibility, now);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return visibility === "staff"
      ? this.readStaff(id, principal)
      : this.readTeam(id, principal);
  }

  withdraw(
    id: string,
    principal: PrincipalContext,
    now = Date.now(),
  ): DerivedMemoryWithDependencies | undefined {
    const current = this.readStaff(id, principal) ?? this.readTeam(id, principal);
    if (!current || current.ownerUserId !== principal.userId) return undefined;
    this.#db.exec("BEGIN");
    try {
      const changed = this.#db.prepare(`
        UPDATE derived_memories
        SET visibility = 'private', published_at = NULL, updated_at = ?
        WHERE id = ? AND authority_id = ? AND team_id = ?
          AND owner_user_id = ? AND visibility = ?
      `).run(
        now,
        id,
        principal.authorityId,
        principal.teamId,
        principal.userId,
        current.visibility,
      );
      if (Number(changed.changes) === 0) {
        this.#db.exec("ROLLBACK");
        return undefined;
      }
      this.#recordSharing(id, principal.userId, "withdraw", current.visibility, "private", now);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    return this.readPrivate(id, principal);
  }

  forgetPrivate(id: string, principal: PrincipalContext, now = Date.now()): boolean {
    const memory = this.readPrivate(id, principal);
    return memory ? this.#forget(memory, principal.userId, now) : false;
  }

  forgetShared(id: string, principal: PrincipalContext, now = Date.now()): boolean {
    if (principal.role !== "admin") return false;
    const memory = this.readStaff(id, principal) ?? this.readTeam(id, principal);
    return memory ? this.#forget(memory, principal.userId, now) : false;
  }

  #forget(memory: DerivedMemory, actorUserId: string, now: number): boolean {
    this.#db.exec("BEGIN");
    try {
      this.#recordSharing(
        memory.id,
        actorUserId,
        "delete",
        memory.visibility,
        undefined,
        now,
      );
      const deleted = this.#db.prepare(`
        DELETE FROM derived_memories
        WHERE id = ? AND authority_id = ? AND team_id = ? AND visibility = ?
      `).run(memory.id, memory.authorityId, memory.teamId, memory.visibility);
      this.#db.exec("COMMIT");
      return Number(deleted.changes) > 0;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #recordSharing(
    memoryId: string,
    actorUserId: string,
    action: DerivedMemorySharingEvent["action"],
    fromVisibility: DerivedMemoryVisibility,
    toVisibility: DerivedMemoryVisibility | undefined,
    occurredAt: number,
  ): void {
    this.#db.prepare(`
      INSERT INTO derived_memory_sharing_events
        (memory_id, actor_user_id, action, from_visibility, to_visibility, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(memoryId, actorUserId, action, fromVisibility, toVisibility ?? null, occurredAt);
  }

  sharingEvents(memoryId: string): DerivedMemorySharingEvent[] {
    const rows = this.#db.prepare(`
      SELECT memory_id, actor_user_id, action, from_visibility, to_visibility, occurred_at
      FROM derived_memory_sharing_events WHERE memory_id = ? ORDER BY occurred_at, id
    `).all(memoryId) as Array<{
      memory_id: string;
      actor_user_id: string;
      action: DerivedMemorySharingEvent["action"];
      from_visibility: DerivedMemoryVisibility;
      to_visibility: DerivedMemoryVisibility | null;
      occurred_at: number;
    }>;
    return rows.map((row) => ({
      memoryId: row.memory_id,
      actorUserId: row.actor_user_id,
      action: row.action,
      fromVisibility: row.from_visibility,
      ...(row.to_visibility ? { toVisibility: row.to_visibility } : {}),
      occurredAt: row.occurred_at,
    }));
  }

  invalidateFromFreshness(
    authorityId: string,
    memoryId: string,
    sourceKeys: readonly string[],
    context: { event?: DomainChangeEvent; now?: number } = {},
  ): boolean {
    const eventId = context.event?.id ?? `freshness:${randomUUID()}`;
    const topics = context.event?.topics ?? ["source_freshness"];
    const now = context.event?.occurredAt ?? context.now ?? Date.now();
    this.#db.exec("BEGIN");
    try {
      const changed = this.#db.prepare(`
        UPDATE derived_memories
        SET status = 'stale', updated_at = ?, invalidated_at = ?, invalidated_by_event_id = ?
        WHERE id = ? AND authority_id = ? AND status = 'fresh'
      `).run(now, now, eventId, memoryId, authorityId);
      if (Number(changed.changes) > 0) {
        this.#db.prepare(`
          INSERT INTO derived_memory_invalidations
            (memory_id, event_id, topics, invalidated_at, source_keys)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          memoryId,
          eventId,
          JSON.stringify(topics),
          now,
          JSON.stringify(sourceKeys),
        );
      }
      this.#db.exec("COMMIT");
      return Number(changed.changes) > 0;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  invalidate(authorityId: string, event: DomainChangeEvent): number {
    this.#db.exec("BEGIN");
    try {
      const inserted = this.#db.prepare(`
        INSERT OR IGNORE INTO derived_memory_processed_events
          (authority_id, event_id, topics, occurred_at) VALUES (?, ?, ?, ?)
      `).run(authorityId, event.id, JSON.stringify(event.topics), event.occurredAt);
      if (Number(inserted.changes) === 0 || event.topics.length === 0) {
        this.#db.exec("COMMIT");
        return 0;
      }
      const placeholders = event.topics.map(() => "?").join(", ");
      const affected = this.#db.prepare(`
        SELECT DISTINCT memories.id
        FROM derived_memories memories
        JOIN derived_memory_dependency_topics topics ON topics.memory_id = memories.id
        WHERE memories.authority_id = ? AND memories.status = 'fresh'
          AND topics.topic IN (${placeholders})
      `).all(authorityId, ...event.topics) as Array<{ id: string }>;
      const update = this.#db.prepare(`
        UPDATE derived_memories
        SET status = 'stale', updated_at = ?, invalidated_at = ?, invalidated_by_event_id = ?
        WHERE id = ? AND authority_id = ? AND status = 'fresh'
      `);
      const audit = this.#db.prepare(`
        INSERT OR IGNORE INTO derived_memory_invalidations
          (memory_id, event_id, topics, invalidated_at) VALUES (?, ?, ?, ?)
      `);
      for (const { id } of affected) {
        update.run(event.occurredAt, event.occurredAt, event.id, id, authorityId);
        audit.run(id, event.id, JSON.stringify(event.topics), event.occurredAt);
      }
      this.#db.exec("COMMIT");
      return affected.length;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  invalidations(authorityId: string, memoryId: string): DerivedMemoryInvalidation[] {
    const rows = this.#db.prepare(`
      SELECT invalidations.memory_id, invalidations.event_id, invalidations.topics,
             invalidations.invalidated_at, invalidations.source_keys
      FROM derived_memory_invalidations invalidations
      JOIN derived_memories memories ON memories.id = invalidations.memory_id
      WHERE invalidations.memory_id = ? AND memories.authority_id = ?
      ORDER BY invalidations.invalidated_at
    `).all(memoryId, authorityId) as Array<{
      memory_id: string;
      event_id: string;
      topics: string;
      invalidated_at: number;
      source_keys: string | null;
    }>;
    return rows.map((row) => ({
      memoryId: row.memory_id,
      eventId: row.event_id,
      topics: parseStringArray(row.topics),
      invalidatedAt: row.invalidated_at,
      ...(row.source_keys ? { sourceKeys: parseStringArray(row.source_keys) } : {}),
    }));
  }

  close(): void {
    this.#db.close();
  }
}
