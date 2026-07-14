# Application: Team Onboarding

Use when the user wants to initialize a new team, register opponents, or build a roster. This application name is not a `teamops` command.

## Registered commands used

- CLI: `team list`
- CLI: `team init`
- CLI: `team add`
- CLI: `player list`
- CLI: `player add`
- CLI: `batch write`

Read [Team CLI](../cli/teams.md), [Player and Report CLI](../cli/players-and-reports.md), and [Protocol](../cli/protocol.md).

## Flow

1. Call `team list` to determine whether an own team already exists.
2. If uninitialized, ask for the actual own-team name when absent, then call `team init` after confirmation.
3. Register only opponents explicitly needed with `team add`.
4. Check the narrowest roster scope before adding players; use `player list --scope own` for the own roster or `--team` for an opponent.
5. Add players with `player add`; never supply a player key.
6. Use `batch write` only when the user explicitly approved multiple ordered additions. A partially failed batch requires authoritative reads before retrying.

## Final answer

Use verified write results and authoritative roster reads as final fact sources. Report only successfully initialized or verified records. Distinguish existing records from newly created ones.
