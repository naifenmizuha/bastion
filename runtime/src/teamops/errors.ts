export class TeamOpsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "TeamOpsError";
  }
}

export function toTeamOpsError(error: unknown): TeamOpsError {
  if (error instanceof TeamOpsError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new TeamOpsError("INTERNAL_ERROR", message);
}
