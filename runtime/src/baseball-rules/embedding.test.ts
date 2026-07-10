import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  createEnvEmbeddingProvider,
  embeddingOptionsFromEnv,
} from "./embedding.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("baseball rule embedding provider", () => {
  it("reads embedding batch size from env", () => {
    const options = embeddingOptionsFromEnv({
      EMBEDDING_API_KEY: "key",
      EMBEDDING_BATCH_SIZE: "7",
    });

    assert.equal(options?.batchSize, 7);
  });

  it("embeds texts in request batches while preserving order", async () => {
    const bodies: unknown[] = [];
    const requests: Array<{
      input: Parameters<typeof fetch>[0];
      init?: Parameters<typeof fetch>[1];
    }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({ input, init });
      const body = JSON.parse(String(init?.body)) as {
        input: string[];
        model: string;
      };
      bodies.push(body);
      return new Response(
        JSON.stringify({
          data: body.input.map((text) => ({
            embedding: [text.length, bodies.length],
          })),
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createEnvEmbeddingProvider({
      endpoint: "https://example.test/embeddings",
      apiKey: "key",
      model: "test-model",
      dimension: 2,
      batchSize: 2,
    });

    const embeddings = await provider.embed(["a", "bb", "ccc", "dddd", "eeeee"]);

    assert.deepEqual(embeddings, [
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 2],
      [5, 3],
    ]);
    assert.deepEqual(
      bodies.map((body) => (body as { input: string[] }).input),
      [["a", "bb"], ["ccc", "dddd"], ["eeeee"]],
    );
    assert.deepEqual(
      bodies.map((body) => (body as { model: string }).model),
      ["test-model", "test-model", "test-model"],
    );
    assert.equal(requests[0]?.input, "https://example.test/embeddings");
    assert.equal(requests[0]?.init?.method, "POST");
    assert.deepEqual(requests[0]?.init?.headers, {
      "Content-Type": "application/json",
      Authorization: "Bearer key",
    });
    assert.deepEqual(Object.keys(bodies[0] as Record<string, unknown>).sort(), [
      "dimensions",
      "input",
      "model",
    ]);
    assert.deepEqual(
      bodies.map((body) => (body as { dimensions: number }).dimensions),
      [2, 2, 2],
    );
  });

  it("includes response body details when embedding request fails", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ error: { message: "too many inputs" } }),
        { status: 400, statusText: "Bad Request" },
      )) as typeof fetch;

    const provider = createEnvEmbeddingProvider({
      endpoint: "https://example.test/embeddings",
      apiKey: "key",
      model: "test-model",
      dimension: 2,
    });

    await assert.rejects(
      provider.embed(["a"]),
      /embedding request failed: 400 Bad Request: .*too many inputs/,
    );
  });

  it("reports empty successful embedding responses clearly", async () => {
    globalThis.fetch = (async () =>
      new Response("", { status: 200, statusText: "OK" })) as typeof fetch;

    const provider = createEnvEmbeddingProvider({
      endpoint: "https://example.test/embeddings",
      apiKey: "key",
      model: "test-model",
      dimension: 2,
      batchSize: 20,
    });

    await assert.rejects(
      provider.embed(["a", "bb"]),
      /embedding response body was empty: 200 OK for batch size 2/,
    );
  });
});
