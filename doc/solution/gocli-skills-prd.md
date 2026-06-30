# Bastion Runtime gocli Skills PRD

- 状态：Draft
- 版本：0.1
- 日期：2026-06-30
- 范围：`runtime`
- 关联能力：`cli`、Runtime Tool、Skills、Multi-Agent

## 1. 名词与结论

本文中的 **gocli** 指仓库内由 Go 实现、构建产物为 `out/bastion` 的 Bastion CLI。

本需求的核心结论是：

1. 首版只提供一个模型可见的领域 Skill：`manage-bastion-team`，避免多个相近 Skill 互相竞争触发。
2. Skill 负责教 LLM 判断何时查询、读取哪些资料、采用什么工作流、如何处理结果和错误。
3. 详细命令、输入 schema 和领域枚举按主题放入 `references/`，由 LLM 按需读取，不全部注入 system prompt。
4. Runtime 提供结构化 `bastion_cli` Tool，负责真正执行 gocli、校验命令白名单、传递 JSON、实施审批并返回统一结果。
5. Skill 不通过通用 shell 调用 gocli，不直接访问 SQLite，也不复制 CLI 内的领域校验规则。
6. 主 Agent 与获得 `bastion_cli` 权限的子 Agent 使用同一份 Skill；权限差异由 Runtime Tool allowlist 保证，不依赖提示词约束。

Skill 与 Tool 缺一不可：只有 Skill，执行缺少安全和稳定边界；只有 Tool，LLM 不知道何时调用以及如何组合命令完成球队管理任务。

## 2. 背景

Bastion CLI 已提供以下权威领域能力：

- 球员登记、读取和列表；
- 自训报告登记与读取；
- 比赛、出场名单、事件和比分登记；
- 单场及跨周期表现分析；
- 候选阵容校验、保存、接受和拒绝；
- 训练推荐、审核和正式训练查询。

当前 Runtime 通过 Pi SDK 创建通用 Agent Session。Pi 可以加载 Skills，也能调用通用工具，但尚未向模型提供一套稳定的 Bastion 领域操作指南。模型若只依赖代码搜索、CLI `--help` 或通用 shell，会出现：

- 不知道用户自然语言意图对应哪个命令；
- 在每次任务中重复探索命令和 JSON 字段；
- 使用已废弃的 flag 形式传递复杂 payload；
- 猜测不存在的命令，例如 `report list`；
- 把读、计算、草稿写和权威写混为一类；
- 写入前未展示影响，写入后未重新读取验证；
- 参数错误后原样重试，或把 CLI 业务错误当作成功；
- 直接操作 SQLite，绕过领域校验和审计；
- 将全部 CLI 文档塞进上下文，挤占用户任务所需 token。

因此需要将“如何可靠地使用 gocli”沉淀为 Runtime 自带 Skill，并建立从 Skill 触发到 Tool 执行、写入审批、结果验证和评测的完整闭环。

## 3. 产品目标

### 3.1 目标

1. 用户以自然语言提出球队管理任务时，LLM 能稳定识别并加载 Bastion Skill。
2. LLM 只读取与当前任务相关的命令资料，保持上下文精简。
3. LLM 能把用户意图转换为合法的 gocli 查询参数或严格 JSON input。
4. LLM 能组合多个命令完成跨领域工作流，而不是只记住单条命令。
5. 读取和无副作用校验可自动执行；有副作用操作遵循 Runtime 风险与审批策略。
6. 所有成功写入均通过权威读取命令验证，并向用户清楚说明实际变更。
7. CLI 演进后，Skill 的命令目录和示例能被自动检查，避免静默过期。
8. 主 Agent 与受权子 Agent 的行为一致，并且子 Agent 无法借 Skill 绕过工具权限。

### 3.2 成功指标

- 领域意图 Skill 触发召回率不低于 95%。
- 非领域任务误触发率不高于 5%。
- 测试集中的合法请求，首次 `bastion_cli` 调用参数正确率不低于 90%。
- LLM 虚构 gocli 命令或 flag 的比例低于 2%。
- 写操作审批绕过次数为 0。
- 成功写操作的写后验证率为 100%。
- 参数或领域校验失败后，完全相同参数的无意义重试次数为 0。
- 单一领域任务默认只加载 `SKILL.md` 和一个相关 reference。
- CLI 命令发生不兼容变化时，CI 必须失败并指出受影响的 Skill reference 或示例。

