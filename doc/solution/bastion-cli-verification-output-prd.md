# Bastion CLI Verification 输出瘦身 PRD

- 状态：Implemented
- 版本：1.0
- 日期：2026-07-03
- 范围：`runtime/src/bastion-cli`
- 关联能力：Bastion CLI Tool、写后验证、Context Projection、Compaction

## 1. 背景

Bastion 的业务写入在主命令成功后执行权威回读，并用 `expected` 字段验证写入结果。
此前 `bastion_cli` 会把回读的完整 envelope 同时放入模型可见的 tool result。对于
比赛事件、阵容和全队分析，单次回读可能包含数千字符；同一活动轮中的后续 Provider
请求会重复携带这些内容。

标准场景的最后一次请求中，`bastion_cli` 结果与验证约占 8,189 个序列化字符，占
上下文 33.23%。其中大部分是模型判断“验证是否通过”并不需要的完整比赛和分析数据。

输入协议与写后验证承担不同职责：

- 工具 Schema、Skill reference 和 `INVALID_INPUT` contract 告诉模型应输入什么；
- verification 告诉模型写入是否经权威回读确认。

因此可以缩减 verification 的模型可见回执，同时保留完整内部审计数据。

## 2. 目标

1. 模型可见 verification 只保留验证命令、执行状态、匹配状态和期望字段。
2. 写入成功、失败和不确定状态的语义保持不变。
3. 普通读取和主写入命令的有效结果保持不变。
4. 完整回读 envelope 继续供投影、压缩、派生记忆、审计和调试使用。
5. 不改变 CLI 执行、验证策略、数据库回读次数或审批策略。

## 3. 非目标

本次不包含：

- 缩减普通 read 命令返回的权威数据；
- 修改工具输入 Schema 或 Skill 文档；
- 生成 expected/actual 字段差异；
- 减少或取消写后回读；
- 缩减 Context Projection receipt；
- 解决 Skill/reference 重复读取。

## 4. 模型可见输出契约

成功验证示例：

```json
{
  "ok": true,
  "command": ["game", "score", "set"],
  "risk": "write",
  "cli": {
    "ok": true,
    "data": {
      "game_id": 1,
      "own_score": 2,
      "opponent_score": 1
    }
  },
  "verification": [
    {
      "command": ["game", "read", "--id", "1"],
      "ok": true,
      "matched": true,
      "expected": {
        "own_score": 2,
        "opponent_score": 1
      }
    }
  ]
}
```

verification 不得包含回读的 `result` envelope。若 `matched` 为 false，输出继续包含
`expected` 和现有 `WRITE_VERIFICATION_FAILED` 错误。模型应使用 `command` 指定的
权威读取重新确认状态，不得直接重放写入。

## 5. 内部数据与安全约束

`BastionCliToolDetails.verification` 保持现有 `VerificationResult[]`：

- `args`
- `expected`
- `matched`
- 完整 `envelope`
- `exitCode`
- `stderr`

只有 `modelContent()` 的文本序列化省略完整 envelope。Session tool details、
compaction extractor、context projection、freshness guard、derived memory observation
和 dev payload 仍可使用完整结构化数据。

以下模型输入指导不得裁剪：

- `BastionCliParameters` 工具 Schema；
- Skill reference 中的命令级字段约束；
- `INVALID_INPUT` 返回的 required fields、类型、example 和 CLI contract。

## 6. 成功指标

- 模型可见 verification 中完整比赛事件、阵容和全队分析出现次数为 0。
- verification 的 command、ok、matched、expected 保留率为 100%。
- `WRITE_VERIFICATION_FAILED` 不确定状态保留率为 100%。
- Session/details 中完整 verification envelope 保留率为 100%。
- 标准场景最后请求中 `bastion_cli` 结果/验证的绝对字符数显著低于 8,189。
- 现有 CLI、projection、compaction 和 derived memory 测试全部通过。

## 7. 验收标准

1. 成功写入后，模型可见回执可判断验证通过并取得合法回读命令。
2. 验证失败后，模型可判断写入状态不确定、看到 expected，并知道应执行哪个读取。
3. 普通 read 的主 `cli` envelope 原样返回。
4. `INVALID_INPUT` contract 原样返回。
5. 测试证明大型回读字段未进入模型可见 verification，但仍存在于原始 details。
6. `just rt-scenario-test` 四轮业务成功，生成的新上下文报告可量化优化结果。
