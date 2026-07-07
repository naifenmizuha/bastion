# Protocol and Safety

## When to use

Use this reference when unsure about `bastion_cli` call shape, write approval,
batch behavior, cancellation, failed verification, or error handling.

## Commands

All registered domain commands use the same tool protocol. The tool owns the
database, JSON mode, stdin transport, approval UI, and write verification.

## Minimal workflow

1. Pass only Bastion subcommand tokens in `args`.
2. Pass JSON object payloads in `input` only for commands that require them.
3. Never include `--db`, `--format`, or `--input`.
4. Treat top-level `ok:true` as success and top-level `ok:false` as failure.
5. For writes, trust successful `verification`; do not repeat the same read.
6. On `USER_CANCELLED`, stop immediately. Do not retry the write or batch.
7. On timeout, abort, or failed verification, report uncertainty and read
   current state before any future overlapping write.

## Required input notes

Read call:

```json
{"args":["player","read","--name","张三"]}
```

Structured input:

```json
{"args":["report","write"],"input":{"name":"张三","date":"2026-06-30","content":"打击训练","reflection":"节奏稳定"}}
```

Batch read:

```json
{"args":["batch","read"],"input":{"operations":[{"args":["player","read","--name","张三"]},{"args":["report","read","--name","张三","--date","2026-06-30"]}]}}
```

Batch write:

```json
{"args":["batch","write"],"input":{"operations":[{"args":["player","add"],"input":{"name":"张三","number":18,"bat":"right","throw":"right","positions":"pitcher"}},{"args":["report","write"],"input":{"name":"张三","date":"2026-06-30","content":"打击训练","reflection":"节奏稳定"}}]}}
```

- `batch read` accepts only read-only or validation commands.
- `batch write` asks for one confirmation and verifies every successful inner
  write with its normal read-back policy.
- Do not nest `batch`.
- If a batch write fails after earlier operations, assume earlier successful
  operations may already be persisted until authoritative reads prove otherwise.

## Result handling

Tool result content is compact JSON:

```json
{"ok":true,"command":["player","read","--name","张三"],"risk":"read","cli":{"ok":true,"data":{}}}
```

Writes include `approved` and often `verification`. A write is complete only
when top-level `ok` is true. `WRITE_VERIFICATION_FAILED` means the write may
have occurred but was not confirmed.

## Error decisions

| Code | Action |
| --- | --- |
| `INVALID_INPUT` | Read `error.details.contract` or `error.details.issues`; correct payload or ask for missing facts |
| `missing_required`, `unknown_field`, `parse_error`, `invalid_value` | Correct once using the relevant reference; do not retry unchanged |
| `not_found` | Resolve by list/read or ask the user |
| `conflict` | Read current state and explain; do not overwrite |
| `USER_CANCELLED` | Stop and say the cancelled write was not saved |
| `APPROVAL_REQUIRED` | Explain that interactive confirmation is required |
| `TIMEOUT`, `ABORTED` | Do not replay; read current state first |
| `UNCLASSIFIED_COMMAND`, `INVALID_FLAGS` | Stop; command or flags are unsupported |
| `CLI_NOT_AVAILABLE` | Ask the operator to build `out/bastion` |
| `WRITE_VERIFICATION_FAILED` | Report uncertain write and show verification evidence |

Never query SQLite or fall back to shell commands.
