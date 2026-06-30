# Agent Runtime 需求

## 背景

Bastion CLI 已负责棒球队管理的权威领域能力,包括球员、训练报告、比赛、阵容、训练推荐和表现分析。Pi Agent 提供基础智能体循环,能够理解用户意图、调用工具并继续推理。

仅在 Pi 上增加领域提示词和若干 CLI 工具包装,可以完成基础对话任务,但不足以支撑长期、复杂和可恢复的球队管理工作:

- 对话历史增长后,重要约束容易被压缩或遗忘。
- 用户偏好、临时信息和权威事实容易混在一起。
- 一个 Agent 同时负责规划、查询、批评和写入,权限过大且难以审计。
- 多个独立查询无法稳定并行,复杂任务容易重复调用工具。
- 会话中断后缺少可恢复的任务状态。
- 写操作缺少统一审批、幂等和失败恢复机制。
- 难以评估一次 Agent 运行为什么成功或失败。

因此需要在 Pi Agent 循环之上增加一层 Agent Runtime。Runtime 不实现棒球领域规则,而是提供通用的智能体基础设施,让领域插件可以可靠地组织长期记忆、上下文、子 Agent 和工具调用。

## 产品定位

Agent Runtime 是 Pi Agent 与领域工具之间的控制层:

```text
用户
  ↓
Pi Agent Loop
  ↓
Agent Runtime
  ├─ Orchestrator
  ├─ Task State Machine
  ├─ Memory Manager
  ├─ Context Manager
  ├─ Subagent Manager
  ├─ Tool Manager
  ├─ Artifact Store
  ├─ Approval Manager
  └─ Observability
  ↓
领域插件与工具适配器
  ↓
Bastion CLI
```

职责边界:

- Bastion CLI 保存权威领域事实并执行领域校验。
- Pi Agent 负责语言理解和基础推理循环。
- Agent Runtime 负责推理过程的组织、隔离、恢复和治理。
- 领域插件声明可用工具、任务模板、角色能力和记忆策略。
- Runtime 不自行计算棒球统计,不复制阵容校验规则,不直接访问 Bastion SQLite。

## 目标

- 支持跨会话、可追溯、可修正的长期记忆。
- 根据任务和 token 预算动态装配最小充分上下文。
- 将复杂任务拆分为可并行、可取消、可重试的子 Agent DAG。
- 对工具调用执行 schema 校验、权限控制、幂等、缓存和重试。
- 对权威写操作实施统一人工确认。
- 将中间结果保存为结构化 Artifact,避免只存在于对话文本中。
- 通过持久化状态机支持中断恢复。
- 为每次运行提供完整 trace、指标和可重复评估。
- 允许领域插件复用 Runtime,而不把 Runtime 写死为棒球队专用。

## 非目标

- 不重新实现 Pi 的模型调用和基础 tool-use loop。
- 不在 Runtime 中实现棒球领域规则。
- 不让子 Agent 直接操作 Bastion 数据库。
- 不以无限自治为目标;高风险写操作必须经过审批。
- MVP 不训练或微调基础模型。
- MVP 不实现分布式多机调度。
- MVP 不依赖向量数据库才能运行;先支持结构化和全文检索。
- MVP 不允许 Agent 自动把任意对话内容升级为永久记忆。

## 核心概念

### Run

一次从用户目标开始、到完成或终止的执行实例。Run 可以跨多个 Pi 对话轮次,也可以在进程重启后恢复。

### Task

Run 中可调度的工作单元。Task 可以由主 Agent 或子 Agent执行,并形成有向无环依赖图。

### Artifact

Agent 或工具产生的结构化中间结果,例如球员快照、候选阵容、CLI 校验结果、决策比较和消息草稿。Artifact 是 Agent 之间传递结果的主要载体。

### Memory

经过选择、带来源和生命周期的跨任务信息。Memory 不等于聊天记录,也不等于 Artifact。

### Context Snapshot

某次模型调用实际获得的上下文清单和版本快照,用于恢复、审计和复现。

### Tool Invocation

一次完整的工具调用记录,包含调用者、参数、权限判断、审批、结果、耗时、重试和幂等信息。

## 总体运行流程

