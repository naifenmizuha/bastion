# Tool protocol and safety

## Call shape

```json
{
  "args": ["player", "read", "--name", "张三"]
}
```

Commands with structured input use:

```json
{
  "args": ["report", "write"],
  "input": {
    "name": "张三",
    "date": "2026-06-30",
    "content": "打击训练 100 球",
    "reflection": "外角球仍需加强"
  }
}
```

Never include `--db`, `--format`, or `--input`. The tool injects the configured
database, forces JSON, and sends `input` over stdin.

## Result

The tool returns:

```json
{
  "ok": true,
  "command": ["player", "read", "--name", "张三"],
  "risk": "read",
  "cli": {"ok": true, "data": {}}
}
```

Writes also include `verification`. A write is complete only when the top-level
`ok` is true. `WRITE_VERIFICATION_FAILED` means the write may have occurred but
could not be confirmed.

## Confirmation

All business writes require an exact TUI confirmation except
`game analysis generate`, which persists derived analysis automatically.
Cancelling confirmation means no CLI process was started. Non-interactive
sessions reject writes with `APPROVAL_REQUIRED`.

## Error decisions

| Code | Action |
| --- | --- |
| `INVALID_INPUT` | Read `error.details.contract`, supply the command's required `input`, and never copy example values as user facts |
| `missing_required`, `unknown_field`, `parse_error`, `invalid_value` | Correct the payload using the relevant reference; do not retry unchanged |
| `not_found` | Resolve the name/id through a list/read command or ask the user |
| `conflict` | Read current state and explain the conflict; do not overwrite |
| `USER_CANCELLED` | Stop and acknowledge cancellation |
| `APPROVAL_REQUIRED` | Explain that an interactive confirmation is required |
| `TIMEOUT`, `ABORTED` | Do not replay a write; read current state first |
| `UNCLASSIFIED_COMMAND`, `INVALID_FLAGS` | Stop; the requested command is unsupported or the Skill is stale |
| `CLI_NOT_AVAILABLE` | Ask the operator to build `out/bastion` |
| `WRITE_VERIFICATION_FAILED` | Report an uncertain write and show the failed verification |

Never query SQLite or fall back to a shell.
