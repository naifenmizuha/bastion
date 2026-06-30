# 比赛信息登记需求

> 范围:Bastion CLI

## 目的

登记棒球队比赛信息，用于赛后检索、复盘和后续统计。

本功能的目标版本为事件流 MVP：agent 负责将自然语言比赛描述解析为结构化比赛事实事件，CLI 负责校验、保存和读取比赛信息。CLI 不负责自然语言理解，也不直接接入 LLM。

## 技术栈

- Go CLI（Kong）
- SQLite

## 使用场景

1. 用户用自然语言描述一场比赛。
2. agent 将自然语言整理为结构化比赛数据。
3. agent 可以一次性调用 CLI 写入整场比赛，也可以分步创建比赛、追加名单和追加比赛事件。
4. 用户可以按比赛 id 读取完整比赛信息，也可以按日期列出比赛。

## 命令设计

### 批量写入整场比赛

```sh
bastion game write \
  --date 2026-06-24 \
  --start-time 19:30 \
  --opponent "海港队" \
  --batting-side top \
  --own-score 5 \
  --opponent-score 3 \
  --raw "6月24日对海港队，先攻，5:3获胜..." \
  --lineup-json '[{"team":"own","player":"张三","batting_order":1,"starting_position":"P"}]' \
  --events-json '[{"inning":1,"half":"top","play_no":1,"sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"single","related_player":"李四","pitch_sequence":"B,S,F,X","description":"张三中前安打"}]'
```

写入成功后输出新比赛 id，例如：

```text
game saved: 1
```

`game write` 用于赛后一次性导入完整结构化数据。该命令创建的比赛默认视为已完赛。

### 分步创建比赛

```sh
bastion game create \
  --date 2026-06-24 \
  --start-time 19:30 \
  --opponent "海港队" \
  --batting-side top \
  --raw "6月24日对海港队"
```

创建成功后输出新比赛 id，例如：

```text
game created: 1
```

### 追加出场名单

```sh
bastion game lineup add \
  --game-id 1 \
  --team own \
  --player "张三" \
  --batting-order 1 \
  --starting-position P
```

追加成功后输出新名单记录 id，例如：

```text
lineup added: 1
```

### 追加比赛事件

```sh
bastion game event write \
  --game-id 1 \
  --events-json '[{"inning":1,"half":"top","play_no":1,"sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"single","related_player":"李四","pitch_sequence":"B,S,F,X","description":"张三中前安打"}]'
```

追加成功后输出本次写入数量，例如：

```text
game events saved: 1
```

### 更新最终比分

```sh
bastion game score set \
  --game-id 1 \
  --own-score 5 \
  --opponent-score 3
```

更新成功后将比赛标记为已完赛，并输出：

```text
score saved: 1
```

### 读取比赛

```sh
bastion game read --id 1
```

输出内容按以下分组展示：

- 比赛信息
- 出场名单
- 比赛事件

### 列出比赛

```sh
bastion game list --date 2026-06-24
```

列表查询默认按日期倒序展示；指定 `--date` 时只展示该日期的比赛。

## 数据边界

- 自然语言解析由 agent 完成。
- CLI 接收结构化参数或 JSON，并负责字段校验、事务写入和读取展示。
- MVP 不做逐球记录，只记录比赛事实事件；同一攻防片段内可以有多条事实事件。
- 已有 `players` 表可作为球员基础资料，但比赛名单允许记录临时球员名，不强制要求球员已存在。
- 支持整场批量写入和分步写入。批量写入适合赛后导入，分步写入适合比赛中或赛后逐段补录。
- MVP 不支持删除比赛或任意修改历史记录；只允许追加名单、追加比赛事件，以及设置最终比分。

## 表格设计

包含如下表格和字段。

