import type {
  CliEnvelope,
  ParsedCommand,
  VerificationRequest,
} from "./types.ts";

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function primitive(
  object: Record<string, unknown> | undefined,
  key: string,
): string | number | boolean | undefined {
  const value = object?.[key];
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined;
}

function requiredPrimitive(
  object: Record<string, unknown> | undefined,
  key: string,
): string | number | boolean {
  const value = primitive(object, key);
  if (value === undefined) {
    throw new Error(`successful command result is missing ${key}`);
  }
  return value;
}

export function buildVerificationRequests(
  command: ParsedCommand,
  input: unknown,
  envelope: CliEnvelope,
): VerificationRequest[] {
  if (!envelope.ok || command.spec.risk === "read") return [];

  const key = command.spec.path.join(" ");
  const inputObject = asObject(input);
  const data = asObject(envelope.data);

  switch (key) {
    case "player add": {
      const name = requiredPrimitive(inputObject, "name");
      return [{ args: ["player", "read", "--name", String(name)], expected: { name } }];
    }
    case "report write": {
      const name = requiredPrimitive(inputObject, "name");
      const date = requiredPrimitive(inputObject, "date");
      return [
        {
          args: ["report", "read", "--name", String(name), "--date", String(date)],
          expected: { name, date },
        },
      ];
    }
    case "game write":
    case "game create": {
      const id = requiredPrimitive(data, "id");
      return [{ args: ["game", "read", "--id", String(id)], expected: { id } }];
    }
    case "game lineup add":
    case "game event write":
    case "game score set": {
      const gameId =
        primitive(data, "game_id") ?? requiredPrimitive(inputObject, "game_id");
      return [
        {
          args: ["game", "read", "--id", String(gameId)],
          expected: { id: gameId },
        },
      ];
    }
    case "game analysis generate": {
      const gameId =
        primitive(data, "game_id") ?? requiredPrimitive(inputObject, "game_id");
      return [
        {
          args: ["game", "analysis", "read", "--game-id", String(gameId)],
          expected: { game_id: gameId },
        },
      ];
    }
    case "lineup write": {
      if (data?.valid === false) return [];
      const id = requiredPrimitive(data, "id");
      return [{ args: ["lineup", "read", "--id", String(id)], expected: { id } }];
    }
    case "lineup accept": {
      const id = requiredPrimitive(data, "id");
      const gameId = requiredPrimitive(data, "game_id");
      return [
        { args: ["lineup", "read", "--id", String(id)], expected: { id } },
        {
          args: ["game", "read", "--id", String(gameId)],
          expected: { id: gameId },
        },
      ];
    }
    case "lineup reject": {
      const id = requiredPrimitive(data, "id");
      return [{ args: ["lineup", "read", "--id", String(id)], expected: { id } }];
    }
    case "drill recommend write": {
      const id = requiredPrimitive(data, "id");
      return [
        {
          args: ["drill", "recommend", "list", "--status", "pending"],
          expected: { id },
        },
      ];
    }
    case "drill review approve": {
      const id = requiredPrimitive(data, "id");
      return [
        {
          args: ["drill", "recommend", "list", "--status", "approved"],
          expected: { id, review_status: "approved" },
        },
        {
          args: [
            "drill",
            "training",
            "read",
            "--recommendation-id",
            String(id),
          ],
          expected: { id },
        },
      ];
    }
    case "drill review reject": {
      const id = requiredPrimitive(data, "id");
      return [
        {
          args: ["drill", "recommend", "list", "--status", "rejected"],
          expected: { id, review_status: "rejected" },
        },
      ];
    }
    default:
      throw new Error(`write command has no verification policy: ${key}`);
  }
}

export function containsExpected(
  value: unknown,
  expected: Readonly<Record<string, string | number | boolean>>,
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => containsExpected(item, expected));
  }
  const object = asObject(value);
  if (!object) return false;

  if (
    Object.entries(expected).every(
      ([key, expectedValue]) => object[key] === expectedValue,
    )
  ) {
    return true;
  }
  return Object.values(object).some((item) => containsExpected(item, expected));
}
