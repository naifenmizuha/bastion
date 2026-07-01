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

Agent 读取两场以上比赛并判断近期进攻主要问题。Agent 将结论、限制条件和真实读取
指令保存为派生记忆。后续询问相同主题时，Agent 可以先搜索并使用仍为 fresh 的结论，
不必重复完整分析。

### 3.2 数据变化后停止复用

某场比赛事件、比分或分析发生变化。Runtime 收到对应 change event，通过依赖反向
索引将相关记忆标记为 stale。默认搜索不再返回该结论；显式读取 stale 记忆时必须展示
警告和重建指令。

### 3.3 进程重启

首版无法观察进程停止期间的外部数据库变化。Runtime 启动时把所有 fresh 记忆标记为
stale，保留历史结论和依赖用于审计与重建。

## 4. 功能需求

### 4.1 显式保存

Agent 通过 `derived_memory` 工具的 `save` action 保存结论。保存请求必须包含：

- 结论种类；
- subject keys；
- 检索 topics；
- 简洁结论；
- 限制条件；
- 至少两条不同的 CLI 读取指令。

Runtime 必须从当前会话 observation ledger 验证每条依赖：

- 指令和结构化 input 完全匹配；
- 已真实执行；
- `ok: true`；
- `risk: read`；
- 指令具有已注册的失效 topic。

模型声明的依赖不能直接成为可信依赖；验证失败不得写入数据库。

### 4.2 检索与读取

`search` 支持按 kind、subject、topic 和文本筛选，默认仅返回 fresh 记忆和有界摘要。
调用者必须显式设置 `includeStale` 才能搜索 stale 记录。

`read` 返回完整结论、限制、状态和依赖。stale 记录必须附带“重新执行全部依赖后再
形成替代结论”的警告。

第一版不做 embedding、自动上下文注入或自动重算。

### 4.3 删除

`forget` 删除记忆、依赖和失效审计，只允许在用户明确要求删除时调用。工具参数必须
显式携带用户确认。

### 4.4 失效

每个读命令由声明式注册表映射到依赖 topics；每个成功的 write 或 compute-write
命令映射到 change topics。topic 有交集时，fresh 记忆转换为 stale。

首版使用领域级粗粒度 topics：

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
- processed event IDs。

schema 使用 `PRAGMA user_version` 迁移。Memory store 在进程级创建，跨 `/new`、
`/resume` 和 `/fork` 复用，只在进程启动时运行一次 startup invalidation。

### 4.6 上下文协作

派生记忆只通过工具按需进入上下文。已完成轮次中的 memory tool trace 按普通工具轨迹
由 Context Projection 移除；持久化记录不受影响。

若 assistant 因 `length` 或 `error` 停止且后续已有新 user 消息，该旧轮视为 closed
incomplete turn：保留问题、截断文本和 incomplete 标记，移除已配对的历史工具轨迹。
没有后续 user 的活动轮必须原样保留。

## 5. 非功能要求

- 结论正文最多 4,000 字符；
- 单条记忆最多 12 个依赖、16 个 subject、16 个 topic 和 16 个限制；
- search 默认最多返回 10 条，最大 20 条；
- 相同依赖使用规范化参数 hash 去重；
- 所有 SQL 写入和失效操作必须事务化；
- 未注册命令 topic 时保守拒绝保存，不产生永不失效的记忆。

## 6. 可观测性

后续指标接口应支持：

```text
bastion_derived_memory_save_total{outcome}
bastion_derived_memory_search_total{hit}
bastion_derived_memory_invalidation_total{topic}
bastion_derived_memory_stale_read_total
bastion_derived_memory_dependency_validation_failure_total{reason}
```

第一版通过工具结构化结果、数据库 invalidation audit 和现有 developer payload 日志
提供调试证据。

## 7. 验收标准

1. 两条真实成功读取可以保存结论；伪造、失败、写操作和重复依赖被拒绝。
2. fresh 结论可跨会话检索，且不会自动污染每次 Provider 上下文。
3. 相关成功写入事件使结论 stale；无关事件不影响结论；重复事件无副作用。
4. 默认搜索不返回 stale，显式读取包含全部重建指令和警告。
5. 进程启动将遗留 fresh 记录统一标记 stale。
6. Session、CLI、compaction 与 projection 原有测试无回归。

## 8. 后续演进

- 外部 MQ adapter、持久 consumer offset 和跨进程版本水位；
- 由 CLI 返回实体级 change topics，降低粗粒度误失效；
- 后台重算和新旧结论 supersede 关系；
- 语义检索，但仍必须保持来源、状态和 token 预算边界。
