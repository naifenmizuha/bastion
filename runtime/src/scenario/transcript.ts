interface MessageLike {
  role?: string;
  content?: unknown;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function renderTranscript(messages: readonly unknown[]): string {
  const turns: string[] = ["# Bastion Runtime 标准化测试对话"];
  let userNumber = 0;
  let pendingAssistant = "";

  const flushAssistant = () => {
    if (!pendingAssistant) return;
    turns.push(`## 助手 ${userNumber}\n\n${pendingAssistant}`);
    pendingAssistant = "";
  };

  for (const raw of messages) {
    const message = raw as MessageLike;
    const text = textContent(message.content);
    if (!text) continue;
    if (message.role === "user") {
      flushAssistant();
      userNumber += 1;
      turns.push(`## 用户 ${userNumber}\n\n${text}`);
    } else if (message.role === "assistant") {
      // Tool-using turns can contain several assistant messages. The last text
      // before the next user message is the turn's final user-facing answer.
      pendingAssistant = text;
    }
  }
  flushAssistant();

  return `${turns.join("\n\n")}\n`;
}
