# Bastion 派生记忆 PRD

## 1. 背景

Bastion Agent 经常需要组合多次权威 CLI 读取，才能形成跨比赛、跨人员或跨时间的
分析结论。完整工具结果不适合长期重复进入 Provider 上下文，而最终 assistant 文本
又可能被截断、遗漏限制条件或错误转述基础数据。

派生记忆（Derived Memory）保存已经完成的复杂认知工作，但不缓存单次 CLI 就能取得
的权威事实。每条记忆必须绑定真实执行过的 CLI 读取依赖；依赖数据变化时，记忆必须
失效。

## 2. 产品定位

派生记忆保存：

- 多场比赛形成的趋势判断；
- 多名球员或多个数据域形成的风险判断；
- 候选方案与多个权威输入之间的综合结论；
- 重建成本明显高于一次读取的、可复用分析。

派生记忆不保存：

- 比分、球员属性、当前阵容等单次 CLI 可读取事实；
- 原始 CLI 输出副本；
- assistant 回答摘要；
- 未绑定来源的模型推断；
- 写操作是否成功等安全状态。

派生记忆与其他机制的边界：

| 机制 | 职责 |
| --- | --- |
| Bastion CLI | 球队权威事实与领域计算 |
| 派生记忆 | 带依赖、可失效的复杂结论 |
| Context Projection | 控制每次 Provider 请求的历史体积 |
| Compaction | 长期任务 checkpoint 和写入安全状态 |
| Semantic Memory | 偏好、别名和稳定的跨任务知识 |

派生记忆永远不能覆盖 CLI 权威事实，也不能让权威写入跳过必要的实时刷新。

## 3. 用户故事

### 3.1 复用复杂趋势分析

Agent 读取两场以上比赛并判断近期进攻主要问题。Agent 将自包含结论和真实读取
指令保存为派生记忆。后续询问相同主题时，Agent 可以先浏览标题目录并读取仍为 fresh 的内容，
不必重复完整分析。

### 3.2 数据变化后停止复用

某场比赛事件、比分或分析发生变化。Runtime 收到对应 change event，通过依赖反向
索引将相关记忆标记为 stale。标题列表继续展示该叶子版本；读取 stale
记忆时只返回状态和重建信息，不返回旧内容。

### 3.3 进程重启

每条依赖保存权威实体的 `updated_at` 快照。Runtime 重启后在 `read` 时重新计算快照；
来源未变化的记忆继续保持 fresh，来源变化的记忆转为 stale。`list` 不触发该校验。

## 4. 功能需求

### 4.1 显式保存

Agent 通过 `derived_memory` 工具的 `save` action 保存结论。保存请求必须包含：

- 能独立表达所解决问题的简短 `title`；
- 包含适用范围和关键限制的自包含 `content`；
- 一条说明未来如何重新解析证据集合并复现分析的 `rebuildInstruction`；
- 至少两条不同的 CLI 读取指令。

Runtime 必须从 session-scoped `DerivedMemoryEvidenceRegistry` 验证每条依赖。该 Registry
只是派生记忆模块的临时证据登记表，不是持久化账本或 Runtime 基础层：

- 指令和结构化 input 完全匹配；
- 已真实执行；
- `ok: true`；
- `risk: read`；
- 指令具有已注册的失效 topic。

模型声明的依赖不能直接成为可信依赖；验证失败不得写入数据库。
新记忆固定保存到当前用户的 `private` 空间。`authorityId`、`teamId`、`userId`、角色和
可选 `playerId` 由 Runtime 宿主注入，工具参数不得接受或覆盖这些身份字段。

### 4.2 渐进式列表与读取

`list` 无需分类或文本过滤，按页返回当前 principal 可访问的 private、
staff 和 team 叶子记忆标题。默认 scope 为 all、limit 为 20，最大 50，offset 从 0
开始；结果包含 total 和可选 nextOffset。Store 分别读取各 scope，合并后完成稳定排序、
ID 去重和一次全局分页，不使用 SQL `UNION`。列表始终包含 fresh 和 stale，已有后继的旧
版本不进入列表。