## 4. 非目标

首版不包含：

- 训练、微调或蒸馏基础模型；
- 用 Skill 重新实现棒球统计、阵容合法性或数据库约束；
- 让 LLM 生成任意 shell 字符串执行 gocli；
- 让 LLM 直接读取或修改 `bastion.db`；
- 将每个 CLI 子命令拆成一个独立 Skill；
- 自动从自然语言猜测缺失的权威事实并写入数据库；
- 为 CLI 增加本文未要求的新业务命令；
- 在 Skill 内维护一份与 Go 类型逐字段重复的完整领域模型；
- 依靠提示词代替 Tool 权限、审批、锁或命令白名单；
- 让子 Agent 获得主 Agent 未授予的写权限。

## 5. 目标用户与核心任务

### 5.1 球队管理者

希望用自然语言查询球队事实、登记训练和比赛、分析表现、制定阵容及审核训练内容，不需要记忆 CLI 语法。

### 5.2 Runtime LLM

需要从用户请求中识别领域意图，补齐必要信息，选用最小命令集合，调用结构化 Tool，并基于权威结果回答。

### 5.3 Runtime 开发者

需要以可版本化、可测试的方式维护领域操作知识，而不将大段命令说明硬编码进 system prompt 或 TypeScript。

## 6. 典型用户故事

### 6.1 查询球队名单

用户问“现在队里有哪些球员”。LLM 加载 Skill，读取球员与训练 reference，调用 `player list`，根据 JSON 结果回答。不得读取 SQLite，也不得猜测名单。

### 6.2 登记自训报告

用户说“帮张三登记今天的训练：打击 100 球，感觉外角球还不稳定”。LLM：

1. 明确“今天”对应 Runtime 当前日期；
2. 读取球员资料确认张三存在；
3. 整理 `report write` JSON；
4. 按风险策略展示并执行写入；
5. 调用 `report read` 验证；
6. 告知用户已登记的姓名、日期、内容和感想。

### 6.3 比较近期表现

用户要求比较三名球员近两个月表现。LLM 读取比赛分析 reference，先确认球员和日期范围，再分别调用 `person analysis read`。若 Runtime 支持多 Agent，可将独立只读查询并行化，但所有 Agent 使用同一 Skill 口径。

### 6.4 生成并确认阵容

用户要求为某场比赛生成守备优先阵容。LLM 读取阵容 reference，依次取得比赛、球员和近期分析，生成候选 JSON，先调用 `lineup validate`。未经用户确认不得调用 `lineup accept`。

### 6.5 处理不支持的请求

用户要求“列出张三所有自训报告”，但当前 CLI 不提供 `report list`。LLM 必须明确说明当前能力缺口，不得虚构命令，也不得绕过 CLI 查询数据库。

## 7. 产品设计原则

### 7.1 单入口、按需展开

首版采用一个 Skill 入口覆盖全部 Bastion 球队管理任务。Skill 的 metadata 负责触发，正文只保留通用决策流程；命令细节按领域拆分到 references。

选择单 Skill 而不是多个平级领域 Skill，原因是大量真实请求会跨球员、比赛、分析和阵容。多个相近 description 会造成触发竞争、重复加载和工作流割裂。

只有在后续评测证明单 Skill 的 reference 选择持续失败，或某一领域需要完全不同的权限和流程时，才拆分独立 Skill。

### 7.2 权威事实只来自 CLI

- 数据库中的球队事实必须通过 gocli 读取。
- LLM 推断必须标记为推断，不能伪装成 CLI 事实。
- CLI 返回业务错误时不得用常识覆盖。
- Skill 可以解释工作流，不能复制并取代领域服务校验。

### 7.3 先读、再变更、后验证

任何写操作默认遵循：

```text
识别目标资源
  → 读取当前状态或依赖实体
  → 构造变更及影响摘要
  → 通过审批策略
  → 执行写操作
  → 重新读取权威状态
  → 向用户报告结果
```

### 7.4 Tool 是安全边界

Skill 中写明“不要做”只能改善模型行为，不能作为安全保证。下列约束必须由 Runtime Tool 强制实施：

- 可执行文件固定；
- 命令路径 allowlist；
- 参数数组执行，`shell: false`；
- DB 路径限制；
- JSON 输入与输出校验；
- 风险分类和审批；
- 超时、锁和取消；
- 主 Agent / 子 Agent capability；
- 调用记录和写后验证状态。

