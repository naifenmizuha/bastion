import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import type {
  DatabaseChanges,
  DatabaseColumn,
  DatabaseState,
  DatabaseTableChanges,
  TableState,
} from "./types.ts";

type Row = Record<string, unknown>;

interface TableSnapshot {
  columns: DatabaseColumn[];
  rows: Map<string, Row>;
  state: TableState;
}

export interface InspectedDatabase {
  state: DatabaseState;
  tables: Map<string, TableSnapshot>;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") return { bigint: value.toString() };
  if (Buffer.isBuffer(value)) return { base64: value.toString("base64") };
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === "object" && value !== null) {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      output[key] = normalizeValue((value as Record<string, unknown>)[key]);
    }
    return output;
  }
  return value;
}

function canonical(value: unknown): string {
  return JSON.stringify(normalizeValue(value)) ?? "null";
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function tableRows(
  db: DatabaseSync,
  tableName: string,
  columns: DatabaseColumn[],
): Map<string, Row> {
  const rows = db
    .prepare(`SELECT * FROM ${quoteIdentifier(tableName)}`)
    .all() as unknown as Row[];
  const primaryKeys = columns
    .filter((column) => column.primaryKeyOrder > 0)
    .sort((left, right) => left.primaryKeyOrder - right.primaryKeyOrder);
  const normalized = rows.map((row) => normalizeValue(row) as Row);
  normalized.sort((left, right) => canonical(left).localeCompare(canonical(right)));
  const output = new Map<string, Row>();
  const duplicateCounts = new Map<string, number>();
  for (const row of normalized) {
    const key = primaryKeys.length
      ? canonical(primaryKeys.map((column) => row[column.name]))
      : digest(canonical(row));
    const index = duplicateCounts.get(key) ?? 0;
    duplicateCounts.set(key, index + 1);
    output.set(primaryKeys.length ? key : `${key}#${index}`, row);
  }
  return output;
}

function tableColumns(db: DatabaseSync, tableName: string): DatabaseColumn[] {
  const rows = db
    .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
    .all() as unknown as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    name: String(row.name),
    type: String(row.type ?? ""),
    notNull: Number(row.notnull) === 1,
    primaryKeyOrder: Number(row.pk ?? 0),
  }));
}

export function inspectDatabase(
  path: string,
  databaseName: "teamops" | "derived-memory",
): InspectedDatabase {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tableRowsResult = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as unknown as Array<{ name: string }>;
    const tables = new Map<string, TableSnapshot>();
    const tableStates: Record<string, TableState> = {};
    for (const { name } of tableRowsResult) {
      const columns = tableColumns(db, name);
      const rows = tableRows(db, name, columns);
      const rowDigest = digest(
        canonical([...rows.entries()].map(([key, row]) => [key, row])),
      );
      const state = {
        columns,
        rowCount: rows.size,
        contentHash: rowDigest,
      } satisfies TableState;
      tables.set(name, { columns, rows, state });
      tableStates[name] = state;
    }
    const hasSchemaMeta = tables.has("schema_meta");
    const schemaRow = hasSchemaMeta
      ? db.prepare("SELECT COALESCE((SELECT version FROM schema_meta WHERE id=1), 0) AS version").get() as { version?: number }
      : db.prepare("PRAGMA user_version").get() as { user_version?: number };
    const integrity = db
      .prepare("PRAGMA integrity_check")
      .all() as unknown as Array<Record<string, unknown>>;
    const foreignKeyErrors = db
      .prepare("PRAGMA foreign_key_check")
      .all() as unknown as unknown[];
    const schemaVersion = Number(hasSchemaMeta
      ? (schemaRow as { version?: number })?.version ?? 0
      : (schemaRow as { user_version?: number })?.user_version ?? 0);
    const databaseHash = digest(canonical({ schemaVersion, tables: tableStates }));
    return {
      state: {
        databaseName,
        schemaVersion,
        integrityPassed: integrity.length === 1 && Object.values(integrity[0] ?? {})[0] === "ok",
        foreignKeyErrors,
        tables: tableStates,
        databaseHash,
      },
      tables,
    };
  } finally {
    db.close();
  }
}

