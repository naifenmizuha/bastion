# 比赛队员表现分析需求

> 范围:Bastion CLI

## 目的

在比赛记录完成之后，按队员维度生成表现分析，覆盖打击、跑垒、投球、防守四类能力，供教练和队员做赛后复盘、训练重点判断和长期成长追踪。

本功能的目标版本为队员表现 MVP：CLI 负责读取结构化比赛事实事件、计算可稳定量化的指标并保存分析结果；agent 负责根据指标做自然语言解读、亮点总结和训练建议。CLI 不负责自然语言理解，也不直接接入 LLM。

```sh
bastion game event write --game-id [game_id] --events-json [events]
bastion game analysis generate --game-id [game_id]
bastion game analysis read --game-id [game_id]
bastion game analysis read --game-id [game_id] --player [name]
bastion game analysis list
```

## 参考口径

MVP 采用棒球常用基础统计口径，并结合统一比赛事件表的记录能力做简化。

- MLB Glossary 将打击上垒率定义为打者每打席上垒频率，计入安打、保送和触身球，不计失误上垒、野手选择和不死三振；本项目 MVP 会明确标注简化口径。参考：https://www.mlb.com/glossary/standard-stats/on-base-percentage
- MLB Glossary 将长打率定义为每打数总垒打，公式为 `(1B + 2B*2 + 3B*3 + HR*4) / AB`。参考：https://www.mlb.com/glossary/standard-stats/slugging-percentage
- MLB Glossary 将 ERA 作为投手每 9 局责任失分指标，公式为 `9 * earned_runs / innings_pitched`；本项目 MVP 若没有责任失分判定，只计算 `RA9`，不冒充正式 ERA。参考：https://www.mlb.com/glossary/standard-stats/earned-run-average
- MLB Glossary 将 WHIP 定义为 `(walks + hits) / innings_pitched`。参考：https://www.mlb.com/glossary/standard-stats/walks-and-hits-per-inning-pitched
- MLB Glossary 将盗垒成功率定义为 `SB / (SB + CS)`。参考：https://www.mlb.com/glossary/standard-stats/stolen-base-percentage
- MLB Glossary 将防守率定义为 `(putouts + assists) / (putouts + assists + errors)`。参考：https://www.mlb.com/glossary/standard-stats/fielding-percentage
- MLB Statcast 使用 Sprint Speed、OAA 等高阶指标衡量跑垒速度和防守范围，但这些指标依赖追踪数据；MVP 不计算。参考：https://www.mlb.com/glossary/statcast/sprint-speed、https://www.mlb.com/glossary/statcast/outs-above-average

## 技术栈

- Go CLI（Kong）
- SQLite

## 使用场景

1. 用户通过 `game write` 或分步命令完成一场比赛记录。
2. agent 从比赛记录、记分表或用户描述中整理可结构化的比赛事实事件。
3. 用户或 agent 调用 `game analysis generate --game-id` 为该场比赛生成队员表现统计。
4. 教练通过 `game analysis read --game-id` 查看全队表现，也可以用 `--player` 查看单个队员。
5. agent 读取结构化分析结果，生成自然语言复盘，例如“打击选球好但跑垒风险偏高”“投手控球稳定但被长打较多”“守备参与多但失误集中在传球”。

## 核心建模原则

源数据只记录“记分事实”，不记录“分析视角”。

打击/投球、跑垒/防守经常是同一件事的两个视角。如果源数据同时记录两个视角，就会出现镜像冗余，例如 `batter_single` 和 `pitcher_hit_allowed` 表达的是同一事实。MVP 只记录不可再推导的事实事件，分析指标全部从事实事件派生。

冗余判断规则：

> 如果删除某条记录后，仍然可以从同一事实源 100% 推导出来，它就是冗余。  
> 如果它给的是另一个人的官方记分归属，它不是冗余，而是同一 play 下的另一条事实。

因此比赛事件只分三类：

- `plate_result`：一次打席的主结果，包含打者、投手、球序和打席结果。
- `runner_movement`：跑者移动、得分或出局，包含起止垒包、原因和相关责任人。
- `fielding_credit`：防守记分归属，包含防守队员的刺杀、助杀、失误等。

