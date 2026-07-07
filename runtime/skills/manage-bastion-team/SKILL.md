---
name: manage-bastion-team
description: Use Bastion's authoritative baseball CLI through the bastion_cli tool to query or change players, training reports, games, performance analysis, lineups, drill recommendations, reviews, and approved training. Use for natural-language baseball team management tasks that need Bastion data, validation, analysis, or persistence.
---

# Manage Bastion Team

Use `bastion_cli` as the only authority for persisted team facts. Do not run the
CLI through a shell, inspect SQLite, or invent unsupported commands.

## CLI quick manual

Call `bastion_cli` with `args` as separate command/flag tokens. Put structured
payloads in `input`. Never include `--db`, `--format`, or `--input`; the tool
owns those protocol details.

Read:

```json
{"args":["player","read","--name","张三"]}
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
2. Resolve names, ids, dates, and current state with reads. Never guess ids or
   missing facts.
3. Prefer `batch read` for several independent reads and `batch write` for one
   user-approved ordered change that contains several commands.
4. For complete game data, prefer `game write`; for incremental game data,
   prefer `batch write`; after saving a game with analyzable events, run
   `game analysis generate` then `game analysis read`.
5. For lineups, `lineup write` only saves a candidate. If the user asks to
   adopt, accept, or make it active, call `lineup accept` and say it was
   accepted only after success.
6. On `USER_CANCELLED`, stop immediately and state that nothing was saved by
   that cancelled attempt. Do not retry.
7. Keep final answers short when requested. Distinguish persisted facts,
   validated candidates, and model suggestions.

## Derived memory

Use `derived_memory` only for reusable conclusions derived from at least two
distinct successful `bastion_cli` reads. Search before repeating complex
cross-game, cross-player, or cross-time analysis. Never use derived memory
instead of refreshing authoritative facts required for a write.
