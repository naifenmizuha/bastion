import { BastionCliError } from "./errors.ts";
import { parseCommand } from "./command-policy.ts";
import type {
  BastionCliParams,
  BastionCliToolDetails,
  CommandInputContract,
  ConfirmWrite,
  ProcessResult,
  VerificationResult,
} from "./types.ts";
import {
  buildVerificationRequests,
  containsExpected,
} from "./verification.ts";

export interface BastionCliRunner {
  run(
    args: string[],
    input: unknown,
    signal?: AbortSignal,
  ): Promise<ProcessResult>;
  inputContract?(
    args: string[],
  ): Promise<CommandInputContract | undefined>;
}

export class BastionCliService {
  constructor(private readonly executor: BastionCliRunner) {}

  async execute(
    params: BastionCliParams,
    options: {
      confirmWrite?: ConfirmWrite;
      signal?: AbortSignal;
    } = {},
  ): Promise<BastionCliToolDetails> {
    let command;
    try {
      command = parseCommand(params);
    } catch (error) {
      if (
        error instanceof BastionCliError &&
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
          throw new BastionCliError(error.code, error.message, {
            ...currentDetails,
            contract,
          });
        }
      }
      throw error;
    }
    let approved: boolean | undefined;

    if (command.spec.risk === "write") {
      if (!options.confirmWrite) {
        throw new BastionCliError(
          "APPROVAL_REQUIRED",
          "This Bastion write requires interactive confirmation",
        );
      }
      approved = await options.confirmWrite({
        args: command.args,
        input: params.input,
      });
      if (!approved) {
        throw new BastionCliError(
          "USER_CANCELLED",
          "The user cancelled the Bastion write",
        );
      }
    }

    const result = await this.executor.run(
      command.args,
      params.input,
      options.signal,
    );
    if (!result.envelope.ok) {
      return {
        kind: "bastion_cli",
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
    return {
      kind: "bastion_cli",
      ok: verified,
      command: command.args,
      risk: command.spec.risk,
      approved,
      result,
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
