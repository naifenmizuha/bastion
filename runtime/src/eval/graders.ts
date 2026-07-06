import type {
  EvalGrade,
  EvalGradeContext,
  GradeDimension,
} from "./types.ts";

export function grade(
  dimension: GradeDimension,
  name: string,
  passed: boolean,
  message: string,
): EvalGrade {
  return { dimension, name, passed, message };
}

export function commandCount(
  context: EvalGradeContext,
  command: readonly string[],
): number {
  return context.observation.toolCalls.filter(
    (call) =>
      command.every((token, index) => call.args[index] === token) &&
      (call.args.length === command.length ||
        call.args[command.length]?.startsWith("--")),
  ).length;
}

export function successfulCommand(
  context: EvalGradeContext,
  command: readonly string[],
): boolean {
  return context.observation.toolCalls.some(
    (call) =>
      call.details.ok &&
      command.every((token, index) => call.args[index] === token),
  );
}

function commandMatches(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return expected.every((token, index) => actual[index] === token);
}

export function verifiedCommand(
  context: EvalGradeContext,
  sourceCommand: readonly string[],
  verificationCommand: readonly string[],
): boolean {
  return context.observation.toolCalls.some(
    (call) =>
      call.details.ok &&
      commandMatches(call.args, sourceCommand) &&
      call.details.verification?.some(
        (item) => item.matched && commandMatches(item.args, verificationCommand),
      ),
  );
}

export function successfulOrVerifiedCommand(
  context: EvalGradeContext,
  command: readonly string[],
): boolean {
  return (
    successfulCommand(context, command) ||
    context.observation.toolCalls.some(
      (call) =>
        call.details.ok &&
        call.details.verification?.some(
          (item) => item.matched && commandMatches(item.args, command),
        ),
    )
  );
}

export function writes(context: EvalGradeContext): typeof context.observation.toolCalls {
  return context.observation.toolCalls.filter(
    (call) =>
      call.details.risk === "write" || call.details.risk === "compute_write",
  );
}

export function verifiedWritesPassed(context: EvalGradeContext): boolean {
  return writes(context)
    .filter((call) => call.details.ok)
    .every(
      (call) =>
        call.details.verification?.length &&
        call.details.verification.every((item) => item.matched),
    );
}

export function answerIncludesAll(
  context: EvalGradeContext,
  values: readonly string[],
): boolean {
  return values.every((value) => context.observation.finalAnswer.includes(value));
}

export function orderedCommands(
  context: EvalGradeContext,
  commands: readonly (readonly string[])[],
): boolean {
  let cursor = 0;
  for (const call of context.observation.toolCalls) {
    const expected = commands[cursor];
    if (expected && expected.every((token, index) => call.args[index] === token)) {
      cursor += 1;
    }
  }
  return cursor === commands.length;
}

export function orderedCommandsWithVerification(
  context: EvalGradeContext,
  commands: readonly (readonly string[])[],
): boolean {
  const evidence = context.observation.toolCalls.flatMap((call) => [
    { args: call.args, ok: call.details.ok },
    ...(call.details.verification ?? []).map((item) => ({
      args: item.args,
      ok: item.matched,
    })),
  ]);
  let cursor = 0;
  for (const item of evidence) {
    const expected = commands[cursor];
    if (item.ok && expected && commandMatches(item.args, expected)) cursor += 1;
  }
  return cursor === commands.length;
}

export function unicodeLength(value: string): number {
  return [...value].length;
}

export async function readEnvelope(
  context: EvalGradeContext,
  args: string[],
): Promise<Record<string, unknown>> {
  const result = await context.executor.run(args, undefined);
  return result.envelope as unknown as Record<string, unknown>;
}

export function envelopeData(
  envelope: Record<string, unknown>,
): Record<string, unknown> {
  if (envelope.ok !== true || typeof envelope.data !== "object" || !envelope.data) {
    return {};
  }
  return envelope.data as Record<string, unknown>;
}
