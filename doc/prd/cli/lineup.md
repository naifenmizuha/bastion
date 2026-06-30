# 比赛阵容生成与确认需求

> 范围:Bastion CLI

## 背景

当前系统已经具备球员资料、比赛、比赛实际出场名单、比赛事件、单场分析和跨期分析能力。比赛实际出场名单保存在 `game_lineups`,单场分析会直接读取该表中的本方打序和首发守备位置。

新增阵容功能后,agent 需要先查询球员资料和近期表现,由 LLM 根据教练意图提出阵容,再交给 CLI 做确定性校验。通过校验的阵容仍是赛前方案,只有教练明确接受后才成为该场比赛的正式首发阵容并同步到 `game_lineups`。

本需求同时细化球员可守位置。现有 `players.positions` 中的 `infield` 需要拆分为棒球守备编号 3-6 对应的四个位置:

- `first_base` / `1B` / 3
- `second_base` / `2B` / 4
- `third_base` / `3B` / 5
- `shortstop` / `SS` / 6

外野在 MVP 中继续使用粗粒度 `outfield`,表示该球员可以被安排到 `LF`、`CF` 或 `RF`。

## 目的

- 让 agent 能够查询可用球员和历史表现并生成结构化阵容方案。
- 让 CLI 独立校验阵容的完整性、唯一性和球员位置资格。
- 保留阵容草稿、校验结果、生成理由和接受状态。
- 教练接受阵容后,将正式首发同步到现有 `game_lineups`。
- 让后续 `game analysis generate` 无需修改即可使用正式阵容。
- 将球员内野能力从笼统的 `infield` 细化为 `1B`、`2B`、`3B`、`SS`。

## 非目标

- CLI 不根据统计数据自动选择球员或自动优化打序。
- CLI 不理解自然语言策略。
- CLI 不在校验失败时自动修改 LLM 生成的阵容。
- MVP 不记录比赛中的换人、调守或逐局守备变化。
- MVP 不自动根据对手数据计算对位策略。
- MVP 不细分外野手的 `LF`、`CF`、`RF` 资格。
- MVP 不实现多人协作审批或阵容审批历史。

## 角色与职责

### Agent / LLM

- 理解教练的自然语言意图。
- 调用 CLI 查询球员列表、球员资料和跨期表现。
- 选择首发、替补、打序、守备位置和投手计划。
- 生成 `lineup.json`。
- 根据 CLI 返回的结构化错误修正方案并重新提交。
- 向教练解释阵容取舍。

### CLI / 领域层

- 读取严格 JSON 输入。
- 校验比赛、球员、打序、位置和投手计划。
- 保存阵容方案及 LLM 提供的理由。
- 返回结构化校验错误。
- 在教练明确接受后,以事务方式同步正式首发。
- 不自行替换、移动或补充球员。

### 教练

- 提供比赛目标和可用人员等上下文。
- 审阅 agent 生成的方案。
- 明确决定是否接受阵容。

## 核心工作流

```text
教练提出阵容需求
  -> agent 查询 player list / player read
  -> agent 查询 person analysis read
  -> LLM 生成 lineup.json
  -> lineup validate
  -> 失败:返回结构化错误,LLM 修正后重试
  -> 成功:lineup write 保存 validated 方案
  -> 教练确认
  -> lineup accept
  -> 事务写入 game_lineups
  -> 比赛记录和单场分析沿用现有流程
```

`lineup accept` 必须由教练明确授权后调用。agent 不得仅因 `lineup validate` 成功而自动接受阵容。

## 前置依赖

为支持 agent 自主选择球员,需要提供或确认以下查询能力:

```sh
bastion player list
bastion player read --name "张三"
bastion person analysis read --name "张三" --from 2026-05-01 --to 2026-06-30
bastion game read --id 12
```

其中 `player list` 至少返回姓名、号码、打击手、投球手和可守位置。当前项目若尚无 `player list`,应作为本需求的一部分补齐。

## 命令设计

### 校验阵容但不保存

```sh
bastion lineup validate --input lineup.json
```

成功输出:

```json
{
  "ok": true,
  "data": {
    "valid": true,
    "game_id": 12,
    "starter_count": 9,
    "bench_count": 3,
    "warnings": []
  }
}
```