投手不作为事件主体出现。投手表现从 `plate_result.related_player` 和投手相关 `runner_movement.related_player` 反向汇总。

## 命令设计

### 写入比赛事件

```sh
bastion game event write \
  --game-id 1 \
  --events-json '[
    {
      "inning": 1,
      "half": "top",
      "play_no": 12,
      "sequence": 1,
      "event_kind": "plate_result",
      "player": "张三",
      "team": "own",
      "result": "single",
      "related_player": "王五",
      "pitch_sequence": "B,S,F,X",
      "description": "张三中前安打"
    },
    {
      "inning": 1,
      "half": "top",
      "play_no": 12,
      "sequence": 2,
      "event_kind": "runner_movement",
      "player": "李四",
      "team": "own",
      "result": "run_scored",
      "base_from": 2,
      "base_to": 4,
      "reason": "batted_ball",
      "rbi_player": "张三",
      "runs_scored": 1,
      "description": "李四从二垒回本垒得分"
    }
  ]'
```

写入成功后输出本次写入数量：

```text
game events saved: 2
```

`events-json` 一次可以包含同一攻防片段的多条事实事件，也可以包含多个攻防片段的事件。该命令追加结构化比赛事件；同一场比赛内的事件共同组成比赛时间线和队员表现数据源。

### 生成队员表现分析

```sh
bastion game analysis generate --game-id 1
```

生成成功后输出：

```text
game analysis generated: 1
```

`generate` 可以重复执行。同一 `game_id` 已存在分析结果时，CLI 在事务内删除旧分析结果，再基于当前比赛记录重新生成。

### 读取全队分析

```sh
bastion game analysis read --game-id 1
```

输出内容按以下分组展示：

- 比赛信息摘要
- 队员综合表现
- 打击表现
- 跑垒表现
- 投球表现
- 防守表现
- 数据缺口提示

### 读取单个队员分析

```sh
bastion game analysis read --game-id 1 --player "张三"
```

只展示该队员在本场比赛中的综合表现、打击、跑垒、投球、防守数据。

### 列出已生成分析的比赛

```sh
bastion game analysis list
```

列表默认按分析生成时间倒序展示，每条包含 game_id、比赛日期、对手、比分、胜负结果、生成时间。

## 数据边界

- 统计计算只基于结构化比赛数据，不从 `games.raw` 或事件描述中猜测指标。
- agent 可以在调用 CLI 前把自然语言、记分表或视频观察整理成结构化事件；CLI 只接收结构化字段。
- MVP 优先产出队员维度分析，而不是球队总览。
- MVP 取消独立的 `plate_appearances` 表；比赛过程统一由 `game_events` 表表达。
- `play_no` 用于把同一打席或同一攻防片段内的多条事实事件分组，不作为单独实体表。
- 打击、跑垒、投球、防守分析都从 `game_events` 汇总。
- Statcast 类指标，如冲刺速度、OAA、接球概率、臂力，不在 MVP 范围内。
- CLI 只保存结构化统计结果。复盘文字、训练建议和表现解读由 agent 在读取结果后生成。

## 源数据设计

### 比赛事件表 `game_events`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 比赛事件 id |
| game_id | INTEGER NOT NULL | 比赛 id，关联 `games.id` |
| inning | INTEGER NOT NULL | 局数，从 1 开始 |
| half | INTEGER NOT NULL | 半局枚举值；`top` 或 `bottom` |
| play_no | INTEGER | 攻防片段编号；同一打席或同一连续攻防动作使用相同编号，不属于片段时为空 |
| sequence | INTEGER NOT NULL | 同一 `play_no` 内事件顺序，从 1 开始 |
| event_kind | INTEGER NOT NULL | 事实事件类型：打席结果、跑者移动、防守归属 |
| player | TEXT NOT NULL | 事件主体队员：打者、跑者或防守队员 |
| team | INTEGER NOT NULL | 队员所属球队；`own` 或 `opponent` |
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
| description | TEXT | 事件描述，保留人工或 agent 整理后的说明 |

### 事实事件类型

| SQLite 值 | CLI/JSON 名称 | 说明 |
| --- | --- | --- |
| 0 | `plate_result` | 打席主结果 |
| 1 | `runner_movement` | 跑者移动、得分或出局 |
| 2 | `fielding_credit` | 防守记分归属 |

