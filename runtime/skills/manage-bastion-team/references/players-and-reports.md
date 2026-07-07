# Players and training reports

## Commands

```text
player list
player read --name NAME
player add
report read --name NAME --date YYYY-MM-DD
report write
batch read
batch write
```

There is no `report list` command. State this limitation instead of inventing
one or reading SQLite.

Use `batch read` to fetch several known players or several known dated reports
in one call. Use `batch write` for a user-approved set of player/report writes
that should be applied in order, such as adding a player and immediately saving
that player's first report.

## Add a player

Confirm the name and uniform number are not already registered. `bat`, `throw`,
and `positions` are comma-separated strings.

```json
{
  "args": ["player", "add"],
  "input": {
    "name": "张三",
    "number": 18,
    "bat": "right",
    "throw": "right",
    "positions": "pitcher,shortstop"
  }
}
```

- Hand values: `left`, `right`
- Position values: `pitcher`, `catcher`, `first_base`, `second_base`,
  `third_base`, `shortstop`, `outfield`

All five fields are required.

## Write a training report

Read the player first. Resolve relative dates to a concrete `YYYY-MM-DD`.

```json
{
  "args": ["report", "write"],
  "input": {
    "name": "张三",
    "date": "2026-06-30",
    "content": "打击训练 100 球",
    "reflection": "外角球仍需加强"
  }
}
```

All four fields are required. After confirmation, the tool verifies the write
with `report read`; do not repeat that read when verification matched.
