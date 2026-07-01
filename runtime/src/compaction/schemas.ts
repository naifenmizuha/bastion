import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

export const BastionNarrativeSchema = Type.Object(
  {
    goals: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 32 }),
    constraints: Type.Array(Type.String({ maxLength: 1000 }), {
      maxItems: 64,
    }),
    decisions: Type.Array(
      Type.Object(
        {
          actor: Type.Union([
            Type.Literal("user"),
            Type.Literal("assistant"),
          ]),
          decision: Type.String({ maxLength: 1000 }),
          rationale: Type.Optional(Type.String({ maxLength: 1500 })),
        },
        { additionalProperties: false },
      ),
      { maxItems: 64 },
    ),
    completed: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 64 }),
    inProgress: Type.Array(Type.String({ maxLength: 1000 }), {
      maxItems: 32,
    }),
    blocked: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 32 }),
    nextSteps: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 32 }),
  },
  { additionalProperties: false },
);

export type ValidatedNarrative = Static<typeof BastionNarrativeSchema>;

export function isValidNarrative(value: unknown): value is ValidatedNarrative {
  return (
    Value.Check(BastionNarrativeSchema, value) &&
    JSON.stringify(value).length <= 24_000
  );
}