### 打席结果 `plate_result.result`

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

`plate_result` 必须填写 `player` 作为打者、`related_player` 作为投手、`pitch_sequence` 作为球序。换投通过后续 `plate_result.related_player` 的变化体现。

### 跑者结果 `runner_movement.result`

| SQLite 值 | CLI/JSON 名称 | 说明 |
| --- | --- | --- |
| 0 | `advance` | 跑者推进 |
| 1 | `run_scored` | 跑者得分 |
| 2 | `out` | 跑者出局 |

### 跑者原因 `runner_movement.reason`

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

暴投、投手犯规、牵制不单独写投手事件；使用 `runner_movement` 表达跑者事实，并在 `related_player` 中记录投手。

### 防守归属 `fielding_credit.result`

| SQLite 值 | CLI/JSON 名称 | 说明 |
| --- | --- | --- |
| 0 | `putout` | 刺杀 |
| 1 | `assist` | 助杀 |
| 2 | `error` | 防守失误 |
| 3 | `double_play` | 参与双杀 |
| 4 | `passed_ball` | 捕手漏接 |
| 5 | `outfield_assist` | 外野助杀 |
| 6 | `other` | 其他防守归属 |

### 同一攻防片段多事实示例

```json
[
  {
    "inning": 1,
    "half": "top",
    "play_no": 12,
    "sequence": 1,
    "event_kind": "plate_result",
    "player": "张三",
    "team": "own",
    "result": "single",
    "related_player": "王五",
    "pitch_sequence": "B,S,F,X",
    "description": "张三中前安打"
  },
  {
    "inning": 1,
    "half": "top",
    "play_no": 12,
    "sequence": 2,
    "event_kind": "runner_movement",
    "player": "李四",
    "team": "own",
    "result": "run_scored",
    "base_from": 2,
    "base_to": 4,
    "reason": "batted_ball",
    "rbi_player": "张三",
    "runs_scored": 1,
    "description": "李四从二垒回本垒得分"
  },
  {
    "inning": 1,
    "half": "top",
    "play_no": 12,
    "sequence": 3,
    "event_kind": "fielding_credit",
    "player": "赵六",
    "team": "opponent",
    "result": "error",
    "description": "中外野手处理球失误"
  }
]
```

## 分析结果表格设计

### 比赛分析主表 `game_analyses`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 分析 id |
| game_id | INTEGER NOT NULL UNIQUE | 比赛 id，关联 `games.id` |
| result | INTEGER NOT NULL | 胜负结果枚举值 |
| own_runs | INTEGER NOT NULL | 我方总得分，来自 `games.own_score` |
| opponent_runs | INTEGER NOT NULL | 对方总得分，来自 `games.opponent_score` |
| players_analyzed | INTEGER NOT NULL | 本场生成分析的我方队员数 |
| generated_at | TEXT NOT NULL | 分析生成时间，格式 RFC3339 |

### 队员综合表现表 `game_player_performance_summaries`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 综合表现记录 id |
| game_id | INTEGER NOT NULL | 比赛 id，关联 `games.id` |
| player | TEXT NOT NULL | 队员姓名 |
| batting_order | INTEGER | 棒次，未知时为空 |
| positions | TEXT | 本场守备位置，多个位置用逗号分隔，未知时为空 |
| batting_available | BOOLEAN NOT NULL | 是否有打击数据 |
| baserunning_available | BOOLEAN NOT NULL | 是否有跑垒数据 |
| pitching_available | BOOLEAN NOT NULL | 是否有投球数据 |
| fielding_available | BOOLEAN NOT NULL | 是否有防守数据 |
| highlight | TEXT | 结构化亮点标签，多个标签用逗号分隔，例如 `multi_hit,stole_base,no_errors` |
| risk | TEXT | 结构化风险标签，多个标签用逗号分隔，例如 `high_strikeout,walks_allowed,fielding_error` |

`game_id` + `player` 唯一。

