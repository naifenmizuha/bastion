# Drill CLI

Use actual persisted player and reviewer facts; placeholders are not identities.

## `drill recommend write`

- Purpose: submit a training recommendation for an own-team player.
- Risk: `write`
- Input: `required`
- Syntax: `drill recommend write`
- Required input fields: `name`, `url`, `reason`, `type`, `summary`
- Values: type `pitching|catching|hitting|strength|baserunning|infield|outfield`.
- Returns: pending recommendation id with verification.

## `drill recommend list`

- Purpose: list recommendations with the narrowest applicable filter.
- Risk: `read`
- Input: `forbidden`
- Syntax: `drill recommend list [--name NAME] [--type TYPE] [--status STATUS]`
- Flags: optional `--name`, `--type`, `--status` (`pending|approved|rejected`).
- Returns: matching recommendations and review state.

## `drill review approve`

- Purpose: approve one pending recommendation with explicit reviewer facts.
- Risk: `write`
- Input: `forbidden`
- Syntax: `drill review approve --recommendation-id ID --coach NAME --summary TEXT --note TEXT`
- Flags: `--recommendation-id`, `--coach`, `--summary`, and `--note` required.
- Returns: approved recommendation and training-read verification.

## `drill review reject`

- Purpose: reject one pending recommendation with explicit reviewer facts.
- Risk: `write`
- Input: `forbidden`
- Syntax: `drill review reject --recommendation-id ID --coach NAME --summary TEXT --reason TEXT`
- Flags: `--recommendation-id`, `--coach`, `--summary`, and `--reason` required.
- Returns: rejected recommendation with verification.

## `drill training list`

- Purpose: list approved training only.
- Risk: `read`
- Input: `forbidden`
- Syntax: `drill training list [--name NAME] [--type TYPE]`
- Flags: optional `--name`, optional `--type`.
- Returns: approved recommendations matching the filters.

## `drill training read`

- Purpose: read one approved training record.
- Risk: `read`
- Input: `forbidden`
- Syntax: `drill training read --recommendation-id ID`
- Flags: `--recommendation-id` required.
- Returns: approved training details; pending or rejected recommendations are unavailable.