```text
接收用户目标
  ↓
创建或恢复 Run
  ↓
检索相关记忆和未完成 Artifact
  ↓
Planner 生成 Task DAG
  ↓
Subagent Manager 调度只读和推理任务
  ↓
Artifact Store 收集中间产物
  ↓
Context Manager 为下一步装配上下文
  ↓
Critic 检查证据、假设和目标覆盖
  ↓
需要写入?
  ├─ 否:生成最终响应
  └─ 是:创建 Approval Request
          ↓
        用户确认
          ↓
        Executor 调用权威写工具
          ↓
        Verifier 重新读取并验证结果
  ↓
完成 Run
  ↓
Memory Manager 提取候选记忆并按策略写入
```

## Orchestrator

Orchestrator 是 Runtime 的主控制器,但不直接承担所有推理。

职责:

- 创建、暂停、恢复和终止 Run。
- 维护任务状态机和 Task DAG。
- 请求 Planner 拆解目标。
- 将就绪 Task 交给 Subagent Manager。
- 根据 Artifact 和工具结果推进状态。
- 检测无进展循环、重复调用和预算耗尽。
- 在需要用户输入或审批时暂停运行。
- 在失败后选择重试、降级、重新规划或终止。
- 确保 Run 结束前不存在仍在运行的子任务。

Orchestrator 的决策必须记录为事件,不能只存在于模型消息中。

## 任务状态机

### Run 状态

```text
created
planning
gathering_context
executing
waiting_for_input
waiting_for_approval
verifying
completed
failed
cancelled
```

状态规则:

- `completed` 只能在目标达成且必需 Task 全部完成后进入。
- `waiting_for_input` 表示缺少用户信息,不等于失败。
- `waiting_for_approval` 必须关联未解决的 Approval Request。
- `failed` 必须记录不可恢复原因和最后稳定状态。
- `cancelled` 会向所有运行中子 Agent 传播取消信号。

### Task 状态

```text
pending
ready
running
waiting
succeeded
failed
cancelled
skipped
```

Task 只有在全部依赖 `succeeded` 或被策略允许跳过后才能进入 `ready`。

### 事件日志

每次状态变化追加不可变事件:

```json
{
  "event_id": "evt_01",
  "run_id": "run_01",
  "task_id": "task_03",
  "type": "task_succeeded",
  "actor": "subagent:data-reader-1",
  "payload": {
    "artifact_ids": ["artifact_roster_12"]
  },
  "created_at": "2026-07-02T10:00:00Z"
}
```

当前状态由事件投影得到,允许保存快照提升恢复速度。

## Memory Manager

### 记忆分层

#### Working Memory

仅服务当前 Run:

- 当前目标
- 已确认约束
- 待解决问题
- 当前计划
- 最近工具结果摘要

Run 完成后不直接永久保存。

#### Episodic Memory

记录一次完整经历:

- 用户目标
- 使用了哪些工具和 Artifact
- Agent 提出哪些候选
- 用户选择或修改了什么
- 最终执行结果

用于回答“上次怎么处理的”和提取长期规律。

#### Semantic Memory

跨任务相对稳定的知识:

- 人员别名
- 教练沟通偏好
- 常用工作流程
- 用户明确表达的长期习惯

Semantic Memory 不能覆盖 Bastion CLI 的权威领域事实。

#### Procedural Memory

成功完成某类任务的过程知识:

- 任务模板
- 常用工具序列
- 失败后的有效修正步骤
- 特定类型任务的上下文需求

Procedural Memory 为 Planner 提供参考,但不能绕过实时工具校验。

#### Decision Memory

专门保存候选、人工选择和最终修改之间的关系:

```text
候选方案
→ 用户选择
→ 用户修改
→ 最终执行
→ 后续反馈
```

用于学习交互偏好和减少重复修改。

### 记忆结构

```json
{
  "memory_id": "mem_01",
  "type": "semantic",
  "subject": "coach:王教练",
  "predicate": "prefers_response_style",
  "object": "concise_with_risks",
  "scope": ["team:first", "workflow:lineup"],
  "confidence": 0.9,
  "authority": "user_explicit",
  "source_refs": ["event_102", "message_44"],
  "valid_from": "2026-07-01T00:00:00Z",
  "valid_until": null,
  "last_confirmed_at": "2026-07-01T00:00:00Z",
  "created_at": "2026-07-01T00:00:00Z",
  "supersedes": null
}
```

### 权威等级

从高到低:

```text
tool_authoritative
user_explicit
user_confirmed_inference
agent_inference
generated_summary
```

规则:

