import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export interface SessionMigrationResult {
  copied: number;
  skipped: number;
}

export function sessionDirectoryForAgent(cwd: string, agentDirectory: string): string {
  const safePath = `--${resolve(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(resolve(agentDirectory), "sessions", safePath);
}

export function assertBastionSessionId(id: string): void {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id)) {
    throw new Error(
      "Session id must be non-empty, contain only alphanumeric characters, '-', '_', and '.', and start and end with an alphanumeric character",
    );
  }
}

export function findSessionFileByExactId(
  sessionDirectory: string,
  sessionId: string,
): string | undefined {
  if (!existsSync(sessionDirectory)) return undefined;
  const suffix = `_${sessionId}.jsonl`;
  const match = readdirSync(sessionDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  return match === undefined ? undefined : join(sessionDirectory, match);
}

export function piSessionDirectory(cwd: string): string {
  return sessionDirectoryForAgent(cwd, join(homedir(), ".pi", "agent"));
}

export function legacyBastionSessionDirectory(cwd: string): string {
  return sessionDirectoryForAgent(cwd, join(homedir(), ".bastion", "agent"));
}

export function migrateSessionJsonl(
  sourceDirectory: string,
  targetDirectory: string,
): SessionMigrationResult {
  if (sourceDirectory === targetDirectory || !existsSync(sourceDirectory)) {
    return { copied: 0, skipped: 0 };
  }

  const files = readdirSync(sourceDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) return { copied: 0, skipped: 0 };

  mkdirSync(targetDirectory, { recursive: true });
  let copied = 0;
  let skipped = 0;
  for (const file of files) {
    try {
      copyFileSync(
        join(sourceDirectory, file),
        join(targetDirectory, file),
        constants.COPYFILE_EXCL,
      );
      copied++;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        skipped++;
        continue;
      }
      throw error;
    }
  }
  return { copied, skipped };
}

export async function createBastionSessionManager(options: {
  cwd: string;
  sessionDirectory?: string;
  sessionId?: string;
  migrateLegacy?: boolean;
}): Promise<SessionManager> {
  const sessionDirectory = options.sessionDirectory ?? piSessionDirectory(options.cwd);
  if (options.migrateLegacy !== false && options.sessionDirectory === undefined) {
    migrateSessionJsonl(
      legacyBastionSessionDirectory(options.cwd),
      sessionDirectory,
    );
  }

  if (options.sessionId !== undefined) {
    assertBastionSessionId(options.sessionId);
    const existing = findSessionFileByExactId(sessionDirectory, options.sessionId);
    if (existing) return SessionManager.open(existing, sessionDirectory);
  }

  return SessionManager.create(
    options.cwd,
    sessionDirectory,
    options.sessionId !== undefined ? { id: options.sessionId } : undefined,
  );
}
