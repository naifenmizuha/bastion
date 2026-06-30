# Games and performance analysis

## Commands

```text
game list [--date YYYY-MM-DD]
game read --id ID
game write
game create
game lineup add
game event write
game score set
game analysis generate
game analysis read --game-id ID [--player NAME]
game analysis list
person analysis read --name NAME --from YYYY-MM-DD --to YYYY-MM-DD
```

Use `game write` for an available complete record. Use `game create`, then
`game lineup add`, `game event write`, and `game score set` when facts arrive
incrementally.

## Game inputs

Create:

```json
{
  "args": ["game", "create"],
  "input": {
    "date": "2026-06-30",
    "start_time": "19:00",
    "opponent": "海港队",
    "batting_side": "top",
    "raw": "赛前创建"
  }
}
```

Complete write adds required `own_score`, `opponent_score`, and optional
`lineups` and `events`. `start_time`, `lineups`, and `events` may be omitted;
the other complete-write fields are required.

Lineup record:

```json
{
  "args": ["game", "lineup", "add"],
  "input": {"game_id": 1, "team": "own", "player": "张三", "batting_order": 1, "starting_position": "P"}
}
```

Score:

```json
{
  "args": ["game", "score", "set"],
  "input": {"game_id": 1, "own_score": 5, "opponent_score": 3}
}
```

## Events

```json
{
  "args": ["game", "event", "write"],
  "input": {
    "game_id": 1,
    "events": [{
      "inning": 1,
      "half": "top",
      "play_no": 1,
      "sequence": 1,
      "event_kind": "plate_result",
      "player": "张三",
      "team": "own",
      "result": "single",
      "related_player": "对方投手",
      "pitch_sequence": "B,X",
      "description": "张三一垒安打"
    }]
  }
}
```

- `batting_side`, `half`: `top`, `bottom`
- `team`: `own`, `opponent`
- `event_kind`: `plate_result`, `runner_movement`, `fielding_credit`
- Plate results: `single`, `double`, `triple`, `homerun`, `walk`,
  `hit_by_pitch`, `strikeout`, `groundout`, `flyout`, `reached_on_error`,
  `fielders_choice`, `sacrifice`, `other`
- Runner results: `advance`, `run_scored`, `out`
- Runner reasons: `batted_ball`, `stolen_base`, `caught_stealing`,
  `wild_pitch`, `passed_ball`, `balk`, `pickoff`, `error`,
  `fielders_choice`, `other`
- Fielding results: `putout`, `assist`, `error`, `double_play`,
  `passed_ball`, `outfield_assist`, `other`
- Starting positions: `P`, `C`, `1B`, `2B`, `3B`, `SS`, `LF`, `CF`, `RF`

Do not infer unreported events.

## Analysis

Generate a single-game analysis with:

```json
{
  "args": ["game", "analysis", "generate"],
  "input": {"game_id": 1}
}
```

Generation persists derived data without confirmation and is automatically
verified. Generate only after the game has analyzable events. Cross-period
analysis requires a registered player and an inclusive date range.
