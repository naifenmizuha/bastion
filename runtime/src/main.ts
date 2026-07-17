#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  InteractiveMode,
  runPrintMode,
  runRpcMode,
  type AgentSessionRuntime,
} from "@earendil-works/pi-coding-agent";
import {
  RUNTIME_CLI_HELP,
  parseRuntimeCliArgs,
  runtimeVersion,
} from "./cli.ts";
import {
  createBastionRuntimeHost,
  repositoryRoot,
  type BastionRuntimeHost,
  type BastionRuntimeHostOptions,
} from "./runtime-host.ts";
import { createBastionSessionManager } from "./session-storage.ts";

export interface RuntimeCliDependencies {
  createHost(options: BastionRuntimeHostOptions): Promise<BastionRuntimeHost>;
  createSessionManager: typeof createBastionSessionManager;
  repositoryRoot(): string;
  runInteractive(runtime: AgentSessionRuntime): Promise<void>;
  runPrint: typeof runPrintMode;
  runRpc(runtime: AgentSessionRuntime): Promise<unknown>;
  readStdin(): Promise<string>;
  writeStdout(value: string): void;
}

const defaultDependencies: RuntimeCliDependencies = {
  createHost: createBastionRuntimeHost,
  createSessionManager: createBastionSessionManager,
  repositoryRoot,
  async runInteractive(runtime) {
    await new InteractiveMode(runtime).run();
  },
  runPrint: runPrintMode,
  runRpc: runRpcMode,
  async readStdin() {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  },
  writeStdout(value) {
    process.stdout.write(value);
  },
};

export async function runRuntimeCli(
  args: string[],
  dependencies: RuntimeCliDependencies = defaultDependencies,
): Promise<number> {
  const options = parseRuntimeCliArgs(args);
  if (options.help) {
    dependencies.writeStdout(RUNTIME_CLI_HELP);
    return 0;
  }
  if (options.version) {
    dependencies.writeStdout(`${runtimeVersion()}\n`);
    return 0;
  }
  const printPrompt = options.mode === "text" || options.mode === "json"
    ? options.prompt ?? await dependencies.readStdin()
    : undefined;
  if (printPrompt !== undefined && printPrompt.length === 0) {
    throw new Error(`${options.mode} mode requires a prompt argument or piped stdin`);
  }

  const sessionManager = await dependencies.createSessionManager({
    cwd: dependencies.repositoryRoot(),
    ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
  });
  const host = await dependencies.createHost({
    sessionManager,
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.thinkingLevel !== undefined
      ? { thinkingLevel: options.thinkingLevel }
      : {}),
  });

  if (options.mode === "interactive") {
    try {
      await dependencies.runInteractive(host.runtime);
      return 0;
    } finally {
      await host.dispose();
    }
  }
  if (options.mode === "rpc") {
    await dependencies.runRpc(host.runtime);
    return 0;
  }
  return await dependencies.runPrint(host.runtime, {
    mode: options.mode,
    initialMessage: printPrompt,
  });
}

export async function main(): Promise<void> {
  process.exitCode = await runRuntimeCli(process.argv.slice(2));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`Failed to start Bastion Agent Runtime:\n${message}`);
    process.exitCode = 1;
  });
}
