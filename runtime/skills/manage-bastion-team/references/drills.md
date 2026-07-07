# Drill recommendations and reviews

## Commands

```text
drill recommend write
drill recommend list [--name NAME] [--type TYPE] [--status STATUS]
drill review approve --recommendation-id ID --coach NAME --summary TEXT --note TEXT
drill review reject --recommendation-id ID --coach NAME --summary TEXT --reason TEXT
drill training list [--name NAME] [--type TYPE]
drill training read --recommendation-id ID
batch read
batch write
```

Types: `pitching`, `catching`, `hitting`, `strength`, `baserunning`, `infield`,
`outfield`.

Review statuses: `pending`, `approved`, `rejected`.

Use `batch read` to inspect several recommendations or approved trainings. Use
`batch write` only when the user has made multiple explicit review decisions or
asked to submit multiple recommendations at once.

## Submit a recommendation

```json
{
  "args": ["drill", "recommend", "write"],
  "input": {
    "name": "张三",
    "url": "https://example.com/drill/1",
    "reason": "需要改善内野脚步",
    "type": "infield",
    "summary": "内野接球脚步与重心训练"
  }
}
```

All fields are required. `name` is the registered player associated with the
training, not the submitting coach. Submission creates a pending recommendation
and requires confirmation.

## Review

Read the pending recommendation before reviewing it. Use the actual coach name
provided by the user; never invent reviewer identity. Approval requires
`--note`; rejection requires `--reason`. Both require an explicit user decision
and TUI confirmation.

Approved recommendations become available through `drill training`. Rejected
recommendations do not. A successful approval already verifies
`drill training read`; do not repeat that read.