校验失败使用正常的业务响应,不把可修正的阵容问题视为内部错误:

```json
{
  "ok": true,
  "data": {
    "valid": false,
    "game_id": 12,
    "errors": [
      {
        "code": "position_uncovered",
        "field": "starters",
        "position": "C",
        "message": "starting lineup does not cover C"
      },
      {
        "code": "player_position_unsupported",
        "field": "starters[2].position",
        "player": "张三",
        "position": "SS",
        "allowed_positions": ["P", "1B"]
      }
    ],
    "warnings": []
  }
}
```

JSON 无法解析、包含未知字段或 `game_id` 不存在时,沿用全局 CLI 错误协议并返回 `ok: false`。

### 校验并保存阵容方案

```sh
bastion lineup write --input lineup.json
```

- 执行与 `lineup validate` 完全相同的校验。
- 只有校验成功才写入数据库。
- 新记录初始状态为 `validated`。
- 同一比赛允许保存多个候选方案。

成功输出:

```json
{
  "ok": true,
  "data": {
    "resource": "lineup",
    "id": 3,
    "game_id": 12,
    "status": "validated"
  }
}
```

### 读取阵容方案

```sh
bastion lineup read --id 3
```

返回阵容头部、首发、替补、投手计划、生成理由、校验警告和状态。

### 列出阵容方案

```sh
bastion lineup list
bastion lineup list --game-id 12
bastion lineup list --game-id 12 --status validated
```

默认按 `created_at` 倒序返回。无记录时返回空数组。

### 接受阵容方案

```sh
bastion lineup accept --id 3
```

接受操作必须在同一事务内:

1. 确认阵容存在且状态为 `validated`。
2. 重新读取当前球员资料并执行完整校验。
3. 删除该比赛 `game_lineups` 中 `team = own` 的已有记录,不影响对方名单。
4. 将方案中的首发复制到 `game_lineups`。
5. 将同一比赛此前的 `accepted` 方案改为 `superseded`。
6. 将当前方案改为 `accepted`,写入 `accepted_at`。

成功输出:

```json
{
  "ok": true,
  "data": {
    "resource": "lineup",
    "id": 3,
    "game_id": 12,
    "status": "accepted",
    "game_lineup_count": 9
  }
}
```

若球员资料在保存方案后发生变化并导致重新校验失败,不得修改 `game_lineups`,也不得改变方案状态。

### 拒绝阵容方案

```sh
bastion lineup reject --id 3
```

仅允许把 `validated` 方案改为 `rejected`。拒绝不修改 `game_lineups`。

## `lineup.json` 输入设计

```json
{
  "schema_version": "1.0",
  "game_id": 12,
  "strategy": "优先守备稳定性,同时避免连续三名右打者",
  "starters": [
    {
      "player": "李四",
      "position": "CF",
      "batting_order": 1
    },
    {
      "player": "王五",
      "position": "SS",
      "batting_order": 2
    },
    {
      "player": "张三",
      "position": "P",
      "batting_order": 3
    }
  ],
  "bench": [
    {
      "player": "陈七",
      "suggested_role": "infield_substitute"
    }
  ],
  "pitching_plan": [
    {
      "player": "张三",
      "role": "starter",
      "planned_innings": 4
    },
    {
      "player": "周八",
      "role": "reliever",
      "planned_innings": 3
    }
  ],
  "reasoning": [
    "李四近期上垒表现较好且速度较快,安排第一棒",
    "张三先发投手,计划最多投4局"
  ]
}
```

字段说明:

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| schema_version | string | 是 | MVP 固定为 `1.0` |
| game_id | integer | 是 | 已存在的比赛 id |
| strategy | string | 否 | 教练意图或 LLM 采用的总体策略 |
| starters | array | 是 | 完整首发阵容 |
| bench | array | 否 | 替补方案,默认为空数组 |
| pitching_plan | array | 否 | 投手使用计划,默认为空数组 |
| reasoning | array[string] | 否 | LLM 给出的方案理由 |

