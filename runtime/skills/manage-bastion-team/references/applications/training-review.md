# Application: Training Recommendation and Review

Use when submitting recommendations, reviewing pending recommendations, or reading approved training. This application name is not a `teamops` command.

## Registered commands used

- CLI: `player read`
- CLI: `drill recommend write`
- CLI: `drill recommend list`
- CLI: `drill review approve`
- CLI: `drill review reject`
- CLI: `drill training list`
- CLI: `drill training read`
- CLI: `batch write`

Read [Drill CLI](../cli/drills.md), [Player and Report CLI](../cli/players-and-reports.md), and [Protocol](../cli/protocol.md).

## Submission

1. Resolve the own-team player.
2. Save the recommendation with `drill recommend write` only after the user supplies the required reason, type, summary, and URL.

## Review

1. Read the pending recommendation with the narrowest `drill recommend list` filter.
2. Require an explicit approve/reject decision and actual coach, summary, and note/reason; never invent reviewer identity.
3. Call exactly one of `drill review approve` or `drill review reject`.
4. Trust successful verification. Approved records become available through `drill training`; rejected records do not.
5. Use `batch write` only for multiple explicit review decisions.

## Execution rules

- Ask for write confirmation after all required fields are known; a batch needs one confirmation covering its complete ordered operation list.
- If a submission or review fails, do not infer status from intent. Refresh with the narrowest recommendation or training read before any retry.

## Final answer

Use verified recommendation, review, or training results as final fact sources. State the persisted review status and distinguish pending recommendations from approved training.