### 队员打击表现表 `game_player_batting_stats`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 打击统计记录 id |
| game_id | INTEGER NOT NULL | 比赛 id，关联 `games.id` |
| player | TEXT NOT NULL | 队员姓名 |
| pa | INTEGER NOT NULL | 打席数 |
| at_bats | INTEGER NOT NULL | 打数 |
| hits | INTEGER NOT NULL | 安打数 |
| singles | INTEGER NOT NULL | 一垒安打数 |
| doubles | INTEGER NOT NULL | 二垒安打数 |
| triples | INTEGER NOT NULL | 三垒安打数 |
| homeruns | INTEGER NOT NULL | 本垒打数 |
| walks | INTEGER NOT NULL | 四坏球数 |
| hit_by_pitch | INTEGER NOT NULL | 触身球上垒次数 |
| strikeouts | INTEGER NOT NULL | 三振数 |
| reached_on_error | INTEGER NOT NULL | 因失误上垒次数 |
| runs_batted_in | INTEGER NOT NULL | 打点，来自 `runner_movement.rbi_player` |
| total_bases | INTEGER NOT NULL | 总垒打数 |
| batting_average | REAL NOT NULL | 打击率，`hits / at_bats`，无打数时为 0 |
| on_base_percentage | REAL NOT NULL | 简化上垒率，见统计规则 |
| slugging_percentage | REAL NOT NULL | 长打率，`total_bases / at_bats`，无打数时为 0 |
| ops | REAL NOT NULL | `on_base_percentage + slugging_percentage` |

`game_id` + `player` 唯一。

### 队员跑垒表现表 `game_player_baserunning_stats`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 跑垒统计记录 id |
| game_id | INTEGER NOT NULL | 比赛 id，关联 `games.id` |
| player | TEXT NOT NULL | 队员姓名 |
| runs | INTEGER NOT NULL | 得分数 |
| stolen_bases | INTEGER NOT NULL | 盗垒成功数 |
| caught_stealing | INTEGER NOT NULL | 盗垒失败数 |
| stolen_base_attempts | INTEGER NOT NULL | 盗垒尝试数，`stolen_bases + caught_stealing` |
| stolen_base_percentage | REAL NOT NULL | 盗垒成功率，无尝试时为 0 |
| extra_bases_taken | INTEGER NOT NULL | 击球后额外推进次数 |
| baserunning_outs | INTEGER NOT NULL | 跑垒出局数，不含盗垒失败 |

`game_id` + `player` 唯一。

### 队员投球表现表 `game_player_pitching_stats`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 投球统计记录 id |
| game_id | INTEGER NOT NULL | 比赛 id，关联 `games.id` |
| player | TEXT NOT NULL | 队员姓名 |
| outs_recorded | INTEGER NOT NULL | 取得出局数，用于计算投球局数 |
| innings_pitched | REAL NOT NULL | 投球局数，按 `outs_recorded / 3` 展示 |
| batters_faced | INTEGER NOT NULL | 面对打者数 |
| hits_allowed | INTEGER NOT NULL | 被安打数 |
| walks_allowed | INTEGER NOT NULL | 四坏球数 |
| strikeouts | INTEGER NOT NULL | 三振数 |
| homeruns_allowed | INTEGER NOT NULL | 被本垒打数 |
| runs_allowed | INTEGER NOT NULL | 失分数 |
| earned_runs | INTEGER NOT NULL | 责任失分数；无责任失分事件时为 0 |
| ra9 | REAL NOT NULL | 每 9 局失分，`9 * runs_allowed / innings_pitched`，无局数时为 0 |
| era | REAL | `9 * earned_runs / innings_pitched`；责任失分数据不可用时为空 |
| whip | REAL NOT NULL | `(walks_allowed + hits_allowed) / innings_pitched`，无局数时为 0 |
| strikeout_walk_ratio | REAL | `strikeouts / walks_allowed`；无保送时为空 |
| wild_pitches | INTEGER NOT NULL | 暴投数，来自 `runner_movement.reason = wild_pitch` 的 `related_player` |
| balks | INTEGER NOT NULL | 投手犯规数，来自 `runner_movement.reason = balk` 的 `related_player` |
| pickoffs | INTEGER NOT NULL | 牵制出局数，来自 `runner_movement.reason = pickoff` 的 `related_player` |
| hit_batters | INTEGER NOT NULL | 触身球数，来自对方 `plate_result.result = hit_by_pitch` 的 `related_player` |

`game_id` + `player` 唯一。

