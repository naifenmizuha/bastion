# Application: Game Recording and Analysis

Use when the user wants to persist a complete game, accumulate partial game facts, or save a game and immediately generate analysis. This application name is not a `teamops` command.

## Registered commands used

- CLI: `team list`
- CLI: `team add`
- CLI: `game write`
- CLI: `game create`
- CLI: `game lineup add`
- CLI: `game event validate`
- CLI: `game event write`
- CLI: `game score set`
- CLI: `game analysis generate`
- CLI: `game analysis read`
- CLI: `batch write`

Read [Game and Analysis CLI](../cli/games-and-analysis.md), [Team CLI](../cli/teams.md), and [Protocol](../cli/protocol.md).

## Complete record

1. Resolve the own team and opponent; register a missing opponent only with explicit write approval.
2. Validate that all required game and event facts are present.
3. Ask for write confirmation, then prefer one `game write` containing all lineups and events.
4. If the saved game is final and events are analyzable, call `game analysis generate`, then `game analysis read`.

## Incremental record

1. Use `game create`, followed by any `game lineup add`, one complete `game event write`, and `game score set` when the final score is known.
2. Prefer one `batch write` only when the user approved the full ordered write set.
3. Validate events before asking for write approval when missing facts are possible.
4. If an operation fails, do not assume later steps ran; refresh any potentially persisted earlier steps.

## Final answer

Use verified game writes and successful analysis reads as final fact sources. Distinguish saved game facts from generated analysis. Do not claim analysis exists until generation and read both succeed.