### 比赛表 `games`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 比赛 id |
| date | TEXT NOT NULL | 比赛日期，格式为 `YYYY-MM-DD` |
| start_time | TEXT | 开赛时间，格式建议为 `HH:MM`，未知时为空 |
| opponent | TEXT NOT NULL | 对手名称 |
| batting_side | INTEGER NOT NULL | 我方先攻/后攻枚举值；CLI/JSON 使用名称，SQLite 内部按整数存储 |
| own_score | INTEGER NOT NULL | 我方得分；未完赛时为当前记录值，已完赛时为最终得分 |
| opponent_score | INTEGER NOT NULL | 对方得分；未完赛时为当前记录值，已完赛时为最终得分 |
| is_final | BOOLEAN NOT NULL | 是否已完赛；SQLite 中按 1/0 存储 |
| raw | TEXT NOT NULL | 原始自然语言比赛信息 |
| created_at | TEXT NOT NULL | 创建时间 |

### 出场名单表 `game_lineups`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 出场名单 id |
| game_id | INTEGER NOT NULL | 比赛 id，关联 `games.id` |
| team | INTEGER NOT NULL | 球队枚举值；CLI/JSON 使用名称，SQLite 内部按整数存储 |
| player | TEXT NOT NULL | 球员姓名 |
| batting_order | INTEGER | 棒次，1-9；替补或未知时为空 |
| starting_position | INTEGER | 先发位置枚举值；CLI/JSON 使用名称，SQLite 内部按整数存储；为空表示非先发或未知 |

### 比赛事件表 `game_events`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 比赛事件 id |
| game_id | INTEGER NOT NULL | 比赛 id，关联 `games.id` |
| inning | INTEGER NOT NULL | 局数，从 1 开始 |
| half | INTEGER NOT NULL | 半局枚举值；CLI/JSON 使用名称，SQLite 内部按整数存储 |
| play_no | INTEGER | 攻防片段编号；同一打席或同一连续攻防动作使用相同编号，不属于片段时为空 |
| sequence | INTEGER NOT NULL | 同一 `play_no` 内事件顺序，从 1 开始 |
| event_kind | INTEGER NOT NULL | 事实事件类型：打席结果、跑者移动、防守归属 |
| player | TEXT NOT NULL | 事件主体队员：打者、跑者或防守队员 |
| team | INTEGER NOT NULL | 球队枚举值；CLI/JSON 使用名称，SQLite 内部按整数存储 |
| result | INTEGER NOT NULL | 事件结果，取值依赖 `event_kind` |
| related_player | TEXT | 相关队员；`plate_result` 中为投手，`runner_movement` 中为责任人，`fielding_credit` 中为传球/接球对象 |
| pitch_sequence | TEXT | 球序，仅用于 `plate_result`，例如 `B,S,F,X`；未知时填 `unknown` |
| base_from | INTEGER | 跑者起始垒包；仅用于 `runner_movement`，0 表示本垒，1-3 表示一至三垒 |
| base_to | INTEGER | 跑者到达垒包；仅用于 `runner_movement`，4 表示回本垒得分，出局时为空 |
| reason | INTEGER | 跑者移动原因；主要用于 `runner_movement` |
| outs_on_play | INTEGER NOT NULL | 本事件产生的出局数，默认 0 |
| runs_scored | INTEGER NOT NULL | 本事件产生的得分数，默认 0 |
| rbi_player | TEXT | 获得打点的打者；仅在跑者得分且有打点归属时填写 |
| earned | BOOLEAN | 跑者得分是否为投手责任失分；未知或不适用时为空 |
| value | INTEGER NOT NULL | 事件计数值，默认 1 |
| description | TEXT | 事件描述 |

## 字段取值

### 先攻/后攻

`batting_side` 在 CLI/JSON 中使用字符串名称，SQLite 内部使用整数枚举：

| SQLite 值 | CLI/JSON 名称 | 说明 |
| --- | --- | --- |
| 0 | `top` | 我方先攻 |
| 1 | `bottom` | 我方后攻 |

### 半局

`half` 在 CLI/JSON 中使用字符串名称，SQLite 内部使用整数枚举：

| SQLite 值 | CLI/JSON 名称 | 说明 |
| --- | --- | --- |
| 0 | `top` | 上半局 |
| 1 | `bottom` | 下半局 |

### 球队