### 队员防守表现表 `game_player_fielding_stats`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 防守统计记录 id |
| game_id | INTEGER NOT NULL | 比赛 id，关联 `games.id` |
| player | TEXT NOT NULL | 队员姓名 |
| positions | TEXT | 本场防守位置，多个位置用逗号分隔 |
| putouts | INTEGER NOT NULL | 刺杀数 |
| assists | INTEGER NOT NULL | 助杀数 |
| errors | INTEGER NOT NULL | 失误数 |
| total_chances | INTEGER NOT NULL | 防守机会，`putouts + assists + errors` |
| fielding_percentage | REAL NOT NULL | 防守率，无防守机会时为 0 |
| double_plays | INTEGER NOT NULL | 参与双杀数 |
| passed_balls | INTEGER NOT NULL | 捕手漏接数 |
| outfield_assists | INTEGER NOT NULL | 外野助杀数 |

`game_id` + `player` 唯一。

### 数据缺口表 `game_analysis_data_gaps`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 数据缺口记录 id |
| game_id | INTEGER NOT NULL | 比赛 id，关联 `games.id` |
| scope | TEXT NOT NULL | 缺口范围，例如 `pitching`、`fielding`、`baserunning` |
| message | TEXT NOT NULL | 缺口说明 |

## 字段取值

### 胜负结果

| SQLite 值 | CLI 名称 | 说明 |
| --- | --- | --- |
| 0 | `win` | 我方得分大于对方得分 |
| 1 | `loss` | 我方得分小于对方得分 |
| 2 | `tie` | 双方得分相同 |
| 3 | `in_progress` | 比赛未完赛 |

### 球队

| SQLite 值 | CLI 名称 | 说明 |
| --- | --- | --- |
| 0 | `own` | 我方球队 |
| 1 | `opponent` | 对方球队 |

## 统计规则

### 我方与对方事件识别

- 根据比赛的 `batting_side` 和 `game_events.half` 判断该事件属于我方进攻还是对方进攻。
- `batting_side = top` 时，上半局为我方进攻，下半局为对方进攻。
- `batting_side = bottom` 时，下半局为我方进攻，上半局为对方进攻。
- 我方打击和跑垒表现只统计我方进攻半局事件。
- 我方投球和防守表现只统计对方进攻半局事件，以及 `game_events.team = own` 的防守归属事件。

### 打击

- 所有我方进攻半局的 `plate_result` 计入 `pa`。
- `walk`、`hit_by_pitch` 和 `sacrifice` 不计入 `at_bats`。
- `single`、`double`、`triple`、`homerun`、`strikeout`、`groundout`、`flyout`、`reached_on_error`、`fielders_choice` 计入 `at_bats`。
- `single`、`double`、`triple`、`homerun` 各计 1 安打，并分别计 1、2、3、4 总垒打。
- `runs_batted_in` 来自 `runner_movement.rbi_player`。
- MVP 简化上垒率为 `(hits + walks + hit_by_pitch + reached_on_error) / pa`。读取时标注为简化口径，不等同于 MLB 正式 OBP。
- `OPS = on_base_percentage + slugging_percentage`。

### 跑垒

- `runs` 来自 `runner_movement.result = run_scored`。
- `stolen_bases` 来自 `runner_movement.reason = stolen_base`。
- `caught_stealing` 来自 `runner_movement.reason = caught_stealing` 且 `result = out`。
- `stolen_base_percentage = stolen_bases / (stolen_bases + caught_stealing)`，无尝试时为 0。
- `extra_bases_taken` 来自 `runner_movement.reason = batted_ball` 且推进超过常规推进的事件。
- `baserunning_outs` 来自 `runner_movement.result = out`，不含 `caught_stealing`。

### 投球