MVP 输入只使用球员姓名,与当前 `players` 和统计表保持一致。后续若为 `players` 增加不可变 id,协议可新增 `player_id` 并保留姓名快照。

## 数据模型

### 阵容方案表 `lineups`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 阵容方案 id |
| game_id | INTEGER NOT NULL | 关联 `games.id` |
| schema_version | TEXT NOT NULL | 输入协议版本 |
| status | INTEGER NOT NULL | 方案状态 |
| strategy | TEXT | 总体策略 |
| reasoning_json | TEXT NOT NULL | 理由 JSON 数组 |
| warnings_json | TEXT NOT NULL | 保存时的警告快照 |
| created_at | TEXT NOT NULL | 生成时间,RFC3339 |
| accepted_at | TEXT | 接受时间 |

约束:

```sql
FOREIGN KEY(game_id) REFERENCES games(id);
CREATE UNIQUE INDEX one_accepted_lineup_per_game
ON lineups(game_id)
WHERE status = 1;
```

状态枚举:

| SQLite 值 | CLI/JSON 名称 | 说明 |
| --- | --- | --- |
| 0 | `validated` | 已校验候选方案 |
| 1 | `accepted` | 当前正式采用方案 |
| 2 | `rejected` | 已拒绝方案 |
| 3 | `superseded` | 曾采用但已被新方案替代 |

MVP 不保存无效草稿。校验失败的内容由 agent 在上下文中修正,不进入数据库。

### 阵容成员表 `lineup_entries`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 成员记录 id |
| lineup_id | INTEGER NOT NULL | 关联 `lineups.id` |
| player | TEXT NOT NULL | 关联已登记球员姓名 |
| role | INTEGER NOT NULL | `starter` 或 `bench` |
| batting_order | INTEGER | 首发棒次 1-9;替补为空 |
| position | INTEGER | 首发位置 1-9;替补为空 |
| suggested_role | TEXT | 替补建议角色 |

约束:

```sql
FOREIGN KEY(lineup_id) REFERENCES lineups(id) ON DELETE CASCADE;
FOREIGN KEY(player) REFERENCES players(name);
UNIQUE(lineup_id, player);
```

同一方案中首发棒次和首发位置还需要条件唯一索引:

```sql
CREATE UNIQUE INDEX lineup_unique_batting_order
ON lineup_entries(lineup_id, batting_order)
WHERE role = 0 AND batting_order IS NOT NULL;

CREATE UNIQUE INDEX lineup_unique_position
ON lineup_entries(lineup_id, position)
WHERE role = 0 AND position IS NOT NULL;
```

### 投手计划表 `lineup_pitching_plans`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 投手计划 id |
| lineup_id | INTEGER NOT NULL | 关联 `lineups.id` |
| player | TEXT NOT NULL | 已登记球员姓名 |
| sequence | INTEGER NOT NULL | 预计登板顺序,从 1 开始 |
| role | INTEGER NOT NULL | `starter` 或 `reliever` |
| planned_innings | INTEGER | 计划投球局数,必须大于 0 |

约束:

```sql
FOREIGN KEY(lineup_id) REFERENCES lineups(id) ON DELETE CASCADE;
FOREIGN KEY(player) REFERENCES players(name);
UNIQUE(lineup_id, player);
UNIQUE(lineup_id, sequence);
```

投手计划属于赛前意图,接受阵容后不复制到现有比赛事实表。后续若需要赛后计划对比,通过 `accepted lineups -> lineup_pitching_plans` 读取。

## 与现有表的联动

### `players`

- 生成前由 agent 查询。
- 校验时确认首发、替补和投手计划中的所有本方球员均已登记。
- 校验球员是否具备所安排位置的资格。
- `lineup_entries.player` 和 `lineup_pitching_plans.player` 关联 `players.name`。

### `games`

- 每个方案必须关联一场已存在比赛。
- 已完赛比赛不得创建、接受或拒绝新阵容方案。
- 同一比赛允许多个 `validated` 候选,但只能有一个 `accepted` 方案。

### `game_lineups`

- 继续表示比赛正式/实际使用的名单,不是 LLM 草稿。
- `lineup accept` 只替换该比赛的本方记录。
- 每个首发映射为一条 `game_lineups`:
  - `team = own`
  - `player = lineup_entries.player`
  - `batting_order = lineup_entries.batting_order`
  - `starting_position = lineup_entries.position`
