# 队员跨比赛表现分析需求

> 范围:Bastion CLI

## 目的

在多场比赛记录和单场分析已落库的前提下,按队员和时间跨度维度聚合队员表现,即时计算跨场比赛的表现摘要,供教练和队员做阶段性复盘、训练周期评估和长期成长追踪。

本功能的目标版本为队员跨期分析 MVP:CLI 负责读取已生成的单场队员表现统计(`game_player_*_stats`)、按时间跨度即时聚合并返回结果;agent 负责根据聚合指标做自然语言解读、趋势总结和下一阶段训练建议。CLI 不负责自然语言理解,也不直接接入 LLM。

跨期分析为只读计算,不落库,不保留历史快照。同一跨度可重复计算,每次调用都基于当前已生成的单场分析即时聚合。

```sh
bastion person analysis read --name "张三" --from 2026-04-01 --to 2026-06-30
```

## 与单场分析的关系

- `game analysis` 产出单场队员表现,数据源是 `game_events`,产物写入 `game_player_*_stats`。
- `person analysis` 产出跨期队员表现,数据源是 `game_player_*_stats` 和 `game_analyses`,产物即时返回,不落库。
- `person analysis` 不重新读取 `game_events`,也不重复计算单场指标;只做跨场聚合。
- 一场比赛必须先执行 `game analysis generate` 才能被 `person analysis` 纳入聚合;未生成单场分析的比赛计入数据缺口,不参与聚合。

## 参考口径

跨期聚合沿用单场分析的口径,以下补充跨期专用口径:

- 跨期打击率定义为 `sum(hits) / sum(at_bats)`,即按累计打数和累计安打重新计算,而不是单场 AVG 的算术平均。参考:https://www.mlb.com/glossary/standard-stats/batting-average
- 跨期上垒率、长打率、OPS 同理,按累计分量重新计算,不复用单场率值。
- 跨期 ERA 定义为 `9 * sum(earned_runs) / sum(innings_pitched)`,要求单场 ERA 数据可用;任一比赛责任失分缺失时,跨期 ERA 为空,并生成数据缺口提示。参考:https://www.mlb.com/glossary/standard-stats/earned-run-average
- 跨期 WHIP 定义为 `(sum(walks_allowed) + sum(hits_allowed)) / sum(innings_pitched)`。参考:https://www.mlb.com/glossary/standard-stats/walks-and-hits-per-inning-pitched
- 跨期盗垒成功率定义为 `sum(stolen_bases) / (sum(stolen_bases) + sum(caught_stealing))`。参考:https://www.mlb.com/glossary/standard-stats/stolen-base-percentage
- 跨期防守率定义为 `(sum(putouts) + sum(assists)) / (sum(putouts) + sum(assists) + sum(errors))`。参考:https://www.mlb.com/glossary/standard-stats/fielding-percentage
- MLB 高阶指标(wRC+、xwOBA、Sprint Speed、OAA 等)依赖追踪数据或更细粒度的逐球数据,MVP 不计算。

## 技术栈

- Go CLI(Kong)
- SQLite

## 使用场景

1. 教练或队员指定一段时间跨度,调用 `person analysis read` 即时返回该队员的跨期聚合结果。
2. agent 读取结构化聚合结果,生成自然语言阶段性复盘,例如"近两个月打击上垒稳定但长打产出下降""投球局数足够但控球波动放大""守备机会集中在三垒,失误率较上一周期上升"。
3. 教练可以多次调用同一跨度或不同跨度,做趋势对比和下一周期训练重点判断;CLI 不保留历史快照,每次调用都基于当前已生成的单场分析重新聚合。
4. 跨期内若新增比赛并执行 `game analysis generate`,下次 `person analysis read` 自动纳入新比赛,无需额外刷新步骤。

## 核心建模原则

跨期分析只做"聚合",不做"重算",也不做"持久化"。

- 单场分析已经把 `game_events` 派生为 `game_player_*_stats`,跨期分析直接以这些表为源,按 `game_id` 关联到 `games.date` 做时间跨度过滤。
- 跨期率值(AVG、OBP、SLG、OPS、ERA、WHIP、SB%、FPCT)按累计分量重新计算,不复用单场率值做算术平均。
- 跨期计数 stats(PA、AB、H、HR、RBI、IP、K、SB、PO、A、E 等)按 SUM 聚合。
- 跨期标签(highlight/risk)基于累计指标重新判定,不复用单场标签做投票或求和。
- 跨期分析不写入任何表,不保留历史快照;调用即计算,返回即丢弃。

