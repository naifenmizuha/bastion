# 训练推荐审核需求

> 范围:Bastion CLI

## 目的

在队员提交训练视频推荐之后,让教练能够通过 agent 对推荐内容进行审核。审核通过的推荐会被认定为正式训练,供全队作为可执行训练内容检索、安排和复盘;未通过的推荐保留原始记录和审核意见,方便队员了解原因并重新提交更合适的训练材料。

本功能的目标版本为训练审核 MVP:队员继续通过 `drill recommend write` 提交训练推荐;agent 负责读取推荐内容、整理审核摘要和风险提示;教练做最终通过或拒绝决策;CLI 负责校验、保存审核结果和读取正式训练。CLI 不负责自然语言理解,也不直接接入 LLM。

```sh
bastion drill recommend list --status pending
bastion drill review approve --recommendation-id 1 --coach "王教练" --summary "适合内野基础步伐训练" --note "下周三训练前半小时全队练习"
bastion drill review reject --recommendation-id 2 --coach "王教练" --summary "动作质量不稳定" --reason "视频示范动作不够清楚,暂不作为正式训练"
bastion drill training list
bastion drill training read --recommendation-id 1
```

## 与训练推荐的关系

- `drill recommend` 记录队员推荐的训练材料,表达的是"队员认为值得学习"。
- `drill review` 更新推荐上的审核字段,表达的是"教练是否认可该推荐进入正式训练"。
- `drill training` 读取已通过审核的推荐,表达的是"全队可以采用的训练内容"。
- 一条推荐只有一个当前审核结论。MVP 不支持多轮审核历史;若教练重新审核,则覆盖推荐上的审核字段。
- 正式训练不复制独立记录;MVP 直接把 `drill_recommendations.is_approved = 1` 的推荐视为正式训练。
- 推荐未通过时仍保留在 `drill_recommendations`,但不会出现在正式训练列表中。

## 技术栈

- Go CLI(Kong)
- SQLite

## 使用场景

1. 队员提交训练视频推荐,agent 完成类型归类和 AI 总结,写入 `drill_recommendations`。
2. 教练询问 agent "有哪些待审核训练推荐",agent 调用 `drill recommend list --status pending` 获取待审核列表。
3. agent 根据推荐理由、AI 总结、队员近期表现或教练指定标准,生成审核参考摘要,例如"适合内野滚地球基础步伐,强度低,可作为全队热身后技术段"。
4. 教练决定通过或拒绝。agent 调用 `drill review approve` 或 `drill review reject` 保存教练结论。
5. 通过审核的推荐进入正式训练列表,教练和队员可通过 `drill training list` 或 `drill training read` 查看。
6. 后续训练计划、队员阶段复盘或跨期分析可以引用正式训练,而不是直接引用所有队员推荐。

## 核心建模原则

训练推荐和正式训练是同一条记录的不同审核状态。

- 队员推荐是输入池,允许质量参差不齐,只要求信息完整和推荐人已登记。
- 教练审核是质量闸门,只有通过审核的推荐才成为正式训练。
- agent 提供审核辅助信息,但不能替代教练做最终决策。
- CLI 只保存结构化审核结论,不自行判断训练好坏。
- MVP 不新建审核表或正式训练表,避免为了简单状态引入额外 join 和同步逻辑。
- MVP 优先做"审核通过/拒绝"闭环,不做排课、签到、训练完成度追踪。

## 命令设计

### 列出训练推荐并按审核状态过滤

```sh
# 列出待审核推荐
bastion drill recommend list --status pending

# 列出已通过推荐
bastion drill recommend list --status approved

# 列出已拒绝推荐
bastion drill recommend list --status rejected

# 与已有过滤条件组合
bastion drill recommend list --name "张三" --type infield --status pending
```

`--status` 为可选过滤条件。省略时保持现有行为,列出全部推荐。

输出在原有字段基础上追加审核状态:

- review_status: `pending`、`approved`、`rejected`
- reviewed_by: 审核教练姓名;未审核时为空
- reviewed_at: 审核时间;未审核时为空
- review_summary: agent 或教练整理的审核摘要;未审核时为空
- review_note: 通过说明或拒绝原因;未审核时为空

