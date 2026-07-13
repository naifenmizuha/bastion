import { TeamOpsError } from "./errors.ts";
import { parseCommand } from "./command-policy.ts";
import type {
  TeamOpsParams,
  TeamOpsToolDetails,
  CommandInputContract,
  ConfirmWrite,
  ProcessResult,
  VerificationResult,
} from "./types.ts";
import { TEAMOPS_DETAILS_KIND } from "./types.ts";
import type { FreshnessProvider } from "../derived-memory/freshness.ts";
import {
  buildVerificationRequests,
  containsExpected,
} from "./verification.ts";

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function batchOperations(input: unknown): Record<string, unknown>[] {
  const operations = asObject(input)?.operations;
  if (!Array.isArray(operations)) return [];
  return operations.flatMap((operation) =>
    asObject(operation) ? [operation] : [],
  );
}

function operationArgs(operation: Record<string, unknown>): string[] | undefined {
  const args = operation.args;
  if (!Array.isArray(args) || args.some((item) => typeof item !== "string")) {
    return undefined;
  }
  return args as string[];
}

export interface TeamOpsRunner {
  run(
    args: string[],
    input: unknown,
    signal?: AbortSignal,
  ): Promise<ProcessResult>;
  inputContract?(
    args: string[],
  ): Promise<CommandInputContract | undefined>;
}

interface GameEventPreflightInput {
  index?: number;
  input: unknown;
}

export class TeamOpsService {
  constructor(
    private readonly executor: TeamOpsRunner,
    private readonly freshness?: FreshnessProvider,
  ) {}

  async execute(
    params: TeamOpsParams,
    options: {
      confirmWrite?: ConfirmWrite;
      signal?: AbortSignal;
    } = {},
  ): Promise<TeamOpsToolDetails> {
    let command;
    try {
      command = parseCommand(params);
    } catch (error) {
      if (
        error instanceof TeamOpsError &&
        error.code === "INVALID_INPUT" &&
        this.executor.inputContract
      ) {
        const contract = await this.executor.inputContract(params.args);
        if (contract) {
          const currentDetails =
            typeof error.details === "object" &&
            error.details !== null &&
            !Array.isArray(error.details)
              ? error.details
              : {};
          throw new TeamOpsError(error.code, error.message, {
            ...currentDetails,
            contract,
          });
        }
      }
      throw error;
    }
    let approved: boolean | undefined;

    const gameEventInputs: GameEventPreflightInput[] =
      command.spec.path.join(" ") === "game event write"
        ? [{ input: params.input }]
        : command.spec.path.join(" ") === "batch write"
          ? batchOperations(params.input).flatMap((operation, index) => {
              const args = operationArgs(operation);
              return args?.join(" ") === "game event write"
                ? [{ index, input: operation.input }]
                : [];
            })
          : [];

    for (const gameEventInput of gameEventInputs) {
      const preflight = await this.executor.run(
        ["game", "event", "validate"],
        gameEventInput.input,
        options.signal,
      );
      const data =
        preflight.envelope.ok &&
        typeof preflight.envelope.data === "object" &&
        preflight.envelope.data !== null &&
        !Array.isArray(preflight.envelope.data)
          ? preflight.envelope.data as Record<string, unknown>
          : undefined;
      if (!preflight.envelope.ok || data?.valid !== true) {
        return {
          kind: TEAMOPS_DETAILS_KIND,
          ok: false,
          command: command.args,
          risk: command.spec.risk,
          error: preflight.envelope.ok
            ? {
                code: "INVALID_INPUT",
                message: "Game events require missing or corrected facts before approval",
                details: {
                  ...(gameEventInput.index !== undefined
                    ? { index: gameEventInput.index }
                    : {}),
                  issues: Array.isArray(data?.issues) ? data.issues : [],
                },
              }
            : {
                code: preflight.envelope.error.code,
                message: preflight.envelope.error.message,
                details: {
                  ...(gameEventInput.index !== undefined
                    ? { index: gameEventInput.index }
                    : {}),
                  ...(preflight.envelope.error.details !== undefined
                    ? { cause: preflight.envelope.error.details }
                    : {}),
                },
              },
        };
      }
    }

    if (command.spec.risk === "write") {
      if (!options.confirmWrite) {
        throw new TeamOpsError(
          "APPROVAL_REQUIRED",
          "This teamops write requires interactive confirmation",
        );
      }
      approved = await options.confirmWrite({
        args: command.args,
        input: params.input,
      });
      if (!approved) {
        return {
          kind: TEAMOPS_DETAILS_KIND,
          ok: false,
          command: command.args,
          risk: command.spec.risk,
          approved: false,
          error: {
            code: "USER_CANCELLED",
            message: "The user cancelled the teamops write",
          },
        };
      }
    }

    const result = await this.executor.run(
      command.args,
      params.input,
      options.signal,
    );
    if (!result.envelope.ok) {
      return {
        kind: TEAMOPS_DETAILS_KIND,
        ok: false,
        command: command.args,
        risk: command.spec.risk,
        approved,
        result,
        error: {
          code: result.envelope.error.code,
          message: result.envelope.error.message,
          ...(result.envelope.error.details !== undefined
            ? { details: result.envelope.error.details }
            : {}),
        },
      };
    }

    const verificationRequests = buildVerificationRequests(
      command,
      params.input,
      result.envelope,
    );
    const verification: VerificationResult[] = [];
    for (const request of verificationRequests) {
      const verificationResult = await this.executor.run(
        request.args,
        undefined,
        options.signal,
      );
      const matched =
        verificationResult.envelope.ok &&
        containsExpected(verificationResult.envelope.data, request.expected);
      verification.push({
        ...verificationResult,
        args: request.args,
        expected: request.expected,
        matched,
      });
    }

    const verified = verification.every(
      (item) => item.envelope.ok && item.matched,
    );
    let freshness;
    if (command.spec.risk === "read" && this.freshness) {
      try {
        freshness = this.freshness.snapshot(params);
      } catch {
        // The authoritative read remains successful, but the observation is
        // intentionally ineligible for derived-memory persistence.
      }
    }
    return {
      kind: TEAMOPS_DETAILS_KIND,
      ok: verified,
      command: command.args,
      risk: command.spec.risk,
      approved,
      result,
      ...(freshness ? { freshness } : {}),
      ...(verification.length > 0 ? { verification } : {}),
      ...(!verified
        ? {
            error: {
              code: "WRITE_VERIFICATION_FAILED",
              message:
                "The write returned success, but authoritative read-back verification failed; the write may have taken effect",
            },
          }
        : {}),
    };
  }
}
