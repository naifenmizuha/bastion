# Player and Report CLI

All example names and dates are placeholders, not persisted facts.

## `player add`

- Purpose: add an own-team or registered opponent player.
- Risk: `write`
- Input: `required`
- Syntax: `player add`
- Required input fields: `name`, `number`, `bat`, `throw`, `positions`
- Optional input fields: `team`; omit for the own team.
- Values: hands `left|right`; positions `pitcher|catcher|first_base|second_base|third_base|shortstop|outfield`, comma-separated when multiple.
- Returns: `id`, generated `player_key`, `name`, and `created`. Never provide `player_key` on add.
- Errors: conflicting same-team identity returns the existing key; opponent must be registered.

```json
{"args":["player","add"],"input":{"name":"<PLAYER>","number":18,"bat":"right","throw":"right","positions":"pitcher"}}
```

## `player read`

- Purpose: read exactly one registered player.
- Risk: `read`
- Input: `forbidden`
- Syntax: `player read (--key KEY | --id ID | --name NAME [--team TEAM])`
- Flags: exactly one of `--key`, `--id`, or `--name`; `--team` is valid only with `--name`.
- Returns: identity, team/scope, profile, and update time.
- Errors: `not_found`, or ambiguity/invalid flags when selectors are incorrect.

## `player list`

- Purpose: list registered players with the narrowest applicable filter.
- Risk: `read`
- Input: `forbidden`
- Syntax: `player list [--team TEAM] [--scope own|opponent]`
- Flags: optional `--team`, optional `--scope`.
- Returns: matching player profiles.
- Filtering: use `player list --scope own` for the own roster. Never fetch every league player unless explicitly requested.

## `report write`

- Purpose: save or replace one own-player self-training report for a date.
- Risk: `write`
- Input: `required`
- Syntax: `report write`
- Required input fields: `name`, `date`, `content`, `reflection`
- Values: `date` is concrete `YYYY-MM-DD`; resolve the own player first.
- Returns: persisted report identity and verification.
- Errors: `not_found` for a non-own or unknown player; invalid date/value errors.

```json
{"args":["report","write"],"input":{"name":"<PLAYER>","date":"<YYYY-MM-DD>","content":"<CONTENT>","reflection":"<REFLECTION>"}}
```

## `report read`

- Purpose: read one dated training report.
- Risk: `read`
- Input: `forbidden`
- Syntax: `report read --name NAME --date YYYY-MM-DD`
- Flags: `--name` required; `--date` required.
- Returns: one report with player linkage and update time.
- Errors: `not_found` when that player/date record is absent. There is no `report list` command.