### 审核通过训练推荐

```sh
bastion drill review approve \
  --recommendation-id 1 \
  --coach "王教练" \
  --summary "适合内野基础步伐训练,动作讲解清晰,强度适中" \
  --note "认定为正式训练,建议下周三团队训练使用"
```

写入成功后输出:

```text
drill recommendation approved: 1
```

通过后该推荐会出现在正式训练列表中。

### 审核拒绝训练推荐

```sh
bastion drill review reject \
  --recommendation-id 2 \
  --coach "王教练" \
  --summary "视频目标与当前训练周期不匹配" \
  --reason "当前阶段优先练习基础挥棒路径,该视频偏高阶力量转换,暂不纳入正式训练"
```

写入成功后输出:

```text
drill recommendation rejected: 2
```

拒绝后该推荐保留在推荐列表中,但不会出现在正式训练列表中。

### 列出正式训练

```sh
# 列出全部正式训练
bastion drill training list

# 按训练类型过滤
bastion drill training list --type infield

# 按推荐人过滤
bastion drill training list --name "张三"
```

正式训练列表仅展示审核状态为 `approved` 的推荐,默认按审核通过时间倒序展示。

每条包含:

- recommendation id
- 推荐人姓名
- 训练类型
- 视频链接
- 队员推荐理由
- agent 推荐总结
- 审核教练
- 审核摘要
- 教练说明
- 推荐提交时间
- 正式训练认定时间

### 读取单个正式训练

```sh
bastion drill training read --recommendation-id 1
```

读取某条正式训练的完整信息。`--recommendation-id` 使用来源训练推荐 id。只有已审核通过的推荐可以作为正式训练读取。

输出内容按以下分组展示:

- 正式训练信息
- 原始队员推荐
- agent 推荐总结
- 教练审核结论

## 数据边界

- 审核对象必须是已存在的训练推荐。
- 推荐人仍必须是已登记队员,沿用 `drill recommend write` 的校验规则。
- 审核教练 MVP 不强制建模为单独用户或队员,仅记录非空文本姓名。
- agent 可以生成 `summary`,但 `approve` 或 `reject` 必须由教练明确授权后调用。
- 审核通过只表示"被认定为正式训练",不表示训练已经被排入某一天的训练计划。
- MVP 不支持正式训练编辑、删除、排序置顶、训练计划排期或完成情况记录。
- MVP 不下载或解析视频本体;视频内容理解仍由 agent 在审核前完成。
- MVP 不保留多轮审核历史;同一推荐再次审核时覆盖当前审核记录。

## 源数据设计

训练审核读取并扩展以下数据:

- `players`:用于训练推荐提交时校验推荐人。
- `drill_recommendations`:原始训练推荐和当前审核结论。

## 表格设计

### 训练推荐表 `drill_recommendations`

在原有 `drill_recommendations` 表基础上追加审核字段:

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| is_approved | BOOLEAN NOT NULL DEFAULT 0 | 是否通过审核;1 表示通过,0 表示未通过或尚未审核 |
| reviewed_by | TEXT | 审核教练姓名;待审核时为空 |
| review_summary | TEXT | 审核摘要,可由 agent 草拟后经教练确认;待审核时为空 |
| review_note | TEXT | 通过说明或拒绝原因;待审核时为空 |
| reviewed_at | TEXT | 审核时间,格式 RFC3339;待审核时为空 |

原有字段 `id`、`name`、`url`、`reason`、`type`、`summary`、`created_at` 保持不变。

## 字段取值

### 审核状态

`--status` 在 CLI 中使用字符串名称,由 `is_approved` 和 `reviewed_at` 共同推导:

| 条件 | CLI 名称 | 说明 |
| --- | --- | --- |
| `reviewed_at IS NULL` | `pending` | 待审核 |
| `is_approved = 1` | `approved` | 已通过,可作为正式训练 |
| `is_approved = 0 AND reviewed_at IS NOT NULL` | `rejected` | 已拒绝,不作为正式训练 |

## 校验规则

