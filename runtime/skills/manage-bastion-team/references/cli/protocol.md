# TeamOps Protocol and Batch CLI

Use this reference for call shape, batches, approvals, results, and failures.

## `batch read`

- Purpose: execute several independent read-only or validation operations.
- Risk: `read`
- Input: `required`
- Syntax: `batch read`
- Required input fields: `operations`
- Values: each operation has registered `args` and optional required `input`; do not nest batches.
- Returns: ordered inner command results.
- Errors: rejects any write/compute-write operation.

## `batch write`

- Purpose: execute explicitly approved ordered operations with one confirmation.
- Risk: `write`
- Input: `required`
- Syntax: `batch write`
- Required input fields: `operations`
- Values: each operation has registered `args` and optional required `input`; do not nest batches.
- Returns: ordered results and verification for successful writes.
- Failure: earlier successful operations may already persist; refresh before retrying.

## Call shape

Pass CLI tokens in `args`. Supply an object in `input` only for commands marked
`required`. Never pass `--db`, `--format`, or `--input`.

```json
{"args":["player","read","--name","<PLAYER>"]}
```

## Result and error decisions

- Trust only top-level `ok:true`; `cli.ok` alone is insufficient.
- Trust successful write verification and do not repeat its read-back.
- On `USER_CANCELLED`, stop without retrying.
- On `TIMEOUT`, `ABORTED`, or `WRITE_VERIFICATION_FAILED`, report uncertainty and refresh before overlapping writes.
- On `missing_required`, `unknown_field`, `parse_error`, or `invalid_value`, correct once from the relevant CLI reference.
- On `not_found`, resolve with the narrowest list/read or ask the user.
- On `conflict`, read current state; do not overwrite silently.
- On `UNCLASSIFIED_COMMAND` or `INVALID_FLAGS`, stop. Never invent a replacement.
- On `CLI_NOT_AVAILABLE`, ask the operator to build `out/teamops`.
