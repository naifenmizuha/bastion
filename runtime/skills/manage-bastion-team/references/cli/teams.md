# Team CLI

Use only placeholder values from examples; query actual names before relying on them.

## `team init`

- Purpose: initialize the own team in an uninitialized database.
- Risk: `write`
- Input: `required`
- Syntax: `team init`
- Required input fields: `own_team`
- Returns: initialized team `id`, `name`, and `scope=own`.
- Errors: fails if the own team is already initialized or the name conflicts.

```json
{"args":["team","init"],"input":{"own_team":"<OWN_TEAM>"}}
```

## `team add`

- Purpose: register an opponent before recording games or opponent players.
- Risk: `write`
- Input: `required`
- Syntax: `team add`
- Required input fields: `name`
- Returns: registered opponent `id`, `name`, and `scope=opponent`.
- Errors: `conflict` for an existing name; own team must be initialized.

```json
{"args":["team","add"],"input":{"name":"<OPPONENT>"}}
```

## `team read`

- Purpose: read one registered team by exact name.
- Risk: `read`
- Input: `forbidden`
- Syntax: `team read --name NAME`
- Flags: `--name` required.
- Returns: one team with `id`, `name`, `scope`, and timestamps.
- Errors: `not_found` when the exact name is absent.

## `team list`

- Purpose: list registered business teams and identify the own team by `scope=own`.
- Risk: `read`
- Input: `forbidden`
- Syntax: `team list`
- Flags: none.
- Returns: own team first, followed by opponents. An uninitialized database returns an empty list.
- Use directly for: "What team are we?" Do not use `team info` or infer the team from players.
