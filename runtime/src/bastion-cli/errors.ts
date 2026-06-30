export class BastionCliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "BastionCliError";
  }
}

export function toBastionCliError(error: unknown): BastionCliError {
  if (error instanceof BastionCliError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new BastionCliError("INTERNAL_ERROR", message);
}
