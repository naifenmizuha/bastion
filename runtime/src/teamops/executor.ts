import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { TeamOpsError } from "./errors.ts";
import type {
  TeamOpsExecutionOptions,
  CliEnvelope,
  CommandInputContract,
  ProcessResult,
} from "./types.ts";

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

function parseEnvelope(stdout: string): CliEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new TeamOpsError(
      "INVALID_CLI_RESPONSE",
      "teamops did not return valid JSON",
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TeamOpsError(
      "INVALID_CLI_RESPONSE",
      "teamops response must be a JSON object",
    );
  }
  const object = value as Record<string, unknown>;
  if (object.ok === true && "data" in object) {
    return { ok: true, data: object.data };
  }
  if (object.ok === false && typeof object.error === "object" && object.error !== null) {
    const error = object.error as Record<string, unknown>;
    if (typeof error.code === "string" && typeof error.message === "string") {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(typeof error.field === "string" ? { field: error.field } : {}),
          ...("details" in error ? { details: error.details } : {}),
        },
      };
    }
  }
  throw new TeamOpsError(
    "INVALID_CLI_RESPONSE",
    "teamops response does not match the JSON envelope",
  );
}

export class TeamOpsExecutor {
  private readonly maxOutputBytes: number;
  private contracts:
    | Promise<ReadonlyMap<string, CommandInputContract>>
    | undefined;

  constructor(private readonly options: TeamOpsExecutionOptions) {
    this.maxOutputBytes =
      options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  }

  async checkExecutable(): Promise<void> {
    try {
      await access(this.options.executablePath, constants.X_OK);
    } catch {
      throw new TeamOpsError(
        "CLI_NOT_AVAILABLE",
        `teamops is not executable: ${this.options.executablePath}`,
      );
    }
  }

  async inputContract(
    args: string[],
  ): Promise<CommandInputContract | undefined> {
    this.contracts ??= this.loadInputContracts();
    const contracts = await this.contracts;
    for (let length = args.length; length > 0; length -= 1) {
      const contract = contracts.get(args.slice(0, length).join(" "));
      if (contract) return contract;
    }
    return undefined;
  }

  private async loadInputContracts(): Promise<
    ReadonlyMap<string, CommandInputContract>
  > {
    const result = await this.run(["contract"], undefined);
    if (!result.envelope.ok) {
      throw new TeamOpsError(
        "INVALID_CLI_RESPONSE",
        "teamops failed to return command input contracts",
        result.envelope.error,
      );
    }
    const data = result.envelope.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new TeamOpsError(
        "INVALID_CLI_RESPONSE",
        "teamops contract data must be an object",
      );
    }
    const commands = (data as Record<string, unknown>).commands;
    if (!Array.isArray(commands)) {
      throw new TeamOpsError(
        "INVALID_CLI_RESPONSE",
        "teamops contract data must contain a commands array",
      );
    }
    const contracts = new Map<string, CommandInputContract>();
    for (const value of commands) {
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value)
      ) {
        throw new TeamOpsError(
          "INVALID_CLI_RESPONSE",
          "teamops returned an invalid command input contract",
        );
      }
      const contract = value as unknown as CommandInputContract;
      if (
        !Array.isArray(contract.command) ||
        contract.command.length === 0 ||
        contract.command.some((token) => typeof token !== "string") ||
        typeof contract.input !== "object" ||
        contract.input === null ||
        contract.input.type !== "object" ||
        !Array.isArray(contract.input.requiredFields)
      ) {
        throw new TeamOpsError(
          "INVALID_CLI_RESPONSE",
          "teamops returned an invalid command input contract",
        );
      }
      contracts.set(contract.command.join(" "), contract);
    }
    return contracts;
  }

  async run(
    args: string[],
    input: unknown,
    signal?: AbortSignal,
  ): Promise<ProcessResult> {
    await this.checkExecutable();
    if (signal?.aborted) {
      throw new TeamOpsError("ABORTED", "teamops operation was aborted");
    }

    const processArgs = [
      "--db",
      this.options.databasePath,
      "--format",
      "json",
      ...args,
      ...(input === undefined ? [] : ["--input", "-"]),
    ];

    return await new Promise<ProcessResult>((resolve, reject) => {
      const child = spawn(this.options.executablePath, processArgs, {
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let terminationCode: "TIMEOUT" | "ABORTED" | "OUTPUT_LIMIT" | undefined;
      let forceKillTimeout: NodeJS.Timeout | undefined;

      const finishWithError = (error: TeamOpsError) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      const terminate = (
        code: "TIMEOUT" | "ABORTED" | "OUTPUT_LIMIT",
      ) => {
        if (terminationCode) return;
        terminationCode = code;
        child.kill("SIGTERM");
        forceKillTimeout = setTimeout(() => child.kill("SIGKILL"), 1_000);
      };

      const timeout = setTimeout(
        () => terminate("TIMEOUT"),
        this.options.timeoutMs,
      );
      const onAbort = () => terminate("ABORTED");
      signal?.addEventListener("abort", onAbort, { once: true });

      const cleanup = () => {
        clearTimeout(timeout);
        if (forceKillTimeout) clearTimeout(forceKillTimeout);
        signal?.removeEventListener("abort", onAbort);
      };

      child.on("error", (error) => {
        finishWithError(
          new TeamOpsError(
            "CLI_PROCESS_ERROR",
            `failed to start teamops: ${error.message}`,
          ),
        );
      });

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > this.maxOutputBytes) {
          terminate("OUTPUT_LIMIT");
          return;
        }
        stdoutChunks.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > this.maxOutputBytes) {
          terminate("OUTPUT_LIMIT");
          return;
        }
        stderrChunks.push(chunk);
      });
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") {
          finishWithError(
            new TeamOpsError(
              "CLI_PROCESS_ERROR",
              `failed to write teamops input: ${error.message}`,
            ),
          );
        }
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (terminationCode) {
          const messages = {
            TIMEOUT: `teamops timed out after ${this.options.timeoutMs}ms`,
            ABORTED: "teamops operation was aborted",
            OUTPUT_LIMIT: "teamops output exceeded the allowed size",
          };
          reject(new TeamOpsError(terminationCode, messages[terminationCode]));
          return;
        }

        const exitCode = code ?? 1;
        const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        let envelope: CliEnvelope;
        try {
          envelope = parseEnvelope(stdout);
        } catch (error) {
          const normalized =
            error instanceof TeamOpsError
              ? error
              : new TeamOpsError(
                  "INVALID_CLI_RESPONSE",
                  error instanceof Error ? error.message : String(error),
                );
          reject(
            new TeamOpsError(normalized.code, normalized.message, {
              exitCode,
              stderr,
            }),
          );
          return;
        }
        if (exitCode !== 0 && envelope.ok) {
          reject(
            new TeamOpsError(
              "INVALID_CLI_RESPONSE",
              `teamops exited with ${exitCode} but returned ok:true`,
              { exitCode, stderr },
            ),
          );
          return;
        }
        resolve({ envelope, exitCode, stderr });
      });

      if (input === undefined) {
        child.stdin.end();
      } else {
        try {
          child.stdin.end(`${JSON.stringify(input)}\n`);
        } catch (error) {
          child.kill("SIGTERM");
          finishWithError(
            new TeamOpsError(
              "INVALID_INPUT",
              `input is not JSON serializable: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
        }
      }
    });
  }
}