## 命令设计

### 读取跨期队员表现分析

```sh
bastion person analysis read --name "张三" --from 2026-04-01 --to 2026-06-30
```

CLI 即时从 `game_player_*_stats` 聚合跨期数据,返回结果,不落库。

输出内容按以下分组展示:

- 跨期信息摘要(队员、跨度、覆盖比赛数、已分析比赛数、计算时间)
- 跨期综合表现(位置、出场比赛数、亮点标签、风险标签)
- 跨期打击表现
- 跨期跑垒表现
- 跨期投球表现
- 跨期防守表现
- 数据缺口提示

### 列出已登记队员

跨期分析不持久化记录,因此不提供 `person analysis list` 命令。需要浏览队员清单时使用已有 `player list`(若存在)或直接读取 `players` 表。

## 数据边界

- 跨期统计只基于已生成的单场队员表现统计(`game_player_*_stats`),不从 `game_events` 重新计算,也不从 `games.raw` 推断。
- 时间跨度按 `games.date` 过滤,`--from` 和 `--to` 均为闭区间。
- 跨期内若有比赛尚未执行 `game analysis generate`,这些比赛计入数据缺口,不参与聚合;CLI 不自动触发单场分析生成。
- 跨期内若有比赛已生成单场分析但该队员无任何统计(打击/跑垒/投球/防守四类全无),该比赛计入"出场但无数据"提示,不参与聚合。
- MVP 优先产出单队员跨期分析,不做全队跨期横向对比。
- MVP 不做趋势曲线、滚动窗口、对手分段等高级视角;趋势对比由 agent 读取多次跨期分析结果后生成。
- MVP 不支持持久化跨期分析;调用即计算,返回即丢弃。
- CLI 只输出结构化聚合结果。复盘文字、训练建议和表现解读由 agent 在读取结果后生成。

## 源数据设计

跨期分析只读取以下已有表,不新建源表,也不新建派生表:

- `players`:用于校验队员已登记。
- `games`:用于按 `date` 过滤跨度和读取对手、比分等元信息。
- `game_analyses`:用于判断比赛是否已生成单场分析。
- `game_player_performance_summaries`:用于读取单场亮点、风险标签和位置。
- `game_player_batting_stats`:打击计数和率值。
- `game_player_baserunning_stats`:跑垒计数和率值。
- `game_player_pitching_stats`:投球计数和率值。
- `game_player_fielding_stats`:防守计数和率值。
- `game_analysis_data_gaps`:用于跨期数据缺口汇总。

跨期分析不读取 `game_events`、`game_lineups` 或 `games.raw`。

## 输出结构设计

跨期分析返回以下结构化结果,不落库,仅由 CLI 展示或由 agent 读取。

### 跨期信息摘要

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| name | TEXT | 队员姓名 |
| span_from | TEXT | 跨度起始日期,`YYYY-MM-DD`,闭区间 |
| span_to | TEXT | 跨度结束日期,`YYYY-MM-DD`,闭区间 |
| games_in_span | INTEGER | 跨度内我方已记录的已完赛比赛总数,基于 `games.date` |
| games_analyzed | INTEGER | 跨度内已生成单场分析且该队员有任一类统计的比赛数 |
| own_wins | INTEGER | 跨度内我方获胜场次 |
| own_losses | INTEGER | 跨度内我方落败场次 |
| own_ties | INTEGER | 跨度内我方平局场次 |
| computed_at | TEXT | 计算时间,格式 RFC3339 |

