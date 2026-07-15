---
name: manage-derived-memory
description: "Discover, validate, save, rebuild, share, withdraw, and delete reusable derived conclusions with the derived_memory tool. Use before any trend, comparison, diagnosis, risk, or recommendation request that may require two or more authoritative reads, even when the user does not mention prior work; also use when the user refers to a previous conclusion or explicitly asks to remember, rebuild, share, withdraw, or forget one."
---

# Manage Derived Memory

Use `derived_memory` for reusable conclusions backed by at least two distinct
successful authoritative reads. Never use memory instead of a current authority
refresh required for a write. Never pass identity fields; Runtime supplies them.

## Discovery gate

For every trend, comparison, diagnosis, risk, or recommendation request that may
need two or more authoritative reads, call `list` with `scope: "all"` before any
new domain reads. Apply this gate even without words such as "previous" or
"remember".

Discovery and domain access are two ordered phases. Finish `list` and any
candidate `read` calls before issuing a domain-data call; never emit memory and
domain tool calls in the same assistant batch. After a fresh read, compare its
content with the current request: answer directly when it fully covers the
request, or read only the domain data needed for uncovered subquestions. Do not
re-read sources merely because the memory came from an earlier session or time.

`list.scope` filters **memory visibility**, never the business subject or data
range being analyzed:

| Value | Memories included |
| --- | --- |
| `all` | Every memory the caller may access: own private plus readable staff/team memories. This is the default. |
| `private` | Only private memories owned by the caller. |
| `staff` | Only memories explicitly published to staff. |
| `team` | Only memories explicitly published to the whole team. |

Omit `scope` or use `all` unless the user explicitly restricts the visibility
audience of the memories being listed. Determine `scope` solely from that
visibility intent. Business subjects, entities, ownership language, analysis
ranges, and domain terminology must not influence it.

`list.limit` is the page size (default 20, maximum 50), and `list.offset` is the
zero-based card offset (default 0). They control pagination only.

`list` returns only `id` and `title`. Select candidates semantically from their
titles; read the closest plausible candidate to load its status and content. If
no candidate appears and `nextOffset` exists, continue listing pages. Do not
claim that no memory exists until pagination is exhausted. If none is relevant,
return to the domain skill and perform a new authoritative analysis.

Titles are discovery metadata, not evidence. Always `read` a selected ID before
using its content.
## Read and freshness

Treat `status` from `read` as authoritative:

- `fresh`: Runtime has just verified that every recorded source dependency still
  matches its saved snapshot. Therefore `content` is the latest derived
  conclusion for its declared analysis scope. Use it directly; an older save
  time or earlier session is not a reason to re-read the same sources. Freshness
  does not claim coverage of data outside that scope.
- `stale`: show `rebuild.reason` and `rebuild.instruction`, then ask once whether
  the user wants it rebuilt. Stale reads do not return old content.
- `unknown`: report that freshness cannot be verified; no content is returned,
  and do not offer reconstruction.

If the user declines reconstruction, do not run its reads or ask again in that
turn.

## Save and replace

Save only reusable analysis, never raw facts, tool-output summaries, write
results, or unsupported speculation. `title` must identify the solved question
well enough for list discovery. `content` is the self-contained reusable result,
including material scope and limitations. `rebuildInstruction` explains how to
resolve current data and derive it again. `dependencies` must exactly match at
least two distinct successful authoritative reads from the current session.
`id` selects an existing memory. `confirmedByUser: true` records explicit
approval; never infer approval.

After explicit reconstruction approval, follow `rebuildInstruction` to resolve
the current evidence set, run every required authoritative read, derive the new
conclusion, and call `replace` with `confirmedByUser: true`. Re-resolve rolling
ranges such as "recent games" instead of replaying old IDs. Failed reads or saves
leave the old version stale.

Only the owner may replace a stale leaf. A non-owner may perform a fresh analysis
and save a separate private memory. A replacement remains private even when its
predecessor was shared; publishing it requires separate explicit approval.

## Share and delete

Publish or withdraw only after explicit user confirmation. Never `forget` a
memory because it is stale or superseded; delete only in response to an explicit
deletion request and with confirmation.

`publish.visibility` is the destination audience: `staff` means staff-only and
`team` means the whole team. It is unrelated to `list.scope`. `withdraw` returns
a shared memory to private visibility; `forget` permanently deletes the selected
memory.
