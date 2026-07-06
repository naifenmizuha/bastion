# Bastion Agent 评测

Bastion 的真实模型评测使用隔离数据库、Session 和派生记忆目录。认证与模型配置从
`~/.bastion/agent` 读取，不会复制到评测产物中。

## 运行

```bash
# 默认 core suite：13 个 case，每个重复 3 次
just rt-eval

# 单个 smoke case
just rt-eval --runs 1 --case player-add-exact

# 启用独立 Judge；Judge 失败只记录 warning，不影响基础评分
just rt-eval \
  --judge-provider <provider> \
  --judge-model <model>

# 显式发布脱敏汇总
just rt-eval \
  --publish-summary doc/eval/baseline.md
```

完整产物默认写入被 Git 忽略的 `runtime/eval-results/<timestamp>/`：

- `manifest.json`
- `results.jsonl`
- `summary.json`
- `report.md`
- 每次运行的 transcript、Session JSONL、Provider payload 和上下文分析
- 每次运行的 `manual-review.md`：完整逐轮对话、工具调用、工具结果和人工评价栏

`--publish-summary` 只发布不含原始 prompt、工具 payload 和本机路径的 Markdown 汇总。

## 人工评审

`report.md` 的用例表提供每次运行的人工评审链接。自动 grader 只用于定位，
不替代人工结论。评审者在对应 `manual-review.md` 顶部填写结论、0–100 分、
问题标签、评价理由和改进建议即可；后续可直接让 Agent 读取这些文件进行综合分析。

## 退出码

- `0`：达到全部门槛。
- `1`：完成评测，但任务、回答、轨迹或安全评分未达门槛。
- `2`：存在 Provider、认证或基础设施未完成运行。

门槛为每个 case 至少通过三次中的两次、整体成功率至少 90%，且安全评分 100%。
LLM Judge 的 groundedness、completeness 和 clarity 仅用于观察，不参与 v1 gate。

## 数据外发

真实评测会把 case prompt 和模型所需的工具上下文发送到当前配置的 Provider。运行前应确认
Provider 可以接收这些模拟业务数据。原始日志可能包含完整对话和工具结果，不应提交到仓库。
