import { BastionCliError } from "./errors.ts";
import type {
  BastionCliParams,
  CommandRisk,
  CommandSpec,
  ParsedCommand,
} from "./types.ts";

const noFlags = {};

function command(
  path: string[],
  options: {
    flags?: Record<string, { required?: boolean }>;
    input?: "required" | "forbidden";
    risk?: CommandRisk;
  } = {},
): CommandSpec {
  return {
    path,
    flags: options.flags ?? noFlags,
    input: options.input ?? "forbidden",
    risk: options.risk ?? "read",
  };
}

export const commandSpecs: readonly CommandSpec[] = [
  command(["player", "add"], { input: "required", risk: "write" }),
  command(["player", "read"], { flags: { "--name": { required: true } } }),
  command(["player", "list"]),
  command(["report", "write"], { input: "required", risk: "write" }),
  command(["report", "read"], {
    flags: { "--name": { required: true }, "--date": { required: true } },
  }),
  command(["game", "write"], { input: "required", risk: "write" }),
  command(["game", "create"], { input: "required", risk: "write" }),
  command(["game", "lineup", "add"], { input: "required", risk: "write" }),
  command(["game", "event", "write"], { input: "required", risk: "write" }),
  command(["game", "event", "validate"], { input: "required" }),
  command(["game", "score", "set"], { input: "required", risk: "write" }),
  command(["game", "analysis", "generate"], {
    input: "required",
    risk: "compute_write",
  }),
  command(["game", "analysis", "read"], {
    flags: {
      "--game-id": { required: true },
      "--player": {},
    },
  }),
  command(["game", "analysis", "list"]),
  command(["game", "read"], { flags: { "--id": { required: true } } }),
  command(["game", "list"], { flags: { "--date": {} } }),
  command(["lineup", "validate"], { input: "required" }),
  command(["lineup", "write"], { input: "required", risk: "write" }),
  command(["lineup", "read"], { flags: { "--id": { required: true } } }),
  command(["lineup", "list"], {
    flags: { "--game-id": {}, "--status": {} },
  }),
  command(["lineup", "accept"], {
    flags: { "--id": { required: true } },
    risk: "write",
  }),
  command(["lineup", "reject"], {
    flags: { "--id": { required: true } },
    risk: "write",
  }),
  command(["drill", "recommend", "write"], {
    input: "required",
    risk: "write",
  }),
  command(["drill", "recommend", "list"], {
    flags: { "--name": {}, "--type": {}, "--status": {} },
  }),
  command(["drill", "review", "approve"], {
    flags: {
      "--recommendation-id": { required: true },
      "--coach": { required: true },
      "--summary": { required: true },
      "--note": { required: true },
    },
    risk: "write",
  }),
  command(["drill", "review", "reject"], {
    flags: {
      "--recommendation-id": { required: true },
      "--coach": { required: true },
      "--summary": { required: true },
      "--reason": { required: true },
    },
    risk: "write",
  }),
  command(["drill", "training", "list"], {
    flags: { "--name": {}, "--type": {} },
  }),
  command(["drill", "training", "read"], {
    flags: { "--recommendation-id": { required: true } },
  }),
  command(["person", "analysis", "read"], {
    flags: {
      "--name": { required: true },
      "--from": { required: true },
      "--to": { required: true },
    },
  }),
];

const sortedSpecs = [...commandSpecs].sort(
  (left, right) => right.path.length - left.path.length,
);

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function commandKey(spec: CommandSpec): string {
  return spec.path.join(" ");
}

export function parseCommand(params: BastionCliParams): ParsedCommand {
  if (!Array.isArray(params.args) || params.args.length === 0) {
    throw new BastionCliError(
      "INVALID_COMMAND",
      "args must contain a registered Bastion command",
    );
  }
  if (params.args.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new BastionCliError(
      "INVALID_COMMAND",
      "every command argument must be a non-empty string",
    );
  }

  const spec = sortedSpecs.find(
    (candidate) =>
      candidate.path.every((token, index) => params.args[index] === token) &&
      (params.args.length === candidate.path.length ||
        params.args[candidate.path.length]?.startsWith("--")),
  );
  if (!spec) {
    throw new BastionCliError(
      "UNCLASSIFIED_COMMAND",
      `command is not registered: ${params.args.join(" ")}`,
    );
  }

  const flagTokens = params.args.slice(spec.path.length);
  if (flagTokens.length % 2 !== 0) {
    throw new BastionCliError(
      "INVALID_FLAGS",
      `every flag requires a value for ${commandKey(spec)}`,
    );
  }

  const flags = new Map<string, string>();
  for (let index = 0; index < flagTokens.length; index += 2) {
    const name = flagTokens[index];
    const value = flagTokens[index + 1];
    if (name === undefined || value === undefined || !name.startsWith("--")) {
      throw new BastionCliError(
        "INVALID_FLAGS",
        `expected --flag value pairs for ${commandKey(spec)}`,
      );
    }
    if (!(name in spec.flags)) {
      throw new BastionCliError(
        "INVALID_FLAGS",
        `flag ${name} is not allowed for ${commandKey(spec)}`,
      );
    }
    if (flags.has(name)) {
      throw new BastionCliError("INVALID_FLAGS", `duplicate flag: ${name}`);
    }
    if (value.length === 0 || value.startsWith("--")) {
      throw new BastionCliError("INVALID_FLAGS", `flag ${name} requires a value`);
    }
    flags.set(name, value);
  }

  for (const [name, flagSpec] of Object.entries(spec.flags)) {
    if (flagSpec.required && !flags.has(name)) {
      throw new BastionCliError("INVALID_FLAGS", `missing required flag: ${name}`);
    }
  }

  if (spec.input === "required" && !isJsonObject(params.input)) {
    throw new BastionCliError(
      "INVALID_INPUT",
      `${commandKey(spec)} requires input to be a JSON object`,
      {
        reason:
          params.input === undefined
            ? "MISSING_INPUT"
            : "INVALID_INPUT_TYPE",
      },
    );
  }
  if (spec.input === "forbidden" && params.input !== undefined) {
    throw new BastionCliError(
      "INVALID_INPUT",
      `${commandKey(spec)} does not accept input`,
    );
  }

  return { spec, args: [...params.args], flags };
}
