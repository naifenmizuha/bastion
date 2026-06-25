# PRD: 按队员和时间跨度分析队员表现

## 背景

当前 Bastion 已支持记录比赛、生成单场队员表现分析，并通过 `game analysis read <game-id> [--player <name>]` 查看某一场比赛内的队员表现。教练或队员在复盘时还需要跨多场比赛查看某名队员或全队在一段时间内的表现趋势，用于发现稳定优势、近期风险和训练重点。

## 目的

支持按队员和时间跨度查询队员比赛表现，让用户可以回答以下问题：

- 某名队员在最近一周、一个月或指定日期范围内的打击、跑垒、投球、守备累计表现如何。
- 某名队员在这个时间段内参与了哪些比赛，哪些比赛存在数据缺口。
- 不指定队员时，能按同一时间跨度对全队队员表现进行横向对比。

## 范围

本需求聚焦已生成的比赛分析数据，不负责从自然语言比赛描述中补齐结构化事件，也不新增训练报告分析。统计口径以 `game_analyses` 及其关联的 `game_player_*_stats`、`game_player_performance_summaries`、`game_analysis_data_gaps` 为准。

## 用户故事

- 作为教练，我希望输入队员姓名和日期范围，查看该队员在这段时间内的综合表现，便于安排下一阶段训练。
- 作为队员，我希望查看自己最近一段时间的亮点和风险，明确需要改进的能力项。
- 作为队长，我希望不指定队员时看到全队排行，快速了解谁在某项能力上表现突出或需要关注。

## 命令设计

新增命令：

```bash
bastion game analysis player --from 2026-06-01 --to 2026-06-30 --player "张三"
```

参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--from` | 是 | 起始日期，格式 `YYYY-MM-DD`，包含当天 |
| `--to` | 是 | 结束日期，格式 `YYYY-MM-DD`，包含当天 |
| `--player` | 否 | 队员姓名；为空时返回时间范围内所有队员汇总 |

行为：

- 仅统计日期落在 `--from` 和 `--to` 闭区间内，且已经执行过 `game analysis generate <game-id>` 的比赛。
- 指定 `--player` 时，只输出该队员的汇总表现、逐场明细和相关数据缺口。
- 未指定 `--player` 时，输出所有有分析记录的队员汇总，默认按 `ops DESC, hits DESC, player ASC` 排序；无打击数据的队员排在有打击数据之后，并继续展示其投球、跑垒、守备数据。
- 如果日期范围内存在比赛但没有生成分析，不纳入统计，并在 `data_gaps` 中提示对应 `game_id`。
- 如果日期范围内没有可统计数据，返回空 TOML，不视为错误。

## 输出设计

输出格式保持现有 CLI 风格，使用 TOML。

### 指定队员

```toml
[period]
from = "2026-06-01"
to = "2026-06-30"
player = "张三"
games_analyzed = 3

[summary]
plate_appearances = 12
hits = 5
doubles = 1
triples = 0
homeruns = 1
walks = 2
strikeouts = 3
runs_batted_in = 4
batting_average = 0.500
on_base_percentage = 0.583
slugging_percentage = 0.900
ops = 1.483
runs = 3
stolen_bases = 1
baserunning_outs = 0
innings_pitched = 2.0
runs_allowed = 1
earned_runs = 1
era = 4.50
whip = 1.00
putouts = 4
assists = 2
errors = 1
fielding_percentage = 0.857

[[games]]
game_id = 1
date = "2026-06-03"
opponent = "北区队"
highlight = "high_ops"
risk = ""

[[data_gaps]]
game_id = 2
scope = "fielding"
message = "no structured fielding credit events recorded"
```

### 全队汇总

```toml
[period]
from = "2026-06-01"
to = "2026-06-30"
games_analyzed = 3

[[players]]
player = "张三"
games = 3
plate_appearances = 12
hits = 5
ops = 1.483
innings_pitched = 2.0
fielding_percentage = 0.857
highlight = "high_ops"
risk = ""

[[players]]
player = "李四"
games = 2
plate_appearances = 8
hits = 2
ops = 0.625
innings_pitched = 0.0
fielding_percentage = 1.000
highlight = ""
risk = "low_on_base"
```

## 数据与统计口径

- 打击累计项：`PA`、`AtBats`、`Hits`、`Singles`、`Doubles`、`Triples`、`Homeruns`、`Walks`、`HitByPitch`、`Strikeouts`、`ReachedOnError`、`RunsBattedIn`、`TotalBases`。
- 打击比例项重新计算：`AVG = Hits / AtBats`；`OBP = (Hits + Walks + HitByPitch) / PA`；`SLG = TotalBases / AtBats`；`OPS = OBP + SLG`。分母为 0 时输出 0。
- 跑垒累计项：`Runs`、`StolenBases`、`CaughtStealing`、`StolenBaseAttempts`、`ExtraBasesTaken`、`BaserunningOuts`；盗垒成功率按累计值重新计算。
- 投球累计项：`OutsRecorded`、`BattersFaced`、`HitsAllowed`、`WalksAllowed`、`Strikeouts`、`HomerunsAllowed`、`RunsAllowed`、`EarnedRuns`、`WildPitches`、`Balks`、`Pickoffs`、`HitBatters`；`InningsPitched`、`RA9`、`ERA`、`WHIP`、`StrikeoutWalkRatio` 按累计值重新计算。若缺少自责分统计口径，`ERA` 输出为空。
- 守备累计项：`Putouts`、`Assists`、`Errors`、`TotalChances`、`DoublePlays`、`PassedBalls`、`OutfieldAssists`；守备率按累计值重新计算。
- `highlight` 与 `risk` 从逐场 summary 聚合，去重后以逗号拼接；若没有标签则为空字符串。

## 校验规则

- `--from` 和 `--to` 必须符合 `YYYY-MM-DD`，复用现有日期标准化逻辑。
- `--from` 不得晚于 `--to`。
- `--player` 仅做首尾空白清理，不强制要求先存在于 `players` 表，因为历史比赛事件可能包含未登记队员；但若指定队员在范围内无数据，输出空 TOML。
- 查询只读，不修改数据库。

## 验收标准

- 给定已生成分析的多场比赛，指定队员和日期范围后，CLI 能输出该队员跨比赛累计指标、重新计算后的比例指标、逐场明细和数据缺口。
- 不指定队员时，CLI 能输出同一日期范围内所有队员的汇总列表，并按默认排序稳定输出。
- 日期范围过滤必须以 `games.date` 为准，边界日期包含在内。
- 日期非法或 `--from` 晚于 `--to` 时返回明确错误。
- 日期范围内无可统计分析数据时，命令成功且输出为空。
- 新增功能需要覆盖服务层统计口径、SQLite 查询过滤、CLI 输出三类测试。
