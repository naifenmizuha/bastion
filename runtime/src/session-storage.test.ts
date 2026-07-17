import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertBastionSessionId,
  createBastionSessionManager,
  migrateSessionJsonl,
  sessionDirectoryForAgent,
} from "./session-storage.ts";

describe("runtime session storage", () => {
  it("encodes cwd using the Pi-compatible session directory shape", () => {
    const path = sessionDirectoryForAgent("/srv/club:west", "/var/lib/bastion-agent");
    assert.equal(path, "/var/lib/bastion-agent/sessions/--srv-club-west--");
  });

  it("copies legacy JSONL without deleting or overwriting files", () => {
    const root = mkdtempSync(join(tmpdir(), "bastion-session-migration-"));
    const source = join(root, "legacy");
    const target = join(root, "pi");
    mkdirSync(source);
    mkdirSync(target);
    writeFileSync(join(source, "first.jsonl"), "legacy-first\n");
    writeFileSync(join(source, "second.jsonl"), "legacy-second\n");
    writeFileSync(join(source, "ignore.txt"), "not-a-session\n");
    writeFileSync(join(target, "second.jsonl"), "newer-target\n");

    assert.deepEqual(migrateSessionJsonl(source, target), {
      copied: 1,
      skipped: 1,
    });
    assert.equal(readFileSync(join(source, "first.jsonl"), "utf8"), "legacy-first\n");
    assert.equal(readFileSync(join(target, "first.jsonl"), "utf8"), "legacy-first\n");
    assert.equal(readFileSync(join(target, "second.jsonl"), "utf8"), "newer-target\n");
  });

  it("creates and reopens the exact requested session across host constructions", async () => {
    const root = mkdtempSync(join(tmpdir(), "bastion-session-resume-"));
    const cwd = join(root, "workspace");
    const sessionDirectory = join(root, "sessions");
    mkdirSync(cwd);

    const first = await createBastionSessionManager({
      cwd,
      sessionDirectory,
      sessionId: "bridge-run-204",
      migrateLegacy: false,
    });
    first.appendMessage({
      role: "user",
      content: [{ type: "text", text: "persisted context" }],
      timestamp: Date.now(),
    });
    const firstFile = first.getSessionFile();
    assert.ok(firstFile);
    writeFileSync(
      firstFile,
      [first.getHeader(), ...first.getEntries()]
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n",
    );

    const resumed = await createBastionSessionManager({
      cwd,
      sessionDirectory,
      sessionId: "bridge-run-204",
      migrateLegacy: false,
    });
    assert.equal(resumed.getSessionId(), "bridge-run-204");
    assert.equal(resumed.getSessionFile(), firstFile);
    assert.equal(resumed.getEntries().length, 1);
  });

  it("rejects IDs outside the upstream Pi session-ID contract", () => {
    for (const invalid of ["", "-leading", "trailing_", "contains space", "slash/id"]) {
      assert.throws(() => assertBastionSessionId(invalid), /Session id/);
    }
    for (const valid of ["a", "run-7", "thread_9", "release.12"]) {
      assert.doesNotThrow(() => assertBastionSessionId(valid));
    }
  });
});
