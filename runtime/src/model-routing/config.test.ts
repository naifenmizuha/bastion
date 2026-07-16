import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveModelRoutingConfig,
  resolveModelRoutingModels,
} from "./config.ts";

const simple = { provider: "fake", id: "simple" };
const complex = { provider: "fake", id: "complex" };

describe("model routing configuration", () => {
  it("keeps routing disabled when all fields are absent", () => {
    assert.equal(resolveModelRoutingConfig({}), undefined);
  });

  it("rejects partially configured routing", () => {
    assert.throws(
      () =>
        resolveModelRoutingConfig({
          BASTION_SIMPLE_MODEL_PROVIDER: "fake",
          BASTION_SIMPLE_MODEL_ID: "simple",
        }),
      /BASTION_COMPLEX_MODEL_PROVIDER.*BASTION_COMPLEX_MODEL_ID/,
    );
  });

  it("returns trimmed simple and complex identities", () => {
    assert.deepEqual(
      resolveModelRoutingConfig({
        BASTION_SIMPLE_MODEL_PROVIDER: " fake ",
        BASTION_SIMPLE_MODEL_ID: " simple ",
        BASTION_COMPLEX_MODEL_PROVIDER: "fake",
        BASTION_COMPLEX_MODEL_ID: "complex",
      }),
      { simple, complex },
    );
  });

  it("resolves both configured models and validates authentication", async () => {
    const models = new Map([
      ["fake/simple", simple],
      ["fake/complex", complex],
    ]);
    const result = await resolveModelRoutingModels(
      {
        find(provider: string, id: string) {
          return models.get(`${provider}/${id}`) as never;
        },
        async getApiKeyAndHeaders() {
          return { ok: true, apiKey: "secret", headers: {}, env: {} } as never;
        },
      },
      { simple, complex },
    );
    assert.equal(result.simple.id, "simple");
    assert.equal(result.complex.id, "complex");
  });

  it("rejects unknown models and missing authentication", async () => {
    await assert.rejects(
      resolveModelRoutingModels(
        {
          find() {
            return undefined;
          },
          async getApiKeyAndHeaders() {
            throw new Error("must not authenticate");
          },
        },
        { simple, complex },
      ),
      /simple routing model does not exist/,
    );

    await assert.rejects(
      resolveModelRoutingModels(
        {
          find(_provider: string, id: string) {
            return { provider: "fake", id } as never;
          },
          async getApiKeyAndHeaders() {
            return { ok: true, apiKey: undefined, headers: {}, env: {} } as never;
          },
        },
        { simple, complex },
      ),
      /has no API key/,
    );
  });
});