- CLI 事实不得被低权威记忆覆盖。
- Agent 推断默认不能直接成为高置信度长期记忆。
- 用户明确纠正时创建新版本并 supersede 旧记忆。
- 冲突记忆均保留来源,检索时按权威、时效和作用域排序。

### 写入流程

```text
候选记忆提取
→ 敏感性检查
→ 去重
→ 冲突检测
→ 置信度计算
→ 根据策略自动写入或请求确认
→ 建立来源引用
```

自动写入范围应限制为低风险的任务过程信息。人员偏好、身份映射和可能影响决策的推断应请求确认或等待重复证据。

### 检索流程

检索必须综合:

- 当前任务类型
- 涉及实体
- 时间范围
- 作用域
- 权威等级
- 置信度
- 新鲜度
- 预计 token 成本

返回结果包含内容和来源,不能只返回无出处摘要。

### Consolidation

后台或 Run 结束时执行:

- 将重复 episode 合并为摘要。
- 从多次明确选择中提取候选偏好。
- 降低长期未确认推断的置信度。
- 标记互相冲突的记忆。
- 保留原始 episode 引用,不破坏可追溯性。

### 遗忘与删除

- 支持按 memory id、人员、作用域删除。
- `valid_until` 到期后默认不进入上下文。
- 删除用户记忆后,派生摘要也应失效或重新计算。
- Runtime 不应把删除内容残留在长期 prompt 模板中。

## Context Manager

### 上下文区域

每次模型调用的上下文按固定区域装配:

```text
1. Runtime policy
2. Agent role and capability
3. Current goal
4. Task contract
5. Authoritative facts
6. User constraints
7. Retrieved memories
8. Dependency artifacts
9. Recent tool results
10. Open questions
11. Output schema
```

不同区域不能互相伪装。例如 Agent 推断不得进入 `authoritative facts`。

### Token 预算

Context Manager 接收总预算并动态分配:

| 区域 | 默认策略 |
| --- | --- |
| Runtime policy | 固定上限 |
| Current goal / task contract | 完整保留 |
| Authoritative facts | 高优先级 |
| User constraints | 高优先级 |
| Retrieved memories | 按相关性裁剪 |
| Artifacts | 默认放摘要和引用 |
| Recent conversation | 滑动窗口 |
| Output reserve | 预留固定比例 |

上下文不能使用视口宽度或简单字符数估算,应以模型 token 计数为准。

### 压缩策略

- 原始 Artifact 永久保存在 Artifact Store。
- 上下文只放结构化摘要和 `artifact_id`。
- 摘要必须保留数字、限制、来源和未解决项。
- 多次压缩不得对摘要继续摘要而丢失原始引用。
- 权威工具结果更新时,旧摘要标记 stale。
- 未完成任务、审批和错误不得在压缩中被删除。

### Context Snapshot

每次模型调用保存:

- 使用的 policy 版本
- memory ids
- artifact ids 和版本
- 工具结果引用
- token 分配
- 截断或压缩记录
- 最终 prompt hash

Snapshot 用于调试和复现,不要求默认保存完整敏感 prompt。

### 子 Agent 上下文隔离

- 子 Agent 只获取任务所需的实体和 Artifact。
- 默认不共享完整用户对话。
- 子 Agent 的推断先进入自己的输出 Artifact。
- 只有 Orchestrator 接受后才能进入 Run Working Memory。
- 敏感记忆按 capability 和 scope 过滤。

## Subagent Manager

### 角色模型

Runtime 提供角色模板,领域插件可以扩展:

| 角色 | 职责 | 默认工具权限 |
| --- | --- | --- |
| planner | 拆解目标并生成 Task DAG | 无权威写工具 |
| data_reader | 查询权威事实 | 只读 |
| candidate | 生成候选 Artifact | 只读和 validate |
| critic | 检查证据、假设和目标覆盖 | 只读 |
| executor | 执行已批准写操作 | 受审批约束的写权限 |
| verifier | 写后重新读取并确认结果 | 只读 |
| communicator | 生成面向不同对象的表达 | 无领域写权限 |

角色是 capability 模板,不是必须常驻的固定 Agent。Orchestrator 按任务创建实例。

### Task Contract

创建子 Agent 时必须提供结构化契约:

```json
{
  "task_id": "task_candidate_1",
  "goal": "基于给定事实生成守备优先候选阵容",
  "input_artifacts": [
    "artifact_game_12",
    "artifact_roster_12",
    "artifact_preferences"
  ],
  "allowed_tools": [
    "bastion.lineup.validate"
  ],
  "output_schema": "candidate_lineup_v1",
  "budgets": {
    "max_tokens": 8000,
    "max_tool_calls": 4,
    "timeout_ms": 120000
  }
}
```

