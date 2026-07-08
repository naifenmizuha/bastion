import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Markdown } from "@earendil-works/pi-tui";
import {
  AuthStorage,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  type ExtensionFactory,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getMarkdownTheme,
} from "@earendil-works/pi-coding-agent";
import { createBaseballRulesExtension } from "./baseball-rules/extension.ts";
import {
  createEnvEmbeddingProvider,
  createUnavailableEmbeddingProvider,
  embeddingOptionsFromEnv,
} from "./baseball-rules/embedding.ts";
import {
  BASEBALL_RULE_INGEST_TOOL_NAME,
  BASEBALL_RULE_QUERY_TOOL_NAME,
} from "./baseball-rules/types.ts";
import { ZvecBaseballRuleStore } from "./baseball-rules/zvec-store.ts";
import { createTeamOpsExtension } from "./teamops/extension.ts";
import {
  TEAMOPS_TOOL_NAME,
  type ConfirmWrite,
} from "./teamops/types.ts";
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
  agentDir?: string;
  configAgentDir?: string;
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
  const defaultAgentDir = join(homedir(), ".bastion", "agent");
  const skillPath = join(repoRoot, "runtime", "skills", "manage-bastion-team");
  const databasePath =
    options.databasePath ??
    resolve(repoRoot, process.env.BASTION_DB_PATH ?? "bastion.db");
  const timeoutValue =
    process.env.TEAMOPS_TIMEOUT_MS ??
    process.env.BASTION_CLI_TIMEOUT_MS ??
    "30000";
  const timeoutMs = Number(timeoutValue);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `TEAMOPS_TIMEOUT_MS must be a positive integer, received ${JSON.stringify(timeoutValue)}`,
    );
  }

  const agentDir = options.agentDir ?? defaultAgentDir;
  const configAgentDir = options.configAgentDir ?? defaultAgentDir;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  mkdirSync(agentDir, { recursive: true });
  const authStorage = AuthStorage.create(join(configAgentDir, "auth.json"));
  const settingsManager = SettingsManager.create(repoRoot, configAgentDir);
  const modelRegistry = ModelRegistry.create(
    authStorage,
    join(configAgentDir, "models.json"),
  );

  const cliOptions = {
    executablePath: join(repoRoot, "out", "teamops"),
    databasePath,
    timeoutMs,
  };
  const contextProjectionExtension = createContextProjectionExtension();
  const derivedMemoryStore = new DerivedMemoryStore(
    join(agentDir, "derived-memory.sqlite"),
  );
  derivedMemoryStore.markFreshMemoriesStaleOnStartup();
  const embeddingOptions = embeddingOptionsFromEnv();
  const baseballRuleEmbedder = embeddingOptions
    ? createEnvEmbeddingProvider(embeddingOptions)
    : createUnavailableEmbeddingProvider();
  const baseballRuleStore = new ZvecBaseballRuleStore(
    join(agentDir, "baseball-rules.zvec"),
    baseballRuleEmbedder.dimension,
  );
  const changeEvents = new LocalChangeEventBus();

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    agentDir,
    sessionManager,
    sessionStartEvent,
  }) => {
    const observationLedger = new CliObservationLedger();
    const teamOpsExtension = createTeamOpsExtension(cliOptions, {
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
    const baseballRulesExtension = createBaseballRulesExtension({
      store: baseballRuleStore,
      embedder: baseballRuleEmbedder,
      safeRoots: [repoRoot, agentDir],
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
      authStorage,
      settingsManager,
      modelRegistry,
      resourceLoaderOptions: {
        additionalSkillPaths: [skillPath],
        extensionFactories: [
          bastionHeaderExtension,
          teamOpsExtension,
          derivedMemoryExtension,
          baseballRulesExtension,
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
        tools: [
          "read",
          TEAMOPS_TOOL_NAME,
          "derived_memory",
          BASEBALL_RULE_INGEST_TOOL_NAME,
          BASEBALL_RULE_QUERY_TOOL_NAME,
        ],
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
    baseballRuleStore.close();
    throw error;
  }

  return {
    runtime,
    agentDir,
    async dispose() {
      await runtime.dispose();
      derivedMemoryStore.close();
      baseballRuleStore.close();
    },
  };
}