### 跨期综合表现

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| positions | TEXT | 跨期内出现过的守备位置,多个位置用逗号分隔,按出现频次降序 |
| games_batting | INTEGER | 跨期内有打击数据的比赛数 |
| games_baserunning | INTEGER | 跨期内有跑垒数据的比赛数 |
| games_pitching | INTEGER | 跨期内有投球数据的比赛数 |
| games_fielding | INTEGER | 跨期内有防守数据的比赛数 |
| batting_available | BOOLEAN | 跨期内是否有任何打击数据 |
| baserunning_available | BOOLEAN | 跨期内是否有任何跑垒数据 |
| pitching_available | BOOLEAN | 跨期内是否有任何投球数据 |
| fielding_available | BOOLEAN | 跨期内是否有任何防守数据 |
| highlight | TEXT | 跨期亮点标签,多个标签用逗号分隔,例如 `consistent_hitter,power_hitter,no_errors_span` |
| risk | TEXT | 跨期风险标签,多个标签用逗号分隔,例如 `high_strikeout_span,walks_prone,fielding_error_span` |

### 跨期打击表现

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| games | INTEGER | 有打击数据的比赛数 |
| pa | INTEGER | 跨期累计打席数 |
| at_bats | INTEGER | 跨期累计打数 |
| hits | INTEGER | 跨期累计安打数 |
| singles | INTEGER | 跨期累计一垒安打数 |
| doubles | INTEGER | 跨期累计二垒安打数 |
| triples | INTEGER | 跨期累计三垒安打数 |
| homeruns | INTEGER | 跨期累计本垒打数 |
| walks | INTEGER | 跨期累计四坏球数 |
| hit_by_pitch | INTEGER | 跨期累计触身球数 |
| strikeouts | INTEGER | 跨期累计三振数 |
| reached_on_error | INTEGER | 跨期累计因失误上垒次数 |
| runs_batted_in | INTEGER | 跨期累计打点 |
| total_bases | INTEGER | 跨期累计总垒打数 |
| batting_average | REAL | 跨期打击率,`sum(hits) / sum(at_bats)`,无打数时为 0 |
| on_base_percentage | REAL | 跨期简化上垒率,见统计规则 |
| slugging_percentage | REAL | 跨期长打率,`sum(total_bases) / sum(at_bats)`,无打数时为 0 |
| ops | REAL | `on_base_percentage + slugging_percentage` |

### 跨期跑垒表现

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| games | INTEGER | 有跑垒数据的比赛数 |
| runs | INTEGER | 跨期累计得分数 |
| stolen_bases | INTEGER | 跨期累计盗垒成功数 |
| caught_stealing | INTEGER | 跨期累计盗垒失败数 |
| stolen_base_attempts | INTEGER | 跨期累计盗垒尝试数 |
| stolen_base_percentage | REAL | 跨期盗垒成功率,无尝试时为 0 |
| extra_bases_taken | INTEGER | 跨期累计额外推进次数 |
| baserunning_outs | INTEGER | 跨期累计跑垒出局数,不含盗垒失败 |

### 跨期投球表现

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| games | INTEGER | 有投球数据的比赛数 |
| outs_recorded | INTEGER | 跨期累计取得出局数 |
| innings_pitched | REAL | 跨期累计投球局数,`sum(outs_recorded) / 3` |
| batters_faced | INTEGER | 跨期累计面对打者数 |
| hits_allowed | INTEGER | 跨期累计被安打数 |
| walks_allowed | INTEGER | 跨期累计四坏球数 |
| strikeouts | INTEGER | 跨期累计三振数 |
| homeruns_allowed | INTEGER | 跨期累计被本垒打数 |
| runs_allowed | INTEGER | 跨期累计失分数 |
| earned_runs | INTEGER | 跨期累计责任失分数;无责任失分数据时为 0 |
| ra9 | REAL | 跨期每 9 局失分,`9 * sum(runs_allowed) / sum(innings_pitched)`,无局数时为 0 |
| era | REAL | 跨期 ERA,`9 * sum(earned_runs) / sum(innings_pitched)`;任一比赛责任失分数据缺失时为空 |
| whip | REAL | 跨期 WHIP,`(sum(walks_allowed) + sum(hits_allowed)) / sum(innings_pitched)`,无局数时为 0 |
| strikeout_walk_ratio | REAL | `sum(strikeouts) / sum(walks_allowed)`;无保送时为空 |
| wild_pitches | INTEGER | 跨期累计暴投数 |
| balks | INTEGER | 跨期累计投手犯规数 |
| pickoffs | INTEGER | 跨期累计牵制出局数 |
| hit_batters | INTEGER | 跨期累计触身球数 |

