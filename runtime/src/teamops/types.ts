export type CommandRisk = "read" | "compute_write" | "write";

export const TEAMOPS_TOOL_NAME = "teamops";
export const LEGACY_TEAMOPS_TOOL_NAME = "bastion_cli";
export const TRANSITIONAL_TEAMOPS_TOOL_NAME = "team-ops";
export const TEAMOPS_DETAILS_KIND = "teamops";
export const LEGACY_TEAMOPS_DETAILS_KIND = "bastion_cli";
export const TRANSITIONAL_TEAMOPS_DETAILS_KIND = "team-ops";

export function isTeamOpsToolName(
  value: unknown,
): value is
  | typeof TEAMOPS_TOOL_NAME
  | typeof LEGACY_TEAMOPS_TOOL_NAME
  | typeof TRANSITIONAL_TEAMOPS_TOOL_NAME {
  return value === TEAMOPS_TOOL_NAME ||
    value === LEGACY_TEAMOPS_TOOL_NAME ||
    value === TRANSITIONAL_TEAMOPS_TOOL_NAME;
}

export function isTeamOpsDetailsKind(
  value: unknown,
): value is
  | typeof TEAMOPS_DETAILS_KIND
  | typeof LEGACY_TEAMOPS_DETAILS_KIND
  | typeof TRANSITIONAL_TEAMOPS_DETAILS_KIND {
  return value === TEAMOPS_DETAILS_KIND ||
    value === LEGACY_TEAMOPS_DETAILS_KIND ||
    value === TRANSITIONAL_TEAMOPS_DETAILS_KIND;
}

export interface TeamOpsParams {
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

export interface TeamOpsToolError {
  code: string;
  message: string;
  details?: unknown;
}

export interface TeamOpsToolDetails {
  kind:
    | typeof TEAMOPS_DETAILS_KIND
    | typeof LEGACY_TEAMOPS_DETAILS_KIND
    | typeof TRANSITIONAL_TEAMOPS_DETAILS_KIND;
  ok: boolean;
  command: string[];
  risk?: CommandRisk;
  approved?: boolean;
  result?: ProcessResult;
  verification?: VerificationResult[];
  error?: TeamOpsToolError;
}

export interface TeamOpsExecutionOptions {
  executablePath: string;
  databasePath: string;
  timeoutMs: number;
  maxOutputBytes?: number;
}

export type ConfirmWrite = (request: {
  args: string[];
  input: unknown;
}) => Promise<boolean>;