- `recommendation_id` 必须存在于 `drill_recommendations`。
- `coach` 不能为空,写入前裁剪首尾空白。
- `summary` 不能为空,写入前裁剪首尾空白。
- `note`/`reason` 不能为空,写入前裁剪首尾空白。
- `approve` 统一写入 `is_approved=1`。
- `reject` 统一写入 `is_approved=0`。
- 已通过推荐再次 `approve` 时更新审核摘要、说明和时间。
- 已通过推荐执行 `reject` 时更新为 `is_approved=0`,该推荐立即不再出现在正式训练列表中。
- 已拒绝推荐执行 `approve` 时更新为 `is_approved=1`,该推荐立即出现在正式训练列表中。
- 所有审核写入必须在事务中完成。

## 写入行为

### `drill review approve`

- 校验推荐存在。
- 更新 `drill_recommendations.is_approved = 1`。
- 写入 `reviewed_by`、`review_summary`、`review_note`、`reviewed_at`。
- 输出被通过的推荐 id。

### `drill review reject`

- 校验推荐存在。
- 更新 `drill_recommendations.is_approved = 0`。
- 写入 `reviewed_by`、`review_summary`、`review_note`、`reviewed_at`。
- 输出被拒绝的推荐 id。

## 读取行为

- `drill recommend list --status pending` 返回 `reviewed_at IS NULL` 的推荐。
- `drill recommend list --status approved` 返回 `is_approved = 1` 的推荐。
- `drill recommend list --status rejected` 返回 `is_approved = 0 AND reviewed_at IS NOT NULL` 的推荐。
- `drill training list` 只读取 `is_approved = 1` 的推荐。
- `drill training read --recommendation-id` 找不到推荐或推荐未通过审核时返回明确错误。
- 无记录时返回空列表,不视为错误。

## 字段帮助说明

### `drill review approve`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--recommendation-id` | integer | 被审核通过的训练推荐 id |
| `--coach` | string | 审核教练姓名,不能为空 |
| `--summary` | string | 审核摘要,不能为空 |
| `--note` | string | 通过说明,不能为空 |

### `drill review reject`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--recommendation-id` | integer | 被审核拒绝的训练推荐 id |
| `--coach` | string | 审核教练姓名,不能为空 |
| `--summary` | string | 审核摘要,不能为空 |
| `--reason` | string | 拒绝原因,不能为空 |

### `drill training list`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--name` | string | 可选过滤条件,只展示指定队员推荐并通过审核的正式训练 |
| `--type` | enum | 可选过滤条件,只展示指定训练类型的正式训练 |

### `drill training read`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--recommendation-id` | integer | 已通过审核的训练推荐 id |

## 验收测试

### CLI 测试

- 可以通过 `drill recommend list --status pending` 列出尚未审核的推荐。
- 可以通过 `drill review approve` 将推荐审核通过,并输出推荐 id。
- 审核通过后,该推荐出现在 `drill training list` 中。
- 可以通过 `drill training read --recommendation-id` 读取正式训练完整信息。
- 可以通过 `drill review reject` 将推荐审核拒绝,并输出推荐 id。
- 审核拒绝后,该推荐不出现在 `drill training list` 中。
- `drill recommend list --status rejected` 可以看到被拒绝的推荐和拒绝原因。
- 非法 `recommendation_id` 返回明确错误。
- 空 `coach`、空 `summary`、空 `note` 或空 `reason` 会失败并返回明确错误。
- `drill training list --name` 和 `--type` 可以单独或组合过滤正式训练。

### SQLite 测试

- `drill_recommendations` 能正确新增 `is_approved`、`reviewed_by`、`review_summary`、`review_note`、`reviewed_at` 字段。
- 新推荐默认 `is_approved = 0` 且 `reviewed_at` 为空,表示待审核。
- 审核通过时更新原推荐记录的审核字段。
- 审核拒绝时更新原推荐记录的审核字段。
- 审核写入失败时不修改原推荐记录。

### Domain 测试

- 待审核状态由 `reviewed_at IS NULL` 推导。
- 同一推荐重复审核时只保留当前审核结论。
- 已通过转拒绝后不再作为正式训练展示。
- 已拒绝转通过后重新作为正式训练展示。
- 正式训练读取结果直接来自通过审核的 `drill_recommendations` 记录。
