import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { parseRuntimeCliArgs, runtimeVersion } from "./cli.ts";

describe("runtime CLI arguments", () => {
  it("keeps the argument-free invocation interactive", () => {
    assert.deepEqual(parseRuntimeCliArgs([]), {
      mode: "interactive",
      print: false,
      help: false,
      version: false,
    });
  });

  it("parses each headless mode and preserves generalized prompt values", () => {
    assert.deepEqual(
      parseRuntimeCliArgs([
        "--mode",
        "json",
        "-p",
        "比较任意两段时期的表现",
        "--session-id",
        "remote-session.27",
        "--model",
        "relay/vendor/model-v2",
        "--thinking",
        "xhigh",
      ]),
      {
        mode: "json",
        print: true,
        prompt: "比较任意两段时期的表现",
        sessionId: "remote-session.27",
        model: { provider: "relay", id: "vendor/model-v2" },
        thinkingLevel: "xhigh",
        help: false,
        version: false,
      },
    );
    assert.equal(parseRuntimeCliArgs(["--mode", "text", "--print", "概括赛程"]).mode, "text");
    assert.equal(parseRuntimeCliArgs(["--mode", "text", "-p", "--- concise answer"]).prompt, "--- concise answer");
    assert.deepEqual(
      parseRuntimeCliArgs(["--mode", "json", "-p", "--model", "relay/model"]),
      {
        mode: "json",
        print: true,
        model: { provider: "relay", id: "model" },
        help: false,
        version: false,
      },
    );
    assert.equal(parseRuntimeCliArgs(["--mode", "rpc"]).mode, "rpc");
    assert.equal(
      parseRuntimeCliArgs(["--mode", "rpc", "--session", "stable-42"]).sessionId,
      "stable-42",
    );
  });

  it("rejects missing values, invalid enums, conflicts, and unknown arguments", () => {
    const cases: Array<[string[], RegExp]> = [
      [["--mode"], /requires a value/],
      [["--mode", "stream"], /invalid --mode/],
      [["--mode", "json"], /requires -p/],
      [["--mode", "rpc", "-p", "unexpected"], /cannot accept/],
      [["--mode", "rpc", "--thinking", "extreme"], /invalid --thinking/],
      [["--mode", "rpc", "--model", "model-only"], /provider\/model/],
      [["--session-id", "orphan"], /--mode is required/],
      [["--mode", "rpc", "--session", "first", "--session-id", "second"], /only be specified once/],
      [["--mode", "rpc", "--mystery"], /unknown argument/],
      [["--help", "--version"], /cannot be combined/],
    ];
    for (const [args, expected] of cases) {
      assert.throws(() => parseRuntimeCliArgs(args), expected);
    }
  });

  it("reports the package version without constructing a runtime", () => {
    assert.match(runtimeVersion(), /^\d+\.\d+\.\d+/);
  });

  it("runs the repository wrapper independently of the caller cwd", () => {
    const wrapper = fileURLToPath(new URL("../../out/bastion-runtime", import.meta.url));
    const cwd = mkdtempSync(resolve(tmpdir(), "bastion-wrapper-"));
    const result = spawnSync(wrapper, ["--version"], {
      cwd,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), runtimeVersion());
  });
});
