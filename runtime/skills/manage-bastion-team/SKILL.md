---
name: manage-bastion-team
description: Use Bastion's authoritative baseball CLI through the bastion_cli tool to query or change players, training reports, games, performance analysis, lineups, drill recommendations, reviews, and approved training. Use for natural-language baseball team management tasks that need Bastion data, validation, analysis, or persistence.
---

# Manage Bastion Team

Use `bastion_cli` as the only authority for persisted team facts. Do not invoke
the executable through a shell, inspect SQLite directly, or invent unsupported
commands.

## Select references

Read only the references needed for the request:

- Players, roster, or self-training reports: [players-and-reports.md](references/players-and-reports.md)
- Games, events, scores, or performance analysis: [games-and-analysis.md](references/games-and-analysis.md)
- Candidate or official lineups: [lineups.md](references/lineups.md)
- Drill recommendations, reviews, or approved training: [drills.md](references/drills.md)
- Tool protocol, writes, failures, or uncertainty: [protocol-and-safety.md](references/protocol-and-safety.md)

Read multiple domain references only for genuinely cross-domain work.

## Follow the workflow

1. Classify the request as read, validation/analysis, candidate creation, or
   authoritative change.
2. Resolve names, ids, dates, and current state with read commands. Never guess
   an identifier or missing fact.
3. Ask the user only when a missing value would materially change the action and
   cannot be uniquely resolved through reads.
4. Call `bastion_cli` with command and flags as separate `args` tokens. Put
   structured command payloads in `input`.
5. Treat only `ok: true` as CLI success. For lineup validation, also inspect
   `data.valid`; a valid CLI response may describe an invalid lineup.
6. Let the tool request confirmation for writes and perform read-back
   verification. Never claim success while confirmation was cancelled or
   verification failed.
7. On a structured error, change the input, disambiguate with a read, ask the
   user, or stop. Never retry the same validation error unchanged.
8. In the answer, distinguish authoritative facts, model suggestions, and
   changes that were actually persisted.

## Preserve protocol boundaries

- Omit `--db`, `--format`, and `--input`; the tool owns them.
- Do not pass `input` to query-only commands.
- Do not request TOML or text output.
- Do not use a nearby command when the requested capability is unsupported.
- Treat timeout or failed verification as an uncertain write state; report it
  rather than replaying the write.
