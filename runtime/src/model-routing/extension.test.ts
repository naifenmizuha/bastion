import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TaskClassificationError } from "./classifier.ts";
import {
  createModelRoutingExtension,
  recentConversationContext,
} from "./extension.ts";
import { MODEL_ROUTE_ENTRY_TYPE } from "./types.ts";

const simple = { provider: "fake", id: "simple" };
const complex = { provider: "fake", id: "complex" };
const usage = {
  input: 10,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 12,
};

function setup(options: {
  classify: Parameters<typeof createModelRoutingExtension>[0]["classify"];
  initialModel?: typeof simple;
}) {
  const handlers = new Map<string, (event: any, context: any) => any>();
  const modelChanges: string[] = [];
  const defaults: string[] = [];
  const audits: Array<{ type: string; data: any }> = [];
  const statuses: string[] = [];
  const notifications: string[] = [];
  let selectedModel = options.initialModel ?? complex;
  let modelSelectHandler: ((event: any, context: any) => any) | undefined;
  const context = {
    mode: "tui",
    get model() {
      return selectedModel;
    },
    ui: {
      setStatus(_key: string, value: string | undefined) {
        statuses.push(value ?? "");
      },
      notify(message: string) {
        notifications.push(message);
      },
    },
    sessionManager: {
      getEntries() {
        return [
          {
            type: "message",
            message: {
              role: "user",
              content: [{ type: "text", text: "Analyze game 1" }],
            },
          },
          {
            type: "message",
            message: {
              role: "toolResult",
              content: [{ type: "text", text: "large secret tool payload" }],
            },
          },
          {
            type: "message",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Which player?" }],
            },
          },
        ];
      },
    },
  };
  createModelRoutingExtension({
    models: { simple: simple as never, complex: complex as never },
    settingsManager: {
      setDefaultModelAndProvider(provider: string, id: string) {
        defaults.push(`${provider}/${id}`);
      },
    } as never,
    classify: options.classify,
    now: () => Date.parse("2026-07-16T00:00:00.000Z"),
  })({
    on(event: string, handler: (event: any, context: any) => any) {
      handlers.set(event, handler);
      if (event === "model_select") modelSelectHandler = handler;
    },
    async setModel(model: typeof simple) {
      const previousModel = selectedModel;
      selectedModel = model;
      modelChanges.push(model.id);
      await modelSelectHandler?.(
        { type: "model_select", model, previousModel, source: "set" },
        context,
      );
      return true;
    },
    appendEntry(type: string, data: any) {
      audits.push({ type, data });
    },
  } as never);
  return {
    handlers,
    context,
    modelChanges,
    defaults,
    audits,
    statuses,
    notifications,
  };
}

describe("model routing extension", () => {
  it("routes once per user turn, keeps the target through the loop, and restores", async () => {
    const classifierInputs: any[] = [];
    const state = setup({
      classify: async (input) => {
        classifierInputs.push(input);
        return { taskType: "transactional", usage };
      },
    });
    await state.handlers.get("session_start")!({}, state.context);
    await state.handlers.get("before_agent_start")!(
      { prompt: "List the roster" },
      state.context,
    );

    assert.deepEqual(state.modelChanges, ["simple"]);
    assert.equal(classifierInputs.length, 1);
    assert.equal(classifierInputs[0].previousUser, "Analyze game 1");
    assert.equal(classifierInputs[0].previousAssistant, "Which player?");
    assert.doesNotMatch(JSON.stringify(classifierInputs[0]), /secret tool/);
    assert.deepEqual(state.defaults, ["fake/complex"]);
    assert.equal(state.audits[0]?.type, MODEL_ROUTE_ENTRY_TYPE);
    assert.deepEqual(state.audits[0]?.data, {
      version: 1,
      taskType: "transactional",
      targetModel: simple,
      classifierModel: simple,
      classifierUsage: usage,
      timestamp: "2026-07-16T00:00:00.000Z",
    });

    await state.handlers.get("agent_end")!({}, state.context);
    assert.deepEqual(state.modelChanges, ["simple", "complex"]);
    assert.equal(classifierInputs.length, 1);
  });

  it("falls back to the complex model and records classification failures", async () => {
    const state = setup({
      initialModel: simple,
      classify: async () => {
        throw new TaskClassificationError("classifier timed out", usage);
      },
    });
    await state.handlers.get("session_start")!({}, state.context);
    await state.handlers.get("before_agent_start")!(
      { prompt: "Do something" },
      state.context,
    );
    assert.deepEqual(state.modelChanges, ["complex"]);
    assert.equal(state.audits[0]?.data.taskType, "creative");
    assert.equal(state.audits[0]?.data.fallbackReason, "classifier timed out");
    assert.deepEqual(state.audits[0]?.data.classifierUsage, usage);
    await state.handlers.get("agent_end")!({}, state.context);
    assert.deepEqual(state.modelChanges, ["complex", "simple"]);
  });

  it("disables automatic routing after an external manual model selection", async () => {
    let classifications = 0;
    const state = setup({
      classify: async () => {
        classifications += 1;
        return { taskType: "transactional", usage };
      },
    });
    await state.handlers.get("session_start")!({}, state.context);
    await state.handlers.get("model_select")!(
      { model: simple, previousModel: complex, source: "set" },
      state.context,
    );
    await state.handlers.get("before_agent_start")!(
      { prompt: "List players" },
      state.context,
    );
    assert.equal(classifications, 0);
    assert.deepEqual(state.modelChanges, []);
    assert.match(state.notifications[0] ?? "", /disabled/);
    assert.equal(state.statuses.at(-1), "Route: manual");
  });

  it("extracts only the latest user and assistant messages", () => {
    assert.deepEqual(
      recentConversationContext([
        { type: "message", message: { role: "user", content: "old" } },
        { type: "message", message: { role: "assistant", content: "old answer" } },
        { type: "message", message: { role: "user", content: "new" } },
        { type: "message", message: { role: "assistant", content: "new answer" } },
      ]),
      { previousUser: "new", previousAssistant: "new answer" },
    );
  });
});
