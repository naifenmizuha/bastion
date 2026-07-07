# Drill Recommendations and Reviews

## When to use

Use this reference for drill recommendation submission, recommendation review,
and approved drill training reads.

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

## Minimal workflow

1. For recommendation submission, verify the associated player when needed.
2. For review, read the pending recommendation first.
3. Use the actual coach name and explicit user decision; never invent reviewer
   identity or approval/rejection.
4. After successful approval, trust verification for `drill training read`; do
   not repeat it.
5. Use `batch write` only when the user made multiple explicit review decisions
   or asked to submit multiple recommendations at once.

## Required input notes

Recommendation:

```json
{"args":["drill","recommend","write"],"input":{"name":"张三","url":"https://example.com/drill/1","reason":"需要改善内野脚步","type":"infield","summary":"内野接球脚步与重心训练"}}
```

- Required: `name`, `url`, `reason`, `type`, `summary`
- `name` is the registered player associated with the training.
- Types: `pitching`, `catching`, `hitting`, `strength`, `baserunning`,
  `infield`, `outfield`

Review:

```text
drill review approve --recommendation-id ID --coach NAME --summary TEXT --note TEXT
drill review reject --recommendation-id ID --coach NAME --summary TEXT --reason TEXT
```

- Review statuses: `pending`, `approved`, `rejected`
- Approval requires `--note`; rejection requires `--reason`.
- Approved recommendations appear through `drill training`; rejected ones do
  not.
