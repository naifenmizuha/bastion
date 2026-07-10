import type { EmbeddingProvider } from "./types.ts";

export interface EnvEmbeddingOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  dimension: number;
  batchSize?: number;
}

const DEFAULT_BATCH_SIZE = 32;
const MAX_ERROR_BODY_CHARS = 1_000;

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function responseErrorMessage(response: Response): Promise<string> {
  let body = "";
  try {
    body = (await response.text()).trim();
  } catch {
    body = "";
  }
  const suffix = body
    ? `: ${body.length > MAX_ERROR_BODY_CHARS ? `${body.slice(0, MAX_ERROR_BODY_CHARS)}...` : body}`
    : "";
  return `embedding request failed: ${response.status} ${response.statusText}${suffix}`;
}

export function embeddingOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EnvEmbeddingOptions | undefined {
  const apiKey = env.EMBEDDING_API_KEY ?? env.OPENAI_API_KEY ?? "";
  if (!apiKey) return undefined;
  return {
    endpoint:
      env.EMBEDDING_URL ??
      "https://api.openai.com/v1/embeddings",
    apiKey,
    model: env.EMBEDDING_MODEL ?? "text-embedding-3-small",
    dimension: positiveInteger(env.EMBEDDING_DIMENSION) ?? 1536,
    batchSize: positiveInteger(env.EMBEDDING_BATCH_SIZE),
  };
}

export function createEnvEmbeddingProvider(
  options: EnvEmbeddingOptions,
): EmbeddingProvider {
  const batchSize =
    options.batchSize && options.batchSize > 0 ? options.batchSize : DEFAULT_BATCH_SIZE;
  return {
    dimension: options.dimension,
    async embed(texts) {
      if (texts.length === 0) return [];
      const embeddings: number[][] = [];
      for (const batch of batches(texts, batchSize)) {
        embeddings.push(...await embedBatch(options, batch));
      }
      return embeddings;
    },
  };
}

async function embedBatch(
  options: EnvEmbeddingOptions,
  texts: readonly string[],
): Promise<number[][]> {
  const response = await fetch(options.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      input: texts,
      dimensions: options.dimension,
    }),
  });
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response));
  }
  const body = (await response.text()).trim();
  if (!body) {
    throw new Error(
      `embedding response body was empty: ${response.status} ${response.statusText} for batch size ${texts.length}`,
    );
  }
  let payload: { data?: Array<{ embedding?: unknown }> };
  try {
    payload = JSON.parse(body) as {
      data?: Array<{ embedding?: unknown }>;
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const preview =
      body.length > MAX_ERROR_BODY_CHARS
        ? `${body.slice(0, MAX_ERROR_BODY_CHARS)}...`
        : body;
    throw new Error(
      `embedding response was not valid JSON: ${message}: ${preview}`,
    );
  }
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
}

export function createUnavailableEmbeddingProvider(
  dimension = 1536,
): EmbeddingProvider {
  return {
    dimension,
    async embed() {
      throw new Error(
        "Embedding provider is not configured. Set EMBEDDING_API_KEY or OPENAI_API_KEY in the shell, runtime/.env.local, or runtime/.env.",
      );
    },
  };
}