export function databaseChanges(
  before: InspectedDatabase,
  after: InspectedDatabase,
): DatabaseChanges {
  const changedTables: Record<string, DatabaseTableChanges> = {};
  const names = new Set([...before.tables.keys(), ...after.tables.keys()]);
  for (const name of [...names].sort()) {
    const left = before.tables.get(name);
    const right = after.tables.get(name);
    if (!left || !right) {
      changedTables[name] = {
        beforeRowCount: left?.rows.size ?? 0,
        afterRowCount: right?.rows.size ?? 0,
        addedRows: right ? [...right.rows.values()] : [],
        removedRows: left ? [...left.rows.values()] : [],
        updatedRows: [],
      };
      continue;
    }
    if (left.state.contentHash === right.state.contentHash) continue;
    const addedRows: unknown[] = [];
    const removedRows: unknown[] = [];
    const updatedRows: DatabaseTableChanges["updatedRows"] = [];
    for (const [key, row] of right.rows) {
      const oldRow = left.rows.get(key);
      if (!oldRow) addedRows.push(row);
      else if (canonical(oldRow) !== canonical(row)) {
        updatedRows.push({ key, before: oldRow, after: row });
      }
    }
    for (const [key, row] of left.rows) {
      if (!right.rows.has(key)) removedRows.push(row);
    }
    if (addedRows.length || removedRows.length || updatedRows.length) {
      changedTables[name] = {
        beforeRowCount: left.rows.size,
        afterRowCount: right.rows.size,
        addedRows,
        removedRows,
        updatedRows,
      };
    }
  }
  return {
    databaseName: after.state.databaseName,
    beforeHash: before.state.databaseHash,
    afterHash: after.state.databaseHash,
    changedTables,
  };
}

export function emptyChanges(
  databaseName: "teamops" | "derived-memory",
  state: DatabaseState,
): DatabaseChanges {
  return {
    databaseName,
    beforeHash: state.databaseHash,
    afterHash: state.databaseHash,
    changedTables: {},
  };
}

export async function sha256File(path: string): Promise<string> {
  const contents = await readFile(path);
  return createHash("sha256").update(contents).digest("hex");
}

export async function ensureBaselineDatabase(
  sqlPath: string,
  cacheDirectory: string,
): Promise<{ path: string; sqlHash: string; state: DatabaseState }> {
  let sql: Buffer;
  try {
    sql = await readFile(sqlPath);
  } catch (error) {
    throw new Error(`找不到 Athletics 基准 SQL: ${sqlPath}；请先运行 just prepare-athletics-2025（${error instanceof Error ? error.message : String(error)}）`);
  }
  const sqlHash = createHash("sha256").update(sql).digest("hex");
  const path = join(cacheDirectory, `athletics-2025-${sqlHash.slice(0, 16)}.db`);
  await mkdir(cacheDirectory, { recursive: true });
  try {
    await stat(path);
  } catch {
    const temporaryPath = `${path}.tmp-${process.pid}`;
    const db = new DatabaseSync(temporaryPath);
    try {
      db.exec(sql.toString("utf8"));
    } finally {
      db.close();
    }
    await rename(temporaryPath, path);
  }
  const inspected = inspectDatabase(path, "teamops");
  const players = inspected.state.tables.players?.rowCount ?? 0;
  const games = inspected.state.tables.games?.rowCount ?? 0;
  const baselineDb = new DatabaseSync(path, { readOnly: true });
  let ownTeamName = "";
  try {
    ownTeamName = String((baselineDb.prepare("SELECT t.name FROM app_config c JOIN teams t ON t.id = c.own_team_id WHERE c.id = 1").get() as { name?: unknown } | undefined)?.name ?? "");
  } finally {
    baselineDb.close();
  }
  if (!inspected.state.integrityPassed || inspected.state.foreignKeyErrors.length) {
    throw new Error(`Athletics baseline database failed SQLite integrity checks: ${path}`);
  }
  if (players === 0 || games !== 162 || ownTeamName !== "Sacramento Athletics") {
    throw new Error(`Athletics baseline database is not the expected 2025 seed (ownTeam=${ownTeamName || "none"}, players=${players}, games=${games})`);
  }
  return { path, sqlHash, state: inspected.state };
}

export async function copyDatabase(sourcePath: string, destinationPath: string): Promise<void> {
  await mkdir(dirname(destinationPath), { recursive: true });
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    await backup(source, destinationPath);
  } finally {
    source.close();
  }
}