- `batters_faced` 来自对方 `plate_result`，按 `related_player` 中记录的投手汇总。
- `hits_allowed` 按对方 `single`、`double`、`triple`、`homerun` 汇总到 `related_player` 投手。
- `walks_allowed` 按对方 `walk` 汇总到 `related_player` 投手。
- `hit_batters` 按对方 `hit_by_pitch` 汇总到 `related_player` 投手。
- `strikeouts` 按对方 `strikeout` 汇总到 `related_player` 投手。
- `homeruns_allowed` 按对方 `homerun` 汇总到 `related_player` 投手。
- `runs_allowed` 来自对方 `runner_movement.result = run_scored`；若能通过 `related_player` 或同 `play_no` 上下文确定责任投手，则汇总到该投手，否则生成数据缺口提示。
- `earned_runs` 根据 `runner_movement.earned` 汇总；责任失分未知时 ERA 为空。
- `outs_recorded` 由对方打者出局结果和跑者出局事件汇总到 `related_player` 投手；缺少投手关联时不估算，并生成数据缺口提示。
- `wild_pitches`、`balks`、`pickoffs` 分别来自 `runner_movement.reason = wild_pitch`、`balk`、`pickoff` 的 `related_player`。
- `WHIP = (walks_allowed + hits_allowed) / innings_pitched`。

### 防守

- `putouts`、`assists`、`errors`、`double_plays`、`passed_balls`、`outfield_assists` 必须来自 `fielding_credit`。
- `fielding_percentage = (putouts + assists) / (putouts + assists + errors)`，无防守机会时为 0。
- OAA、接球概率、臂力等需要追踪数据，不在 MVP 中计算。

### 综合表现标签

CLI 可以生成结构化标签，供 agent 做复盘摘要：

- `multi_hit`：单场安打数大于等于 2。
- `extra_base_hit`：有二垒安打、三垒安打或本垒打。
- `reached_base_multiple`：上垒次数大于等于 2。
- `high_strikeout`：三振数大于等于 2。
- `stole_base`：盗垒成功数大于 0。
- `baserunning_risk`：盗垒失败或跑垒出局数大于 0。
- `strong_control`：投手无保送且面对打者数大于等于 3。
- `walks_allowed`：投手保送数大于等于 2。
- `no_errors`：有防守机会且无失误。
- `fielding_error`：防守失误数大于 0。

## 校验规则

- `game event write` 的 `--game-id` 必须大于 0，且对应比赛必须存在。
- `events-json` 必须是合法 JSON 数组，且不能为空。
- `inning` 必须大于等于 1。
- `half` 必须为 `top` 或 `bottom`。
- `play_no` 为空或大于 0。
- `sequence` 必须大于 0；同一 `game_id` + `inning` + `half` + `play_no` 下按 `sequence ASC` 展示事件。
- `event_kind` 必须为 `plate_result`、`runner_movement`、`fielding_credit` 之一。
- `player` 不能为空，写入前裁剪首尾空白。
- `team` 必须为 `own` 或 `opponent`。
- `result` 必须匹配 `event_kind` 对应的结果枚举。
- `plate_result` 必须填写 `related_player` 作为投手姓名，且必须填写 `pitch_sequence`；未知球序时由 agent 显式填入 `unknown`。
- `runner_movement` 必须填写 `base_from`；`result != out` 时必须填写 `base_to`。
- `runner_movement.reason` 为空时视为 `other`。
- `base_from` 为空或 0-3；`base_to` 为空或 1-4。
- `outs_on_play` 和 `runs_scored` 必须大于等于 0。
- `value` 必须大于等于 0。
- 不写入投手主体事件；投手统计从 `plate_result` 和投手相关 `runner_movement` 的 `related_player` 反向汇总。
- `--player` 读取时裁剪首尾空白；为空时等同于未指定。
- 指定 `--player` 但该队员没有分析结果时返回 `game player analysis not found: <game_id> <player>`。
- 百分比和率值字段保留三位小数；内部可使用 `REAL` 存储。

## 写入行为

- `game analysis generate` 在一个事务内完成删除旧分析、计算新分析、写入所有分析表。
- 任一计算或写入失败时，本次分析不落库，旧分析结果保持不变。
- `generated_at` 由 CLI 在写入时自动填入当前时间（RFC3339）。
- 重新生成分析不会修改 `games`、`game_lineups` 或 `game_events`。
- 分析表属于派生数据，可重复生成；不作为原始比赛记录来源。

## 读取行为

