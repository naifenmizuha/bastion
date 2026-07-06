# Candidate and official lineups

## Commands

```text
lineup validate
lineup write
lineup read --id ID
lineup list [--game-id ID] [--status validated|accepted|rejected|superseded]
lineup accept --id ID
lineup reject --id ID
```

## Workflow

1. Read the target game and registered players.
2. Read relevant person analysis when recent performance affects selection.
3. Generate a candidate and call `lineup validate` first.
4. Inspect `data.valid`, errors, and warnings. `ok:true` does not imply the
   candidate itself is valid.
5. Call `lineup write` only when the user wants to save the candidate.
6. For an explicit decision such as “直接采用”“接受” or “生效”, call
   `lineup accept` before claiming the lineup is active; use `lineup reject`
   for explicit rejection.

## Candidate input

```json
{
  "args": ["lineup", "validate"],
  "input": {
    "schema_version": "1.0",
    "game_id": 12,
    "strategy": "优先守备稳定性",
    "starters": [
      {"player": "张三", "position": "P", "batting_order": 1}
    ],
    "bench": [
      {"player": "李四", "suggested_role": "outfield_substitute"}
    ],
    "pitching_plan": [
      {"player": "张三", "role": "starter", "planned_innings": 4}
    ],
    "reasoning": ["张三担任先发投手"]
  }
}
```

Use the same `input` with `args: ["lineup", "write"]` only when saving is
requested.

- Required: `schema_version`, `game_id`, `starters`
- Schema version: `1.0`
- Positions: `P`, `C`, `1B`, `2B`, `3B`, `SS`, `LF`, `CF`, `RF`
- Batting order: integers 1–9
- Pitching roles: `starter`, `reliever`
- Omit optional arrays or provide arrays; do not add unknown fields.

Treat CLI validation as authoritative. Correct only the fields identified by
structured issues, then validate again.
