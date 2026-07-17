import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  AgentSessionRuntime,
  PrintModeOptions,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { runRuntimeCli, type RuntimeCliDependencies } from "./main.ts";
import type { BastionRuntimeHost } from "./runtime-host.ts";

function harness() {
  const calls: string[] = [];
  const runtime = {} as AgentSessionRuntime;
  let output = "";
  const host: BastionRuntimeHost = {
    runtime,
    agentDir: "/private/test-agent",
    async dispose() {
      calls.push("dispose");
    },
  };
  const dependencies: RuntimeCliDependencies = {
    async createHost(options) {
      calls.push(`host:${options.model?.provider ?? "default"}:${options.thinkingLevel ?? "default"}`);
      return host;
    },
    async createSessionManager(options) {
      calls.push(`session:${options.sessionId ?? "new"}`);
      return {} as SessionManager;
    },
    repositoryRoot() {
      return "/private/workspace";
    },
    async runInteractive(received) {
      assert.equal(received, runtime);
      calls.push("interactive");
    },
    async runPrint(received, options: PrintModeOptions) {
      assert.equal(received, runtime);
      calls.push(`print:${options.mode}:${options.initialMessage}`);
      return 6;
    },
    async runRpc(received) {
      assert.equal(received, runtime);
      calls.push("rpc");
    },
    async readStdin() {
      calls.push("stdin");
      return "prompt supplied through stdin";
    },
    writeStdout(value) {
      output += value;
    },
  };
  return { calls, dependencies, getOutput: () => output };
}

describe("runtime CLI dispatch", () => {
  it("runs interactive mode and lets the TUI path dispose the host", async () => {
    const test = harness();
    assert.equal(await runRuntimeCli([], test.dependencies), 0);
    assert.deepEqual(test.calls, [
      "session:new",
      "host:default:default",
      "interactive",
      "dispose",
    ]);
  });

  it("delegates JSON output and disposal ownership to print mode", async () => {
    const test = harness();
    const exitCode = await runRuntimeCli(
      [
        "--mode",
        "json",
        "-p",
        "分析任意球员",
        "--session-id",
        "chat-88",
        "--model",
        "gateway/baseball-v3",
        "--thinking",
        "medium",
      ],
      test.dependencies,
    );
    assert.equal(exitCode, 6);
    assert.deepEqual(test.calls, [
      "session:chat-88",
      "host:gateway:medium",
      "print:json:分析任意球员",
    ]);
  });

  it("delegates persistent lifecycle ownership to RPC mode", async () => {
    const test = harness();
    assert.equal(
      await runRuntimeCli(["--mode", "rpc", "--session-id", "rpc-31"], test.dependencies),
      0,
    );
    assert.deepEqual(test.calls, ["session:rpc-31", "host:default:default", "rpc"]);
  });

  it("reads a print-mode prompt from stdin when cc-connect passes bare -p", async () => {
    const test = harness();
    assert.equal(
      await runRuntimeCli(
        ["--mode", "json", "-p", "--model", "gateway/baseball-v4"],
        test.dependencies,
      ),
      6,
    );
    assert.deepEqual(test.calls, [
      "stdin",
      "session:new",
      "host:gateway:default",
      "print:json:prompt supplied through stdin",
    ]);
  });

  it("answers help before creating session state", async () => {
    const test = harness();
    assert.equal(await runRuntimeCli(["--help"], test.dependencies), 0);
    assert.match(test.getOutput(), /--mode <text\|json\|rpc>/);
    assert.deepEqual(test.calls, []);
  });
});
