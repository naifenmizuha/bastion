# CLI JSON 输入输出优化需求

> 范围:Bastion CLI

## 背景

当前 CLI 已经具备较完整的非交互式命令和结构化读取能力,但输入输出协议仍偏向人类命令行使用:

- 读操作主要输出 TOML,便于人阅读,但不是 agent 最通用的接口格式。
- 写操作输出为短文本,例如 `game saved: 1`、`lineup added: 1`,agent 需要用正则提取 id。
- 复杂输入通过 `--lineup-json`、`--events-json` 等 JSON 字符串 flag 传入,一旦内容较长或包含引号、换行,容易被 shell 转义影响。
- 列表为空时部分命令输出为空,agent 难以区分"查询成功但无数据"和"命令没有产生可解析输出"。
- JSON 解析目前允许未知字段被静默忽略,agent 拼错字段时可能延迟到业务校验阶段才暴露问题。

本需求目标是将 CLI 优化为 agent-first 的 JSON 输入输出协议,同时保留人类可读输出格式。写入类命令不再保留旧 flag payload,项目内 `justfile` 需要随新协议同步调整。

## 目的

让 agent 可以稳定、低歧义、可恢复地调用 CLI 完成数据写入、读取、分析和列表查询。

JSON 协议应满足:

- 所有机器调用都有稳定 JSON 输出。
- 所有写操作都返回结构化 id、计数和资源类型。
- 所有错误都返回结构化错误对象,包含错误码、字段、消息和可选详情。
- 复杂输入支持从文件或 stdin 读取,避免长 JSON 塞进 shell flag。
- 输入 JSON 使用严格 schema,未知字段应报错。
- 空列表也返回空数组,不输出空 stdout。
- 保持现有业务校验、数据库结构和领域服务职责不变。

CLI 仍不负责自然语言理解,也不直接接入 LLM。agent 负责把自然语言整理为 JSON 请求;CLI 负责校验、持久化、查询和返回 JSON 结果。

## 技术栈

- Go CLI(Kong)
- SQLite
- JSON 输入输出协议

## 设计原则

- JSON 是机器协议,TOML 或 text 是人类展示格式。
- 默认输出为 JSON;人类阅读模式通过 `--format toml` 或 `--format text` 显式启用。
- 默认模式下 stdout 只输出结果 JSON;`--format toml` 或 `--format text` 下 stdout 只输出所选格式;stderr 只输出诊断信息或保持为空。
- 成功和失败都应能被程序稳定解析。
- 命令语义保持单一:一个命令完成一个明确动作。
- 字段名统一使用 snake_case,与现有 JSON/TOML 字段保持一致。
- 枚举值统一使用现有英文字符串,例如 `top`、`own`、`plate_result`、`runner_movement`。
- SQLite 内部整数枚举不暴露给 agent;JSON 输入输出均使用字符串枚举。

## 总体命令设计

### 全局输出格式

新增全局参数:

```sh
bastion ...                 # 默认 JSON
bastion --format json ...   # 显式 JSON,等同默认
bastion --format toml ...
bastion --format text ...
```

默认策略:

- 默认输出 JSON,适合作为 agent 和脚本的稳定协议。
- `--format toml` 输出人类更容易阅读的结构化结果。
- `--format text` 仅用于简单写操作的短文本提示,不作为机器协议。
- `--format json` 可以作为显式写法保留,但语义等同于默认行为。

默认 JSON 输出下,所有成功输出必须是合法 JSON object,不得混入人类文本。

### 全局输入来源

新增通用输入参数:

```sh
--input PATH
--input -
```

规则:

- `--input PATH` 从文件读取 JSON。
- `--input -` 从 stdin 读取 JSON。
- 写入、生成、设置类命令的 payload 必须通过 `--input PATH` 或 `--input -` 传入。
- 读/list 等查询类命令可以继续使用定位或过滤 flag,例如 `--id`、`--name`、`--from`、`--to`、`--date`。
- 同一个命令不得同时提供 `--input` payload 和旧式 payload flag。
- 旧式写入 payload flag 不作为兼容入口保留。

