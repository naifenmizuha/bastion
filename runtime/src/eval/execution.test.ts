import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionRecorder } from "./execution.ts";

function event(value: unknown): any {
  return value;
}

test("execution flow records model, tool, memory and database steps", () => {
  const recorder = new ExecutionRecorder();
  recorder.setTurn("lookup");
  recorder.onEvent(event({ type: "message_start", message: { role: "user", content: "查名单" } }));
  recorder.onEvent(event({ type: "message_start", message: { role: "assistant", content: [] } }));
  recorder.onEvent(event({ type: "tool_execution_start", toolName: "teamops", toolCallId: "call-1", args: { args: ["player", "list"] } }));
  recorder.onEvent(event({
    type: "tool_execution_end",
    toolName: "teamops",
    toolCallId: "call-1",
    result: { details: { kind: "teamops", ok: true, command: ["player", "list"], risk: "read" } },
  }));
  recorder.onEvent(event({ type: "tool_execution_start", toolName: "derived_memory", toolCallId: "call-2", args: { action: "search" } }));
  recorder.onEvent(event({ type: "tool_execution_end", toolName: "derived_memory", toolCallId: "call-2", result: { details: { kind: "derived_memory", ok: true, action: "search" } } }));
  recorder.onEvent(event({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "名单如下" }], usage: { input: 10, output: 3, totalTokens: 13 } } }));
  const flow = recorder.flow;
  assert.ok(flow.steps.some((step) => step.kind === "model_request"));
  assert.ok(flow.steps.some((step) => step.kind === "teamops_command"));
  assert.ok(flow.steps.some((step) => step.kind === "memory_action" && step.status === "succeeded"));
  assert.ok(flow.steps.every((step) => step.turnId === "lookup"));
  assert.equal(recorder.agentUsage.total, 13);
});