没有输出 schema 的开放式子任务应限制使用。

### DAG 调度

- 依赖满足后 Task 进入 `ready`。
- 无依赖的只读查询可以并行。
- 共享同一幂等工具请求时合并调用。
- 对同一权威资源的写任务串行执行。
- 父任务取消时递归取消子任务。
- 子任务失败后按策略重试、替代或重新规划。
- 并发数、总 token 和总工具调用数受 Run 预算限制。

### 结果合并

子 Agent 通过 Artifact 协作,不直接互相修改消息:

- 每个 Artifact 声明 producer、依赖和 schema。
- 合并时不丢弃来源。
- 冲突结果由 Critic 或 Orchestrator 显式裁决。
- 不通过“少数服从多数”决定权威事实。
- 多个候选应保留差异,不能过早合并成平均方案。

### 防循环机制

检测:

- 相同 Agent 重复相同工具调用。
- 任务在无新 Artifact 情况下反复重新规划。
- 两个子 Agent 互相委派。
- 校验失败后重复提交完全相同输入。
- 达到调用预算仍无状态进展。

触发后应暂停、降级或请求用户输入。

## Tool Manager

### 工具注册

每个工具注册:

```json
{
  "name": "bastion.lineup.accept",
  "adapter": "bastion_cli",
  "input_schema": "lineup_accept_v1",
  "output_schema": "lineup_accept_result_v1",
  "risk": "authoritative_write",
  "idempotency": "required",
  "cache": "disabled",
  "required_capabilities": ["lineup:accept"],
  "approval_policy": "user_confirmation"
}
```

### 风险级别

| 级别 | 示例 | 默认策略 |
| --- | --- | --- |
| read | list/read/analysis | 可自动执行 |
| compute | validate/generate analysis draft | 可自动执行,限制预算 |
| draft_write | 保存候选方案 | 可配置是否确认 |
| authoritative_write | accept/approve/final score | 必须确认 |
| destructive | 删除、覆盖不可恢复数据 | MVP 默认禁止 |

### 调用前处理

- 检查调用者 capability。
- 校验输入 schema 和必填字段。
- 计算规范化参数 hash。
- 检查审批和幂等要求。
- 检查相同请求缓存或运行中调用。
- 检查 Run 和 Task 调用预算。
- 记录 invocation started 事件。

### 调用后处理

- 解析结构化输出。
- 校验输出 schema。
- 区分业务错误、临时错误和内部错误。
- 保存完整结果 Artifact。
- 更新 cache freshness。
- 记录耗时、退出码和重试次数。
- 权威写入后自动创建 verifier task。

### 重试策略

- 参数和领域校验错误不自动原样重试。
- 超时、临时锁和可识别的临时进程错误允许有限重试。
- 每次重试使用同一 idempotency key。
- 重试前应用退避并检查 Run 是否已取消。
- 达到预算后返回结构化失败,交给 Orchestrator 重新规划。

### 缓存

- 只读工具可按参数 hash 缓存。
- 缓存条目包含数据版本、来源和 `fresh_until`。
- 权威写操作成功后使相关读缓存失效。
- 用户明确要求“最新”时不得使用过期缓存。
- 缓存不改变 Artifact 的来源信息。

### Bastion CLI Adapter

适配器职责:

- 使用参数数组启动进程,不拼接 shell 字符串。
- 统一传入数据库路径和 JSON 输出格式。
- 复杂输入通过 stdin。
- 分别捕获 stdout、stderr、退出码和超时。
- 只接受合法 JSON envelope。
- 将 CLI `ok:false` 转换为结构化 Tool Error。
- 不直接读取或写入 Bastion SQLite。

## Approval Manager

### Approval Request

```json
{
  "approval_id": "approval_01",
  "run_id": "run_01",
  "tool": "bastion.lineup.accept",
  "summary": "将候选阵容3设为比赛12正式阵容",
  "argument_hash": "sha256:...",
  "risk": "authoritative_write",
  "expires_at": "2026-07-02T12:00:00Z",
  "status": "pending"
}
```

### 确认令牌

- 确认与规范化参数 hash 绑定。
- 修改参数后原确认失效。
- 令牌只能使用一次。
- 令牌有过期时间和确认用户。
- Executor 必须同时具备 capability 和有效令牌。
- 子 Agent 不能自行生成或批准令牌。

