---
name: knowledge-base-ingest
description: "Use chunk_preview, ingest, and retrieve for official baseball rule knowledge-base workflows. Use when Codex needs to ingest authoritative baseball rule Markdown such as material/rules.md, tune chunking, troubleshoot embedding setup, or retrieve official rule evidence for baseball rules questions."
---

# 知识库录入

Use `chunk_preview`, `ingest`, and `retrieve` for official rule workflows.

## Official Baseball Rules

For large authoritative Markdown such as `material/rules.md`, do not read the
whole file to inspect its structure. `chunk_preview` performs document
inspection internally and returns bounded diagnostics and samples. Read only a
specific range when a diagnostic requires human inspection.

Call `chunk_preview` with these candidate strategies:

- `fine=800/1400/120`
- `balanced=1200/2000/200`
- `broad=1600/2400/250`

Use this fixed workflow:

1. Call `chunk_preview` with all candidates.
2. Check `recommendedStrategy`, `qualityScore`, and `diagnostics`.
3. Require zero oversized chunks. Treat isolated headings and a high
   tiny-chunk ratio as diagnostics to investigate, not automatic blockers.
4. Call `ingest` with the recommended parameters, `replaceDocument: true`,
   and stable metadata. Use returned hashes only for audit.
5. Run representative `retrieve` queries to verify the new index.

Do not choose from chunk count alone. Prefer the recommendation unless its
samples expose a semantic split that needs a targeted strategy change.

## Embeddings

Embeddings require `EMBEDDING_API_KEY` or `OPENAI_API_KEY`; runtime loads these
from the shell, `runtime/.env.local`, or `runtime/.env`. Prefer
`runtime/.env.local` for real keys and never print or paste the key. Restart
the runtime after changing embedding configuration; existing shell variables
override values from env files.

For SiliconFlow use:
- `EMBEDDING_URL=https://api.siliconflow.cn/v1/embeddings`
- `EMBEDDING_MODEL=Qwen/Qwen3-Embedding-8B`
- `EMBEDDING_DIMENSION=4096`
- `EMBEDDING_BATCH_SIZE=10`

If the provider returns `401` or `Invalid token`, fix `EMBEDDING_API_KEY`.
If the provider rejects large requests or returns an empty JSON body, set
`EMBEDDING_BATCH_SIZE` lower and retry. Do not assume `rules.md` must be split
just because embedding failed; first inspect the embedding error and env setup.
If an external script reports that `baseball-rules.zvec/LOCK` cannot be opened,
the live runtime already owns the index. Restart the runtime or call `ingest`
from inside that runtime instead of writing the same zvec index from another
process.

## Retrieval

For rule questions, call `retrieve` with the raw situation, English rule-term
queries, and normalized concepts. Never pass only the raw Chinese question.
The tool retrieves evidence; it does not decide whether the known facts support
a ruling.

Do not silently add facts such as fair/foul status, prior fielder contact,
intent, fence clearance, or venue ground rules. If a material fact is absent,
ask the user or give an explicit "if ... then ..." answer. If retrieval returns
`insufficient_evidence`, broaden the queries or say that official support was
not found; do not invent a ruling.

Keep answers compact: conclusion, conditions, material exception, and rule
reference. Clearly label whether a statement is direct rule text, a
translation, or an inference from multiple rules. Do not present paraphrases as
quotes or make absolute claims beyond the evidence.
