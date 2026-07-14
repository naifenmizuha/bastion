# Lineup CLI

Candidates and official game lineups are distinct states.

## `lineup validate`

- Purpose: validate a candidate without saving it.
- Risk: `read`
- Input: `required`
- Syntax: `lineup validate`
- Required input fields: `schema_version`, `game_id`, `starters`
- Optional input fields: `strategy`, `bench`, `pitching_plan`, `reasoning`.
- Values: schema `1.0`; positions `P|C|1B|2B|3B|SS|LF|CF|RF`; batting order 1-9; pitching roles `starter|reliever`.
- Returns: validation result. Top-level `ok:true` may contain `valid:false`; inspect structured issues.

## `lineup write`

- Purpose: save a candidate; it does not activate the lineup.
- Risk: `write`
- Input: `required`
- Syntax: `lineup write`
- Required input fields: `schema_version`, `game_id`, `starters`
- Optional input fields and values: identical to `lineup validate`.
- Returns: saved candidate id and status with verification.

## `lineup read`

- Purpose: read one candidate or official lineup.
- Risk: `read`
- Input: `forbidden`
- Syntax: `lineup read --id ID`
- Flags: `--id` required.
- Returns: lineup status, starters, bench, pitching plan, reasoning, and timestamps.

## `lineup list`

- Purpose: list lineups with optional narrowing.
- Risk: `read`
- Input: `forbidden`
- Syntax: `lineup list [--game-id ID] [--status STATUS]`
- Flags: optional `--game-id`; optional `--status` with `validated|accepted|rejected|superseded`.
- Returns: matching lineup summaries.

## `lineup accept`

- Purpose: make a saved candidate the active official lineup for its game.
- Risk: `write`
- Input: `forbidden`
- Syntax: `lineup accept --id ID`
- Flags: `--id` required.
- Returns: accepted status and official game-lineup verification; supersedes a previous accepted candidate.

## `lineup reject`

- Purpose: reject a saved candidate.
- Risk: `write`
- Input: `forbidden`
- Syntax: `lineup reject --id ID`
- Flags: `--id` required.
- Returns: rejected status with verification.