每条列表项只包含 `id` 和 `title`。`list` 不返回 content、状态、权限、依赖、重建指令、
版本或失效审计，也不执行来源快照校验。标题只用于发现候选，不得作为回答证据。

`read` 按 ID 实时校验 freshness。fresh 只返回 `id`、`title`、`status` 和 `content`；
stale 返回 `id`、`title`、`status` 以及简短的 `rebuild.reason` 和
`rebuild.instruction`，不返回旧 content；unknown 只返回 `id`、`title` 和 `status`。
Runtime 不向 Agent 暴露完整依赖、来源快照、身份、权限、版本关系或失效审计。
fresh 表示 Runtime 刚刚确认该记忆记录的全部来源依赖仍与保存快照一致，因此 content 是
其既定分析范围内基于最新数据的派生结论；保存时间较早或来自先前 Session 不构成重读
相同来源的理由。fresh 不表示分析范围之外的领域数据也已被该记忆覆盖。

涉及“之前、上次、还记得、现在还成立吗”或可能复用复杂分析时，Agent 先无标签 list，
按标题语义选择候选，再 read。存在 nextOffset 时，
未继续翻页不得声称没有保存过记忆。

记忆发现与领域读取是两个有序阶段。Agent 必须先完成 list 和候选 read，不得在同一批
工具调用中并行发出记忆与领域数据请求。fresh content 完整覆盖当前问题时直接回答；仅
部分覆盖时，只读取未覆盖子问题所需的最小领域数据。不得因为跨 Session、墙上时间变化
或主观怀疑而重读已由 fresh content 覆盖的来源。

完整记忆生命周期由独立的 `manage-derived-memory` Skill 承载。它与领域 Skill 不互相
引用；复杂分析的发现规则由记忆 Skill metadata 和始终可见的 `derived_memory` 工具描述
声明，没有候选后才开始新的领域读取。

用户明确同意后，Agent 按 `rebuild.instruction` 重新解析动态范围并执行新的权威读取，
再通过 `replace` 保存替代结论。`replace` 只接受作者拥有、尚无后继的 stale 记录，并
再次验证新依赖快照未在读取后变化。替代记录使用新 ID、固定保存为 private，并通过
`supersedesId`/`supersededById` 保留版本链；共享需另行确认。列表不返回已有后继的旧
版本，但仍可按 ID 触发正常 freshness 读取。非作者只能另存自己的 private 结论。

记忆正文由 `read` 返回前必须完成来源快照校验。校验不可用时本次状态为 unknown，不得
作为 fresh 使用，也不得永久把记录标记为 stale。

第一版不做 embedding、自动上下文注入或后台自动重算；只支持用户确认后的
update-on-use。

### 4.3 共享与删除

`publish` 把作者的 private 记忆原地发布到 staff 或 team；player 只能发布到 team。
`withdraw` 把作者发布的记忆撤回 private。两者不复制依赖或 freshness 状态，且必须
显式携带用户确认并记录共享审计。

`forget` 删除记忆、依赖和失效审计，只允许在用户明确要求删除时调用。作者只能删除
private 记忆，共享记忆只有 admin 可以删除；删除行为保留独立共享审计。

### 4.4 失效

每个读命令由声明式注册表映射到权威实体及其 `updated_at`。成功或可能已经落库的 write
与 compute-write 发布本地变化事件；Runtime 先按事件 topics 从依赖反向索引选择 fresh
候选，再精确复检其来源快照。实体集合或时间戳实际变化时才转换为 stale，并记录原事件、
topics 和变化 source keys；复检失败不永久改状态。`read` 仍必须复检，`list` 不复检。

首版使用领域级粗粒度 topics：

- `team`
- `player`
- `report`
- `game`
- `game_analysis`
- `lineup`
- `drill`

事件 ID 必须幂等；失效需要记录事件、topics 和时间。失败、取消或验证不确定的写入
不得发布确定性 change event。

Runtime 通过 `ChangeEventSource` 消费事件。本地同步 event bus 是第一版实现；未来
外部消息队列只需提供相同订阅契约。

### 4.5 持久化

