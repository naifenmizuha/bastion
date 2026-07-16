import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, it } from "node:test";
import { hyperlink } from "@earendil-works/pi-tui";
import { createDeveloperMode } from "./extension.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "bastion-developer-mode-"));
  temporaryDirectories.push(path);
  return path;
}

function context() {
  const notifications: Array<{ message: string; type?: string }> = [];
  const statuses: Array<{ key: string; text: string | undefined }> = [];
  return {
    value: {
      mode: "tui",
      model: { provider: "test-provider", id: "test-model" },
      ui: {
        notify(message: string, type?: string) {
          notifications.push({ message, type });
        },
        setStatus(key: string, text: string | undefined) {
          statuses.push({ key, text });
        },
      },
    } as never,
    notifications,
    statuses,
  };
}

function setup(
  options: Parameters<typeof createDeveloperMode>[0],
) {
  const handlers = new Map<string, (event: any, context: any) => unknown>();
  let command:
    | {
        handler: (args: string, context: any) => Promise<void>;
      }
    | undefined;
  const developerMode = createDeveloperMode(options);
  developerMode.extension({
    on(event: string, handler: (event: any, context: any) => unknown) {
      handlers.set(event, handler);
    },
    registerCommand(name: string, registered: typeof command) {
      assert.equal(name, "dev");
      command = registered;
    },
  } as never);
  assert.ok(command);
  return { developerMode, handlers, command };
}

describe("developer mode extension", () => {
  it("toggles /dev and writes final agent payloads to a private JSONL file", async () => {
    const root = await temporaryDirectory();
    const logDirectory = join(root, "logs");
    const { developerMode, handlers, command } = setup({
      logDirectory,
      sessionId: "session-1",
      now: () => Date.parse("2026-07-01T12:00:00.000Z"),
    });
    const ctx = context();

    await command.handler("", ctx.value);
    assert.equal(developerMode.isEnabled(), true);
    const logFileLink = hyperlink(
      basename(developerMode.logFilePath),
      pathToFileURL(developerMode.logFilePath).href,
    );
    assert.equal(
      ctx.statuses.at(-1)?.text,
      `Dev log: ${logFileLink}`,
    );
    assert.equal(
      ctx.notifications.at(-1)?.message,
      `Developer mode enabled. LLM payload log: ${logFileLink}`,
    );

    await handlers.get("before_provider_request")!(
      { payload: { system: "real prompt", messages: [{ role: "user" }] } },
      ctx.value,
    );
    const record = JSON.parse(
      (await readFile(developerMode.logFilePath, "utf8")).trim(),
    );
    assert.deepEqual(record, {
      timestamp: "2026-07-01T12:00:00.000Z",
      source: "agent",
      sessionId: "session-1",
      model: { provider: "test-provider", id: "test-model" },
      payload: {
        system: "real prompt",
        messages: [{ role: "user" }],
      },
    });
    assert.equal((await stat(logDirectory)).mode & 0o777, 0o700);
    assert.equal(
      (await stat(developerMode.logFilePath)).mode & 0o777,
      0o600,
    );

    await command.handler("", ctx.value);
    assert.equal(developerMode.isEnabled(), false);
    assert.equal(ctx.statuses.at(-1)?.text, undefined);
    await handlers.get("before_provider_request")!(
      { payload: { ignored: true } },
      ctx.value,
    );
    assert.equal(
      (await readFile(developerMode.logFilePath, "utf8")).trim().split("\n")
        .length,
      1,
    );
  });

  it("records compaction payloads with their own source", async () => {
    const root = await temporaryDirectory();
    const { developerMode, command } = setup({
      logDirectory: join(root, "logs"),
      sessionId: "session-2",
    });
    const ctx = context();

    await command.handler("", ctx.value);
    await developerMode.capturePayload(
      "compaction",
      { input: "summary prompt" },
      { provider: "summary-provider", id: "summary-model" },
      ctx.value,
    );

    const record = JSON.parse(
      (await readFile(developerMode.logFilePath, "utf8")).trim(),
    );
    assert.equal(record.source, "compaction");
    assert.deepEqual(record.model, {
      provider: "summary-provider",
      id: "summary-model",
    });
    assert.deepEqual(record.payload, { input: "summary prompt" });
  });

  it("records router payloads with their own source", async () => {
    const root = await temporaryDirectory();
    const { developerMode, command } = setup({
      logDirectory: join(root, "logs"),
      sessionId: "session-router",
    });
    const ctx = context();

    await command.handler("", ctx.value);
    await developerMode.capturePayload(
      "router",
      { input: "classification prompt" },
      { provider: "simple-provider", id: "simple-model" },
      ctx.value,
    );

    const record = JSON.parse(
      (await readFile(developerMode.logFilePath, "utf8")).trim(),
    );
    assert.equal(record.source, "router");
    assert.deepEqual(record.model, {
      provider: "simple-provider",
      id: "simple-model",
    });
  });

  it("uses a distinct log path for each session id", () => {
    const first = createDeveloperMode({
      logDirectory: "/tmp/bastion-logs",
      sessionId: "first",
    });
    const second = createDeveloperMode({
      logDirectory: "/tmp/bastion-logs",
      sessionId: "second",
    });

    assert.notEqual(first.logFilePath, second.logFilePath);
    assert.match(first.logFilePath, /first\.provider-payload\.jsonl$/);
    assert.match(second.logFilePath, /second\.provider-payload\.jsonl$/);
  });

  it("disables logging after a write failure without rejecting the provider hook", async () => {
    const ctx = context();
    const { developerMode, handlers, command } = setup({
      logDirectory: "/unused",
      sessionId: "broken",
      prepareLogFile: async () => {},
      appendLogLine: async () => {
        throw new Error("disk full");
      },
    });

    await command.handler("", ctx.value);
    await assert.doesNotReject(async () => {
      await handlers.get("before_provider_request")!(
        { payload: { prompt: "still send this" } },
        ctx.value,
      );
    });
    assert.equal(developerMode.isEnabled(), false);
    assert.equal(ctx.statuses.at(-1)?.text, undefined);
    assert.match(ctx.notifications.at(-1)?.message ?? "", /disk full/);
    assert.equal(ctx.notifications.at(-1)?.type, "error");
  });

  it("rejects arguments without changing the mode", async () => {
    const root = await temporaryDirectory();
    const ctx = context();
    const { developerMode, command } = setup({
      logDirectory: join(root, "logs"),
      sessionId: "session-3",
    });

    await command.handler("on", ctx.value);

    assert.equal(developerMode.isEnabled(), false);
    assert.equal(ctx.notifications.at(-1)?.message, "Usage: /dev");
    assert.equal(ctx.notifications.at(-1)?.type, "warning");
  });
});
