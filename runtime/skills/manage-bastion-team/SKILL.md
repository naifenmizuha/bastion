---
name: manage-bastion-team
description: "Query and manage Bastion's authoritative baseball team data through the registered teamops tool. Use for team identity, rosters, players, reports, games, events, performance analysis, lineups, drill recommendations, reviews, approved training, and multi-step team-management workflows."
---

# Manage Bastion Team

Use `teamops` as the only authority for persisted team facts. Never inspect
SQLite, run the CLI through a shell, or invent a command or flag.

## Two-layer workflow

1. Always read the one relevant CLI capability reference before calling
   `teamops`. It is the exhaustive command and parameter layer.
2. For a request requiring multiple dependent commands, also read the one
   relevant application reference. Applications only compose registered CLI
   commands; their names are never tool commands.
3. Use the fewest calls and the narrowest list filters that satisfy the request.

Examples contain placeholders, never database facts. Resolve every team name, player,
date, id, and current state through `teamops`.

## Layer 1: CLI capabilities

- Team identity and registration: [teams.md](references/cli/teams.md)
- Players and reports: [players-and-reports.md](references/cli/players-and-reports.md)
- Games and analysis: [games-and-analysis.md](references/cli/games-and-analysis.md)
- Candidate and official lineups: [lineups.md](references/cli/lineups.md)
- Drill recommendations and reviews: [drills.md](references/cli/drills.md)
- Tool protocol, batches, results, and errors: [protocol.md](references/cli/protocol.md)

For simple reads, stop after the CLI layer:

- "What team are we?" -> `team list`
- "Who is on our roster?" -> `player list --scope own`
- "What was the latest game?" -> `game list --limit 1`

`team info` is not a command. If the CLI layer does not list a command, do not
call it. Do not replace a direct team read with an unfiltered player list.

## Layer 2: application recipes

Recipe names are not CLI commands.

- Initialize a team and roster: [team-onboarding.md](references/applications/team-onboarding.md)
- Record a game and generate analysis: [game-recording.md](references/applications/game-recording.md)
- Analyze a game or player period: [performance-analysis.md](references/applications/performance-analysis.md)
- Validate, save, and activate a lineup: [lineup-lifecycle.md](references/applications/lineup-lifecycle.md)
- Submit and review training recommendations: [training-review.md](references/applications/training-review.md)

Do not load an application for a request that one CLI command can answer.

## Protocol invariants

Pass subcommand and flag tokens in `args`; pass an object in `input` only when
the CLI reference marks it required. Never include `--db`, `--format`, or
`--input`; the tool owns those protocol details.

Treat only top-level `ok:true` as success. Writes request confirmation and may
include verification; do not repeat a verified read-back. On `USER_CANCELLED`,
stop immediately. On timeout, abort, or failed verification, report uncertainty
and refresh current state before a future overlapping write.

Use `derived_memory` only for reusable conclusions supported by at least two
distinct successful reads. Never use it instead of an authoritative refresh for
a write. Do not pass identity fields; Runtime supplies the trusted principal.