派生记忆使用独立的 Runtime SQLite 数据库，不写入 Bastion 业务数据库。数据库至少
包含：

- memories；
- dependencies；
- dependency topic 反向索引；
- invalidation audit；
- processed event IDs；
- sharing audit。

memories 同时保存重建指令和双向版本关联；一个旧版本最多有一个直接后继。

schema 使用固定 `PRAGMA user_version`。首版不兼容旧派生记忆 schema：版本不匹配时
fail closed 并要求显式重建数据库，不自动迁移或静默删除。Memory store 在进程级创建，
跨 `/new`、`/resume` 和 `/fork` 复用；普通进程重启不使记忆失效。

### 4.6 多用户隔离与共享

每条记忆强制绑定 `authorityId`、`teamId` 和 `ownerUserId`。private 只对作者可见；
staff 对同 authority/team 的 admin 和 coach 可见；team 对同 authority/team 的所有
角色可见。用户与队员身份保持独立，membership 可以提供可选 `playerId`，但 player
关联不参与认证或记忆授权。

首版 principal 由 Host options 或环境变量提供。缺少或非法的
`BASTION_AUTHORITY_ID`、`BASTION_TEAM_ID`、`BASTION_USER_ID`、`BASTION_USER_ROLE`
时 Runtime 拒绝启动。工具输入不暴露身份字段，模型不能声明或覆盖 principal。

### 4.7 上下文协作

派生记忆只通过工具按需进入上下文。已完成轮次中的 memory tool trace 按普通工具轨迹
由 Context Projection 移除；持久化记录不受影响。

若 assistant 因 `length` 或 `error` 停止且后续已有新 user 消息，该旧轮视为 closed
incomplete turn：保留问题、截断文本和 incomplete 标记，移除已配对的历史工具轨迹。
没有后续 user 的活动轮必须原样保留。

## 5. 非功能要求

- content 最多 4,000 字符；
- title 最多 128 字符；
- 重建指令最多 2,000 字符；
- 单条记忆最多 12 个依赖；
- list 默认返回 20 条，最大 50 条，并支持 offset 分页；
- 相同依赖使用规范化参数 hash 去重；
- 所有 SQL 写入和失效操作必须事务化；
- 所有读取、修改和 freshness 失效必须带 authority scope；
- 未注册命令 topic 时保守拒绝保存，不产生永不失效的记忆。

## 6. 可观测性

后续指标接口应支持：

```text
bastion_derived_memory_save_total{outcome}
bastion_derived_memory_list_total{outcome}
bastion_derived_memory_invalidation_total{topic}
bastion_derived_memory_stale_read_total
bastion_derived_memory_dependency_validation_failure_total{reason}
```

第一版通过工具结构化结果、数据库 invalidation audit 和现有 developer payload 日志
提供调试证据。

## 7. 验收标准

1. 两条真实成功读取可以保存结论；伪造、失败、写操作和重复依赖被拒绝。
2. fresh 结论可跨会话通过 list/read 渐进加载，且不会自动污染每次 Provider 上下文。
3. 相关成功写入事件使结论 stale；无关事件不影响结论；重复事件无副作用。
4. list 只返回有界的 id/title 目录且不校验 freshness；read 实时校验，只有 fresh 返回
   content，stale 返回重建信息，unknown 不返回内容。
5. 用户 private 记录相互隔离；player 不可读取 staff；team 记录可由全队读取。
6. 不同 authority/team 不可交叉读取、修改或失效，模型不能覆盖宿主 principal。
7. 发布和撤回保持同一 memory ID、依赖和 freshness；只有 admin 可删除共享记录。
8. stale 记忆只在使用时提示重建；确认后产生 private fresh 后继，拒绝、unknown 或
   重建失败均不改变旧记录。
9. 进程重启后来源未变化的 fresh 记录仍可复用；旧 schema 明确拒绝启动。
10. Session、CLI、compaction 与 projection 原有测试无回归。

## 8. 后续演进

- 捕获绕过 teamops 的直接 SQL 修改；
- 外部 MQ adapter 和跨进程主动失效通知；
- 可选后台重算；
- 语义检索，但仍必须保持来源、状态和 token 预算边界。
