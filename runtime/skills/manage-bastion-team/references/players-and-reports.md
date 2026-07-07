# Players and Training Reports

## When to use

Use this reference for roster queries, player creation, and dated self-training
reports. There is no `report list`; state that limitation instead of inventing
one or reading SQLite.

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

Use `batch read` for several known players or dated reports. Use `batch write`
only for one user-approved ordered set, such as adding a player and then saving
that player's first report.

## Minimal workflow

1. For reads, call the exact read command when the name/date is known.
2. For `player add`, first check existing roster when duplicate name or number
   is possible.
3. For `report write`, read the player first and resolve any relative date to
   `YYYY-MM-DD`.
4. After a successful write, trust the tool verification and do not repeat the
   same read-back.
5. If name/date is ambiguous, ask once instead of choosing a candidate.

## Required input notes

Player add:

```json
{"args":["player","add"],"input":{"name":"张三","number":18,"bat":"right","throw":"right","positions":"pitcher,shortstop"}}
```

- Required: `name`, `number`, `bat`, `throw`, `positions`
- Hand values: `left`, `right`
- Position values: `pitcher`, `catcher`, `first_base`, `second_base`,
  `third_base`, `shortstop`, `outfield`
- `bat`, `throw`, and `positions` are comma-separated strings.

Report write:

```json
{"args":["report","write"],"input":{"name":"张三","date":"2026-06-30","content":"打击训练 100 球","reflection":"外角球仍需加强"}}
```

- Required: `name`, `date`, `content`, `reflection`
- `date` must be concrete `YYYY-MM-DD`.
