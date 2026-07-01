# Bastion Runtime 上下文投影 PRD

- 状态：Draft
- 版本：0.1
- 日期：2026-07-01
- 范围：`runtime`
- 关联能力：Pi `context` event、Bastion CLI Tool、上下文压缩

## 1. 更正结论

本 PRD 记录对 Bastion 上下文治理方向的一次更正：

1. 限制上下文增长的主要手段应是**每次模型调用前的上下文投影**，而不是等上下文接近窗口上限后再压缩。
2. 对已经完成的对话轮次，最重要的长期内容是**用户问题和最终面向用户的回答**。
3. 工具调用、中间推理和大型工具结果主要服务于当前轮执行，不应默认在后续每次模型请求中完整重放。
4. 完整工具轨迹继续保存在 Session 和领域审计数据中；上下文投影只改变发送给模型的消息，不删除原始记录。
5. 写入结果、失败、不确定状态和继续任务所需的稳定实体键不能仅依赖自然语言回答，必须以有界的结构化凭据保留。
6. 上下文压缩继续负责长期任务 checkpoint 和窗口恢复，但不再承担日常控制增长速度的首要职责。

目标上下文形态为：

```text
System Prompt
  + 长期 checkpoint（如已发生 compaction）
  + 已完成轮次
      - 用户问题
      - 最终 assistant 回答
      - 必要的操作凭据
  + 当前未完成轮次
      - 完整 assistant tool call
      - 完整 tool result
      - 当前执行所需消息
```

## 2. 背景

当前 Pi 会在每次 Provider 请求中重放尚未被压缩的完整消息历史。一次领域任务通常包含：

- Skill 和 reference 读取；
- 多次 `bastion_cli` 查询；
- 大型比赛事件、球员列表或分析结果；
- 工具调用前后的 assistant 过程消息；
- 最终面向用户的回答。

在会话
`019f1c50-80d4-785e-8feb-68effe4cd106` 中，最后一次 Provider 请求的
`input` 约为 58,962 个字符，其中历史工具结果约为 41,692 个字符，占约
70.7%。`game read` 和 `game analysis generate` 分别带入约 15 KiB 的高度相关
数据，而用户下一步只要求继续分析一名球员。

该会话尚未达到自动 compaction 阈值，但上下文已经快速增长。这说明只优化
compaction 无法解决以下问题：

- compaction 触发前，每轮请求仍重复发送大型历史结果；
- `keepRecentTokens` 会保留近期完整工具轨迹；
- 单个近期 turn 本身可能已经很大；
- 大量低价值数据会分散模型注意力并增加调用成本；
- Prompt cache 即使降低部分费用，也不会消除窗口占用和模型阅读负担。

因此需要在 Session 原始记录与 Provider 模型上下文之间增加稳定的投影层。

## 3. 产品目标

### 3.1 目标

1. 已完成轮次默认只向后续模型请求保留用户问题、最终回答和必要操作凭据。
2. 当前尚未完成的轮次完整保留工具协议，使模型能够继续调用工具并生成最终回答。
3. 完整 Session、工具结果和审计信息不因投影而丢失。
4. 写入成功、取消、失败和不确定写入在投影后仍保持准确语义。
5. 需要继续处理领域实体时，模型仍能获得稳定 ID、操作结果和合法刷新命令。
6. 上下文投影与 compaction、resume、fork 及 Provider payload 观测兼容。
7. 投影策略由确定性代码完成，不使用额外 LLM 调用总结每个工具结果。

### 3.2 成功指标

- 已完成轮次中的历史工具结果字符数默认减少不低于 80%。
- 用户原始消息保留率为 100%。
- 最终面向用户回答保留率为 100%。
- 当前未完成轮次的 tool call/result 配对破坏次数为 0。
- 不确定写入和验证失败状态保留率为 100%。
- 投影引入的额外 Provider 或 LLM 请求数为 0。
- 典型连续球队管理会话的 Provider input 增长主要由用户消息和最终回答决定，而不是由历史原始工具结果决定。
- 投影后的领域任务完成率不低于未投影基线。

## 4. 非目标

首版不包含：

