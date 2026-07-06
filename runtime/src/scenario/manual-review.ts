interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  arguments?: unknown;
}

interface MessageLike {
  role?: string;
  content?: unknown;
  toolName?: string;
  details?: unknown;
  isError?: boolean;
}

export interface ManualReviewMetadata {
  caseId: string;
  title: string;
  repetition: number;
}

function blocks(content: unknown): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content)
    ? content.filter(
        (item): item is ContentBlock =>
          typeof item === "object" && item !== null,
      )
    : [];
}

function text(content: unknown): string {
  return blocks(content)
    .filter(
      (block): block is ContentBlock & { text: string } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function pretty(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2) ?? String(value);
}

function details(label: string, value: unknown): string {
  return `<details>
<summary>${label}</summary>

<pre>${escapeHtml(pretty(value))}</pre>
</details>`;
}

function renderTurn(messages: MessageLike[], turn: number): string {
  const output: string[] = [`## 第 ${turn} 轮`];
  const user = messages.find((message) => message.role === "user");
  output.push(`### 用户输入\n\n${text(user?.content) || "（无文本）"}`);

  let finalAssistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message?.role === "assistant" &&
      Boolean(text(message.content))
    ) {
      finalAssistantIndex = index;
      break;
    }
  }
  let assistantStep = 0;
  let toolCall = 0;
  let toolResult = 0;

  messages.forEach((message, index) => {
    if (message.role === "assistant") {
      const assistantText = text(message.content);
      if (assistantText) {
        assistantStep += 1;
        output.push(
          index === finalAssistantIndex
            ? `### 助手最终回答\n\n${assistantText}`
            : `### 助手过程 ${assistantStep}\n\n${assistantText}`,
        );
      }
      for (const block of blocks(message.content)) {
        if (block.type !== "toolCall" || typeof block.name !== "string") continue;
        toolCall += 1;
        output.push(
          `### 工具调用 ${toolCall}：\`${block.name}\`\n\n${details("调用参数", block.arguments ?? {})}`,
        );
      }
    } else if (message.role === "toolResult") {
      toolResult += 1;
      const name = message.toolName ?? "unknown";
      const resultText = text(message.content);
      output.push(
        `### 工具结果 ${toolResult}：\`${name}\`${message.isError ? "（错误）" : ""}\n\n${details("模型可见结果", resultText || "（无文本结果）")}${
          message.details !== undefined
            ? `\n\n${details("结构化详情", message.details)}`
            : ""
        }`,
      );
    }
  });

  return output.join("\n\n");
}

export function renderManualReview(
  messages: readonly unknown[],
  metadata: ManualReviewMetadata,
): string {
  const turns: MessageLike[][] = [];
  let current: MessageLike[] | undefined;
  for (const raw of messages) {
    const message = raw as MessageLike;
    if (message.role === "user") {
      current = [message];
      turns.push(current);
    } else if (
      current &&
      (message.role === "assistant" || message.role === "toolResult")
    ) {
      current.push(message);
    }
  }

  return `# 人工评审：${metadata.title} #${metadata.repetition}

- 用例 ID：\`${metadata.caseId}\`
- 运行序号：${metadata.repetition}
- 说明：以下内容按实际发生顺序保留用户输入、助手过程、工具调用和工具结果。

## 人工评价（请填写）

请只修改本节字段；保留字段名称，便于后续 Agent 批量读取。

- 结论：未评价
- 评分（0–100）：
- 问题标签：

### 评价与理由

<!-- 在这里填写评价；可多行。 -->

### 改进建议

<!-- 在这里填写建议；可多行。 -->

---

## 完整运行过程

${turns.length ? turns.map((turn, index) => renderTurn(turn, index + 1)).join("\n\n---\n\n") : "（没有可还原的对话消息）"}
`;
}

export function sessionMessagesFromJsonl(value: string): unknown[] {
  return value
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const record = JSON.parse(line) as {
        type?: string;
        message?: unknown;
      };
      return record.type === "message" && record.message
        ? [record.message]
        : [];
    });
}
