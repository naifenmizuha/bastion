# CLI 帮助信息补全需求

> 范围:Bastion CLI

## 背景

当前执行 `bastion -h` 时，命令摘要只展示参数类型，例如：

```text
player add --name=STRING --number=INT --bat=STRING --throw=STRING --positions=STRING
game event add --game-id=INT-64 --inning=INT --half=STRING --batter=STRING --event-type=STRING ...
```

这会让用户不知道 `STRING` 应该填写什么。比如 `--bat`、`--throw`、`--positions`、`--batting-side`、`--half`、`--event-type` 都有固定取值；`--date`、`--start-time`、`--base-state` 也有格式要求，但顶层帮助里没有提示。

## 目标

让 CLI 帮助信息在用户不查 PRD 或源码的情况下，也能知道关键参数的格式、可选值和最小示例。

本需求只改进帮助文本和参数展示，不改变现有数据库结构、命令名称、参数名称、字段校验规则和读写行为。

## 使用场景

1. 用户首次运行 `bastion -h`，能从命令列表看出哪些命令可以用。
2. 用户运行 `bastion player add -h`，能知道 `--bat`、`--throw`、`--positions` 的合法值。
3. 用户运行 `bastion game event add -h`，能知道半局、事件类型、出局数和垒位状态应该如何填写。
4. agent 调用 CLI 前，可以通过帮助信息快速确认字段格式，减少传错枚举值。

## 设计原则

- 顶层帮助 `bastion -h` 保持简洁，负责展示命令入口。
- 子命令帮助 `bastion <command> -h` 展示完整字段说明、枚举取值和示例。
- 对所有非自由文本的 `STRING` 参数必须提供 `enum` 或 `help` 提示。
- 对所有有固定格式的字符串参数必须提供格式提示，例如日期、时间、JSON。
- 对数值参数必须说明范围或语义，例如比分、出局数、垒位 bitflag。
- 帮助文本使用 CLI 实际接受的英文枚举值，中文只放在说明里。

## 需要补全的字段

### 通用参数

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--db` | path | SQLite 数据库路径，默认 `bastion.db` |
| `--date` | string | 日期，格式 `YYYY-MM-DD` |
| `--start-time` | string | 开赛时间，格式 `HH:MM`，未知时可省略 |

### 队员命令

#### `player add`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--name` | string | 队员姓名，不能为空 |
| `--number` | int | 背号，必须大于等于 0 |
| `--bat` | enum list | 打击手，可填 `left`、`right`，多选用逗号分隔，例如 `left,right` |
| `--throw` | enum list | 投球手，可填 `left`、`right`，多选用逗号分隔，例如 `right` |
| `--positions` | enum list | 守备位置，可填 `pitcher`、`catcher`、`infield`、`outfield`，多选用逗号分隔 |

#### `player read`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--name` | string | 要读取的队员姓名 |

### 自训登记命令

#### `report write`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--name` | string | 队员姓名，不能为空 |
| `--date` | string | 自训日期，格式 `YYYY-MM-DD` |
| `--content` | string | 自训内容，不能为空 |
| `--reflection` | string | 自训感想，不能为空 |

#### `report read`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--name` | string | 队员姓名 |
| `--date` | string | 自训日期，格式 `YYYY-MM-DD` |

### 比赛命令

#### `game write`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--date` | string | 比赛日期，格式 `YYYY-MM-DD` |
| `--start-time` | string | 开赛时间，格式 `HH:MM`，未知时可省略 |
| `--opponent` | string | 对手名称，不能为空 |
| `--batting-side` | enum | 我方先攻/后攻，可填 `top` 或 `bottom` |
| `--own-score` | int | 我方最终得分，必须大于等于 0 |
| `--opponent-score` | int | 对方最终得分，必须大于等于 0 |
| `--raw` | string | 原始比赛描述，不能为空 |
| `--lineup-json` | JSON | 出场名单 JSON 数组，默认 `[]` |
| `--events-json` | JSON | 逐打席事件 JSON 数组，默认 `[]` |

`lineup-json` 中的枚举字段：

| 字段 | 可选值 |
| --- | --- |
| `team` | `own`、`opponent` |
| `starting_position` | `P`、`C`、`1B`、`2B`、`3B`、`SS`、`LF`、`CF`、`RF` |

`events-json` 中的枚举字段：

| 字段 | 可选值 |
| --- | --- |
| `half` | `top`、`bottom` |
| `event_type` | `other`、`single`、`double`、`triple`、`homerun`、`walk`、`strikeout`、`groundout`、`flyout`、`error`、`steal` |

#### `game create`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--date` | string | 比赛日期，格式 `YYYY-MM-DD` |
| `--start-time` | string | 开赛时间，格式 `HH:MM`，未知时可省略 |
| `--opponent` | string | 对手名称，不能为空 |
| `--batting-side` | enum | 我方先攻/后攻，可填 `top` 或 `bottom` |
| `--raw` | string | 原始比赛描述，不能为空 |

#### `game lineup add`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--game-id` | int64 | 比赛 id，必须大于 0 |
| `--team` | enum | 球队，可填 `own` 或 `opponent` |
| `--player` | string | 球员姓名，不能为空 |
| `--batting-order` | int | 棒次，1-9，替补或未知时可省略 |
| `--starting-position` | enum | 先发位置，可填 `P`、`C`、`1B`、`2B`、`3B`、`SS`、`LF`、`CF`、`RF`，非先发或未知时可省略 |