- 删除或改写 Session JSONL 中的原始消息；
- 用最终回答替代 SQLite 或 `bastion_cli` 的权威事实；
- 在投影阶段自动刷新数据库；
- 使用 LLM 为每个工具结果生成摘要；
- 任意截断当前轮正在使用的工具结果；
- 替换 Pi 的 compaction、token 估算或 SessionManager；
- 保证错误的历史最终回答自动被纠正；
- 将所有领域数据缓存进模型上下文。

## 5. 核心概念

### 5.1 原始会话

Pi Session 中持久化的完整消息、工具调用、工具结果、compaction entry 和自定义
entry。它是恢复、fork、审计和诊断的依据，不受上下文投影影响。

### 5.2 模型上下文投影

在每次 LLM 调用前，从原始会话消息生成的一份临时消息列表。投影只影响本次
Provider 请求，不写回原始会话。

### 5.3 已完成轮次

从一个用户消息开始，已经产生不包含待执行 tool call 的最终 assistant 回答的逻辑
轮次。已完成轮次可以折叠其执行轨迹。

### 5.4 当前活动轮次

最新用户请求之后，尚未产生最终 assistant 回答的逻辑轮次。活动轮次中的 tool
call、tool result 和必要中间消息必须完整保留。

### 5.5 操作凭据

从工具调用和结果中确定性提取的有界记录，用于保存不能安全地只依赖最终回答的
执行状态。至少包括：

- 命令及目标实体键；
- 操作类别：read、compute write 或 write；
- 结果：confirmed、cancelled、failed 或 uncertain；
- 写后验证状态；
- 必要的权威刷新命令。

操作凭据不是完整工具结果，也不是数据库快照。

## 6. 用户故事

### 6.1 连续追问比赛表现

用户先问某名球员在最近比赛中的表现，Agent 读取完整比赛和分析数据后回答。用户
接着追问另一名球员。

第二次请求应主要收到前一个用户问题和最终回答，不应再次收到完整比赛事件和全部
球员统计。若回答新问题确实需要更多事实，Agent 应执行针对性只读查询。

### 6.2 写入后继续对话

用户确认接受一个阵容，工具完成写入和回读验证，Agent 向用户报告成功。后续请求
不需要携带完整写入响应，但必须保留：

- 接受的阵容 ID；
- confirmed 状态；
- 验证命令；
- 历史观察值只是线索、使用前应重新读取的规则。

### 6.3 不确定写入

写入发生 timeout 或写后验证失败。即使最终回答很短，后续上下文仍必须包含该操作
的 uncertain 状态、目标实体以及“先回读、禁止直接重放”的要求。

### 6.4 当前轮多步工具调用

Agent 调用 `game list` 后还需要调用 `game read`。在本轮最终回答产生前，投影不得
删除 `game list` 的 call/result，否则会破坏模型继续执行所需的上下文和 Provider
工具协议。

## 7. 功能需求

### 7.1 每次调用前投影（P0）

Runtime 必须使用 Pi `context` event，在每次 LLM 调用前生成非破坏性的消息投影。

投影不得：

- 修改 `event.messages` 之外的 Session 数据；
- 发起新的模型或工具调用；
- 改变当前活动轮次的工具语义；
- 产生未配对的 tool call 或 tool result。

### 7.2 保留已完成轮次的对话主干（P0）

对已完成轮次默认保留：

- 用户消息原文；
- 最终 assistant 回答；
- 与该轮相关且仍有安全或继续价值的操作凭据。

默认移出 Provider 上下文：

- assistant 的纯过程说明；
- assistant 的中间 reasoning；
- 已完成的 tool call；
- 对应的原始 tool result；
- Skill/reference 的历史读取正文；
- 已被最终回答吸收且没有安全状态的只读查询结果。

### 7.3 完整保留活动轮次（P0）

从最新尚未完成的用户请求开始，消息必须原样保留，直到产生最终 assistant 回答。

首版不对活动轮次做结果裁剪，以正确性和 Provider 协议兼容为优先。命令级
projection、分页和紧凑 JSON 属于独立的工具输出优化。

### 7.4 确定性识别最终回答（P0）

Runtime 必须通过消息结构识别最终回答，不能用文本内容猜测。

一个 assistant 消息只有在不包含待执行 tool call，且其后没有属于同一用户请求的
必要工具结果时，才可以作为该轮终止消息。若无法可靠判断，必须保守地将该轮视为
活动轮次。

