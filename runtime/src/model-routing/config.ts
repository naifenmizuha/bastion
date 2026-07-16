import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type {
  ModelIdentity,
  ModelRoutingConfig,
  RoutingModels,
} from "./types.ts";

const ENVIRONMENT_FIELDS = [
  "BASTION_SIMPLE_MODEL_PROVIDER",
  "BASTION_SIMPLE_MODEL_ID",
  "BASTION_COMPLEX_MODEL_PROVIDER",
  "BASTION_COMPLEX_MODEL_ID",
] as const;

function configuredValue(
  env: NodeJS.ProcessEnv,
  key: (typeof ENVIRONMENT_FIELDS)[number],
): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export function resolveModelRoutingConfig(
  env: NodeJS.ProcessEnv = process.env,
): ModelRoutingConfig | undefined {
  const values = Object.fromEntries(
    ENVIRONMENT_FIELDS.map((key) => [key, configuredValue(env, key)]),
  ) as Record<(typeof ENVIRONMENT_FIELDS)[number], string | undefined>;
  const configured = ENVIRONMENT_FIELDS.filter((key) => values[key]);
  if (configured.length === 0) return undefined;
  if (configured.length !== ENVIRONMENT_FIELDS.length) {
    const missing = ENVIRONMENT_FIELDS.filter((key) => !values[key]);
    throw new Error(
      `model routing configuration is incomplete; missing ${missing.join(", ")}`,
    );
  }
  return {
    simple: {
      provider: values.BASTION_SIMPLE_MODEL_PROVIDER!,
      id: values.BASTION_SIMPLE_MODEL_ID!,
    },
    complex: {
      provider: values.BASTION_COMPLEX_MODEL_PROVIDER!,
      id: values.BASTION_COMPLEX_MODEL_ID!,
    },
  };
}

async function resolveModel(
  registry: Pick<ModelRegistry, "find" | "getApiKeyAndHeaders">,
  role: "simple" | "complex",
  identity: ModelIdentity,
) {
  const model = registry.find(identity.provider, identity.id);
  if (!model) {
    throw new Error(
      `${role} routing model does not exist: ${identity.provider}/${identity.id}`,
    );
  }
  const auth = await registry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error(
      `${role} routing model authentication failed for ${identity.provider}/${identity.id}: ${auth.error}`,
    );
  }
  if (!auth.apiKey) {
    throw new Error(
      `${role} routing model has no API key: ${identity.provider}/${identity.id}`,
    );
  }
  return model;
}

export async function resolveModelRoutingModels(
  registry: Pick<ModelRegistry, "find" | "getApiKeyAndHeaders">,
  config: ModelRoutingConfig,
): Promise<RoutingModels> {
  const [simple, complex] = await Promise.all([
    resolveModel(registry, "simple", config.simple),
    resolveModel(registry, "complex", config.complex),
  ]);
  return { simple, complex };
}
