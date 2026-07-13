import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { toTeamOpsError } from "./errors.ts";
import { TeamOpsExecutor } from "./executor.ts";
import { TeamOpsService } from "./service.ts";
import type {
  TeamOpsExecutionOptions,
  TeamOpsParams,
  TeamOpsToolDetails,
  ConfirmWrite,
} from "./types.ts";
import {
  TEAMOPS_DETAILS_KIND,
  TEAMOPS_TOOL_NAME,
  isTeamOpsDetailsKind,
  isTeamOpsToolName,
} from "./types.ts";
import type { FreshnessProvider } from "../derived-memory/freshness.ts";

export const TeamOpsParameters: TSchema = Type.Object(
  {
    args: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      description:
        "teamops subcommand and query flags as separate tokens. Do not include --db, --format, or --input.",
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

export interface TeamOpsExtensionHooks {
  freshness?: FreshnessProvider;
  /**
   * Explicit host-owned approval policy. This is intentionally opt-in so the
   * normal runtime continues to require the interactive confirmation dialog.
   */
  confirmWrite?: ConfirmWrite;
  onResult?: (event: {
    toolCallId: string;
    params: TeamOpsParams;
    details: TeamOpsToolDetails;
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
export function prepareTeamOpsArguments(args: unknown): TeamOpsParams {
  if (!isObject(args)) return args as TeamOpsParams;
  const prepared = { ...args };
  if (typeof prepared.input === "string") {
    try {
      const parsed = JSON.parse(prepared.input);
      if (isObject(parsed)) prepared.input = parsed;
    } catch {
      // Leave malformed strings unchanged so schema validation rejects them.
    }
  }
  return prepared as unknown as TeamOpsParams;
}

export function modelContent(details: TeamOpsToolDetails): string {
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

export function createTeamOpsExtension(
  options: TeamOpsExecutionOptions,
  hooks: TeamOpsExtensionHooks = {},
): ExtensionFactory {
  return (pi) => {
    const service = new TeamOpsService(
      new TeamOpsExecutor(options),
      hooks.freshness,
    );

    pi.registerTool({
      name: TEAMOPS_TOOL_NAME,
      label: "teamops",
      description:
        "Query, validate, analyze, or update authoritative baseball team data through the registered teamops protocol. Commands that write, validate, or generate structured data require an input JSON object. Use the manage-bastion-team skill for command-specific schemas.",
      promptSnippet: "Operate authoritative baseball team data",
      parameters: TeamOpsParameters,
      prepareArguments: prepareTeamOpsArguments,
      executionMode: "sequential",

      async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
        const params = rawParams as TeamOpsParams;
        let details: TeamOpsToolDetails;
        try {
          details = await service.execute(params, {
            signal,
            confirmWrite: hooks.confirmWrite ?? (ctx.hasUI
              ? async ({ args, input }) =>
                  await ctx.ui.confirm(
                    "Confirm teamops write",
                    `${args.join(" ")}\n\n${JSON.stringify(input, null, 2)}`,
                  )
              : undefined),
          });
        } catch (error) {
          const normalized = toTeamOpsError(error);
          details = {
            kind: TEAMOPS_DETAILS_KIND,
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
      if (!isTeamOpsToolName(event.toolName)) return;
      const details = event.details as TeamOpsToolDetails | undefined;
      if (
        isTeamOpsDetailsKind(details?.kind) &&
        Array.isArray(event.input.args)
      ) {
        hooks.onResult?.({
          toolCallId: event.toolCallId,
          params: event.input as unknown as TeamOpsParams,
          details,
        });
      }
      if (isTeamOpsDetailsKind(details?.kind) && !details.ok) {
        return { isError: true };
      }
    });
  };
}