### 严格 JSON 解析

所有 `--input` 解析都应启用未知字段检查。

要求:

- JSON object 或 array 中出现未知字段时报错。
- 类型不匹配时报错,错误中包含字段路径。
- 必填字段缺失时报错,错误中包含字段名。
- 枚举不合法时报错,错误中包含合法值。

## 成功输出协议

默认 JSON 输出下,所有命令统一返回 envelope:

```json
{
  "ok": true,
  "data": {}
}
```

写操作示例:

```json
{
  "ok": true,
  "data": {
    "resource": "game",
    "id": 1
  }
}
```

批量追加示例:

```json
{
  "ok": true,
  "data": {
    "resource": "game_events",
    "game_id": 1,
    "count": 3
  }
}
```

读取操作示例:

```json
{
  "ok": true,
  "data": {
    "game": {},
    "lineups": [],
    "events": []
  }
}
```

列表操作示例:

```json
{
  "ok": true,
  "data": {
    "games": []
  }
}
```

## 错误输出协议

默认 JSON 输出下,所有失败输出必须是合法 JSON object:

```json
{
  "ok": false,
  "error": {
    "code": "invalid_enum",
    "field": "events[0].event_kind",
    "message": "invalid event_kind \"hit\", expected one of: plate_result,runner_movement,fielding_credit",
    "details": {
      "expected": ["plate_result", "runner_movement", "fielding_credit"]
    }
  }
}
```

错误码建议:

| code | 说明 |
| --- | --- |
| `parse_error` | JSON 语法错误或输入无法读取 |
| `unknown_field` | JSON 中存在未知字段 |
| `missing_required` | 必填字段缺失 |
| `invalid_type` | 字段类型不匹配 |
| `invalid_enum` | 枚举值不合法 |
| `invalid_value` | 字段值不满足范围或格式 |
| `not_found` | 资源不存在 |
| `conflict` | 唯一约束冲突或重复写入 |
| `storage_error` | SQLite 或存储层错误 |
| `internal_error` | 未预期内部错误 |

退出码:

- 成功:0
- 输入/校验错误:2
- 资源不存在或冲突:3
- 存储或内部错误:1

## 输入结构设计

### `player add`

命令:

```sh
bastion player add --input player.json
```

输入:

```json
{
  "name": "张三",
  "number": 18,
  "bat": "right",
  "throw": "right",
  "positions": "pitcher,infield"
}
```

输出:

```json
{
  "ok": true,
  "data": {
    "resource": "player",
    "name": "张三"
  }
}
```

### `report write`

输入:

```json
{
  "name": "张三",
  "date": "2026-06-25",
  "content": "打击训练 100 球,含变化球应对",
  "reflection": "挥棒节奏有进步,外角球仍需加强"
}
```

输出:

```json
{
  "ok": true,
  "data": {
    "resource": "report",
    "name": "张三",
    "date": "2026-06-25"
  }
}
```

### `game write`

命令:

```sh
bastion game write --input game.json
```

输入:

```json
{
  "date": "2026-06-24",
  "start_time": "19:30",
  "opponent": "海港队",
  "batting_side": "top",
  "own_score": 2,
  "opponent_score": 1,
  "raw": "参考比赛:6月24日对海港队,先攻,2:1获胜。",
  "lineups": [
    {
      "team": "own",
      "player": "张三",
      "batting_order": 1,
      "starting_position": "P"
    }
  ],
  "events": [
    {
      "inning": 1,
      "half": "top",
      "play_no": 1,
      "sequence": 1,
      "event_kind": "plate_result",
      "player": "张三",
      "team": "own",
      "result": "double",
      "related_player": "对方投手",
      "pitch_sequence": "B,X",
      "outs_on_play": 0,
      "runs_scored": 0,
      "value": 1,
      "description": "张三二垒安打"
    }
  ]
}
```

