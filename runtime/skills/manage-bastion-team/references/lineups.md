# Candidate and Official Lineups

## When to use

Use this reference for generated lineup candidates, validation, saving,
acceptance into the official game lineup, and rejection.

## Commands

```text
lineup validate
lineup write
lineup read --id ID
lineup list [--game-id ID] [--status validated|accepted|rejected|superseded]
lineup accept --id ID
lineup reject --id ID
batch read
batch write
```

## Minimal workflow

1. Read the target game and registered players.
2. Read person analysis only when recent performance affects selection.
3. Call `lineup validate` before saving. Inspect `cli.data.valid`; top-level
   `ok:true` can still describe an invalid candidate.
4. Call `lineup write` only when the user wants to save the candidate.
5. `lineup write` only saves a candidate. If the user says adopt, accept,
   use, active, or 生效, call `lineup accept --id ID`.
6. Final answer must distinguish validated, saved, rejected, and accepted. Say
   "accepted" only after `lineup accept` succeeds.

Use `batch read` for several candidate lineups or a game plus candidates. Use
`batch write` only for explicit ordered decisions, such as saving and accepting
a candidate after the user approved both steps.

## Required input notes

```json
{"args":["lineup","validate"],"input":{"schema_version":"1.0","game_id":12,"strategy":"优先守备稳定性","starters":[{"player":"张三","position":"P","batting_order":1}],"bench":[{"player":"李四","suggested_role":"outfield_substitute"}],"pitching_plan":[{"player":"张三","role":"starter","planned_innings":4}],"reasoning":["张三担任先发投手"]}}
```

Use the same `input` with `args:["lineup","write"]` only when saving is
requested.

- Required: `schema_version`, `game_id`, `starters`
- Schema version: `1.0`
- Positions: `P`, `C`, `1B`, `2B`, `3B`, `SS`, `LF`, `CF`, `RF`
- Batting order: integers 1-9
- Pitching roles: `starter`, `reliever`
- Omit optional arrays or provide arrays; do not add unknown fields.

Treat validation issues as authoritative. Correct only fields identified by
structured issues, then validate again.