- 替补和投手计划不在接受时写入 `game_lineups`。

### `game_player_*` 分析表

- 不直接关联阵容方案。
- `game analysis generate` 继续通过 `game_lineups` 获取正式打序和位置。
- 阵容接受后,现有分析链路无需新增 join。
- 如果该比赛已经生成分析后又接受新阵容,CLI 应返回警告,要求重新执行 `game analysis generate`。

## 球员位置细化

### CLI/JSON 位置名称

`players.positions` 的输入和输出继续使用逗号分隔字符串:

```json
{
  "name": "王五",
  "number": 6,
  "bat": "right",
  "throw": "right",
  "positions": "second_base,third_base,shortstop"
}
```

支持值:

| 名称 | 可安排的守备位置 |
| --- | --- |
| `pitcher` | `P` / 1 |
| `catcher` | `C` / 2 |
| `first_base` | `1B` / 3 |
| `second_base` | `2B` / 4 |
| `third_base` | `3B` / 5 |
| `shortstop` | `SS` / 6 |
| `outfield` | `LF`、`CF`、`RF` / 7-9 |

新增写入不再接受 `infield`。这样 agent 必须明确球员能守哪些内野位置。

### Position bit flag

球员能力使用 bit flag,不得直接使用守备编号 1-9 作为 bit 值。建议定义:

| bit | 领域名称 |
| --- | --- |
| `1 << 0` | pitcher |
| `1 << 1` | catcher |
| `1 << 2` | first_base |
| `1 << 3` | second_base |
| `1 << 4` | third_base |
| `1 << 5` | shortstop |
| `1 << 6` | outfield |

不保留 `infield` 领域值或兼容 bit。原有笼统的 `infield` 数据无法可靠推断球员具体能守哪个内野位置,且部分旧 bit 与新 bit 数值重合,因此不做自动迁移或旧数据识别。启用新模型前必须重建数据库,或清空 `players` 后重新录入球员及其精确位置;开发和演示数据库直接重建。

## 阵容校验规则

### 比赛

- `game_id` 必须大于 0 且存在。
- 比赛必须尚未完赛。
- `schema_version` 必须为 `1.0`。

### 首发

- 必须正好包含 9 名球员。
- 每名球员必须存在于 `players`。
- 同一球员只能出现一次。
- 棒次必须完整覆盖 1-9,不得重复或缺失。
- 位置必须完整覆盖 `P,C,1B,2B,3B,SS,LF,CF,RF`,不得重复或缺失。
- 球员必须具备对应位置资格。
- `outfield` 资格可以安排到 `LF`、`CF` 或 `RF`。
- 首发与替补不得重复。

### 替补

- 替补球员必须存在于 `players`。
- 同一替补只能出现一次。
- `suggested_role` 为自由文本建议,不参与资格校验。
- 替补可以为空。

### 投手计划

- 投手必须存在于 `players`。
- 投手必须具备 `pitcher` 资格。
- `role` 只能是 `starter` 或 `reliever`。
- 第一名投手必须是 `starter`,其余必须是 `reliever`。
- 先发投手必须与首发阵容中的 `P` 为同一球员。
- 同一投手只能出现一次。
- `planned_innings` 若填写必须大于 0。
- 总计划局数超过比赛局数时返回 warning,不阻止保存。
- 投手计划可以为空;为空时返回 warning,不阻止保存。

### 理由与策略

- `strategy`、`reasoning` 只做裁剪和长度限制,不参与阵容合法性判断。
- CLI 不验证 LLM 的自然语言理由是否真实。
- `reasoning` 不得包含用于绕过校验的结构化指令。

## 错误码

