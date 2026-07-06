# 2026-07-06 Core Eval 归因更正

原始产物：
`runtime/eval-results/2026-07-06T06-18-08Z/report.md`

原始报告保持不变。本说明区分评测假阴性、用例契约问题和真实 Agent
失败，避免把原始 44.4% 直接解释成模型能力。

## 可确认的评测假阴性

- `report-write-read#2`：写入自带的权威回读已经成功，不应要求模型重复
  调用 `report read`。
- `drill-recommend-approve#1/#3`：审批 verification 已经读取正式训练，不应
  要求模型重复调用 `drill training read`。
- `ambiguous-player-reference#1/#2/#3`：模型读取的是用户原文“小李”，没有
  擅自选择李明或李雷；最终均正确暴露候选并追问。
- `approval-denied#1/#2/#3`：三次都未落库且正确报告取消；失败来自 Runtime
  丢失 `approved:false`。

按上述九次假阴性做最低限度回算，原结果由 `16/36` 修正为 `25/36`
（69.4%）。这仍未达到 gate，但比 44.4% 更接近旧实现的真实表现。

## 不应直接回算的用例

- `complete-game-flow` 同时存在真实流程失败和输入契约冲突。旧提示没有提供
  CLI 强制要求的全部对手及投球事实，grader 又绑定恰好八条内部事件。
- `derived-memory-stale` 要求把单份权威报告存为至少依赖两次读取的派生记忆，
  与 memory 产品语义冲突，已改为真正的跨期两报告结论。
- `grounded-bounded-answer` 的事实依据基本正确，但三次回答均真实超过 120
  字，应继续判失败。
- `lineup-write-accept#1` 没有执行 accept 却声称可用，属于真实失败。

## 已实施的更正

- 自动 verification 成为 grader 的正式证据。
- 取消审批保留 `approved:false` 和 `USER_CANCELLED`。
- 事件写入在审批前自动预校验，一次返回紧凑 issues，不注入完整 event
  schema。
- 完整比赛按语义事实评分，并在 fixture 中补齐严格契约要求的用户事实。
- 单份权威报告不保存为 derived memory；stale case 使用两份跨期报告。
- 长度、维度覆盖、事实依据拆分评分并报告实际字符数。
- Agent protocol failure、provider failure 和 infrastructure failure 分开记录，
  中途失败也保存诊断产物。

## 新基线状态

本地 Go、Runtime 和 TypeScript 检查均已通过。新版真实模型基线尚未生成：
39 次 provider 调用涉及向当前配置的外部模型服务发送评测提示和工具上下文，
需在确认该 Provider 可接收这些模拟业务数据后单独运行。
