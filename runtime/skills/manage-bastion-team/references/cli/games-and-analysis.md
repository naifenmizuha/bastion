# Game and Analysis CLI

All names, dates, ids, scores, and event values in examples are placeholders.

## Contents

- Game records: `game write`, `game create`, `game read`, `game list`
- Attached facts: `game lineup add/list`, `game event validate/write/list`, `game score set`
- Analysis: `game analysis generate/generate-batch/read/list`, `person analysis read`

## `game write`

- Purpose: write one complete game with optional lineups and events.
- Risk: `write`
- Input: `required`
- Syntax: `game write`
- Required input fields: `date`, `opponent`, `batting_side`, `own_score`, `opponent_score`, `raw`
- Optional input fields: `start_time`, `lineups`, `events`.
- Values: date `YYYY-MM-DD`; time `HH:MM`; batting side `top|bottom`; opponent must be registered.
- Returns: game id and verification.

## `game create`

- Purpose: create an incomplete game before facts arrive.
- Risk: `write`
- Input: `required`
- Syntax: `game create`
- Required input fields: `date`, `opponent`, `batting_side`, `raw`
- Optional input fields: `start_time`.
- Returns: game id and verification.

## `game read`

- Purpose: read a complete game snapshot by id.
- Risk: `read`
- Input: `forbidden`
- Syntax: `game read --id ID`
- Flags: `--id` required.
- Returns: game header, score, attached lineups, and events.

## `game list`

- Purpose: list games with narrow filters, newest first.
- Risk: `read`
- Input: `forbidden`
- Syntax: `game list [--date DATE] [--from DATE] [--to DATE] [--opponent TEAM] [--final BOOL] [--result RESULT] [--limit N] [--offset N]`
- Flags: optional `--date`, `--from`, `--to`, `--opponent`, `--final`, `--result`, `--limit`, `--offset`.
- Values: result `win|loss|tie|in_progress`; limits and offsets are non-negative.
- Filtering: use `game list --limit 1` for the latest game; never fetch all games first.

## `game lineup add`

- Purpose: add one own or opponent lineup entry to an existing game.
- Risk: `write`
- Input: `required`
- Syntax: `game lineup add`
- Required input fields: `game_id`, `team`
- Optional input fields: `player_key`, `player`, `batting_order`, `starting_position`; provide a key or name.
- Values: team `own|opponent`; position `P|C|1B|2B|3B|SS|LF|CF|RF`.
- Returns: lineup-entry id and verification.

## `game lineup list`

- Purpose: list lineup entries for one game.
- Risk: `read`
- Input: `forbidden`
- Syntax: `game lineup list --game-id ID [--team own|opponent]`
- Flags: `--game-id` required; optional `--team`.
- Returns: matching game lineup entries.

## `game event validate`

- Purpose: validate a complete event batch without saving.
- Risk: `read`
- Input: `required`
- Syntax: `game event validate`
- Required input fields: `game_id`, `events`
- Returns: structured validity and all missing/invalid fact issues.

## `game event write`

- Purpose: persist a complete event batch for one game.
- Risk: `write`
- Input: `required`
- Syntax: `game event write`
- Required input fields: `game_id`, `events`
- Returns: inserted/updated counts, idempotence, and verification.
- Identity: prefer player keys; if key and name are both supplied they must match.
- Idempotence: `play_no` makes `(game, inning, half, play_no, sequence)` an upsert key; omitting it appends.

Event values:

- `event_kind`: `plate_result|runner_movement|fielding_credit`
- `half`: `top|bottom`; `team`: `own|opponent`
- Plate results require batter, opposing player, pitch sequence, and result.
- Runner movements require runner and base movement; include reason and run/RBI/earned facts when known.
- Treat `missing_required` as missing facts. Ask once for all reported issues; never rename fields or guess.

## `game event list`

- Purpose: read selected events from one game.
- Risk: `read`
- Input: `forbidden`
- Syntax: `game event list --game-id ID [--inning N] [--half top|bottom] [--player-key KEY] [--limit N] [--offset N]`
- Flags: `--game-id` required; optional `--inning`, `--half`, `--player-key`, `--limit`, `--offset`.
- Returns: matching events in recorded order.

## `game score set`

- Purpose: finalize or update a game's score.
- Risk: `write`
- Input: `required`
- Syntax: `game score set`
- Required input fields: `game_id`, `own_score`, `opponent_score`
- Returns: final score and verification.

## `game analysis generate`

- Purpose: generate and persist one game's derived player analysis.
- Risk: `compute_write`
- Input: `required`
- Syntax: `game analysis generate`
- Required input fields: `game_id`
- Returns: generated analysis id and deterministic verification; it does not request user confirmation.
- Preconditions: the game must be final and contain analyzable events.

## `game analysis generate-batch`

- Purpose: generate analyses across an inclusive date span.
- Risk: `compute_write`
- Input: `required`
- Syntax: `game analysis generate-batch`
- Required input fields: `from`, `to`
- Optional input fields: `mode` (`missing|stale|all`, default `missing`).
- Returns: matched/generated/skipped/failed counts and failures.

## `game analysis read`

- Purpose: read generated game analysis, optionally narrowed to one player.
- Risk: `read`
- Input: `forbidden`
- Syntax: `game analysis read --game-id ID [--player-key KEY | --player NAME [--team TEAM]]`
- Flags: `--game-id` required; optional `--player-key`, `--player`, `--team` with mutually exclusive selector forms.
- Returns: analysis header, summaries, batting, baserunning, pitching, fielding, and gaps.

## `game analysis list`

- Purpose: list games with persisted analysis.
- Risk: `read`
- Input: `forbidden`
- Syntax: `game analysis list`
- Flags: none.
- Returns: analysis summaries and generation timestamps.

## `person analysis read`

- Purpose: aggregate one registered player's performance across a date span.
- Risk: `read`
- Input: `forbidden`
- Syntax: `person analysis read (--player-key KEY | --name NAME [--team TEAM]) --from DATE --to DATE`
- Flags: exactly one of `--player-key` or `--name`; `--team` only with name; `--from` and `--to` required.
- Returns: inclusive cross-game batting, pitching, fielding, summaries, and limitations.