输出:

```json
{
  "ok": true,
  "data": {
    "resource": "game",
    "id": 1
  }
}
```

### `game create`

输入:

```json
{
  "date": "2026-06-24",
  "start_time": "19:30",
  "opponent": "海港队",
  "batting_side": "top",
  "raw": "6月24日对海港队"
}
```

输出:

```json
{
  "ok": true,
  "data": {
    "resource": "game",
    "id": 1
  }
}
```

### `game lineup add`

输入:

```json
{
  "game_id": 1,
  "team": "own",
  "player": "张三",
  "batting_order": 1,
  "starting_position": "P"
}
```

输出:

```json
{
  "ok": true,
  "data": {
    "resource": "game_lineup",
    "id": 1,
    "game_id": 1
  }
}
```

### `game event write`

命令:

```sh
bastion game event write --input events.json
```

`events.json` 是完整请求对象:

```json
{
  "game_id": 1,
  "events": [
    {
      "inning": 1,
      "half": "top",
      "play_no": 1,
      "sequence": 1,
      "event_kind": "plate_result",
      "player": "张三",
      "team": "own",
      "result": "single",
      "related_player": "对方投手",
      "pitch_sequence": "X",
      "description": "张三一垒安打"
    }
  ]
}
```

输出:

```json
{
  "ok": true,
  "data": {
    "resource": "game_events",
    "game_id": 1,
    "count": 1
  }
}
```

### `game score set`

输入:

```json
{
  "game_id": 1,
  "own_score": 5,
  "opponent_score": 3
}
```

输出:

```json
{
  "ok": true,
  "data": {
    "resource": "game_score",
    "game_id": 1,
    "own_score": 5,
    "opponent_score": 3
  }
}
```

### `game analysis generate`

输入:

```json
{
  "game_id": 1
}
```

输出:

```json
{
  "ok": true,
  "data": {
    "resource": "game_analysis",
    "id": 1,
    "game_id": 1
  }
}
```

### `drill recommend write`

输入:

```json
{
  "name": "张三",
  "url": "https://example.com/drill/1",
  "reason": "变化球握法参考",
  "type": "pitching",
  "summary": "演示变化球握法与释放点"
}
```

输出:

```json
{
  "ok": true,
  "data": {
    "resource": "drill_recommendation",
    "id": 1
  }
}
```

## 读取输出结构设计

所有读取命令默认返回当前 TOML 输出的等价 JSON 结构,字段名保持 snake_case。需要人类阅读时使用 `--format toml`。

### `player read`

```json
{
  "ok": true,
  "data": {
    "player": {
      "name": "张三",
      "number": 18,
      "bat": "right",
      "throw": "right",
      "positions": "pitcher,infield"
    }
  }
}
```

### `report read`

```json
{
  "ok": true,
  "data": {
    "report": {
      "name": "张三",
      "date": "2026-06-25",
      "content": "打击训练 100 球",
      "reflection": "节奏更稳定"
    }
  }
}
```

### `game read`

```json
{
  "ok": true,
  "data": {
    "game": {},
    "lineups": [],
    "events": []
  }
}
```

### `game list`

```json
{
  "ok": true,
  "data": {
    "games": []
  }
}
```

### `game analysis read`

```json
{
  "ok": true,
  "data": {
    "analysis": {},
    "player_summaries": [],
    "batting": [],
    "baserunning": [],
    "pitching": [],
    "fielding": [],
    "data_gaps": []
  }
}
```

### `game analysis list`

```json
{
  "ok": true,
  "data": {
    "analyses": []
  }
}
```

### `person analysis read`

```json
{
  "ok": true,
  "data": {
    "analysis": {},
    "summary": {},
    "batting": {},
    "baserunning": {},
    "pitching": {},
    "fielding": {},
    "data_gaps": []
  }
}
```

