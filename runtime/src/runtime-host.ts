import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Markdown } from "@earendil-works/pi-tui";
import {
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  type ExtensionFactory,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { createBastionCliExtension } from "./bastion-cli/extension.ts";
import type { ConfirmWrite } from "./bastion-cli/types.ts";
import { createBastionCompactionExtension } from "./compaction/extension.ts";
import { createContextProjectionExtension } from "./context-projection/extension.ts";
import { createDeveloperMode } from "./developer-mode/extension.ts";
import { LocalChangeEventBus } from "./derived-memory/events.ts";
import { createDerivedMemoryExtension } from "./derived-memory/extension.ts";
import { CliObservationLedger } from "./derived-memory/ledger.ts";
import { DerivedMemoryStore } from "./derived-memory/store.ts";

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
          { color: (text) => theme.fg("dim", text) },
        ),
    );
  });
};

export interface BastionRuntimeHostOptions {
  databasePath?: string;
  confirmWrite?: ConfirmWrite;
}

export interface BastionRuntimeHost {
  runtime: AgentSessionRuntime;
  agentDir: string;
  dispose(): Promise<void>;
}

export function repositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

export async function createBastionRuntimeHost(
  options: BastionRuntimeHostOptions = {},
): Promise<BastionRuntimeHost> {
  const repoRoot = repositoryRoot();
  const skillPath = join(repoRoot, "runtime", "skills", "manage-bastion-team");
  const databasePath =
    options.databasePath ??
    resolve(repoRoot, process.env.BASTION_DB_PATH ?? "bastion.db");
  const timeoutValue = process.env.BASTION_CLI_TIMEOUT_MS ?? "30000";
  const timeoutMs = Number(timeoutValue);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `BASTION_CLI_TIMEOUT_MS must be a positive integer, received ${JSON.stringify(timeoutValue)}`,
    );
  }

  const agentDir = join(homedir(), ".bastion", "agent");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  mkdirSync(agentDir, { recursive: true });

  const cliOptions = {
    executablePath: join(repoRoot, "out", "bastion"),
    databasePath,
    timeoutMs,
  };
  const contextProjectionExtension = createContextProjectionExtension();
  const derivedMemoryStore = new DerivedMemoryStore(
    join(agentDir, "derived-memory.sqlite"),
  );
  derivedMemoryStore.markFreshMemoriesStaleOnStartup();
  const changeEvents = new LocalChangeEventBus();

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    agentDir,
    sessionManager,
    sessionStartEvent,
  }) => {
    const observationLedger = new CliObservationLedger();
    const bastionCliExtension = createBastionCliExtension(cliOptions, {
      confirmWrite: options.confirmWrite,
      onResult: ({ toolCallId, params, details }) => {
        observationLedger.record(toolCallId, params, details, changeEvents);
      },
    });
    const derivedMemoryExtension = createDerivedMemoryExtension({
      store: derivedMemoryStore,
      ledger: observationLedger,
      changeEvents,
    });
    const developerMode = createDeveloperMode({
      logDirectory: join(agentDir, "logs"),
      sessionId: sessionManager.getSessionId(),
    });
    const bastionCompactionExtension = createBastionCompactionExtension({
      onProviderPayload: (payload, model, context) =>
        developerMode.capturePayload("compaction", payload, model, context),
    });
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions: {
        additionalSkillPaths: [skillPath],
        extensionFactories: [
          bastionHeaderExtension,
          bastionCliExtension,
          derivedMemoryExtension,
          bastionCompactionExtension,
          contextProjectionExtension,
          developerMode.extension,
        ],
      },
    });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        tools: ["read", "bastion_cli", "derived_memory"],
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  let runtime: AgentSessionRuntime;
  try {
    runtime = await createAgentSessionRuntime(createRuntime, {
      cwd: repoRoot,
      agentDir,
      sessionManager: SessionManager.create(repoRoot),
    });
  } catch (error) {
    derivedMemoryStore.close();
    throw error;
  }

  return {
    runtime,
    agentDir,
    async dispose() {
      await runtime.dispose();
      derivedMemoryStore.close();
    },
  };
}
