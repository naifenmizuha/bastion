import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createContextProjectionExtension } from "./extension.ts";

describe("context projection extension", () => {
  it("registers a context handler and reports diagnostics", () => {
    let handler:
      | ((event: { messages: any[] }) => { messages: any[] })
      | undefined;
    let projectedTurns = -1;
    const extension = createContextProjectionExtension({
      onProjection: (diagnostics) => {
        projectedTurns = diagnostics.completedTurnsProjected;
      },
    });
    extension({
      on(event: string, value: typeof handler) {
        assert.equal(event, "context");
        handler = value;
      },
    } as never);
    assert.ok(handler);

    const messages = [{ role: "user", content: "active", timestamp: 1 }];
    const result = handler({ messages });

    assert.deepEqual(result.messages, messages);
    assert.equal(projectedTurns, 0);
  });
});