### `drill recommend list`

```json
{
  "ok": true,
  "data": {
    "drills": []
  }
}
```

## 迁移策略

### 移除旧式写入 flag

以下旧式写入 payload flag 不再保留:

- `player add --name ...`
- `report write --name ...`
- `game write --lineup-json ... --events-json ...`
- `game event write --events-json ...`

对应命令改为:

```sh
bastion player add --input player.json
bastion report write --input report.json
bastion game write --input game.json
bastion game event write --input events.json
```

`justfile` 必须同步迁移到新协议。示例和 demo 中的写入命令应改为 JSON 文件或 stdin 输入;需要展示人类可读读取结果时,在读命令上显式添加 `--format toml`。

### 保留 TOML 输出

现有读操作的 TOML 输出保留,通过 `--format toml` 访问。

写操作默认返回 JSON;需要短文本提示时使用 `--format text`。

### 替换复杂 JSON flag

`--lineup-json`、`--events-json` 不再作为 CLI 参数存在。结构化比赛数据统一放入输入 JSON:

```sh
bastion game write --input game.json
bastion game event write --input events.json
```

### justfile 迁移设计

`justfile` 不再通过长 flag 传递写入 payload。所有写入类 demo recipe 使用 stdin 或临时 JSON 文件。

推荐规则:

- 简短 payload 使用 `--input -`。
- 比赛、事件等较长 payload 写入 `/tmp/bastion-demo/*.json`,再通过 `--input PATH` 调用。
- 读操作默认 JSON;demo 若面向人类展示,读命令显式传 `--format toml`。
- `justfile` 中不得再出现 `--lineup-json`、`--events-json` 或写入 payload 的旧式 flag。

示例:

```make
demo-player: build demo-reset
    printf '%s\n' '{"name":"张三","number":1,"bat":"right","throw":"right","positions":"pitcher"}' | ./{{bin}} --db {{demo_db}} player add --input -
    printf '%s\n' '{"name":"李四","number":2,"bat":"left","throw":"right","positions":"outfield"}' | ./{{bin}} --db {{demo_db}} player add --input -
    ./{{bin}} --db {{demo_db}} player read --name "张三" --format toml

demo-game: demo-player
    mkdir -p /tmp/bastion-demo
    ./{{bin}} --db {{demo_db}} game write --input /tmp/bastion-demo/game.json
    ./{{bin}} --db {{demo_db}} game read --id 1 --format toml
```

长 JSON fixture 的生成方式由实现阶段选择,可以使用 checked-in fixture、`printf`、heredoc 或单独的 `just` recipe;但最终调用 CLI 时必须走 `--input`。

## Schema 和自描述能力

新增 schema 子命令,供 agent 查询字段、类型和枚举:

```sh
bastion schema list
bastion schema show game_write
bastion schema show game_event
```

`schema list` 输出:

```json
{
  "ok": true,
  "data": {
    "schemas": [
      "player_add",
      "report_write",
      "game_write",
      "game_lineup",
      "game_event",
      "game_score_set",
      "game_analysis_generate",
      "drill_recommend_write"
    ]
  }
}
```

`schema show` 输出应包含:

- 字段名
- 类型
- 是否必填
- 是否可为空
- 枚举合法值
- 默认值
- 简短说明

MVP 可以先在代码中维护静态 schema,不要求生成正式 JSON Schema Draft 文件;但输出结构应稳定,便于 agent 读取。

## 校验命令

新增 validate 命令,用于写入前检查输入:

```sh
bastion validate game_write --input game.json
bastion validate game_event --input events.json
```

成功:

```json
{
  "ok": true,
  "data": {
    "valid": true,
    "schema": "game_write"
  }
}
```

失败使用统一错误协议。

`validate` 只做输入结构、枚举、字段范围和领域校验,不写数据库。若校验依赖数据库存在性,例如队员是否已登记,应在输出中明确该检查是否执行。

