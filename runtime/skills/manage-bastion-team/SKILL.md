---
name: manage-bastion-team
description: "Use the teamops tool to query or change Bastion's authoritative baseball team data: players, training reports, games, performance analysis, lineups, drill recommendations, reviews, and approved training. Use for natural-language baseball team management tasks that need Bastion data, validation, analysis, or persistence."
---

# Manage Bastion Team

Use `teamops` as the only authority for persisted team facts. Do not run the CLI
through a shell, inspect SQLite, or invent unsupported commands. A new database
must first be initialized with `team init`; register every opponent
with `team add` before recording a game against it.

## CLI quick manual

Call `teamops` with `args` as separate command/flag tokens. Put structured
payloads in `input`. Never include `--db`, `--format`, or `--input`; the tool
owns those protocol details.

Read:

```json
{"args":["player","read","--name","张三"]}
```

Team setup:

```json
{"args":["team","init"],"input":{"own_team":"堡垒队"}}
{"args":["team","add"],"input":{"name":"海港队"}}
```

Opponent players use the same player command with a team field and remain
isolated from reports, drills, and generated own-team lineups:

```json
{"args":["player","add"],"input":{"team":"海港队","name":"王五","number":9,"bat":"left","throw":"right","positions":"outfield"}}
```

Structured write:

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

Treat only top-level `ok: true` as success. Writes request confirmation and
return `verification`; do not repeat a verified read-back. If `ok: false`, use
the error code to correct input, ask once for missing facts, or stop.

## Select references

Read only the references needed for the request:

- Players, roster, or self-training reports: [players-and-reports.md](references/players-and-reports.md)
- Games, events, scores, or performance analysis: [games-and-analysis.md](references/games-and-analysis.md)
- Candidate or official lineups: [lineups.md](references/lineups.md)
- Drill recommendations, reviews, or approved training: [drills.md](references/drills.md)
- Protocol, write safety, cancellation, or uncertainty: [protocol-and-safety.md](references/protocol-and-safety.md)

Read multiple domain references only for genuinely cross-domain work.

## Workflow

1. Classify the task: read, validate/analyze, create candidate, or persist.
2. Resolve names, ids, dates, and current state with reads. Never guess missing facts.
3. Prefer `batch read` for several independent reads and `batch write` for one
   user-approved ordered change that contains several commands.
4. For complete game data, prefer `game write`; for incremental game data,
   prefer `batch write`; after saving a game with analyzable events, run
   `game analysis generate` then `game analysis read`.
5. For lineups, `lineup write` only saves a candidate. If the user asks to
   adopt, accept, or make it active, call `lineup accept` and say it was
   accepted only after success.
6. On `USER_CANCELLED`, stop immediately, do not retry, and state nothing was saved.
7. Keep final answers short when requested. Distinguish persisted facts,
   validated candidates, and model suggestions.

## Derived memory

Use `derived_memory` only for reusable conclusions from at least two distinct
successful `teamops` reads. Search before repeating complex
cross-game, cross-player, or cross-time analysis. Never use derived memory
instead of refreshing authoritative facts required for a write. New memories are private.
Publish only after explicit sharing requests: players may publish to `team`,
while coaches and administrators may publish to `staff`
or `team`. Withdraw or forget only with explicit user confirmation. Never ask
for or pass user, team, role, player, or authority identity fields; the Runtime
supplies the trusted principal.