## 8. Skill 信息架构

### 8.1 目录

Skill 作为 Runtime 自带资源随代码版本发布：

```text
runtime/
└── skills/
    └── manage-bastion-team/
        ├── SKILL.md
        └── references/
            ├── protocol-and-safety.md
            ├── players-and-reports.md
            ├── games-and-analysis.md
            ├── lineups.md
            └── drills.md
```

首版不需要 `assets/`。只有在命令目录校验无法由 Runtime 测试承担时，才增加一个最小 `scripts/` 校验脚本。

### 8.2 Metadata

建议 frontmatter：

```yaml
---
name: manage-bastion-team
description: Use Bastion's authoritative baseball CLI through the bastion_cli tool to query or change players, training reports, games, performance analysis, lineups, drill recommendations, reviews, and approved training. Use for natural-language baseball team management tasks that need Bastion data, validation, analysis, or persistence.
---
```

要求：

- `name` 与目录名一致，使用小写字母和连字符；
- description 同时说明能力和触发场景；
- description 使用用户领域语言，不要求用户说出 “gocli” 或命令名；
- 不在 metadata 中罗列具体命令和 schema；
- 不为通用编程、修改 CLI 源码、讨论棒球常识等任务触发。

### 8.3 `SKILL.md` 正文

正文目标不超过 200 行，使用祈使式，必须包含：

1. 将 gocli 视为球队权威事实入口；
2. 根据任务主题选择并读取一个或多个 references；
3. 只使用 `bastion_cli` Tool，不使用 shell 或 SQLite；
4. 使用默认 JSON envelope，不请求 text/TOML；
5. 查询参数用 flags，复杂写入通过 Tool 的 `input` 字段传递；
6. 不猜测 ID、球员名、日期范围、枚举或缺失事实；
7. 写前读取依赖，写后读取验证；
8. 区分 CLI 错误类型并禁止原样重试；
9. 明确能力缺口，不发明命令；
10. 最终回答区分已读取事实、模型建议和已执行变更。

正文只保留跨领域稳定规则，不复制 references 中的字段表。

### 8.4 References 职责

#### `protocol-and-safety.md`

在首次调用、写操作、错误处理或不确定协议时读取，包含：

- `bastion_cli` Tool 参数和结果结构；
- JSON success/error envelope；
- 查询 flags 与 JSON input 的边界；
- 风险级别、审批规则和写后验证规则；
- 通用错误恢复决策表；
- CLI 不可用、超时、取消和未知命令处理。

#### `players-and-reports.md`

处理名单、球员详情和自训报告时读取，包含：

- `player add/read/list`；
- `report write/read`；
- 最小输入字段、合法枚举与示例；
- “先确认球员存在”等领域工作流；
- 当前没有 `report list` 的明确限制。

#### `games-and-analysis.md`

处理比赛、比赛事件、比分、单场及跨周期分析时读取，包含：

- `game write/create/lineup add/event write/score set/read/list`；
- `game analysis generate/read/list`；
- `person analysis read`；
- 完整写入与分步写入的选择原则；
- 事实事件结构和分析前置条件；
- 生成分析属于会写入派生结果的计算操作。

#### `lineups.md`

处理候选阵容时读取，包含：

- `lineup validate/write/read/list/accept/reject`；
- 生成候选前的事实收集清单；
- validate → write → user choice → accept/reject 流程；
- 保存候选与接受正式阵容的风险区别；
- CLI 校验失败后的定向修正方式。

#### `drills.md`

处理训练视频推荐、审核和正式训练时读取，包含：

- `drill recommend write/list`；
- `drill review approve/reject`；
- `drill training read/list`；
- 推荐者、教练和审核动作的身份边界；
- approve/reject 必须基于明确审核意图。

### 8.5 Reference 编写要求

- 命令示例统一基于当前 JSON 协议；
- 不使用已废弃的长 JSON flag；
- 每个写命令最多保留一个最小合法示例；
- 列出关键枚举，但大规模字段说明可链接到仓库内权威 CLI PRD；
- 超过 100 行的 reference 在顶部提供目录；
- 相同规则只在一个文件中定义，其他文件通过链接引用；
- reference 不引用 Skill 目录外不稳定的绝对路径；
- 所有示例必须能被自动化测试或 fixture 验证。

