# 训练视频推荐需求

> 范围:Bastion CLI

## 目的

队员可以提交训练视频链接和推荐理由，由 agent 分析后归类训练类型并生成 AI 总结，最终写入训练推荐表，供全队按类型或队员检索和学习。

本功能的目标版本为 MVP：agent 负责分类和总结，CLI 负责校验、保存和读取。CLI 不负责自然语言理解，也不直接接入 LLM。

```sh
bastion drill recommend write --name [name] --url [url] --reason [reason] --type [type] --summary [summary]
bastion drill recommend list
bastion drill recommend list --name [name]
bastion drill recommend list --type [type]
```

## 技术栈

- Go CLI（Kong）
- SQLite

## 使用场景

1. 队员看到一个有价值的训练视频，告知 agent 视频链接和推荐理由。
2. agent 分析视频内容，归类训练类型，并生成 AI 总结。
3. agent 调用 CLI，将队员原始信息和 agent 产出（类型、总结）一次性写入。
4. 教练或队员通过 `drill recommend list` 浏览全队推荐的训练视频，可按训练类型或推荐人过滤。

## 命令设计

### 提交训练视频推荐

```sh
bastion drill recommend write \
  --name "张三" \
  --url "https://www.youtube.com/watch?v=example" \
  --reason "讲解了扑球步伐，很适合内野手练习" \
  --type infield \
  --summary "本视频系统演示了内野手处理滚地球时的步伐与重心控制，重点讲解了交叉步与正面扑球的选择时机，适合有一定内野基础的队员进阶练习。"
```

写入成功后输出新推荐 id，例如：

```text
drill recommendation saved: 1
```

### 列出训练视频推荐

```sh
# 列出全部推荐
bastion drill recommend list

# 按推荐人过滤
bastion drill recommend list --name "张三"

# 按训练类型过滤
bastion drill recommend list --type infield

# 组合过滤
bastion drill recommend list --name "张三" --type infield
```

输出按推荐时间倒序，每条包含 id、推荐人姓名、训练类型、视频链接、推荐理由、AI 总结、提交时间。

## 表格设计

### 训练推荐表 `drill_recommendations`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | INTEGER PRIMARY KEY AUTOINCREMENT | 推荐 id |
| name | TEXT NOT NULL | 推荐人姓名，不能为空 |
| url | TEXT NOT NULL | 视频链接，不能为空 |
| reason | TEXT NOT NULL | 推荐理由（队员原文），不能为空 |
| type | INTEGER NOT NULL | 训练类型枚举值；CLI 使用名称，SQLite 内部按整数存储 |
| summary | TEXT NOT NULL | agent 生成的 AI 总结，不能为空 |
| created_at | TEXT NOT NULL | 提交时间，格式 RFC3339，例如 `2026-06-24T10:30:45Z` |

## 字段取值

### 训练类型

`type` 在 CLI 中使用字符串名称，SQLite 内部使用整数枚举：

| SQLite 值 | CLI 名称 | 说明 |
| --- | --- | --- |
| 0 | `pitching` | 投球 |
| 1 | `catching` | 捕球 |
| 2 | `hitting` | 打击 |
| 3 | `strength` | 力量训练 |
| 4 | `baserunning` | 跑垒 |
| 5 | `infield` | 内野守备 |
| 6 | `outfield` | 外野守备 |

## 校验规则

- `name` 不能为空，写入前裁剪首尾空白。
- `name` 必须为已登记队员，即在 `players` 表中存在；不存在时返回 `player not found: <name>`。
- `url` 不能为空，写入前裁剪首尾空白；不校验 URL 格式，允许任意字符串（支持私有链接或非标准平台）。
- `reason` 不能为空，写入前裁剪首尾空白。
- `type` 必须为受支持训练类型名称之一：`pitching`、`catching`、`hitting`、`strength`、`baserunning`、`infield`、`outfield`；大小写不敏感。
- `summary` 不能为空，写入前裁剪首尾空白。
- `--name` 和 `--type` 过滤条件省略时不过滤该字段；两者均省略则返回全部记录。

## 写入行为

- `drill recommend write` 创建一条推荐记录，`created_at` 由 CLI 在写入时自动填入当前时间（RFC3339）。
- 写入前校验推荐人 `name` 已在 `players` 表中登记，否则返回 `player not found` 且不落库。
- 写入使用事务；任一校验失败时不落库。
- 写入成功后输出新建记录 id。

## 读取行为

- `drill recommend list` 按 `created_at DESC`、`id DESC` 排序展示全部推荐。
- `--name` 和 `--type` 过滤条件可单独或组合使用。
- 无记录时返回空列表，不视为错误。

## 字段帮助说明

### `drill recommend write`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--name` | string | 推荐人姓名，不能为空，必须为已登记队员 |
| `--url` | string | 视频链接，不能为空，例如 `https://www.youtube.com/watch?v=xxx` |
| `--reason` | string | 队员推荐理由，不能为空 |
| `--type` | enum | 训练类型，可填 `pitching`、`catching`、`hitting`、`strength`、`baserunning`、`infield`、`outfield` |
| `--summary` | string | agent 生成的 AI 总结，不能为空 |

### `drill recommend list`

| 参数 | 类型 | 帮助说明 |
| --- | --- | --- |
| `--name` | string | 可选过滤条件，只展示指定队员的推荐 |
| `--type` | enum | 可选过滤条件，只展示指定训练类型的推荐；可填 `pitching`、`catching`、`hitting`、`strength`、`baserunning`、`infield`、`outfield` |

## 数据边界

- 视频内容分析、训练类型归类和 AI 总结生成由 agent 完成。
- CLI 接收结构化参数，负责字段校验、事务写入和读取展示。
- CLI 不负责自然语言理解，也不直接接入 LLM。
- MVP 不支持编辑或删除已有推荐记录。

## 验收测试

### CLI 测试

- 可以通过 `drill recommend write` 写入包含所有字段的推荐记录，并输出新 id。
- 空 `--name`、空 `--url`、空 `--reason`、空 `--summary` 会失败并返回明确错误。
- `--name` 对应队员不存在于 `players` 表时返回 `player not found`。
- 非法 `--type` 值（例如 `running`、空字符串）会失败并返回明确错误。
- 可以通过 `drill recommend list` 列出全部推荐，按时间倒序展示。
- 可以通过 `--name` 过滤出指定队员的推荐。
- 可以通过 `--type` 过滤出指定训练类型的推荐。
- `--name` 和 `--type` 同时指定时，结果同时满足两个条件。
- 无推荐记录时 `drill recommend list` 返回空列表，不报错。

### SQLite 测试

- `drill_recommendations` 能正确建表，包含 `type`（整数）和 `summary` 字段。
- 写入使用事务，校验失败时不落库。

### Domain 测试

- 写入前对 `name`、`url`、`reason`、`summary` 裁剪首尾空白。
- `type` 枚举大小写不敏感，内部统一存储为整数。
- 缺少必填字段、非法枚举值或推荐人未登记时返回明确错误。
