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
batch read
batch write
```

Use `game write` for an available complete record. Use `game create`, then
`game lineup add`, `game event write`, and `game score set` when facts arrive
incrementally.
Use `batch read` for several known games or analyses. Use `batch write` for an
ordered incremental update such as create game, add lineup records, write
events, and set score after all payloads are known. Keep one game's event facts
inside a single `game event write` operation; do not split individual events
across batch operations.

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

Use `top|bottom`, `own|opponent`, and event kinds `plate_result`,
`runner_movement`, or `fielding_credit`. Preflight returns allowed values for
invalid enums. Never infer unreported facts; ask once for all reported issues
and do not submit a partial batch.

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
