# Bastion Agent 评测

评测入口接收一个 TOML 文件。v2 使用 `[[cases]]` 定义隔离用例，并在每个用例内顺序运行共享会话与数据库的 `[[cases.turns]]`；v3 使用 `[[cases.sessions]]` 定义多个独立会话。每次用例运行都会从 `out/athletics-2025.sql` 构建/复用基准库副本。基准 SQL 不存在时先执行：

```sh
just prepare-athletics-2025
```

运行示例：

```sh
BASTION_EVAL_REVIEWER_PROVIDER=deepseek \
BASTION_EVAL_REVIEWER_MODEL=deepseek-v4-flash \
just eval evals/athletics-smoke.toml
```

常用筛选：

```sh
just eval evals/athletics-smoke.toml --case team-roster
just eval evals/athletics-smoke.toml --tag safety --output /tmp/bastion-eval
```

## TOML v2 多轮结构

```toml
schema_version = 2
name = "我的评测"
runs = 1
timeout_seconds = 180

[agent]
thinking = "low"

[reviewer]
provider = "deepseek"
model = "deepseek-v4-flash"

[[cases]]
id = "query-roster"
title = "查询名单"
tags = ["read"]
write_permission = "deny"

[[cases.turns]]
id = "lookup"
prompt = "请查询当前球队名单，并用数据库事实支撑回答。"

[[cases.turns.expectations]]
id = "uses-teamops"
title = "使用 TeamOps"
type = "tool_called"
weight = 3
tool = "teamops"
command_prefix = ["player", "list"]

[[cases.turns]]
id = "follow-up"
prompt = "再解释一下你的信息来源。"

[[cases.turns.expectations]]
id = "mentions-source"
title = "说明信息来源"
type = "response_contains"
weight = 2
value = "数据库"

[[cases.expectations]]
id = "clear-answer"
title = "回答清晰"
type = "rubric"
weight = 2
criteria = "回答组织清楚，并区分事实与解释。"
anchors = { "1" = "混乱或误导", "3" = "基本清楚", "5" = "清晰、准确且有证据" }
required_facts = ["说明数据来源"]
forbidden = ["编造未查询的信息"]
```

每个期望项使用正数 `weight` 表达相对重要性，不要求凑固定总数。五个通用质量维度各自权重为 1；运行结果与报告使用“获得权重 / 最大权重 × 100”归一化为百分制，默认 80 分通过。中间预期失败会损失对应权重，但不会阻止后续轮次。

程序性预期支持 `response_contains`、`response_regex`、`tool_called`、`tool_not_called` 和只读 `sql`；创作性 `rubric` 使用明确的 1/3/5 分锚点，由独立 Reviewer 给出评分、原因和证据。硬事实应使用程序性预期校验。旧 `points` 字段暂时兼容，但新配置应使用 `weight`。

`tool_called` 可以只检查工具，也可以用 `command` 精确匹配完整 TeamOps 命令，或用 `command_prefix` 只匹配稳定的命令前缀。`command` 与 `command_prefix` 不能同时配置：

```toml
# 可匹配 game read --id 1、game read --id 2 等命令
tool = "teamops"
command_prefix = ["game", "read"]
```

`tool_not_called` 使用相同的筛选字段，但要求当前轮次内不存在匹配调用。只配置 `tool` 时，可以禁止该轮调用整个工具：

```toml
type = "tool_not_called"
tool = "teamops"
```

现有 `schema_version = 1` 和 `[[prompts]]` 配置仍可运行，执行和通过规则保持不变。

## TOML v3 跨会话结构

v3 case 至少包含两个 session。每个 session 都会销毁并重建 Runtime，不继承前一个 session 的消息；同一 case 内的 TeamOps 数据库、派生记忆和其他持久化 Agent 状态继续共享。

```toml
schema_version = 3
name = "跨会话记忆评测"

[reviewer]
provider = "deepseek"
model = "deepseek-v4-flash"

[[cases]]
id = "remember-season-size"
write_permission = "allow"

[[cases.sessions]]
id = "establish"

[[cases.sessions.turns]]
id = "save"
prompt = "查询本赛季比赛总数，并把有数据依据的结论保存到长期记忆。"

[[cases.sessions.turns.expectations]]
id = "saved-memory"
type = "tool_called"
weight = 2
tool = "derived_memory"
arguments = { action = "save" }

[[cases.sessions]]
id = "recall"

[[cases.sessions.turns]]
id = "verify"
prompt = "不重新查询比赛数据库：我们这个赛季有多少场比赛？说明信息来自哪里。"

[[cases.sessions.turns.expectations]]
id = "recalls-count"
type = "response_regex"
weight = 2
pattern = "162\\s*场?"
```

session ID 与 turn ID 在 case 内必须唯一；每个 session 至少包含一个 turn。v3 不接受顶层 `cases.turns`。评分、筛选、写入权限和 case expectations 与 v2 相同。完整示例见 `evals/attack-so-weak.toml`。

每个运行都会生成 `run-result.json`，以及便于人阅读的 `report.md` / `report.html`。机器和人工都能直接看这些字段：

评测复用 Runtime 自带的扩展、Skill、模型注册和认证，不加载 Bastion 用户设置中的额外 Pi packages。每个用例只隔离数据库、派生记忆和日志，不创建独立的 `npm/node_modules`。

- `execution-flow.json`：执行过程和执行步骤，包含模型请求、工具、TeamOps 命令、Skill、参考文档、记忆操作、写入确认、结果验证和数据库变化。
- `teamops-baseline-state.json` / `teamops-final-state.json`：Athletics 基准库和运行结束时的表、行数、内容哈希、完整性/外键结果。
- `memory-baseline-state.json` / `memory-final-state.json`：派生记忆库状态。
- `database-changes.json`：按表列出新增、删除和更新行，并关联到执行步骤。
- `quality-review.json`：独立质量评审的相关性、好用度、依据充分性、数据库正确性和执行质量分数（1–5）。
- `run-result.json`：包含逐轮 `turns`、逐项 `expectationResults` 及程序性、创作性、通用质量和总分 `score`。
- `messages.json`、`provider-payload.jsonl`：原始对话和开发模式下的模型请求证据。

跨会话用例还会为每个 session 输出 `sessions/<session-id>/messages.json` 和对应的 `provider-payload.jsonl`；根目录 `messages.json` 保留扁平聚合结果，便于兼容既有分析脚本。

代码中的概念名称也按使用者理解命名：`ExecutionFlow` 是“执行过程”，`ExecutionStep` 是“执行步骤”，`RuleCheck` 是“规则检查”，`QualityReview` 是“AI 质量评审”，`BaselineDatabase` 是“Athletics 基准数据库”。