若 assistant 的 `stopReason` 为 `length` 或 `error`，且其后已经出现新的 user
消息，则旧轮已被后续输入关闭，应作为 incomplete closed turn 投影：保留截断文本和
结构化 incomplete 标记，移除配对完整的历史工具轨迹。没有后续 user 消息时仍视为
活动轮次并原样保留。

### 7.5 操作凭据（P0）

投影必须复用或兼容现有 Bastion compaction extractor 的确定性分类，不得由自由文本
推断写入结果。

必须保留：

- 所有 unresolved uncertain write；
- cancelled 和 failed 操作，直到相关用户目标结束；
- 已确认写入的目标实体和验证信息；
- 后续任务显式依赖的稳定实体键；
- 合法且最小的刷新命令。

普通成功只读结果默认不生成长期凭据；只有其实体键仍被当前任务依赖时才保留引用。

### 7.6 与 compaction 协作（P0）

上下文投影和 compaction 的职责必须分离：

| 能力 | 主要职责 |
| --- | --- |
| 上下文投影 | 控制每次 Provider 请求的历史增长速度 |
| Compaction | 在窗口压力下形成长期 checkpoint 并恢复任务状态 |
| Session | 保存完整历史和审计记录 |

Compaction extractor 仍应从原始会话范围提取安全状态，不能因为 Provider 投影隐藏了
工具结果而丢失写入账本。

发生 compaction 后，投影必须保留 compaction summary，并继续折叠其后的已完成轮次。

### 7.7 Resume 与 fork（P0）

- Resume 后应从恢复的原始会话重新计算投影。
- Fork 不复制临时投影状态，只继承分支中实际存在的原始消息和 checkpoint。
- 投影结果不得作为新的普通消息持久化，避免重复折叠和 summary-of-summary 漂移。

### 7.8 保守降级（P0）

出现以下情况时，应保留更多原始消息，而不是冒险删除：

- 无法确定用户轮次边界；
- tool call/result 配对不完整；
- 未识别的自定义消息参与工具协议；
- 操作凭据提取或校验失败；
- Provider 对历史工具协议有额外约束。

降级必须记录诊断，但不应中断正常对话。

## 8. 投影流程

```text
Pi 原始 messages
  → 识别 compaction 边界
  → 划分已完成轮次与当前活动轮次
  → 从已完成轮次提取必要操作凭据
  → 保留用户消息与最终回答
  → 移除已完成执行轨迹
  → 追加原样活动轮次
  → 校验 tool call/result 完整性
  → 发送 Provider
```

投影顺序必须稳定，相同输入应产生相同结果。

## 9. 产品策略

### 9.1 最终回答优先，但不是唯一状态

最终回答是历史轮次面向后续模型的主要语义摘要，因为它已经完成了从工具数据到用户
意图的提炼。但以下内容不能只依赖最终回答：

- 副作用是否真实发生；
- 写后验证是否成功；
- timeout 后操作是否可能已经生效；
- 后续刷新所需的稳定实体键；
- 模型建议与数据库事实的区别。

因此首版采用“用户问题 + 最终回答 + 最小操作凭据”，而不是只保留聊天文本。

### 9.2 重新查询优于缓存大型结果

历史只读结果在投影后视为可丢弃观察值。后续任务需要该事实时，Agent 应使用最小的
权威查询重新读取，而不是依赖旧的完整 JSON。

如果频繁重复查询造成明显延迟，应优先为 CLI 增加字段投影、按球员读取或分页能力，
而不是恢复全量历史结果重放。

### 9.3 不依赖格式压缩解决语义问题

紧凑 JSON 可以降低常数开销，但仍会重复发送大量已经完成使命的数据。格式压缩可以
作为工具输出优化同时实施，不能替代上下文投影。

## 10. 可观测性

每次投影至少记录：

- 投影前、投影后消息数；
- 投影前、投影后估算 token 或字符数；
- 被折叠的 completed turn 数；
- 被移除的 tool call 和 tool result 数；
- 保留的操作凭据数；
- 保守降级原因；
- 当前活动轮次是否原样保留；
- compaction summary 是否存在。

建议指标：

