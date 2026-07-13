# Application: Lineup Lifecycle

Use when a user wants a candidate lineup created, checked, saved, accepted, or rejected. This application name is not a `teamops` command.

## Registered commands used

- CLI: `game read`
- CLI: `player list`
- CLI: `person analysis read`
- CLI: `lineup validate`
- CLI: `lineup write`
- CLI: `lineup read`
- CLI: `lineup list`
- CLI: `lineup accept`
- CLI: `lineup reject`

Read [Lineup CLI](../cli/lineups.md), [Game and Analysis CLI](../cli/games-and-analysis.md), and [Player and Report CLI](../cli/players-and-reports.md).

## Flow

1. Read the target game and the own roster with `player list --scope own`.
2. Read person analysis only when recent performance materially affects selection.
3. Build a candidate from authoritative availability and user strategy.
4. Call `lineup validate`; inspect `valid` and every structured issue.
5. Call `lineup write` only when the user asks to save the valid candidate.
6. Saving does not activate it. Call `lineup accept --id ID` only when the user asks to adopt, use, activate, or make it official.
7. Call `lineup reject --id ID` only for an explicit rejection.

## Execution rules

- Request write confirmation for each save, accept, or reject transition.
- Do not batch lifecycle transitions; each verified state is a precondition for the next command.
- If a write fails or verification is uncertain, refresh with `lineup read` or the narrowest `lineup list` before retrying.

## Final answer

Use the verified lineup result as the final fact source. Use exact states: validated, saved, accepted, rejected, or superseded. Say "official" only after acceptance succeeds.