## 9. Runtime 集成

### 9.1 Skill 加载

`main.ts` 创建服务时，通过 `resourceLoaderOptions.additionalSkillPaths` 显式加载：

```text
<repo>/runtime/skills/manage-bastion-team
```

不将内置 Skill 安装到用户的 `~/.bastion/agent/skills`，原因是：

- 内置 Skill 应与 Runtime 和 CLI 代码版本一致；
- 不污染用户目录；
- `/new`、`/resume`、`/fork` 重建 Session 后仍可确定性加载；
- 开发、测试和发布使用同一份仓库资源。

加载失败或 Skill 校验异常必须作为 Runtime 启动诊断展示，不得静默忽略。

### 9.2 主 Agent 与子 Agent

- 主 Agent 默认可见 `manage-bastion-team`。
- 子 Agent 只有在 tool allowlist 包含 `bastion_cli` 时才注入该 Skill。
- 只读子 Agent 即使加载 Skill，也只能调用只读和被允许的 compute 操作。
- Skill 内容不得向子 Agent 隐式授予写权限。
- 多个子 Agent 可并行调用只读命令；写锁和资源冲突由 Runtime 统一管理。

### 9.3 结构化 Tool

Skill 面向的 Tool 名称固定为 `bastion_cli`。建议参数：

```ts
interface BastionCliParams {
  args: string[];         // 子命令和查询 flags，不包含全局协议参数
  input?: unknown;        // 需要结构化输入时由 Tool 通过 stdin 传递
}
```

Tool 必须：

- 固定执行仓库内 `out/bastion`；
- 数据库路径由 Runtime 配置，默认 `<repo>/bastion.db`，模型不能指定；
- 超时由 Runtime 配置，默认 30000ms，模型不能指定；
- 自动附加或强制使用 JSON 输出；
- 将 `input` 序列化后通过 stdin 或 0600 临时文件传递；
- 不允许模型自行添加 `--input` 的任意文件路径；
- 精确匹配命令路径和合法 flags；
- 返回 parsed envelope、stdout、stderr、exit code 和错误类别；
- 对未知命令返回 `UNCLASSIFIED_COMMAND`，不回退到 shell；
- 将执行风险、审批状态、锁等待和验证状态写入 trace。

### 9.4 命令能力与风险

| 命令 | 语义 | Tool 锁 | 默认审批 |
| --- | --- | --- | --- |
| `player read/list` | 权威读取 | DB read | 无 |
| `report read` | 权威读取 | DB read | 无 |
| `game read/list` | 权威读取 | DB read | 无 |
| `game analysis read/list` | 权威读取 | DB read | 无 |
| `lineup validate/read/list` | 校验或读取 | DB read | 无 |
| `drill recommend list` | 权威读取 | DB read | 无 |
| `drill training read/list` | 权威读取 | DB read | 无 |
| `person analysis read` | 权威读取/计算 | DB read | 无 |
| `game analysis generate` | 生成并保存派生结果 | DB write | 无，但必须记录副作用 |
| `lineup write` | 保存候选草稿 | DB write | 必须确认 |
| `drill recommend write` | 保存待审核推荐 | DB write | 必须确认 |
| `player add` | 权威事实写入 | DB write | 必须确认 |
| `report write` | 权威事实写入 | DB write | 必须确认 |
| `game write/create/lineup add/event write/score set` | 权威比赛事实写入 | DB write | 必须确认 |
| `lineup accept/reject` | 改变候选状态或正式阵容 | DB write | 必须确认 |
| `drill review approve/reject` | 权威审核决定 | DB write | 必须确认 |

首版除 `game analysis generate` 外，所有业务写操作均进入 Runtime Approval 流程。当前纵向切片使用与本次 Tool 参数绑定的即时 TUI 确认，不跨调用复用；后续 Approval Manager 再升级为持久化参数 hash 令牌。

## 10. LLM 标准工作流

### 10.1 意图识别

先将请求分为：

- 权威事实查询；
- 计算或校验；
- 候选草稿；
- 权威事实变更；
- 纯建议，不需要访问 Bastion 数据。

只有前四类需要调用 gocli。纯棒球常识问答不应为了“看起来有依据”而无目的查询数据库。

### 10.2 信息完备性检查

调用前检查：

