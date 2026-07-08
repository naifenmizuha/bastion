import type { EmbeddingProvider } from "./types.ts";

export interface EnvEmbeddingOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  dimension: number;
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function embeddingOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EnvEmbeddingOptions | undefined {
  const apiKey =
    env.BASEBALL_RULES_EMBEDDING_API_KEY ?? env.OPENAI_API_KEY ?? "";
  if (!apiKey) return undefined;
  return {
    endpoint:
      env.BASEBALL_RULES_EMBEDDING_URL ??
      "https://api.openai.com/v1/embeddings",
    apiKey,
    model: env.BASEBALL_RULES_EMBEDDING_MODEL ?? "text-embedding-3-small",
    dimension: positiveInteger(env.BASEBALL_RULES_EMBEDDING_DIMENSION) ?? 1536,
  };
}

export function createEnvEmbeddingProvider(
  options: EnvEmbeddingOptions,
): EmbeddingProvider {
  return {
    dimension: options.dimension,
    async embed(texts) {
      if (texts.length === 0) return [];
      const response = await fetch(options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          input: texts,
        }),
      });
      if (!response.ok) {
        throw new Error(
          `embedding request failed: ${response.status} ${response.statusText}`,
        );
      }
      const payload = await response.json() as {
        data?: Array<{ embedding?: unknown }>;
      };
      if (!Array.isArray(payload.data) || payload.data.length !== texts.length) {
        throw new Error("embedding response did not match the request");
      }
      return payload.data.map((item) => {
        if (
          !Array.isArray(item.embedding) ||
          item.embedding.some((value) => typeof value !== "number")
        ) {
          throw new Error("embedding response contains an invalid vector");
        }
        const vector = item.embedding as number[];
        if (vector.length !== options.dimension) {
          throw new Error(
            `embedding dimension mismatch: expected ${options.dimension}, got ${vector.length}`,
          );
        }
        return vector;
      });
    },
  };
}

export function createUnavailableEmbeddingProvider(
  dimension = 1536,
): EmbeddingProvider {
  return {
    dimension,
    async embed() {
      throw new Error(
        "Embedding provider is not configured. Set BASEBALL_RULES_EMBEDDING_API_KEY or OPENAI_API_KEY.",
      );
    },
  };
}