### 跨期防守表现

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| games | INTEGER | 有防守数据的比赛数 |
| positions | TEXT | 跨期内出现过的防守位置,多个位置用逗号分隔 |
| putouts | INTEGER | 跨期累计刺杀数 |
| assists | INTEGER | 跨期累计助杀数 |
| errors | INTEGER | 跨期累计失误数 |
| total_chances | INTEGER | 跨期累计防守机会 |
| fielding_percentage | REAL | 跨期防守率,无防守机会时为 0 |
| double_plays | INTEGER | 跨期累计参与双杀数 |
| passed_balls | INTEGER | 跨期累计捕手漏接数 |
| outfield_assists | INTEGER | 跨期累计外野助杀数 |

### 跨期数据缺口

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| scope | TEXT | 缺口范围,例如 `missing_game_analysis`、`pitching`、`fielding`、`baserunning` |
| message | TEXT | 缺口说明,例如 `game 3 in span has no game analysis` |

## 字段取值

### 跨期综合表现标签

跨期亮点和风险标签由 CLI 基于累计指标即时判定,供 agent 做阶段性复盘:

#### 亮点标签

| 标签 | 判定规则 |
| --- | --- |
| `consistent_hitter` | 跨期 `at_bats >= 20` 且 `batting_average >= 0.300` |
| `on_base_machine` | 跨期 `pa >= 20` 且简化上垒率 `>= 0.400` |
| `power_hitter` | 跨期 `homeruns >= 2` 或 `slugging_percentage >= 0.450` 且 `at_bats >= 15` |
| `rbi_producer` | 跨期 `runs_batted_in >= 10` |
| `efficient_baserunner` | 跨期 `stolen_base_attempts >= 5` 且 `stolen_base_percentage >= 0.800` |
| `strong_control_span` | 跨期 `batters_faced >= 20` 且 `walks_allowed == 0` |
| `strikeout_artist` | 跨期 `batters_faced >= 20` 且 `strikeouts / batters_faced >= 0.400` |
| `no_errors_span` | 跨期 `total_chances >= 10` 且 `errors == 0` |
| `fielding_reliable` | 跨期 `total_chances >= 15` 且 `fielding_percentage >= 0.970` |

#### 风险标签

| 标签 | 判定规则 |
| --- | --- |
| `high_strikeout_span` | 跨期 `pa >= 20` 且 `strikeouts / pa >= 0.300` |
| `walks_prone` | 跨期 `batters_faced >= 20` 且 `walks_allowed / batters_faced >= 0.200` |
| `homeruns_prone` | 跨期 `batters_faced >= 20` 且 `homeruns_allowed >= 3` |
| `baserunning_risk_span` | 跨期 `stolen_base_attempts >= 5` 且 `stolen_base_percentage < 0.600` |
| `fielding_error_span` | 跨期 `total_chances >= 10` 且 `errors / total_chances >= 0.150` |
| `passed_ball_prone` | 跨期捕手漏接 `passed_balls >= 3` |

### 数据缺口范围

| scope | 说明 |
| --- | --- |
| `missing_game_analysis` | 跨度内存在比赛但未生成单场分析 |
| `pitching` | 投球相关数据缺口,例如责任失分缺失导致 ERA 不可用 |
| `fielding` | 防守相关数据缺口,例如位置信息缺失 |
| `baserunning` | 跑垒相关数据缺口,例如缺少跑者移动事件 |
| `batting` | 打击相关数据缺口,例如缺少球序或投手关联 |

## 统计规则

### 时间跨度过滤

- 跨度按 `games.date` 过滤,`--from` 和 `--to` 均为闭区间,即 `games.date BETWEEN span_from AND span_to`。
- 跨度内只统计 `games.is_final = true` 的已完赛比赛;未完赛比赛计入 `missing_game_analysis` 数据缺口,不参与聚合。
- 跨度内只统计已生成单场分析的比赛,即 `game_analyses.game_id` 存在的比赛;未生成单场分析的比赛计入 `missing_game_analysis` 数据缺口。
- 跨度内只统计我方队员(`games.id` 关联的 `game_player_*_stats` 中该队员的记录);对方队员表现不在跨期分析范围内。