- 目标实体是否明确；
- 名称或 ID 是否来自用户或权威查询；
- 相对日期是否已转换为明确日期；
- 日期范围是否完整；
- 写入 payload 的必填事实是否齐全；
- 用户是在预览、保存还是正式确认；
- 是否需要先读取现状避免重复或冲突。

缺少会实质改变结果的信息时向用户提问。能够从只读 CLI 唯一确定的信息，应先查询而不是让用户重复提供。

### 10.3 Reference 路由

| 用户意图 | 必读 reference |
| --- | --- |
| 球员、名单、自训 | `players-and-reports.md` |
| 比赛、事件、比分、表现 | `games-and-analysis.md` |
| 候选或正式阵容 | `lineups.md` |
| 训练推荐、审核、正式训练 | `drills.md` |
| 首次 Tool 调用、写入、报错、协议不确定 | `protocol-and-safety.md` |

跨领域任务只加载所需的多个 reference，不预先读取全部文件。

### 10.4 Tool 调用

- 使用命令 token 数组，不拼接 shell 字符串；
- 查询条件放入 `args`；
- 写入 payload 放入 `input`；
- 不手动指定 text/TOML 输出；
- 不在对话或日志中暴露临时文件路径；
- Tool 返回前不宣称操作已成功。

### 10.5 结果处理

成功条件必须同时满足：

- 进程按 Tool 协议成功；
- 输出是合法 JSON envelope；
- `ok` 为 `true`；
- `data` 满足对应命令的最小结果预期。

对 `ok:false`：

- `parse_error`、`unknown_field`、`missing_required`、`invalid_type`、`invalid_enum`、`invalid_value`：根据结构化错误修正输入；没有新信息时不得原样重试；
- `not_found`：检查名称或 ID，必要时用 list/read 消歧或询问用户；
- `conflict`：读取当前状态并向用户解释，不自动覆盖；
- `storage_error`、`internal_error`：有限重试或报告失败，不伪造结果；
- `UNCLASSIFIED_COMMAND`：视为 Skill/Tool 版本不匹配，停止并报告；
- 超时或取消：保持操作结果未知，先读取目标资源判断是否已生效。

### 10.6 写后验证

每个写命令必须映射验证命令：

| 写操作 | 验证操作 |
| --- | --- |
| `player add` | `player read` |
| `report write` | `report read` |
| `game write/create/lineup add/event write/score set` | `game read` |
| `game analysis generate` | `game analysis read` |
| `lineup write/accept/reject` | `lineup read`，accept 后追加 `game read` |
| `drill recommend write` | `drill recommend list` 并按返回 id/条件定位 |
| `drill review approve/reject` | `drill recommend list`；approve 后可追加 `drill training read` |

若写命令成功而验证失败，最终状态为“写入结果待确认”，不得直接向用户宣称完全成功。

## 11. 功能需求

### FR-1 Skill 发现与触发（P0）

- Runtime 必须确定性加载内置 Skill。
- Skill metadata 必须出现在模型的 available skills 中。
- 用户不需要显式说“使用 Skill”或“调用 gocli”。
- 用户可通过 `/skill:manage-bastion-team` 显式调用。
- 非球队管理任务不得被 description 宽泛匹配。

### FR-2 渐进式知识加载（P0）

- 首轮只暴露 Skill name、description 和 location。
- 匹配任务后读取完整 `SKILL.md`。
- 只在需要时读取对应 reference。
- references 的选择和读取必须出现在 trace 中。

### FR-3 命令与 schema 准确性（P0）

- Skill 只描述当前 CLI 已实现命令。
- 每个写命令提供最小合法 JSON 示例。
- 每个查询命令列出合法定位或过滤 flags。
- 不支持能力必须显式标注。
- CLI 命令或输入不兼容变更必须触发 Skill 校验失败。

### FR-4 结构化执行（P0）

- 所有模型发起的 gocli 调用必须经过 `bastion_cli`。
- Tool 不使用 shell。
- Tool 拒绝未知命令、未知 flags、任意 executable 和越界 DB 路径。
- Tool 解析统一 JSON envelope 并返回结构化错误。

### FR-5 读写风险与审批（P0）

- Tool 根据命令路径而不是模型描述判断风险。
- 读取自动执行。
- 权威写操作必须获得与参数绑定的审批。
- 模型不能通过改名、shell 或直接 DB 访问绕过审批。
- 取消审批不得执行命令。

