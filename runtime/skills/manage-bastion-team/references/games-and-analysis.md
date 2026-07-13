# Games and Performance Analysis

## When to use

Use this reference for games, lineups attached to games, event facts, scores,
single-game analysis, and cross-period player analysis.

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
game analysis read --game-id ID [--player NAME] [--team TEAM]
game analysis list
person analysis read --name NAME [--team TEAM] --from YYYY-MM-DD --to YYYY-MM-DD
batch read
batch write
```

## Minimal workflow

1. If the user provides a complete game record, prefer one `game write`.
2. If facts arrive incrementally, prefer one `batch write` containing
   `game create`, any `game lineup add`, one `game event write`, and
   `game score set` in order.
3. Keep all event facts for one game inside a single `game event write`.
4. After saving a game with analyzable events, run `game analysis generate`,
   then `game analysis read`. Do not answer as if analysis exists before both
   calls succeed.
5. For cross-period analysis, verify the player exists and use one
   `person analysis read` with inclusive `--from` and `--to` dates.

## Required input notes

Complete game write:

```json
{"args":["game","write"],"input":{"date":"2026-06-30","start_time":"19:00","opponent":"海港队","batting_side":"top","own_score":5,"opponent_score":3,"raw":"比赛记录","lineups":[],"events":[]}}
```

- Required: `date`, `opponent`, `batting_side`, `own_score`,
  `opponent_score`, `raw`
- Optional: `start_time`, `lineups`, `events`
- `batting_side`: `top` or `bottom`

Incremental commands:

```json
{"args":["game","create"],"input":{"date":"2026-06-30","start_time":"19:00","opponent":"海港队","batting_side":"top","raw":"赛前创建"}}
{"args":["game","lineup","add"],"input":{"game_id":1,"team":"own","player":"张三","batting_order":1,"starting_position":"P"}}
{"args":["game","score","set"],"input":{"game_id":1,"own_score":5,"opponent_score":3}}
```

## Events

```json
{"args":["game","event","write"],"input":{"game_id":1,"events":[{"inning":1,"half":"top","play_no":1,"sequence":1,"event_kind":"plate_result","player":"张三","team":"own","result":"single","related_player":"对方投手","pitch_sequence":"B,X","description":"张三一垒安打"}]}}
```

- Use `top|bottom`, `own|opponent`.
- Event kinds: `plate_result`, `runner_movement`, `fielding_credit`.
- `plate_result` needs reported batter, opposing player, pitch sequence, and
  result.
- `runner_movement` needs reported runner, base movement, reason when known,
  and run/RBI/earned facts when scoring is reported.
- `missing_required` means the fact is missing, not that the field name should
  be renamed. Do not guess or loop. Ask once for all missing facts shown in
  `error.details.issues`.

## Analysis

```json
{"args":["game","analysis","generate"],"input":{"game_id":1}}
{"args":["game","analysis","read","--game-id","1"]}
```

`game analysis generate` persists derived data without confirmation and is
verified by the tool. Generate only after events are analyzable.