### 批量确认

MVP 默认每个权威写操作单独确认。后续可允许用户明确批准具有固定边界的一组操作,但必须展示操作列表和失败策略。

## Artifact Store

### Artifact 结构

```json
{
  "artifact_id": "artifact_candidate_1",
  "run_id": "run_01",
  "task_id": "task_candidate_1",
  "type": "candidate_lineup",
  "schema_version": "1.0",
  "producer": "subagent:candidate-1",
  "authority": "agent_generated",
  "dependency_ids": [
    "artifact_roster_12",
    "artifact_game_12"
  ],
  "payload": {},
  "content_hash": "sha256:...",
  "created_at": "2026-07-02T10:00:00Z",
  "stale_at": null
}
```

要求:

- Artifact 默认不可变;修改产生新版本。
- 相同内容可以按 hash 去重。
- Artifact 声明 schema 和依赖。
- 权威源变化时,依赖 Artifact 标记 stale。
- 大型 payload 可存文件或对象存储,元数据仍在 Runtime 数据库。
- Agent 输出文本不能替代必需的结构化 Artifact。

## 持久化模型

MVP 可以使用独立 SQLite 数据库,不得与 Bastion 业务表混用。

建议表:

```text
runs
run_events
tasks
task_dependencies
artifacts
artifact_dependencies
memories
memory_sources
context_snapshots
subagent_instances
tool_invocations
approval_requests
runtime_locks
```

Runtime 数据库保存智能体过程状态;Bastion 数据库保存球队权威业务状态。

## 配置模型

领域插件提供声明式配置:

```yaml
plugin: bastion-team-manager
runtime_policy_version: 1

roles:
  - planner
  - data_reader
  - candidate
  - critic
  - executor
  - verifier

tools:
  adapter: bastion_cli
  executable: ./out/bastion

budgets:
  max_subagents: 4
  max_parallel_tools: 4
  max_tool_calls_per_run: 40
  max_replans: 3

memory:
  auto_write:
    - procedural
  require_confirmation:
    - identity_alias
    - preference

approval:
  authoritative_write: required
  destructive: denied
```

配置不能授予适配器未注册的 capability。

## 典型流程

### 生成并确认比赛阵容

```text
1. Orchestrator 创建 lineup_planning Run。
2. Planner 生成比赛、球员、近期表现和记忆检索任务。
3. Data Reader 并行调用 Bastion 只读命令。
4. Context Manager 生成权威事实快照。
5. 多个 Candidate Agent 生成不同目标的候选。
6. Tool Manager 调用 lineup validate。
7. 失败候选根据结构化错误在预算内修正。
8. Critic 输出候选差异、证据和未确认假设。
9. 用户选择候选。
10. Runtime 创建 lineup write/accept Approval Request。
11. Executor 使用确认令牌执行。
12. Verifier 调用 game read 和 lineup read。
13. Run 完成。
14. Memory Manager 保存 episode 和用户修改差异。
```

### 会话中断恢复

```text
1. Pi 会话或进程中断。
2. Runtime 从事件日志恢复 Run 和 Task 投影。
3. 检查 running Task 的 lease。
4. 已过期任务标记为 interrupted。
5. 已成功工具调用通过幂等记录复用结果。
6. 未完成只读任务重新入队。
7. 未使用的 Approval Request 保持 pending 或按时间过期。
8. Context Manager 基于 Artifact 重新构建上下文。
9. Orchestrator 从最后稳定状态继续。
```

### 记忆冲突

```text
已有记忆:教练偏好简短报告
新表达:以后复盘请给详细数据

1. 提取新候选记忆。
2. 发现 subject/predicate/scope 冲突。
3. 新记忆 authority=user_explicit。
4. 新记忆 supersede 旧记忆。
5. 旧记忆保留用于审计,但不再进入活跃检索。
```

## 安全与可靠性

- Runtime 进程不得绕过 Tool Manager 调用权威写工具。
- 子 Agent capability 使用 allowlist。
- 工具参数和输出必须经过 schema 校验。
- CLI 路径、数据库路径和环境变量由受信配置提供。
- 不把未经清理的工具输出直接拼入 system policy。
- Memory 中的外部内容按不可信数据处理,不能作为指令执行。
- 审批、工具调用和状态变化必须审计。
- 持久化敏感 prompt 时支持关闭、脱敏或加密。
- Run 恢复时不得重复执行已成功的权威写操作。