## 实现范围

### MVP 必须完成

- 默认输出改为 JSON,并保留显式 `--format json`。
- 所有读/list/analysis 命令默认输出 JSON。
- 所有写/generate/set 命令默认返回结构化成功结果。
- 默认 JSON 输出下错误输出统一为 `{"ok":false,"error":...}`。
- 列表为空时 JSON 输出空数组。
- `player add` 支持 `--input PATH` 和 `--input -`,并移除旧式 payload flag。
- `report write` 支持 `--input PATH` 和 `--input -`,并移除旧式 payload flag。
- `game write` 支持 `--input PATH` 和 `--input -`。
- `game event write` 支持 `--input PATH` 和 `--input -`。
- `game create`、`game lineup add`、`game score set`、`game analysis generate`、`drill recommend write` 支持 `--input PATH` 和 `--input -`,并移除旧式 payload flag。
- 输入 JSON 严格拒绝未知字段。
- 通过 `--format toml` 保留现有读操作 TOML 行为;通过 `--format text` 保留写操作短文本行为。
- 更新 `justfile`,让所有 demo 和 seed recipe 使用新的 JSON 输入协议。

### MVP 可选

- `schema list/show`。
- `validate`。

### 非目标

- 不改变 SQLite 表结构。
- 不改变现有领域服务统计口径。
- 不接入 LLM。
- 不做自然语言解析。
- 不引入 HTTP server。
- 不实现批量事务脚本语言。

## 测试要求

### 单元测试

需要覆盖:

- `player read` 默认输出合法 JSON。
- `game read` 默认输出合法 JSON。
- `game list` 无数据时默认输出 `games: []`。
- `game write --input file` 成功返回 `resource` 和 `id`。
- `game event write --input -` 成功返回 `count`。
- 旧式写入 payload flag 会返回参数错误,例如 `game write --events-json ...` 不再可用。
- JSON 输入未知字段报 `unknown_field`。
- JSON 输入枚举错误报 `invalid_enum`。
- JSON 输入缺少必填字段报 `missing_required`。
- 写操作业务错误默认返回结构化错误。
- `--format toml` 和 `--format text` 兼容输出不被破坏。
- 需要人类可读断言的测试应显式使用 `--format toml` 或 `--format text`。

### 集成测试

需要覆盖完整 agent 流程:

1. `player add`
2. `game write --input game.json`
3. `game analysis generate --input game-analysis-generate.json`
4. `game analysis read`
5. `person analysis read`

整个流程中,agent 不需要解析任何人类短文本。

### justfile 迁移测试

`justfile` 应改用新 JSON 输入协议。以下命令仍应通过:

```sh
just test
just demo-all
```

## 验收标准

- agent 可以只使用 JSON 输入输出完成一次完整比赛写入、分析生成和跨期读取。
- 所有默认输出均可被标准 JSON parser 解析。
- 所有成功响应都有 `ok: true` 和 `data`。
- 所有失败响应都有 `ok: false` 和 `error.code`。
- 空列表返回空数组,不返回空 stdout。
- 长比赛事件输入可以通过文件或 stdin 传入,无需 shell JSON 转义。
- 未知字段、拼错枚举、缺失必填字段都能给出稳定错误码和字段路径。
- 现有人类命令仍可通过显式 `--format toml` 或 `--format text` 获得可读输出。
- `justfile` 中不再出现 `--lineup-json`、`--events-json` 或写入 payload 的旧式 flag。

## 推荐迁移顺序

1. 引入输出格式枚举和 JSON envelope。
2. 将现有 TOML 输出结构复用为 JSON data。
3. 将写操作成功文本替换为可按格式切换的响应对象。
4. 增加 JSON 错误响应和错误码映射。
5. 为 `game write`、`game event write` 增加 `--input`。
6. 启用严格 JSON 解析。
7. 补齐空列表 JSON 输出。
8. 增加 schema 和 validate 命令。
