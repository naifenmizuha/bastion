import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { toBastionCliError } from "./errors.ts";
import { BastionCliExecutor } from "./executor.ts";
import { BastionCliService } from "./service.ts";
import type {
  BastionCliExecutionOptions,
  BastionCliParams,
  BastionCliToolDetails,
  ConfirmWrite,
} from "./types.ts";

export const BastionCliParameters: TSchema = Type.Object(
  {
    args: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      description:
        "Bastion subcommand and query flags as separate tokens. Do not include --db, --format, or --input.",
    }),
    input: Type.Optional(
      Type.Object(
        {},
        {
          additionalProperties: true,
          description:
            "JSON object for commands that take structured input. Omit for query-only commands.",
        },
      ),
    ),
  },
  { additionalProperties: false },
);

export interface BastionCliExtensionHooks {
  /**
   * Explicit host-owned approval policy. This is intentionally opt-in so the
   * normal runtime continues to require the interactive confirmation dialog.
   */
  confirmWrite?: ConfirmWrite;
  onResult?: (event: {
    toolCallId: string;
    params: BastionCliParams;
    details: BastionCliToolDetails;
  }) => void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Some OpenAI-compatible providers serialize an unconstrained nested tool
 * argument as a JSON string. Decode exactly one object layer before Pi validates
 * the explicit object schema.
 */
export function prepareBastionCliArguments(args: unknown): BastionCliParams {
  if (!isObject(args)) return args as BastionCliParams;
  const prepared = { ...args };
  if (typeof prepared.input === "string") {
    try {
      const parsed = JSON.parse(prepared.input);
      if (isObject(parsed)) prepared.input = parsed;
    } catch {
      // Leave malformed strings unchanged so schema validation rejects them.
    }
  }
  return prepared as unknown as BastionCliParams;
}

export function modelContent(details: BastionCliToolDetails): string {
  const result = {
    ok: details.ok,
    command: details.command,
    risk: details.risk,
    ...(details.approved !== undefined ? { approved: details.approved } : {}),
    ...(details.result ? { cli: details.result.envelope } : {}),
    ...(details.verification
      ? {
          verification: details.verification.map((item) => ({
            command: item.args,
            ok: item.envelope.ok,
            matched: item.matched,
            expected: item.expected,
          })),
        }
      : {}),
    ...(details.error
      ? {
          error: {
            code: details.error.code,
            message: details.error.message,
            ...(details.error.details !== undefined
              ? { details: details.error.details }
              : {}),
          },
        }
      : {}),
  };
  return JSON.stringify(result, null, 2);
}

export function createBastionCliExtension(
  options: BastionCliExecutionOptions,
  hooks: BastionCliExtensionHooks = {},
): ExtensionFactory {
  return (pi) => {
    const service = new BastionCliService(new BastionCliExecutor(options));

    pi.registerTool({
      name: "bastion_cli",
      label: "Bastion CLI",
      description:
        "Query, validate, analyze, or update authoritative Bastion baseball team data through the registered CLI protocol. Commands that write, validate, or generate structured data require an input JSON object. Use the manage-bastion-team skill for command-specific schemas.",
      promptSnippet: "Operate authoritative Bastion baseball team data",
      parameters: BastionCliParameters,
      prepareArguments: prepareBastionCliArguments,
      executionMode: "sequential",

      async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
        const params = rawParams as BastionCliParams;
        let details: BastionCliToolDetails;
        try {
          details = await service.execute(params, {
            signal,
            confirmWrite: hooks.confirmWrite ?? (ctx.hasUI
              ? async ({ args, input }) =>
                  await ctx.ui.confirm(
                    "Confirm Bastion write",
                    `${args.join(" ")}\n\n${JSON.stringify(input, null, 2)}`,
                  )
              : undefined),
          });
        } catch (error) {
          const normalized = toBastionCliError(error);
          details = {
            kind: "bastion_cli",
            ok: false,
            command: [...params.args],
            error: {
              code: normalized.code,
              message: normalized.message,
              details: normalized.details,
            },
          };
        }
        return {
          content: [{ type: "text", text: modelContent(details) }],
          details,
        };
      },
    });

    pi.on("tool_result", (event) => {
      if (event.toolName !== "bastion_cli") return;
      const details = event.details as BastionCliToolDetails | undefined;
      if (
        details?.kind === "bastion_cli" &&
        Array.isArray(event.input.args)
      ) {
        hooks.onResult?.({
          toolCallId: event.toolCallId,
          params: event.input as unknown as BastionCliParams,
          details,
        });
      }
      if (details?.kind === "bastion_cli" && !details.ok) {
        return { isError: true };
      }
    });
  };
}