| code | 说明 |
| --- | --- |
| `game_not_found` | 比赛不存在 |
| `game_already_final` | 比赛已经完赛 |
| `player_not_found` | 球员未登记 |
| `duplicate_player` | 首发或替补重复 |
| `starter_bench_conflict` | 同一球员同时为首发和替补 |
| `invalid_starter_count` | 首发人数不是 9 |
| `duplicate_batting_order` | 棒次重复 |
| `batting_order_uncovered` | 1-9 中存在缺失棒次 |
| `duplicate_position` | 首发守备位置重复 |
| `position_uncovered` | 1-9 中存在缺失位置 |
| `player_position_unsupported` | 球员不具备所安排的位置资格 |
| `invalid_pitching_role` | 投手角色不合法 |
| `pitcher_not_eligible` | 投手不具备投手资格 |
| `starter_pitcher_mismatch` | 投手计划先发与阵容 P 不一致 |
| `lineup_not_validated` | 方案状态不允许接受 |
| `lineup_stale` | 保存后球员资料变化导致重新校验失败 |

每个可定位错误应尽可能返回:

- `field`: JSON 字段路径
- `player`: 相关球员
- `position`: 相关位置
- `expected`: 期望值
- `actual`: 实际值
- `message`: 简短可读描述

## 一致性与并发

- `lineup write` 必须在事务中写入头部、成员和投手计划。
- `lineup accept` 必须在事务中完成状态切换和 `game_lineups` 替换。
- 数据库通过条件唯一索引保证一场比赛最多一个 accepted 方案。
- 接受时必须重新校验,避免保存方案后球员资料改变。
- 若两个进程同时接受不同方案,最多一个事务成功;失败方返回 `conflict`。
- 不允许删除 accepted 方案,以保留正式阵容来源。

## 测试要求

### 领域测试

- 完整合法阵容通过。
- 每一种位置缺失、重复均失败。
- 每一种棒次缺失、重复均失败。
- 首发球员重复、首发替补冲突均失败。
- `first_base` 只能守 `1B`,不能守其他内野位置。
- `second_base`、`third_base`、`shortstop` 分别只匹配对应位置。
- `outfield` 可以匹配 `LF`、`CF`、`RF`。
- 投手计划与首发 P 一致性。
- 多个错误一次返回,方便 LLM 单轮修复。

### SQLite 测试

- 阵容头部、成员和投手计划事务写入。
- 外键阻止不存在的比赛和球员。
- 一场比赛只能有一个 accepted 方案。
- 接受后只替换本方 `game_lineups`,保留对方名单。
- 接受失败时不产生部分写入。
- 替代旧 accepted 方案后状态正确。
- 新位置 bit 能正确保存和还原。
- 新建数据库只使用新的位置 bit 定义。

### CLI 测试

- 严格 JSON 拒绝未知字段。
- `validate` 不写数据库。
- `write` 只保存合法阵容。
- `read` 和 `list` 输出稳定 JSON。
- 校验错误包含 code 和字段路径。
- `accept` 输出同步到 `game_lineups` 的记录数。

### 回归测试

- 现有 `game write` 和 `game lineup add` 行为不变。
- 接受阵容后 `game read` 能读取正式首发。
- 接受阵容后 `game analysis generate` 能读取棒次和位置。
- 重新录入位置后的 player 数据可正常读取和格式化。

## MVP 验收标准

1. Agent 能通过 CLI 列出球员并读取其精确内野位置资格。
2. LLM 生成的 `lineup.json` 可被 CLI 严格校验。
3. 非法阵容返回结构化、可供 LLM 修复的全部错误。
4. 合法阵容可以保存、读取、列出、拒绝和接受。
5. 同一比赛可以保留多个候选,但只能有一个正式接受方案。
6. 接受阵容后,本方九名首发正确写入现有 `game_lineups`。
7. 对方名单不会被接受操作删除或覆盖。
8. 现有单场分析无需修改数据来源即可读取正式阵容。
9. 球员位置只接受精确内野位置,不再接受笼统的 `infield`。
10. 全部新增领域、SQLite 和 CLI 测试通过。

## 后续方向

- 将外野资格进一步细分为 `left_field`、`center_field`、`right_field`。
- 为 `players` 增加不可变 id,逐步替代姓名关联。
- 增加球员当天可用状态、伤病和出场限制。
- 增加替补换人和逐局守备计划。
- 增加纯算法候选生成器,作为 LLM 可选工具。
- 比较赛前 accepted 阵容与赛后实际出场及表现。
