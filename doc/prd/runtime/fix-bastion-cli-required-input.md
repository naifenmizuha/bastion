# bastion_cli 命令输入契约与错误回传修复需求

> 范围：Bastion CLI / Agent Runtime / `bastion_cli` Tool  
> 优先级：P0

## 背景

Agent 调用新增队员命令时，可能只传入命令路径：

```json
{
  "args": ["player", "add"]
}
```

Runtime 随后返回：

```json
{
  "ok": false,
  "command": ["player", "add"],
  "error": {
    "code": "INVALID_INPUT",
    "message": "player add requires input to be a JSON object"
  }
}
```

该错误虽然准确，但当前 Tool 的模型可见参数只把 `input` 声明为可选
`unknown`，没有直接说明 `player add` 必须携带哪些字段。错误结果也没有返回
所需字段、字段约束或可重试示例，Agent 无法仅根据错误完成纠正，容易原样重试、
猜测数据或把本可避免的参数错误暴露给用户。

该问题并非 `player add` 独有。当前所有 `input: required` 命令都只在 Runtime
中标记“需要对象”，没有向模型暴露各自的完整字段契约。

受影响命令包括：

- `player add`
- `report write`
- `game write/create/lineup add/event write/score set/analysis generate`
- `lineup validate/write`
- `drill recommend write`

其中多数命令是需要确认的权威写操作。修复不能通过补默认值、自动生成业务资料或
绕过审批来实现。

## 目标

1. Agent 在首次调用结构化输入命令前即可发现该命令的完整输入契约。
2. 用户已提供全部队员资料时，Agent 应在同一次 Tool 调用中正确传入 `input`。
3. 用户资料不完整时，Agent 应先询问缺失事实，不得先发起无效调用。
4. `INVALID_INPUT.details` 必须返回当前命令的输入契约，使错误可被确定性修正。
5. 所有需要结构化输入的命令使用同一套契约和错误回传机制。

## 非目标

- 不修改 Go CLI 的 `player add --input` 协议。
- 不恢复已经移除的 `--name`、`--number` 等旧式 payload flags。
- 不改变队员数据模型、字段枚举、数据库结构和重复队员校验。
- 不自动补全姓名、背号、惯用手或守备位置。
- 不降低写操作确认和写后验证要求。

## `player add` 输入契约

Tool 调用必须使用以下形态：

```json
{
  "args": ["player", "add"],
  "input": {
    "name": "张三",
    "number": 18,
    "bat": "right",
    "throw": "right",
    "positions": "pitcher,shortstop"
  }
}
```

字段约束：

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `name` | string | 是 | 非空队员姓名 |
| `number` | integer | 是 | 大于等于 0 的背号 |
| `bat` | string | 是 | `left`、`right`，多值使用逗号分隔 |
| `throw` | string | 是 | `left`、`right`，多值使用逗号分隔 |
| `positions` | string | 是 | `pitcher`、`catcher`、`first_base`、`second_base`、`third_base`、`shortstop`、`outfield`，多值使用逗号分隔 |

`args` 中不得出现 `--input`、文件路径或上述业务字段；Runtime 负责把 `input`
序列化并通过标准输入交给 CLI。

## 期望流程

### 用户已提供完整资料

1. Agent 读取球员领域命令契约。
2. Agent 可先通过 `player list` 或 `player read` 检查姓名和背号冲突。
3. Agent 以 `args + input` 形态调用 `player add`。
4. Runtime 展示包含完整 payload 的写操作确认。
5. 用户确认后执行写入，并通过 `player read` 完成写后验证。

流程中不得先发送缺少 `input` 的探测调用。

### 用户资料不完整

若缺少任一必填事实，Agent 应直接询问用户。未知值不得用空字符串、`null`、
占位符或模型猜测值代替，也不得调用 `player add` 来探测缺失字段。

### Tool 收到非法输入

当 `input` 缺失、为 `null`、数组或其他非对象值时，Runtime 不启动 CLI、
不请求写审批，并在 `INVALID_INPUT.details` 中返回失败原因和当前命令的完整
输入契约：

```json
{
  "ok": false,
  "command": ["player", "add"],
  "error": {
    "code": "INVALID_INPUT",
    "message": "player add requires input to be a JSON object",
    "details": {
      "reason": "MISSING_INPUT",
      "contract": {
        "command": ["player", "add"],
        "input": {
          "required": true,
          "type": "object",
          "additionalProperties": false,
          "requiredFields": ["name", "number", "bat", "throw", "positions"],
          "properties": {
            "name": {
              "type": "string",
              "minLength": 1,
              "description": "Player name"
            },
            "number": {
              "type": "integer",
              "minimum": 0,
              "description": "Uniform number"
            },
            "bat": {
              "type": "string",
              "description": "Comma-separated values: left, right"
            },
            "throw": {
              "type": "string",
              "description": "Comma-separated values: left, right"
            },
            "positions": {
              "type": "string",
              "description": "Comma-separated player positions"
            }
          },
          "example": {
            "name": "张三",
            "number": 18,
            "bat": "right",
            "throw": "right",
            "positions": "pitcher,shortstop"
          }
        }
      }
    }
  }
}
```

