import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

export const BASTION_INTRODUCTION_INSTRUCTION_TYPE =
  "bastion-introduction-instruction";
export const BASTION_HELP_OUTPUT_TYPE = "bastion-help-output";

const MAX_INTRODUCTION_REQUEST_LENGTH = 80;

const DEVELOPMENT_CONTEXT =
  /(?:代码|实现|运行时|测试|提示词|工具调用|\bruntime\b|\bskill\b|\bprompt\b|\btest(?:ing)?\b|\bcode\b|\bimplement(?:ation)?\b)/iu;

const INTRODUCTION_PATTERNS = [
  /^(?:你|bastion)?有(?:什么|哪些)功能$/u,
  /^(?:你|bastion)?(?:能|可以|会)(?:帮我)?(?:做|干)(?:什么|些啥)$/u,
  /^(?:怎么|如何)(?:使用|用)(?:你|bastion)?$/u,
  /^(?:怎么|如何)开始$/u,
  /^(?:新手|入门)(?:介绍|指南|帮助)$/u,
  /^(?:使用)?帮助$/u,
  /^what can you do$/u,
  /^what are your capabilities$/u,
  /^how (?:do|can) i use (?:you|bastion)$/u,
  /^(?:getting started|beginner(?:'s)? guide)$/u,
];

export const BASTION_INTRODUCTION_INSTRUCTION = `用户正在询问 Bastion 的功能或使用方式。请用中文简短介绍可协助的用户任务：球队与球员管理、比赛记录与复盘、阵容制定与校验、训练建议与审核、棒球规则查询。不要披露任何内部工具、Skill、CLI、数据库或实现机制，不要读取球队数据或调用工具。最后给出三个可直接尝试的示例问题。`;

export const BASTION_HELP_TEXT = `Bastion 可以协助你管理球队和球员、记录与复盘比赛、制定并校验阵容、整理训练建议，以及查询棒球规则。

你可以直接试试：
- 我们队现在有哪些球员？
- 帮我复盘最近一场比赛。
- 根据现有信息给出下一次训练重点。`;

function normalizePrompt(prompt: string): string {
  return prompt
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[?？!！。.,，]+$/u, "")
    .trim();
}

export function isIntroductionRequest(
  prompt: string,
  hasImages = false,
): boolean {
  if (hasImages) return false;
  const normalized = normalizePrompt(prompt);
  if (
    !normalized ||
    normalized.startsWith("/") ||
    Array.from(normalized).length > MAX_INTRODUCTION_REQUEST_LENGTH ||
    DEVELOPMENT_CONTEXT.test(normalized)
  ) {
    return false;
  }
  return INTRODUCTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function createOnboardingExtension(): ExtensionFactory {
  return (pi) => {
    pi.on("before_agent_start", (event) => {
      if (!isIntroductionRequest(event.prompt, Boolean(event.images?.length))) {
        return;
      }
      return {
        message: {
          customType: BASTION_INTRODUCTION_INSTRUCTION_TYPE,
          content: BASTION_INTRODUCTION_INSTRUCTION,
          display: false,
          details: { version: 1 },
        },
      };
    });

    pi.registerCommand("help", {
      description: "Show a concise introduction to Bastion",
      handler: async (args, context) => {
        if (args.trim()) {
          context.ui.notify("Usage: /help", "warning");
          return;
        }
        pi.sendMessage(
          {
            customType: BASTION_HELP_OUTPUT_TYPE,
            content: BASTION_HELP_TEXT,
            display: true,
            details: { version: 1 },
          },
          { triggerTurn: false },
        );
      },
    });
  };
}