### 聚合规则

- 计数字段(PA、AB、H、1B、2B、3B、HR、BB、HBP、K、ROE、RBI、TB、R、SB、CS、额外推进、跑垒出局、IP 的 outs、BF、H 允许、BB 允许、K、HR 允许、R、ER、WP、BK、PK、HB、PO、A、E、DP、PB、OFA)按 `SUM` 聚合。
- 率值字段(AVG、OBP、SLG、OPS、RA9、ERA、WHIP、K/BB、SB%、FPCT)按累计分量重新计算,不复用单场率值。
- `innings_pitched = sum(outs_recorded) / 3`,保留三位小数。
- `batting_average = sum(hits) / sum(at_bats)`,无打数时为 0。
- 跨期简化上垒率 = `(sum(hits) + sum(walks) + sum(hit_by_pitch) + sum(reached_on_error)) / sum(pa)`,无打席时为 0。
- `slugging_percentage = sum(total_bases) / sum(at_bats)`,无打数时为 0。
- `ops = on_base_percentage + slugging_percentage`。
- `stolen_base_percentage = sum(stolen_bases) / sum(stolen_base_attempts)`,无尝试时为 0。
- `ra9 = 9 * sum(runs_allowed) / sum(innings_pitched)`,无局数时为 0。
- `era = 9 * sum(earned_runs) / sum(innings_pitched)`;若跨期内任一投球比赛的责任失分数据不可用(单场 `era IS NULL`),跨期 ERA 为空,并生成 `pitching` 数据缺口。
- `whip = (sum(walks_allowed) + sum(hits_allowed)) / sum(innings_pitched)`,无局数时为 0。
- `strikeout_walk_ratio = sum(strikeouts) / sum(walks_allowed)`,无保送时为空。
- `fielding_percentage = (sum(putouts) + sum(assists)) / sum(total_chances)`,无防守机会时为 0。
- `total_chances = sum(putouts) + sum(assists) + sum(errors)`。

### 位置汇总

- 跨期 `positions` 来自单场 `game_player_performance_summaries.positions` 和 `game_player_fielding_stats.positions` 的并集,按出现频次降序排列,频次相同按位置名称字母序。
- 单场位置为空时不参与跨期位置汇总,并视情况生成 `fielding` 数据缺口。

### 出场数与覆盖比赛数

- `games_in_span` 来自 `games` 表中 `date BETWEEN span_from AND span_to` 且 `is_final = true` 的比赛数。
- `games_analyzed` 来自跨期内已生成单场分析且该队员有任一类统计(`batting_available OR baserunning_available OR pitching_available OR fielding_available`)的比赛数。
- `games_batting`、`games_baserunning`、`games_pitching`、`games_fielding` 分别为跨期内该队员有对应类别统计的比赛数。
- `own_wins`、`own_losses`、`own_ties` 来自跨期内已完赛比赛的胜负结果汇总。

### 综合表现标签

- 跨期标签基于累计指标即时判定,不复用单场 `highlight` / `risk` 标签。
- 跨期标签的判定阈值见"字段取值"小节。
- 阈值未达到触发条件时不生成对应标签;`highlight` 或 `risk` 为空时输出为空。

## 校验规则

- `--name` 不能为空,写入前裁剪首尾空白。
- `--name` 必须为已登记队员,即在 `players` 表中存在;不存在时返回 `player not found: <name>`。
- `--from` 和 `--to` 必须为 `YYYY-MM-DD` 格式,且 `--from <= --to`。
- `--from` 和 `--to` 均为必填,不支持半开区间或默认跨度。
- `person analysis read` 要求跨期内至少有一场已完赛且已生成单场分析的比赛;否则返回 `no analyzable games in span`。
- `person analysis read` 要求该队员在跨期内至少有一类统计(打击、跑垒、投球、防守任一);否则返回 `no player stats in span: <name>`。
- 百分比和率值字段保留三位小数;内部计算可使用 `REAL` 中间值。
- 跨期分析不写入数据库,不涉及外键或事务;计算在内存中完成,返回结果后丢弃。

## 读取行为