示例只用于描述格式，不代表 Runtime 可以用示例值执行写入。

`reason` 至少支持：

| 值 | 含义 |
| --- | --- |
| `MISSING_INPUT` | 调用没有提供 `input` |
| `INVALID_INPUT_TYPE` | `input` 不是 JSON 对象 |

同一个错误只能返回实际匹配命令的契约。例如 `report write` 出错时必须返回
`report write` 的字段，不能返回 `player add` 的字段。

## 功能需求

### FR-1 模型可见的命令契约

- `bastion_cli` 的模型可见说明必须明确区分查询命令与结构化输入命令。
- Tool 参数 schema 必须将 `input` 声明为 `type: object`，不得使用会让提供商
  自由选择字符串或对象的无约束类型。
- 对已知会把嵌套对象编码成 JSON 字符串的兼容提供商，Runtime 应在 schema 校验
  前只解码一层合法 JSON 对象；不得接受 JSON primitive、数组或多层字符串。
- 说明必须明确指出 `player add` 的 `input` 是必填 JSON 对象。
- `manage-bastion-team` Skill 的球员 reference 必须同时展示完整 Tool 调用，
  不能只展示脱离 `args` 的 payload。
- 协议 reference 必须将 `INVALID_INPUT` 纳入错误决策表。

### FR-2 命令级输入元数据

- 每个 `input: required` 命令必须提供机器可读的 `CommandInputContract`，至少
  包括命令路径、是否必填、输入类型、是否允许额外字段、字段定义、必填字段和
  安全示例。
- Go CLI 应作为命令输入契约的唯一事实来源。Runtime 可以在构建期生成或在启动
  时读取契约，不得长期手工维护一份独立字段表。
- CLI 提供不访问数据库的 `bastion --format json contract`，一次返回全部
  `input: required` 命令契约；该命令仅供 Runtime 和契约测试使用，不注册为
  模型可调用的业务命令。
- `player add` 的命令策略、模型可见说明和错误 details 必须来自同一份契约。
- 新增结构化输入命令时必须同时提供契约，不为每个命令拼接独立硬编码错误。
- Go CLI 继续作为字段合法性和业务规则的最终权威；Runtime 不复制完整业务校验。

### FR-3 可操作的错误回传

- 非对象输入继续使用 `INVALID_INPUT`，保持现有错误码兼容。
- 错误的 `details` 必须包含 `reason` 和实际匹配命令的
  `CommandInputContract`。
- 契约必须足以表达字段类型、必填性、基础约束和示例；枚举、范围等已有约束不得
  退化成无说明的 `string` 或 `number`。
- Tool 返回给模型的文本内容必须保留 `error.details`，不得只保留
  `code` 和 `message`。
- 错误 details 不得包含数据库路径、临时文件路径、内部堆栈或其他用户数据。

### FR-4 无副作用失败

- 输入边界校验必须发生在审批与 CLI 进程启动之前。
- `INVALID_INPUT` 不得产生数据库写入、审批弹窗和写后验证调用。
- Agent 不得在没有新增信息的情况下原样重试。

### FR-5 正常写入行为保持不变

- 合法 `player add` 仍必须经过用户确认。
- 用户取消时不得执行 CLI。
- 写入成功后仍使用 `player read --name <name>` 验证结果。
- 顶层只有在执行和验证均成功时才返回 `ok: true`。

## 验收标准

1. 用户在同一轮消息中提供五个必填字段时，首次 `player add` Tool 调用包含
   正确的 `input` 对象，不出现本需求背景中的错误。
2. 用户只说“新增一个队员”时，Agent 询问缺失字段，且调用记录中没有
   `player add`。
3. 直接调用 `{ "args": ["player", "add"] }` 返回 `INVALID_INPUT`，其中
   `details.reason` 为 `MISSING_INPUT`，`details.contract` 包含五个必填字段、
   字段约束和完整示例。
4. `input` 分别为 `null`、字符串和数组时，均在 CLI 启动前失败，且不触发审批。
5. 合法对象仍进入原有审批流程；确认后成功写入并完成 `player read` 验证。
6. 查询命令如 `player list` 仍拒绝多余的 `input`，现有行为不回退。
7. 所有其他 `input: required` 命令返回各自的完整 `CommandInputContract`，
   不错误复用 `player add` 的契约。
8. CLI、Runtime 命令策略、Skill 文档和错误 details 的契约漂移测试通过。

## 测试要求

- command policy 单元测试：缺失、`null`、数组、字符串及合法对象。
- Tool 输出单元测试：断言模型文本保留 `error.details`。
- service 单元测试：非法输入不调用确认回调和 executor。
- 契约参数化测试：遍历全部 `input: required` 命令，断言缺失输入时返回与命令
  路径匹配的契约。
- CLI/Runtime 漂移测试：断言命令路径、必填字段、字段类型和基础约束一致。
- Skill 契约测试：`player add` 示例同时包含 `args` 与 `input`，字段集合与命令
  元数据一致。
- 集成测试：合法新增、用户取消、写后验证成功三个路径。
