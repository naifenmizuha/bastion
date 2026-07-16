import test from "node:test";
import assert from "node:assert/strict";
import { parseEvaluationConfig } from "./config.ts";

test("evaluation TOML accepts prompt arrays and defaults", () => {
  const config = parseEvaluationConfig(`
schema_version = 1
name = "test"
[reviewer]
provider = "p"
model = "m"
[[prompts]]
id = "read-one"
text = "读取一条数据"
`, "test.toml");
  assert.equal(config.prompts.length, 1);
  assert.equal(config.prompts[0]?.writePermission, "allow");
  assert.equal(config.passRules.relevance, 4);
});

test("evaluation TOML also accepts a plain string prompt array", () => {
  const config = parseEvaluationConfig(`
schema_version = 1
name = "simple"
prompts = ["只读查询"]
[reviewer]
provider = "p"
model = "m"
`, "simple.toml");
  assert.equal(config.prompts[0]?.id, "case-1");
  assert.equal(config.prompts[0]?.text, "只读查询");
});

test("evaluation TOML rejects duplicate prompt ids", () => {
  assert.throws(() => parseEvaluationConfig(`
schema_version = 1
name = "test"
[reviewer]
provider = "p"
model = "m"
[[prompts]]
id = "same"
text = "a"
[[prompts]]
id = "same"
text = "b"
`, "test.toml"), /duplicate prompt id/);
});

test("evaluation TOML v2 accepts multi-turn cases and mixed expectations", () => {
  const config = parseEvaluationConfig(`
schema_version = 2
name = "multi"
[reviewer]
provider = "p"
model = "m"
[scoring]
pass_score = 80
[[cases]]
id = "multi-turn"
write_permission = "deny"
[[cases.turns]]
id = "lookup"
prompt = "查询名单"
[[cases.turns.expectations]]
id = "mentions-player"
title = "提到球员"
type = "response_contains"
weight = 3
value = "球员"
[[cases.turns]]
id = "explain"
prompt = "解释结论"
[[cases.turns.expectations]]
id = "uses-teamops"
title = "调用 TeamOps"
type = "tool_called"
weight = 2
tool = "teamops"
command_prefix = ["player", "list"]
[[cases.expectations]]
id = "clear"
title = "表达清晰"
type = "rubric"
weight = 2
criteria = "结论清楚"
anchors = { "1" = "混乱", "3" = "基本清楚", "5" = "非常清楚" }
required_facts = ["来自数据库"]
forbidden = ["编造"]
`, "multi.toml");
  assert.equal(config.schemaVersion, 2);
  assert.equal(config.prompts[0]?.turns.length, 2);
  assert.equal(config.prompts[0]?.expectations[0]?.type, "rubric");
  const toolExpectation = config.prompts[0]?.turns[1]?.expectations[0];
  assert.deepEqual(toolExpectation?.type === "tool_called" ? toolExpectation.commandPrefix : undefined, ["player", "list"]);
  assert.equal(config.scoring.passScore, 80);
});

test("tool expectations reject simultaneous exact and prefix commands", () => {
  assert.throws(() => parseEvaluationConfig(`
schema_version = 2
name = "bad-tool"
[reviewer]
provider = "p"
model = "m"
[[cases]]
id = "bad-tool"
[[cases.turns]]
id = "one"
prompt = "x"
[[cases.turns.expectations]]
id = "tool"
type = "tool_called"
weight = 1
tool = "teamops"
command = ["game", "read"]
command_prefix = ["game"]
`, "bad-tool.toml"), /cannot define both command and command_prefix/);
});

test("evaluation TOML v2 rejects unsafe SQL without requiring a fixed weight total", () => {
  assert.throws(() => parseEvaluationConfig(`
schema_version = 2
name = "bad"
[reviewer]
provider = "p"
model = "m"
[[cases]]
id = "bad"
[[cases.turns]]
id = "one"
prompt = "x"
[[cases.turns.expectations]]
id = "write"
type = "sql"
weight = 1
database = "teamops"
query = "DELETE FROM players"
expected_row_count = 0
`, "bad.toml"), /read-only SELECT\/WITH/);
});

test("evaluation TOML v3 accepts explicit cross-session cases", () => {
  const config = parseEvaluationConfig(`
schema_version = 3
name = "cross-session"
[reviewer]
provider = "p"
model = "m"
[[cases]]
id = "remember"
write_permission = "allow"
[[cases.sessions]]
id = "establish"
[[cases.sessions.turns]]
id = "save"
prompt = "查询并记住"
[[cases.sessions.turns.expectations]]
id = "saved"
type = "tool_called"
weight = 2
tool = "derived_memory"
[[cases.sessions]]
id = "recall"
[[cases.sessions.turns]]
id = "verify"
prompt = "之前的结论是什么？"
[[cases.sessions.turns.expectations]]
id = "recalled"
type = "tool_not_called"
weight = 2
tool = "teamops"
`, "cross-session.toml");
  assert.equal(config.schemaVersion, 3);
  assert.deepEqual(config.prompts[0]?.sessions.map((session) => session.id), ["establish", "recall"]);
  assert.deepEqual(config.prompts[0]?.turns.map((turn) => turn.id), ["save", "verify"]);
  assert.equal(config.prompts[0]?.sessions[1]?.turns[0]?.expectations[0]?.type, "tool_not_called");
});

test("evaluation TOML v3 rejects invalid session layouts", () => {
  const base = (body: string) => `
schema_version = 3
name = "bad-cross-session"
[reviewer]
provider = "p"
model = "m"
[[cases]]
id = "bad"
${body}`;
  assert.throws(() => parseEvaluationConfig(base(`
[[cases.sessions]]
id = "only"
[[cases.sessions.turns]]
id = "one"
prompt = "x"
[[cases.sessions.turns.expectations]]
id = "all"
type = "response_contains"
weight = 1
value = "x"
`), "one-session.toml"), /at least two session/);
  assert.throws(() => parseEvaluationConfig(base(`
[[cases.turns]]
id = "legacy"
prompt = "x"
[[cases.sessions]]
id = "one"
[[cases.sessions.turns]]
id = "one"
prompt = "x"
[[cases.sessions]]
id = "two"
[[cases.sessions.turns]]
id = "two"
prompt = "y"
`), "mixed.toml"), /cannot define both turns and sessions/);
  assert.throws(() => parseEvaluationConfig(base(`
[[cases.sessions]]
id = "same"
[[cases.sessions.turns]]
id = "one"
prompt = "x"
[[cases.sessions]]
id = "same"
[[cases.sessions.turns]]
id = "two"
prompt = "y"
`), "duplicates.toml"), /duplicate session id/);
  assert.throws(() => parseEvaluationConfig(base(`
[[cases.sessions]]
id = "one"
[[cases.sessions.turns]]
id = "same-turn"
prompt = "x"
[[cases.sessions]]
id = "two"
[[cases.sessions.turns]]
id = "same-turn"
prompt = "y"
`), "duplicate-turns.toml"), /duplicate turn id across sessions/);
});