- `game analysis read --game-id` 读取指定比赛的全队队员表现分析。
- `game analysis read --game-id --player` 读取指定队员表现分析。
- 若比赛存在但尚未生成分析，返回明确错误，例如 `game analysis not found: 1`。
- 队员综合表现按 `batting_order ASC NULLS LAST`、`player ASC` 排序。
- 打击表现按 `ops DESC`、`hits DESC`、`player ASC` 排序。
- 跑垒表现按 `stolen_bases DESC`、`runs DESC`、`player ASC` 排序。
- 投球表现按 `innings_pitched DESC`、`strikeouts DESC`、`player ASC` 排序。
- 防守表现按 `total_chances DESC`、`errors ASC`、`player ASC` 排序。
- 数据缺口提示在输出最后展示，避免用户误读空数据为表现为 0。

## 列表行为

- `game analysis list` 默认按 `generated_at DESC`、`game_id DESC` 展示已生成分析的比赛。
- 列表展示字段包括：game_id、日期、对手、比分、胜负结果、是否已完赛、分析队员数、生成时间。
- 无分析记录时返回空列表，不视为错误。

## 字段帮助说明

### `game event write`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--game-id` | int | 要补充比赛事件的比赛 id，必须存在 |
| `--events-json` | JSON array | 比赛事实事件数组；支持同一攻防片段下的打席结果、跑者移动和防守归属多条事实 |

### `game analysis generate`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--game-id` | int | 要生成队员表现分析的比赛 id，必须存在且有可分析事件 |

### `game analysis read`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--game-id` | int | 要读取分析结果的比赛 id |
| `--player` | string | 可选，只读取指定队员的表现分析 |

### `game analysis list`

MVP 不提供过滤参数。

## 验收测试

### CLI 测试

- 可以通过 `game event write` 为同一攻防片段写入 `plate_result`、`runner_movement`、`fielding_credit` 多条事实事件。
- 非法 `events-json`、空数组、非法 `event_kind`、非法 `result` 或不匹配的 `event_kind` / `result` 会失败并返回明确错误。
- 非空 `play_no` 小于等于 0 时写入失败。
- 可以对一场已有 `game_events` 的比赛执行 `game analysis generate --game-id` 并输出比赛 id。
- 可以通过 `game analysis read --game-id` 读回队员综合表现、打击、跑垒、投球、防守和数据缺口提示。
- 可以通过 `game analysis read --game-id --player` 只读取单个队员分析。
- 可以通过 `game analysis list` 列出所有已生成分析的比赛，按生成时间倒序展示。
- 重复执行 `game analysis generate --game-id` 会刷新旧分析结果，不产生重复统计记录。
- 不存在的 `--game-id` 会失败并返回 `game not found`。
- 没有可分析事件的比赛生成分析会失败并返回 `game has no analyzable events`。
- 未生成分析时执行 `game analysis read --game-id` 会失败并返回 `game analysis not found`。

### SQLite 测试

- `game_events` 能正确建表，支持同一攻防片段下挂多条事实事件。
- `game_analyses`、`game_player_performance_summaries`、`game_player_batting_stats`、`game_player_baserunning_stats`、`game_player_pitching_stats`、`game_player_fielding_stats`、`game_analysis_data_gaps` 能正确建表。
- 各队员表现表的 `game_id + player` 唯一，重复生成同一场比赛不会产生重复队员记录。
- 生成分析使用事务；写入任一分析子表失败时旧分析结果保持不变。
- 分析表通过外键关联 `games.id`。

### Domain 测试

- 能根据 `batting_side` 和 `half` 正确判断我方/对方进攻事件。
- 能正确计算打击 PA、AB、H、1B、2B、3B、HR、BB、HBP、K、RBI、TB、AVG、简化 OBP、SLG、OPS。
- `walk`、`hit_by_pitch`、`sacrifice` 的 PA/AB 处理符合统计规则。
- 能正确计算跑垒 R、SB、CS、SB%、额外推进和跑垒出局。
- 能从对方 `plate_result.related_player` 和投手相关 `runner_movement.related_player` 反向汇总投手 BF、H、BB、K、HR、R、ER、IP、RA9、ERA、WHIP、K/BB。
- 缺少责任失分数据时 ERA 为空，并生成数据缺口提示。
- 能正确计算防守 PO、A、E、TC、FPCT、DP、PB、OFA。
- 缺少跑垒或防守结构化事件时，对应 available 字段为 false，并生成数据缺口提示。
- 能根据统计结果生成综合表现标签。
