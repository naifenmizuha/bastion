import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BASTION_HELP_OUTPUT_TYPE,
  BASTION_HELP_TEXT,
  BASTION_INTRODUCTION_INSTRUCTION,
  BASTION_INTRODUCTION_INSTRUCTION_TYPE,
  createOnboardingExtension,
  isIntroductionRequest,
} from "./extension.ts";

describe("onboarding request detection", () => {
  it("recognizes concise Chinese and English introduction requests", () => {
    for (const prompt of [
      "你有什么功能？",
      "你能帮我做什么",
      "如何开始？",
      "新手指南",
      "WHAT CAN YOU DO?",
      "How do I use Bastion?",
      "Getting started",
    ]) {
      assert.equal(isIntroductionRequest(prompt), true, prompt);
    }
  });

  it("rejects commands, images, long prompts, compound work, and development questions", () => {
    const longPrompt = `你有什么功能${"，请详细介绍".repeat(20)}`;
    for (const [prompt, hasImages = false] of [
      ["", false],
      ["/help", false],
      ["你有什么功能", true],
      [longPrompt, false],
      ["你有什么功能，然后查询球队名单", false],
      ["这个功能在 Runtime 怎么实现", false],
      ["如何测试 skill prompt", false],
      ["球员有什么功能", false],
    ] as const) {
      assert.equal(isIntroductionRequest(prompt, hasImages), false, prompt);
    }
  });
});

describe("onboarding extension", () => {
  function harness() {
    let beforeAgentStart: ((event: any) => any) | undefined;
    let helpHandler: ((args: string, context: any) => Promise<void>) | undefined;
    const sent: Array<{ message: any; options: any }> = [];
    const extension = createOnboardingExtension();
    extension({
      on(event: string, handler: (event: any) => any) {
        assert.equal(event, "before_agent_start");
        beforeAgentStart = handler;
      },
      registerCommand(name: string, options: { handler: typeof helpHandler }) {
        assert.equal(name, "help");
        helpHandler = options.handler;
      },
      sendMessage(message: any, options: any) {
        sent.push({ message, options });
      },
    } as never);
    assert.ok(beforeAgentStart);
    assert.ok(helpHandler);
    return { beforeAgentStart, helpHandler, sent };
  }

  it("injects one fixed hidden instruction only for a matching request", () => {
    const { beforeAgentStart } = harness();
    assert.equal(beforeAgentStart({ prompt: "列出球队名单" }), undefined);
    assert.deepEqual(beforeAgentStart({ prompt: "你有什么功能？" }), {
      message: {
        customType: BASTION_INTRODUCTION_INSTRUCTION_TYPE,
        content: BASTION_INTRODUCTION_INSTRUCTION,
        display: false,
        details: { version: 1 },
      },
    });
  });

  it("shows /help without triggering an agent turn", async () => {
    const { helpHandler, sent } = harness();
    await helpHandler("", { ui: { notify() {} } });
    assert.deepEqual(sent, [{
      message: {
        customType: BASTION_HELP_OUTPUT_TYPE,
        content: BASTION_HELP_TEXT,
        display: true,
        details: { version: 1 },
      },
      options: { triggerTurn: false },
    }]);
  });

  it("reports /help argument misuse without sending a message", async () => {
    const { helpHandler, sent } = harness();
    const notifications: unknown[][] = [];
    await helpHandler("extra", {
      ui: { notify: (...args: unknown[]) => notifications.push(args) },
    });
    assert.deepEqual(sent, []);
    assert.deepEqual(notifications, [["Usage: /help", "warning"]]);
  });
});