### FR-6 写后验证（P0）

- 成功写入后自动或由 LLM 按 Skill 调用验证命令。
- Runtime trace 记录验证命令与结果。
- 未验证或验证不一致时不得返回确定成功。

### FR-7 错误恢复（P0）

- LLM 根据错误 code 选择修正、查询、询问、重试或停止。
- 同一参数的校验错误不得自动重试。
- 未知命令视为版本漂移。
- 超时后的状态通过权威读取判断。

### FR-8 Multi-Agent 一致性（P1）

- 有 Tool 权限的子 Agent 使用同版本 Skill。
- 子 Agent 只加载任务相关 reference。
- Runtime 在 Tool 层实施 capability 和资源锁。
- 子 Agent 结果必须携带使用的命令、权威实体引用和错误状态，便于主 Agent 汇总。

### FR-9 可观测性（P1）

每次领域任务至少记录：

- Skill 是否触发及触发方式；
- 读取的 references；
- Tool 命令路径，不记录敏感 payload 明文；
- 风险分类与审批结果；
- CLI error code；
- 重试次数及参数是否变化；
- 写后验证结果；
- 总 tool call 和 token 使用。

### FR-10 可维护性（P1）

- Skill 与 Runtime 代码一起版本控制。
- CI 校验 frontmatter、目录名、reference 链接和最大行数。
- CI 构建 gocli 后验证所有登记命令路径。
- CI 对每个写命令至少执行一个临时数据库 fixture。
- 变更 CLI 命令、flags、JSON schema 或风险语义时，PR 检查项必须要求同步 Skill。

## 12. 验收场景

| 编号 | 输入/条件 | 预期行为 |
| --- | --- | --- |
| AC-01 | “队里有哪些球员？” | 自动触发 Skill，读取球员 reference，调用 `player list` |
| AC-02 | “解释 Go 里 Kong 的用法” | 不触发球队管理 Skill |
| AC-03 | “读取张三 6 月 24 日训练记录” | 调用 `report read`，不调用写工具 |
| AC-04 | “列出张三所有训练记录” | 明确当前无 `report list`，不虚构命令、不查 SQLite |
| AC-05 | 用户提供完整自训内容并确认登记 | 写前确认球员，审批后 `report write`，再 `report read` |
| AC-06 | 自训 payload 拼错字段 | 根据 `unknown_field` 修改字段，不原样重试 |
| AC-07 | 查询不存在球员 | 返回 not found，必要时 list 消歧，不编造资料 |
| AC-08 | “先看看阵容是否可行，不要保存” | 只调用 `lineup validate` |
| AC-09 | “把候选 3 设为正式阵容” | 读取候选，展示影响，审批后 accept，再读 lineup 和 game |
| AC-10 | 用户取消正式阵容审批 | 不执行 `lineup accept` |
| AC-11 | `game analysis generate` 成功 | 标记发生派生数据写入，并用 analysis read 验证 |
| AC-12 | CLI 超时 | 不确定是否写入时先读目标资源，不立即重放写操作 |
| AC-13 | Skill 写了 Tool 未登记命令 | Tool 拒绝并返回版本不匹配，不回退 bash |
| AC-14 | 只读子 Agent 尝试 `report write` | Tool capability 拒绝，Skill 不能越权 |
| AC-15 | 三名球员跨期比较 | 可并行只读；各任务使用一致 reference 和日期范围 |
| AC-16 | Runtime `/new` 或 `/resume` | 新 Session 仍加载同版本内置 Skill |
| AC-17 | `out/bastion` 不存在 | Runtime 给出可操作诊断，不要求 LLM 猜测替代路径 |
| AC-18 | 修改 CLI 命令但未更新 Skill | CI 失败并定位不一致项 |

## 13. 评测方案

### 13.1 离线任务集

建立不少于 40 个任务：

- 20 个单领域正常任务；
- 8 个跨领域组合任务；
- 5 个缺少关键信息的任务；
- 5 个 CLI 错误恢复任务；
- 5 个不应触发 Skill 的负样本；
- 3 个审批取消或权限不足任务。

每个任务记录：

- 是否应触发；
- 期望读取的 references；
- 允许的命令集合；
- 禁止命令；
- 是否需要审批；
- 写后验证命令；
- 最终结果中的必要事实。