`team` 在 CLI/JSON 中使用字符串名称，SQLite 内部使用整数枚举：

| SQLite 值 | CLI/JSON 名称 | 说明 |
| --- | --- | --- |
| 0 | `own` | 我方球队 |
| 1 | `opponent` | 对方球队 |

### 先发位置

`starting_position` 在 CLI/JSON 中使用字符串名称，SQLite 内部沿用棒球守备位置编号：

| SQLite 值 | CLI/JSON 名称 | 说明 |
| --- | --- | --- |
| 1 | `P` | 投手 |
| 2 | `C` | 捕手 |
| 3 | `1B` | 一垒手 |
| 4 | `2B` | 二垒手 |
| 5 | `3B` | 三垒手 |
| 6 | `SS` | 游击手 |
| 7 | `LF` | 左外野手 |
| 8 | `CF` | 中外野手 |
| 9 | `RF` | 右外野手 |

### 事实事件类型

`event_kind` 在 CLI/JSON 中使用字符串名称，SQLite 内部使用整数枚举：

| SQLite 值 | CLI/JSON 名称 | 说明 |
| --- | --- | --- |
| 0 | `plate_result` | 打席主结果 |
| 1 | `runner_movement` | 跑者移动、得分或出局 |
| 2 | `fielding_credit` | 防守记分归属 |

### 打席结果

`plate_result.result` 支持：

| SQLite 值 | CLI/JSON 名称 | 说明 |
| --- | --- | --- |
| 0 | `single` | 一垒安打 |
| 1 | `double` | 二垒安打 |
| 2 | `triple` | 三垒安打 |
| 3 | `homerun` | 本垒打 |
| 4 | `walk` | 四坏球上垒 |
| 5 | `hit_by_pitch` | 触身球上垒 |
| 6 | `strikeout` | 三振 |
| 7 | `groundout` | 滚地出局 |
| 8 | `flyout` | 飞球出局 |
| 9 | `reached_on_error` | 因失误上垒 |
| 10 | `fielders_choice` | 野手选择 |
| 11 | `sacrifice` | 牺牲打或牺牲飞球 |
| 12 | `other` | 其他打席结果 |

### 跑者结果

`runner_movement.result` 支持：

| SQLite 值 | CLI/JSON 名称 | 说明 |
| --- | --- | --- |
| 0 | `advance` | 跑者推进 |
| 1 | `run_scored` | 跑者得分 |
| 2 | `out` | 跑者出局 |

### 跑者原因

`runner_movement.reason` 支持：

| SQLite 值 | CLI/JSON 名称 | 说明 |
| --- | --- | --- |
| 0 | `batted_ball` | 击球造成推进、得分或出局 |
| 1 | `stolen_base` | 盗垒成功 |
| 2 | `caught_stealing` | 盗垒失败 |
| 3 | `wild_pitch` | 暴投 |
| 4 | `passed_ball` | 捕手漏接 |
| 5 | `balk` | 投手犯规 |
| 6 | `pickoff` | 牵制 |
| 7 | `error` | 防守失误 |
| 8 | `fielders_choice` | 野手选择 |
| 9 | `other` | 其他原因 |

### 防守归属

`fielding_credit.result` 支持：

| SQLite 值 | CLI/JSON 名称 | 说明 |
| --- | --- | --- |
| 0 | `putout` | 刺杀 |
| 1 | `assist` | 助杀 |
| 2 | `error` | 防守失误 |
| 3 | `double_play` | 参与双杀 |
| 4 | `passed_ball` | 捕手漏接 |
| 5 | `outfield_assist` | 外野助杀 |
| 6 | `other` | 其他防守归属 |

## 校验规则

