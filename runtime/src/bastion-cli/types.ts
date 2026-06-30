export type CommandRisk = "read" | "compute_write" | "write";

export interface BastionCliParams {
  args: string[];
  input?: unknown;
}

export interface CliErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    field?: string;
    details?: unknown;
  };
}

export interface CliSuccessEnvelope {
  ok: true;
  data: unknown;
}

export type CliEnvelope = CliSuccessEnvelope | CliErrorEnvelope;

export interface FlagSpec {
  required?: boolean;
}

export interface CommandSpec {
  path: readonly string[];
  flags: Readonly<Record<string, FlagSpec>>;
  input: "required" | "forbidden";
  risk: CommandRisk;
}

export interface CommandInputContract {
  command: string[];
  input: {
    required: true;
    type: "object";
    additionalProperties: boolean;
    requiredFields: string[];
    properties: Record<string, Record<string, unknown>>;
    example: Record<string, unknown>;
  };
}

export interface ParsedCommand {
  spec: CommandSpec;
  args: string[];
  flags: ReadonlyMap<string, string>;
}

export interface ProcessResult {
  envelope: CliEnvelope;
  exitCode: number;
  stderr: string;
}

export interface VerificationRequest {
  args: string[];
  expected: Readonly<Record<string, string | number | boolean>>;
}

export interface VerificationResult extends ProcessResult {
  args: string[];
  expected: Readonly<Record<string, string | number | boolean>>;
  matched: boolean;
}

export interface BastionCliToolError {
  code: string;
  message: string;
  details?: unknown;
}

export interface BastionCliToolDetails {
  kind: "bastion_cli";
  ok: boolean;
  command: string[];
  risk?: CommandRisk;
  approved?: boolean;
  result?: ProcessResult;
  verification?: VerificationResult[];
  error?: BastionCliToolError;
}

export interface BastionCliExecutionOptions {
  executablePath: string;
  databasePath: string;
  timeoutMs: number;
  maxOutputBytes?: number;
}

export type ConfirmWrite = (request: {
  args: string[];
  input: unknown;
}) => Promise<boolean>;