#### `game event add`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--game-id` | int64 | 比赛 id，必须大于 0 |
| `--inning` | int | 局数，从 1 开始 |
| `--half` | enum | 半局，可填 `top` 或 `bottom` |
| `--batter` | string | 打者姓名，不能为空 |
| `--pitcher` | string | 投手姓名，未知时可省略 |
| `--event-type` | enum | 事件类型，见下方事件类型表 |
| `--pitch-sequence` | string | 球序，例如 `B,S,F,X`，未知时可省略 |
| `--outs` | int | 事件发生后出局数，只能是 0、1、2 |
| `--base-state` | int | 事件发生前垒位状态，0-7；`0` 无人在垒，`1` 一垒，`2` 二垒，`4` 三垒，可相加组合 |
| `--runs-scored` | int | 本事件产生的得分数，默认 0，必须大于等于 0 |
| `--description` | string | 事件描述，不能为空 |

事件类型可选值：

| 值 | 说明 |
| --- | --- |
| `other` | 其他事件 |
| `single` | 一垒安打 |
| `double` | 二垒安打 |
| `triple` | 三垒安打 |
| `homerun` | 本垒打 |
| `walk` | 四坏球保送 |
| `strikeout` | 三振 |
| `groundout` | 滚地出局 |
| `flyout` | 飞球出局 |
| `error` | 失误 |
| `steal` | 盗垒 |

#### `game score set`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--game-id` | int64 | 比赛 id，必须大于 0 |
| `--own-score` | int | 我方最终得分，必须大于等于 0 |
| `--opponent-score` | int | 对方最终得分，必须大于等于 0 |

#### `game read`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--id` | int64 | 要读取的比赛 id |

#### `game list`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--date` | string | 可选过滤条件，只展示指定日期比赛，格式 `YYYY-MM-DD` |

## 帮助文本示例

### `bastion player add -h`

期望能看到类似信息：

```text
Usage: bastion player add --name=STRING --number=INT --bat=STRING --throw=STRING --positions=STRING

Flags:
  --name=STRING          Player name.
  --number=INT          Jersey number, >= 0.
  --bat=STRING          Batting hand(s): left,right. Use comma for multiple values.
  --throw=STRING        Throwing hand(s): left,right. Use comma for multiple values.
  --positions=STRING    Positions: pitcher,catcher,infield,outfield. Use comma for multiple values.
```

### `bastion game event add -h`

期望能看到类似信息：

```text
Usage: bastion game event add --game-id=INT-64 --inning=INT --half=STRING --batter=STRING --event-type=STRING --outs=INT --base-state=INT --description=STRING [flags]

Flags:
  --half=STRING          Half inning: top,bottom.
  --event-type=STRING    Event type: other,single,double,triple,homerun,walk,strikeout,groundout,flyout,error,steal.
  --outs=INT             Outs after the event: 0, 1, or 2.
  --base-state=INT       Base state before the event: 0-7. 0 empty, 1 first, 2 second, 4 third, combine by addition.
```

## 实现建议

- 优先使用 Kong struct tag 补全 `help` 文案。
- 对固定枚举值，可以考虑使用自定义类型或 Kong enum tag，让 usage 从 `STRING` 尽量变成更明确的取值提示；如果实现成本较高，至少必须在字段 `help` 中完整列出可选值。
- 对 JSON 参数，在 `help` 文案里说明它们是 JSON 数组，并列出关键枚举字段；不要求在顶层 usage 中展开 JSON schema。
- 顶层 `bastion -h` 如果 Kong 默认只展示 `STRING`，可以接受；但子命令 `-h` 必须完整说明。
- 帮助文本变更不应影响现有命令解析、错误信息和测试数据。

## 非目标

- 不新增交互式输入。
- 不新增 shell completion。
- 不改变现有参数名，例如不把 `--batting-side` 改成其他名称。
- 不改变枚举值，例如不新增中文枚举。
- 不实现自然语言解析。
- 不修改数据库 schema。

## 验收标准

### 帮助信息

- `bastion player add -h` 展示 `--bat`、`--throw`、`--positions` 的可选值。
- `bastion report write -h` 展示 `--date` 的 `YYYY-MM-DD` 格式要求。
- `bastion game write -h` 展示 `--batting-side` 的 `top,bottom`，并说明 `lineup-json` 和 `events-json` 是 JSON 数组。
- `bastion game lineup add -h` 展示 `--team` 和 `--starting-position` 的可选值。
- `bastion game event add -h` 展示 `--half`、`--event-type`、`--outs`、`--base-state` 的可选值或范围。
- `bastion game list -h` 展示 `--date` 的过滤语义和格式。

### 行为兼容

- 现有合法命令仍然可以正常执行。
- 现有非法参数仍然返回明确错误。
- 帮助命令退出成功，不创建或修改数据库文件。

### 测试建议

- 增加 CLI 帮助文本测试，至少覆盖：
  - `player add -h`
  - `report write -h`
  - `game write -h`
  - `game event add -h`
- 测试只断言关键片段，不断言完整帮助文本，避免 Kong 格式微调导致测试脆弱。
