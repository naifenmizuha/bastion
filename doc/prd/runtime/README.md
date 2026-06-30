# Agent Runtime PRD

本目录描述建立在 Pi Agent 基础智能体循环之上的 Agent Runtime。Runtime 负责记忆、上下文、子 Agent、工具调用、任务恢复、审批和可观测性;棒球领域事实、规则、校验和持久化继续由 Bastion CLI 提供。

## 文档

- [Agent Runtime 需求](agent-runtime.md):总体架构、核心模块、数据模型、运行流程与验收标准。
- [bastion_cli 命令输入契约与错误回传修复需求](fix-bastion-cli-required-input.md):为全部结构化输入命令提供统一契约，并在 `INVALID_INPUT.details` 中返回对应命令契约。