- `person analysis read --name --from --to` 即时聚合并返回结果,不落库。
- 若队员存在但该跨度内无可分析比赛,返回明确错误,例如 `no analyzable games in span`。
- 若队员在跨期内无任何统计,返回 `no player stats in span: <name>`。
- 输出按跨期信息摘要、综合表现、打击、跑垒、投球、防守、数据缺口提示分组展示。
- 数据缺口提示在输出最后展示,避免用户误读空数据为表现为 0。
- 率值字段展示时保留三位小数;`era` 和 `strikeout_walk_ratio` 等可空字段为空时展示 `n/a`。
- 同一跨度可多次调用,每次调用都基于当前已生成的单场分析重新聚合;跨期内新增比赛并执行 `game analysis generate` 后,下次调用自动纳入新比赛。

## 字段帮助说明

### `person analysis read`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--name` | string | 队员姓名,不能为空,必须为已登记队员 |
| `--from` | string | 跨度起始日期,格式 `YYYY-MM-DD`,闭区间 |
| `--to` | string | 跨度结束日期,格式 `YYYY-MM-DD`,闭区间,必须大于等于 `--from` |

## 验收测试

### CLI 测试

- 可以通过 `person analysis read --name --from --to` 为已登记队员返回跨期聚合结果。
- `--name` 对应队员不存在于 `players` 表时返回 `player not found`。
- `--from` 或 `--to` 非法日期、`--from > --to` 会失败并返回明确错误。
- 跨度内没有已完赛比赛时返回 `no analyzable games in span`。
- 跨度内有已完赛比赛但全部未生成单场分析时返回 `no analyzable games in span`。
- 跨度内有已生成单场分析的比赛但该队员无任何统计时返回 `no player stats in span`。
- 同一跨度多次调用 `person analysis read` 返回一致结果,不产生副作用,不创建任何表或记录。
- 跨期内新增比赛并执行 `game analysis generate` 后,再次调用 `person analysis read` 会自动纳入新比赛。
- 跨期内存在未生成单场分析的比赛时,输出包含 `missing_game_analysis` 数据缺口提示。
- 跨期内存在未完赛比赛时,输出包含 `missing_game_analysis` 数据缺口提示,且该比赛不参与聚合。

### SQLite 测试

- 跨期分析不新建任何派生表,不修改 `schema.go`,不写入任何 `person_*` 表。
- 跨期分析只读取 `games`、`game_analyses`、`game_player_*_stats`、`game_player_performance_summaries`、`game_analysis_data_gaps`、`players` 表。
- 多次调用同一跨度不产生数据库写入,表行数不变。

### Domain 测试

- 能按 `games.date` 正确过滤跨期内的已完赛比赛。
- 能正确识别跨期内已生成单场分析的比赛,并对未生成单场分析的比赛生成 `missing_game_analysis` 数据缺口。
- 能正确 SUM 聚合打击 PA、AB、H、1B、2B、3B、HR、BB、HBP、K、ROE、RBI、TB。
- 能按累计分量重新计算跨期 AVG、简化 OBP、SLG、OPS,且与单场率值算术平均不同。
- 能正确 SUM 聚合跑垒 R、SB、CS、额外推进、跑垒出局,并按累计分量重新计算 SB%。
- 能正确 SUM 聚合投球 BF、H 允许、BB 允许、K、HR 允许、R、ER、WP、BK、PK、HB、outs,并按累计分量重新计算 IP、RA9、ERA、WHIP、K/BB。
- 跨期内任一投球比赛责任失分数据缺失时,跨期 ERA 为空,并生成 `pitching` 数据缺口。
- 能正确 SUM 聚合防守 PO、A、E、DP、PB、OFA,并按累计分量重新计算 FPCT。
- 能正确汇总跨期 `positions`,按出现频次降序排列。
- 能正确统计 `games_in_span`、`games_analyzed`、`games_batting`、`games_baserunning`、`games_pitching`、`games_fielding`、`own_wins`、`own_losses`、`own_ties`。
- 能根据累计指标生成跨期亮点和风险标签,且阈值判定正确。
- 跨期标签不复用单场标签;即使单场标签为空,跨期标签仍可基于累计指标生成。
- 计算结果只在内存中返回,不持久化;调用结束即丢弃。
