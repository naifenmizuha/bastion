import { mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Markdown } from "@earendil-works/pi-tui";
import type { ThinkingLevel } from "./eval/types.ts";
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
  BASEBALL_RULE_CHUNK_PREVIEW_TOOL_NAME,
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
import { createOnboardingExtension } from "./onboarding/extension.ts";
import {
  resolveModelRoutingConfig,
  resolveModelRoutingModels,
} from "./model-routing/config.ts";
import { createModelRoutingExtension } from "./model-routing/extension.ts";
import { LocalChangeEventBus } from "./derived-memory/events.ts";
import { createDerivedMemoryExtension } from "./derived-memory/extension.ts";
import { DerivedMemoryEvidenceRegistry } from "./derived-memory/evidence-registry.ts";
import { publishTeamOpsChange } from "./derived-memory/teamops-change-events.ts";
import { DerivedMemoryStore } from "./derived-memory/store.ts";
import { SqliteFreshnessProvider } from "./derived-memory/freshness.ts";
import type {
  PrincipalContext,
  PrincipalRole,
} from "./derived-memory/types.ts";
import { loadRuntimeEnv } from "./env-loader.ts";

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
  executablePath?: string;
  agentDir?: string;
  configAgentDir?: string;
  /** Load user-configured Pi packages. Evaluations disable these and use Runtime resources only. */
  loadConfiguredPackages?: boolean;
  confirmWrite?: ConfirmWrite;
  principal?: PrincipalContext;
  /** Optional per-session model override. It is not persisted to user settings. */
  model?: { provider: string; id: string };
  /** Optional per-session thinking level. */
  thinkingLevel?: ThinkingLevel;
}

export interface BastionRuntimeHost {
  runtime: AgentSessionRuntime;
  agentDir: string;
  dispose(): Promise<void>;
}

export function repositoryRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

function runtimeSkillPaths(repoRoot: string): string[] {
  const skillsRoot = join(repoRoot, "runtime", "skills");
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(skillsRoot, entry.name))
    .sort();
}

const PRINCIPAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

function principalId(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized || !PRINCIPAL_ID.test(normalized)) {
    throw new Error(`${name} must be a non-empty stable identifier`);
  }
  return normalized;
}

export function resolvePrincipalContext(
  supplied: PrincipalContext | undefined,
  env: NodeJS.ProcessEnv = process.env,
): PrincipalContext {
  const role = supplied?.role ?? env.BASTION_USER_ROLE;
  if (role !== "admin" && role !== "coach" && role !== "player") {
    throw new Error("BASTION_USER_ROLE must be one of admin, coach, or player");
  }
  return {
    authorityId: principalId(
      supplied?.authorityId ?? env.BASTION_AUTHORITY_ID,
      "BASTION_AUTHORITY_ID",
    ),
    teamId: principalId(
      supplied?.teamId ?? env.BASTION_TEAM_ID,
      "BASTION_TEAM_ID",
    ),
    userId: principalId(
      supplied?.userId ?? env.BASTION_USER_ID,
      "BASTION_USER_ID",
    ),
    role: role as PrincipalRole,
    ...((supplied?.playerId ?? env.BASTION_PLAYER_ID)
      ? {
          playerId: principalId(
            supplied?.playerId ?? env.BASTION_PLAYER_ID,
            "BASTION_PLAYER_ID",
          ),
        }
      : {}),
  };
}

export async function createBastionRuntimeHost(
  options: BastionRuntimeHostOptions = {},
): Promise<BastionRuntimeHost> {
  const repoRoot = repositoryRoot();
  loadRuntimeEnv(repoRoot);
  const principal = resolvePrincipalContext(options.principal);
  const defaultAgentDir = join(homedir(), ".bastion", "agent");
  const skillPaths = runtimeSkillPaths(repoRoot);
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
  if (options.loadConfiguredPackages === false) {
    settingsManager.applyOverrides({ packages: [] });
  }
  const modelRegistry = ModelRegistry.create(
    authStorage,
    join(configAgentDir, "models.json"),
  );
  const selectedModel = options.model
    ? modelRegistry.find(options.model.provider, options.model.id)
    : undefined;
  if (options.model && !selectedModel) {
    throw new Error(`model does not exist: ${options.model.provider}/${options.model.id}`);
  }
  const modelRoutingConfig = options.model
    ? undefined
    : resolveModelRoutingConfig();
  const modelRoutingModels = modelRoutingConfig
    ? await resolveModelRoutingModels(modelRegistry, modelRoutingConfig)
    : undefined;

  const cliOptions = {
    executablePath: options.executablePath ?? join(repoRoot, "out", "teamops"),
    databasePath,
    timeoutMs,
  };
  const onboardingExtension = createOnboardingExtension();
  const contextProjectionExtension = createContextProjectionExtension();
  const derivedMemoryStore = new DerivedMemoryStore(
    join(agentDir, "derived-memory.sqlite"),
  );
  const freshness = new SqliteFreshnessProvider(databasePath);
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
    const evidenceRegistry = new DerivedMemoryEvidenceRegistry();
    const teamOpsExtension = createTeamOpsExtension(cliOptions, {
      confirmWrite: options.confirmWrite,
      freshness,
      onResult: ({ toolCallId, params, details }) => {
        evidenceRegistry.registerTeamOpsRead(params, details);
        publishTeamOpsChange(
          toolCallId,
          params,
          details,
          changeEvents,
        );
      },
    });
    const derivedMemoryExtension = createDerivedMemoryExtension({
      store: derivedMemoryStore,
      evidenceRegistry,
      changeEvents,
      freshness,
      principal,
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
    const modelRoutingExtension = modelRoutingModels
      ? createModelRoutingExtension({
          models: modelRoutingModels,
          settingsManager,
          onProviderPayload: (payload, model, context) =>
            developerMode.capturePayload("router", payload, model, context),
        })
      : undefined;
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      authStorage,
      settingsManager,
      modelRegistry,
      resourceLoaderOptions: {
        additionalSkillPaths: skillPaths,
        extensionFactories: [
          bastionHeaderExtension,
          onboardingExtension,
          teamOpsExtension,
          derivedMemoryExtension,
          baseballRulesExtension,
          bastionCompactionExtension,
          contextProjectionExtension,
          ...(modelRoutingExtension ? [modelRoutingExtension] : []),
          developerMode.extension,
        ],
      },
    });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager,
        sessionStartEvent,
        ...(selectedModel ? { model: selectedModel } : {}),
        ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
        tools: [
          "read",
          TEAMOPS_TOOL_NAME,
          "derived_memory",
          BASEBALL_RULE_CHUNK_PREVIEW_TOOL_NAME,
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
    freshness.close();
    baseballRuleStore.close();
    throw error;
  }

  return {
    runtime,
    agentDir,
    async dispose() {
      await runtime.dispose();
      derivedMemoryStore.close();
      freshness.close();
      baseballRuleStore.close();
    },
  };
}
