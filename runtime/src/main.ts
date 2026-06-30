#!/usr/bin/env node

import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Markdown } from "@earendil-works/pi-tui";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import {
  type CreateAgentSessionRuntimeFactory,
  type ExtensionFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getMarkdownTheme,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createBastionCliExtension } from "./bastion-cli/extension.ts";

const bastionHeaderExtension: ExtensionFactory = (pi) => {
  pi.on("session_start", (_event, context) => {
    if (context.mode !== "tui") return;

    context.ui.setHeader(
      (_tui, theme) =>
        new Markdown(
          "**Bastion** — your next baseball team manager!",
          0,
          0,
          {
            ...getMarkdownTheme(),
            bold: (text) => theme.bold(theme.fg("accent", text)),
          },
          {
            color: (text) => theme.fg("dim", text),
          },
        ),
    );
  });
};

export async function main(): Promise<void> {
  // main.ts 位于 runtime/src/，向上两级就是 Bastion 仓库根目录。
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const skillPath = join(
    repoRoot,
    "runtime",
    "skills",
    "manage-bastion-team",
  );
  const databasePath = resolve(
    repoRoot,
    process.env.BASTION_DB_PATH ?? "bastion.db",
  );
  const timeoutValue = process.env.BASTION_CLI_TIMEOUT_MS ?? "30000";
  const timeoutMs = Number(timeoutValue);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `BASTION_CLI_TIMEOUT_MS must be a positive integer, received ${JSON.stringify(timeoutValue)}`,
    );
  }

  // Bastion 使用独立的配置根目录，不读取或写入 Pi 默认的 ~/.pi/agent。
  // 同时设置 SDK 官方环境变量，覆盖仍通过全局路径助手取目录的 TUI 功能。
  const agentDir = join(homedir(), ".bastion", "agent");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const bastionCliExtension = createBastionCliExtension({
    executablePath: join(repoRoot, "out", "bastion"),
    databasePath,
    timeoutMs,
  });

  // AgentSessionRuntime 在 /new、/resume、/fork 等操作后需要重建会话。
  // 因此这里提供工厂函数，而不是只创建一次 AgentSession。
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    agentDir,
    sessionManager,
    sessionStartEvent,
  }) => {
    // 创建当前工作目录对应的 Bastion 服务。
    // 认证、模型、设置、skills 和 extensions 均从独立的 agentDir 加载。
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions: {
        additionalSkillPaths: [skillPath],
        extensionFactories: [bastionHeaderExtension, bastionCliExtension],
      },
    });

    // 使用上面的服务和指定的 SessionManager 创建真正执行 Agent Loop 的会话。
    // diagnostics 会交给 InteractiveMode，由 Pi 原生 TUI 统一展示启动警告。
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        // 球队管理会话只暴露权威只读文件能力和结构化领域 CLI。
        // 不注册 bash/edit/write，避免绕过 bastion_cli 的命令策略和审批。
        tools: ["read", "bastion_cli"],
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  // 将根目录作为 cwd，确保 Skill references 使用稳定的项目路径。
  const cwd = repoRoot;

  // SessionManager.create() 使用持久化会话机制；其默认目录也会通过上面的
  // PI_CODING_AGENT_DIR 落到 ~/.bastion/agent/sessions。
  const runtimeHost = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: SessionManager.create(cwd),
  });

  // InteractiveMode 是 Pi SDK 暴露的完整原生 TUI，包括编辑器、历史记录和命令。
  const interactiveMode = new InteractiveMode(runtimeHost);

  try {
    await interactiveMode.run();
  } finally {
    // 无论正常退出还是发生异常，都释放当前 AgentSession 及扩展资源。
    await runtimeHost.dispose();
  }
}

// 将启动错误输出到 stderr，同时保留 finally 中的清理机会和正常的异步堆栈。
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Failed to start Bastion Agent Runtime:\n${message}`);
  process.exitCode = 1;
});
