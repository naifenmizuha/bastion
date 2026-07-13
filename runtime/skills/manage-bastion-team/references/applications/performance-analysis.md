# Application: Performance Analysis

Use for multi-step latest-game analysis, one-game player analysis, or cross-period player review. This application name is not a `teamops` command. A simple latest score needs only `game list --limit 1` and does not need this application.

## Registered commands used

- CLI: `game list`
- CLI: `game read`
- CLI: `game analysis list`
- CLI: `game analysis generate`
- CLI: `game analysis generate-batch`
- CLI: `game analysis read`
- CLI: `player read`
- CLI: `person analysis read`

Read [Game and Analysis CLI](../cli/games-and-analysis.md) and [Player and Report CLI](../cli/players-and-reports.md).

## Latest game

1. Use `game list --limit 1`.
2. Use `game read --id ID` only when the user needs attached lineup or event detail.
3. Read existing analysis when available. Generate it only when requested or required for the answer and the game is analyzable.

## Player period

1. Resolve the player with `player read`, preferring a known key.
2. Use one `person analysis read` with inclusive concrete dates; never loop game by game.
3. Report data gaps and limitations alongside conclusions.

## Bulk refresh

Use `game analysis generate-batch` rather than looping. Select `missing`, `stale`, or `all` from the user's intent; default to `missing`.

## Execution rules

- Do not use `batch read` for a single latest game or one period analysis.
- Analysis generation is `compute_write`; it does not request user write confirmation. Generate only when the user's requested result requires persisted analysis.
- If generation fails, do not claim analysis exists. Report the failure or read a previously persisted analysis when it still satisfies the request.

## Final answer

Use successful `game read`, `game analysis read`, or `person analysis read` results as final fact sources. Separate authoritative game facts, persisted generated analysis, and model interpretation.