- `date` 必须为 `YYYY-MM-DD`。
- `game_id` 必须大于 0，且对应比赛必须存在。
- `opponent` 不能为空。
- `batting_side` 必须为受支持先攻/后攻名称之一：`top`、`bottom`。
- `raw` 不能为空。
- `own_score` 和 `opponent_score` 必须大于等于 0。
- `is_final` 必须为布尔值；`game create` 默认为 `false`，`game write` 和 `game score set` 后为 `true`。
- `team` 必须为受支持球队名称之一：`own`、`opponent`。
- `player` 不能为空。
- `batting_order` 为空或 1-9。
- `starting_position` 为空或受支持先发位置名称之一：`P`、`C`、`1B`、`2B`、`3B`、`SS`、`LF`、`CF`、`RF`；为空表示非先发或未知。
- `inning` 必须大于等于 1。
- `half` 必须为受支持半局名称之一：`top`、`bottom`。
- `play_no` 为空或大于 0。
- `sequence` 必须大于 0。
- `event_kind` 必须为受支持事实事件类型之一。
- `result` 必须与 `event_kind` 匹配。
- `plate_result` 必须填写 `related_player` 作为投手姓名，且必须填写 `pitch_sequence`；未知球序时由 agent 显式填入 `unknown`。
- `runner_movement` 必须填写 `base_from`；`result != out` 时必须填写 `base_to`。
- `base_from` 为空或 0-3。
- `base_to` 为空或 1-4。
- `outs_on_play` 必须大于等于 0。
- `runs_scored` 必须大于等于 0。
- `value` 必须大于等于 0。
- CLI/JSON 中的枚举字符串大小写不敏感；读取和列表输出使用上文表格中的规范名称。

## 写入行为

- `game write` 同时保存比赛主表、出场名单和比赛事件，用于整场批量导入。
- `game create` 只创建比赛主表记录，比分默认为 0:0，`is_final` 默认为 `false`。
- `game lineup add` 只追加一条出场名单，要求 `game_id` 对应比赛存在。
- `game event write` 追加一组比赛事件，要求 `game_id` 对应比赛存在。
- `game score set` 更新最终比分，并将 `is_final` 设为 `true`。
- 每个写入命令都必须使用事务；任一校验或保存失败时，本次命令不落库。
- `game write` 默认不覆盖已有比赛，每次调用都新增一场比赛。
- `lineup-json` 和 `events-json` 允许为空数组，但不能是非法 JSON。
- 写入成功后按命令输出新建、更新的记录 id 或本次写入数量。

## 读取行为

- `game read --id` 读取指定比赛，并按比赛信息、出场名单、比赛事件分组输出。
- 出场名单按 `team`、`batting_order`、`id` 排序。
- 比赛事件按 `inning ASC`、`half ASC`、`play_no ASC`、`sequence ASC`、`id ASC` 排序；同一局内上半局排在下半局前。
- 未完赛比赛读取时展示 `is_final: false`，比分为当前记录值。
- 比赛不存在时返回明确错误，例如 `game not found: 1`。

## 列表行为

- `game list` 默认按 `date` 倒序、`id` 倒序展示比赛。
- `game list --date YYYY-MM-DD` 只展示指定日期的比赛。
- 列表展示字段包括：id、日期、开赛时间、对手、先攻/后攻、比分、是否已完赛。

## 验收测试

### CLI 测试

- 可以写入一场包含名单和比赛事实事件的比赛。
- 可以先 `game create` 创建比赛，再通过 `game lineup add` 和 `game event write` 分步追加记录。
- 可以通过 `game score set` 设置最终比分，并将比赛标记为已完赛。
- 可以通过 `game read --id` 读回完整比赛信息。
- 可以通过 `game list --date` 列出指定日期比赛。
- 不存在的 `game_id`、非法日期、空对手、非法半局枚举值、非法事件类型、非法结果类型会失败。

### SQLite 测试

- `games`、`game_lineups`、`game_events` 能正确建表。
- 比赛写入使用事务，任一子记录失败时整场比赛不落库。
- 分步追加使用事务，任一子记录失败时本次追加不落库。
- MVP 默认只新增比赛和追加记录，不覆盖历史比赛事件。

### Domain 测试

- 服务层会裁剪空白、标准化日期。
- 事实事件类型、结果枚举、原因枚举、先攻/后攻、半局枚举和垒位字段校验正确。
- 缺少必填字段时返回明确错误。