```text
bastion_context_projection_total{outcome}
bastion_context_projection_messages_before
bastion_context_projection_messages_after
bastion_context_projection_tokens_before_estimate
bastion_context_projection_tokens_after_estimate
bastion_context_projection_tool_results_removed
bastion_context_projection_receipts_preserved
bastion_context_projection_fallback_total{reason}
```

Developer mode 的 Provider payload 日志应记录投影后的真实 payload，以便直接验证
增长速度。

## 11. 验收标准

### 11.1 基本对话

1. 纯用户/assistant 对话投影后内容和顺序不变。
2. 已完成的工具轮次只保留用户问题、最终回答和必要凭据。
3. 多轮连续查询不会重复发送之前的大型工具结果。

### 11.2 活动轮次

1. tool call 发出但尚无结果时不裁剪该轮。
2. tool result 已返回但最终回答尚未生成时不裁剪该轮。
3. 多次连续工具调用期间所有必要 call/result 均保持合法配对。
4. 最终回答生成后的下一次 LLM 调用才折叠该轮执行轨迹。

### 11.3 安全状态

1. confirmed write 折叠后保留实体键和验证结果。
2. cancelled write 不得变成 confirmed。
3. `TIMEOUT`、`ABORTED`、`WRITE_VERIFICATION_FAILED` 折叠后仍为 uncertain。
4. uncertain write 在后续投影中不能被普通成功回答淘汰。
5. 对同一实体的写入重放仍受 freshness guard 阻止。

### 11.4 生命周期

1. 手动和自动 compaction 后投影继续生效。
2. Resume 后相同分支产生等价投影。
3. Fork 后不引用分叉点之后的操作凭据。
4. 原始 Session JSONL 中仍能查看完整工具调用与结果。

### 11.5 真实 Provider E2E

使用本 PRD 背景中的连续比赛分析场景：

1. 第一轮读取比赛与分析并生成最终回答。
2. 第二轮追问另一名球员。
3. 第二轮 Provider payload 不再包含第一轮完整比赛事件和全部球员分析。
4. 第二轮仍包含第一轮用户问题、最终回答和所需 `game_id`。
5. Provider 能正常接受投影后的消息结构并继续调用工具。
6. 历史工具结果字符数相较当前基线至少减少 80%。

## 12. 风险与缓解

| 风险 | 缓解措施 |
| --- | --- |
| 最终回答遗漏后续需要的事实 | 保留稳定实体键；需要时执行针对性权威查询 |
| 最终回答包含错误结论 | 不把回答当作数据库权威事实；mutable fact 使用前刷新 |
| 删除 tool result 后破坏 Provider 协议 | 只折叠已完成轮次；删除完整 call/result 单元；E2E 验证 |
| 轮次边界识别错误 | 无法确认时保守保留 |
| 安全状态被自然语言弱化 | 操作凭据由确定性 extractor 生成 |
| 投影与 compaction 产生双重摘要漂移 | 投影不持久化、不生成自由文本摘要 |
| 重新查询增加延迟 | 增加 CLI projection、分页和针对性读取能力 |
| 不同 Provider 对历史消息要求不同 | 建立 Provider 兼容测试和按 Provider 保守策略 |

## 13. 实施优先级

### P0：安全投影

- 已完成轮次识别；
- 活动轮次原样保留；
- 用户问题和最终回答保留；
- Bastion 操作凭据；
- call/result 配对校验；
- compaction、resume 和 fork 测试；
- Developer mode payload E2E。

### P1：效率增强

- CLI 结果字段投影和分页；
- 紧凑模型可见 JSON；
- 按 Provider 和模型窗口配置投影预算；
- 更完整的 token、缓存和延迟遥测。

### P2：策略调优

- 基于真实会话集评估回答质量；
- 按领域命令定制只读引用保留策略；
- 对超长活动轮次提供不破坏协议的分段结果访问。

## 14. 发布门槛

满足以下条件后才能默认启用：

1. 当前活动轮次不被裁剪。
2. 所有测试中的 tool call/result 协议保持有效。
3. confirmed、cancelled、failed 和 uncertain 状态无语义漂移。
4. 原始 Session 和审计数据保持完整。
5. 真实 Provider 连续追问 E2E 通过。
6. 历史工具结果字符数减少至少 80%。
7. 领域任务完成率不低于未投影基线。
