# PRD: 训练推荐审批功能

## 背景

Bastion 已支持队员通过 `drill recommend write` 推荐训练视频，并通过 `drill recommend list` 查看推荐列表。当前所有推荐一旦写入就永久存在，没有审批环节，教练无法从中筛选出被正式采纳的训练。

## 目的

在推荐写入与队伍训练库之间增加一道审批环节，让教练能够：

- 快速查看待审批的推荐。
- 通过或驳回单条推荐。
- 通过的推荐自动进入"队伍训练库"，作为全队可执行的训练清单。
- 按状态、类型过滤查看推荐与训练库。

## 范围

本需求只覆盖 `drill_recommendations` 表的审批流转，不改动 `WriteRecommendation` 的入参校验，不涉及训练报告、比赛分析等其他域。审批操作不鉴权（CLI 工具本身无用户体系），仅记录审批人姓名留痕。

## 用户故事

- 作为教练，我希望列出所有待审批的推荐，快速浏览队员提交的训练视频。
- 作为教练，我希望对某条推荐执行通过，使其进入队伍训练库。
- 作为教练，我希望对不合适的推荐执行驳回，使其不再出现在待审批列表中。
- 作为教练，我希望查看队伍训练库（已通过的推荐），了解当前可执行的训练清单。
- 作为教练，我希望按训练类型过滤训练库，针对某一项能力挑选训练。

## 表设计

在 `drill_recommendations` 表上新增三列，承载审批状态与留痕信息：

| 列名 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `status` | INTEGER | NOT NULL DEFAULT 0 CHECK(status IN (0,1,2)) | 0=pending, 1=approved, 2=rejected |
| `reviewed_by` | TEXT | 可空 | 审批人姓名；未审批时为 NULL |
| `reviewed_at` | TEXT | 可空 | 审批时间，RFC3339；未审批时为 NULL |

`WriteRecommendation` 写入时 `status=0`，`reviewed_by`/`reviewed_at` 为 NULL。

由于 `schema.Init()` 使用 `CREATE TABLE IF NOT EXISTS`，已存在的库不会自动加列。开发时需在 `Init()` 中补一段幂等的 `ALTER TABLE drill_recommendations ADD COLUMN ...`（捕获 "duplicate column" 错误并忽略），或直接重建表——由开发牛马选择，但必须保证旧库升级后不丢数据。

## 命令设计

### 新增命令

```bash
bastion drill recommend approve --id <N> [--reviewer <name>]
bastion drill recommend reject  --id <N> [--reviewer <name>]
bastion drill library list [--type <type>]
```

### 参数说明

| 命令 | 参数 | 必填 | 说明 |
| --- | --- | --- | --- |
| `approve` | `--id` | 是 | 推荐 ID，> 0，必须存在 |
| `approve` | `--reviewer` | 否 | 审批人姓名；提供时必须是已注册队员 |
| `reject` | `--id` | 是 | 推荐 ID，> 0，必须存在 |
| `reject` | `--reviewer` | 否 | 审批人姓名；提供时必须是已注册队员 |
| `library list` | `--type` | 否 | 训练类型过滤：pitching,catching,hitting,strength,baserunning,infield,outfield |

### 修改命令

`drill recommend list` 新增 `--status` 过滤：

```bash
bastion drill recommend list [--name <name>] [--type <type>] [--status pending|approved|rejected]
```

不传 `--status` 时返回全部状态，保持向后兼容。

## 行为规则

### 审批流转

- `approve` 将 `status` 置为 `1`，写入 `reviewed_by` 和 `reviewed_at`（UTC RFC3339）。
- `reject` 将 `status` 置为 `2`，写入 `reviewed_by` 和 `reviewed_at`。
- 同一推荐可反复审批（教练改主意），每次覆盖 `status`/`reviewed_by`/`reviewed_at`，不保留历史。
- `--id` 不存在时返回错误 `drill recommendation not found: <id>`。
- `--reviewer` 提供时，调用 `PlayerExists` 校验，未注册则返回 `player not found: <name>`（与 `WriteRecommendation` 一致）。

### 训练库视图

- `drill library list` 等价于 `drill recommend list --status approved`，再加可选的 `--type` 过滤。
- 输出格式与 `drill recommend list` 完全一致（TOML `[[drills]]`），新增 `status`、`reviewed_by`、`reviewed_at` 三个字段输出。

### 列表输出

`drill recommend list` 和 `drill library list` 的 TOML 输出在现有字段基础上增加：

```toml
[[drills]]
id = 1
name = '张三'
type = 'infield'
url = 'https://example.com/a'
reason = '步伐好'
summary = '讲解内野扑球'
status = 'approved'
reviewed_by = '教练王'
reviewed_at = '2026-06-25T08:00:00Z'
created_at = '2026-06-25T07:00:00Z'
```

`status` 字段输出为字符串：`pending` / `approved` / `rejected`。未审批时 `reviewed_by` / `reviewed_at` 省略（TOML `omitempty`）。

## 命令输出

- `approve` 成功：`drill recommendation approved: <id>`
- `reject` 成功：`drill recommendation rejected: <id>`
- `library list`：TOML，同 `recommend list` 格式，无数据时无输出。

## 验收标准

1. `drill recommend write` 写入的推荐，`status` 默认为 pending，`reviewed_by`/`reviewed_at` 为空。
2. `drill recommend approve --id 1` 后，`drill recommend list --status approved` 能查到该条，`--status pending` 查不到。
3. `drill recommend reject --id 2` 后，`drill recommend list --status rejected` 能查到，`library list` 查不到。
4. `drill library list` 只返回 approved 推荐，支持 `--type` 过滤。
5. `--reviewer` 传入未注册队员时报 `player not found`。
6. `--id` 不存在时报 `drill recommendation not found`。
7. 旧库（仅有原始六列）升级后，原有推荐 `status` 视为 pending，可被审批。
8. 既有 `drill recommend write`/`list` 测试全部通过，新增审批与训练库测试覆盖以上验收点。