### 13.2 自动检查

- 使用临时 SQLite 数据库，禁止接触开发者真实 `bastion.db`；
- 固定 fixture，比较 Tool 调用 trace 而不只比较自然语言答案；
- 校验不存在 shell 和直接 SQLite 调用；
- 校验写入审批事件和验证调用；
- 对同一任务至少覆盖中文自然表达、简写和命令式表达。

### 13.3 人工检查

重点检查：

- 模型是否问了真正必要的问题；
- 是否清楚区分事实、建议和变更；
- 审批摘要是否让用户理解影响；
- 能力缺口是否诚实而有帮助；
- references 是否过度加载。

## 14. 发布阶段

### Phase 0：协议确认

- 冻结 Tool 名称和参数结构；
- 确认命令风险矩阵；
- 确认 Runtime 内置 Skill 路径；
- 为当前 CLI 建立命令清单测试。

### Phase 1：只读 MVP

- 实现 Skill、五个 references 和 Runtime 加载；
- `bastion_cli` 首先开放全部只读命令与 `lineup validate`；
- 完成触发、命令正确性和错误恢复评测。

### Phase 2：受控写入

- 开放 compute、draft write 和 authoritative write；
- 接入审批、DB 写锁、写后验证与 trace；
- 完成取消、超时、冲突和版本漂移测试。

### Phase 3：Multi-Agent

- 向有权限的子 Agent 注入 Skill；
- 验证并行只读、写冲突控制和主 Agent 汇总；
- 根据 trace 优化 reference 路由和 token 消耗。

## 15. 依赖与风险

### 15.1 依赖

- gocli 保持默认 JSON envelope；
- Runtime 实现或接入结构化 `bastion_cli` Tool；
- Runtime Approval Manager 能提供参数绑定审批；
- Multi-Agent 场景能按 capability 裁剪 Tool；
- 测试环境可以构建 `out/bastion` 并使用临时数据库。

### 15.2 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Skill description 过宽 | 非领域任务误触发 | 使用球队管理实体和动作描述；加入负样本 |
| Skill description 过窄 | 自然语言请求不触发 | 不要求出现 CLI 名；扩充中文表达评测 |
| reference 过大 | 上下文浪费 | 按领域拆分；正文保留路由表 |
| 文档与 CLI 漂移 | 命令调用失败 | 构建后检查命令路径和 fixture |
| 提示词被当作权限 | 越权写入 | Tool allowlist、capability 和审批强制执行 |
| 写成功但响应丢失 | 重试导致重复 | 超时先读后判定；后续补充幂等 key |
| 多 Agent 口径不同 | 汇总矛盾 | 同版本 Skill；任务契约声明日期和实体 |
| CLI 能力缺口诱发绕行 | 直接查库或造命令 | Skill 明示限制；Tool 禁止回退 shell |

## 16. 待确认决策

以下默认值已用于本 PRD，进入实现前可调整：

1. **Skill 数量**：默认单 Skill + 五个 references，不按 CLI 一级命令拆分。
2. **内置路径**：默认放在 `runtime/skills/`，由 Runtime 显式加载，不放 `.pi/skills` 或用户目录。
3. **业务写审批**：除 `game analysis generate` 外全部通过即时 TUI 确认；非交互模式拒绝写入。
4. **主 Agent 工具入口**：默认统一使用 `bastion_cli`，不让 Skill 直接调用通用 `bash`。
5. **命令真源**：CLI 实现与自动测试是最终真源，Skill references 是面向模型的操作视图。
6. **数据库配置**：模型接口不暴露数据库路径；Runtime 使用 `BASTION_DB_PATH`，默认 `<repo>/bastion.db`。

## 17. Definition of Done

满足以下条件才视为完成：

- `manage-bastion-team` Skill 和全部 references 已实现并通过格式校验；
- Runtime 在主会话重建后仍能加载 Skill；
- 结构化 `bastion_cli` 覆盖当前全部登记命令；
- 风险矩阵、审批、锁和 Tool allowlist 生效；
- 所有写命令均有写后验证映射；
- 离线任务集达到成功指标；
- CI 能发现 CLI 与 Skill 的命令漂移；
- 不存在通过 shell 或直接 SQLite 绕过领域 Tool 的测试路径；
- 用户能从最终回答中分辨读取到的事实、模型建议和实际执行的变更。