## 可观测性

### Trace

每个 Run 提供树状 trace:

```text
run
├─ planning span
├─ memory retrieval span
├─ task:data-game span
│  └─ tool invocation
├─ task:data-player span
│  └─ tool invocation
├─ task:candidate span
├─ task:critic span
├─ approval span
├─ executor span
└─ verifier span
```

### 指标

- Run 成功率和平均耗时
- Task 重试、失败和取消率
- 每个角色 token 使用量
- 工具调用次数、耗时和错误率
- 缓存命中率
- 平均重新规划次数
- 校验失败后的修正轮次
- 未经确认写操作拦截数
- 中断恢复成功率
- 用户最终修改候选的比例
- 记忆检索命中和被采用比例

### 调试视图

应能回答:

- 为什么创建这个子 Agent?
- 它获得了哪些上下文?
- 为什么调用这个工具?
- 哪条记忆影响了决策?
- 哪个 Artifact 是最终结果的来源?
- 为什么发生重试或重新规划?
- 哪个确认令牌授权了写操作?

## Agent 评估

### 离线场景集

至少覆盖:

- 单次只读查询
- 多工具依赖任务
- 可并行数据收集
- 工具业务校验失败后的修正
- 子 Agent 超时和替代
- 用户输入等待和恢复
- 权威写操作审批
- 写成功但响应丢失后的幂等恢复
- 记忆冲突和用户纠正
- 上下文超预算压缩
- 会话中断恢复
- 循环工具调用拦截

### 核心断言

- 不把 Agent 推断标记为权威事实。
- 不向无权限子 Agent 暴露写工具。
- 不未经审批执行权威写操作。
- 相同幂等写操作最多执行一次。
- 子 Agent 只能读取任务契约允许的上下文。
- 任务完成后不存在泄漏的运行实例。
- Artifact 可以追溯到工具结果或模型调用。
- 删除记忆后不会继续进入新 Context Snapshot。

## 分阶段实现

### Phase 1:可恢复单 Agent Runtime

- Run/Task 状态机
- 事件日志
- Artifact Store
- Tool Registry 和 Bastion Adapter
- 工具 schema 校验
- Approval Manager
- 单 Agent 上下文快照

此阶段先不启用并行子 Agent,但所有数据结构按多 Agent 设计。

### Phase 2:上下文与记忆

- Working/Episodic/Semantic Memory
- 权威等级和来源
- 结构化检索
- Context Builder 和 token 预算
- 摘要与 stale 管理
- 记忆查看、修正和删除

### Phase 3:子 Agent 调度

- 角色 capability
- Task DAG
- 并发调度
- 超时、取消和预算
- Artifact 合并
- Critic 和 Verifier 角色
- 防循环机制

### Phase 4:学习与优化

- Procedural/Decision Memory
- Consolidation
- 候选选择差异分析
- 缓存和调用合并
- 离线评估框架
- Trace 可视化和性能调优

## MVP 验收标准

1. Runtime 能创建一个持久化 Run,进程重启后继续执行。
2. 每个 Task 都有明确依赖、状态、预算和输出 Artifact。
3. 所有 Bastion 调用经过 Tool Manager,输入输出均校验。
4. `accept`、`approve` 等权威写操作未经确认无法执行。
5. 写操作使用幂等键,恢复时不会重复写入。
6. 每次模型调用保存可审计的 Context Snapshot 元数据。
7. 记忆包含类型、权威、置信度、作用域和来源。
8. 用户可以查看、纠正和删除长期记忆。
9. 子 Agent 只能获得任务所需上下文和工具 capability。
10. 独立只读任务可以并行,取消 Run 会终止全部子任务。
11. 中间结果通过结构化 Artifact 传递,不依赖复制完整对话。
12. 完整 trace 能解释一次决策使用了哪些记忆、工具和 Artifact。
13. 离线场景集能够稳定验证审批、恢复、隔离和防循环行为。

## 后续方向

- 使用向量检索补充结构化记忆检索。
- 使用不同模型处理规划、抽取、批评和沟通任务。
- 为子 Agent 增加动态模型路由和成本优化。
- 支持跨插件共享 Runtime,同时保持 memory namespace 隔离。
- 支持远程 worker 和分布式 Task lease。
- 引入基于历史人工选择的候选排序模型。
- 为复杂写流程增加 Saga 补偿和人工恢复控制台。
