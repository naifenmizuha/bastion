---
name: knowledge-base-ingest
description: "Use chunk_preview, ingest, and retrieve for official baseball rule knowledge-base workflows. Use when Codex needs to ingest authoritative baseball rule Markdown such as material/rules.md, tune chunking, troubleshoot embedding setup, or retrieve official rule evidence for baseball rules questions."
---

# 知识库录入

Use `chunk_preview`, `ingest`, and `retrieve` for official baseball rule
documents and rule evidence.

## Official Baseball Rules

For authoritative rule Markdown such as `material/rules.md`, preview chunking
before ingesting. Read enough Markdown to judge heading depth, long sections,
tables, and explicit rule subsections.

Call `chunk_preview` with these candidate strategies:

- `fine=800/1400/120`
- `balanced=1200/1800/200`
- `broad=1600/2400/250`

Choose `balanced` by default, `fine` for many large chunks or dense
subsections, and `broad` when chunk count is high and sections are short.

Then call `ingest` with the selected `chunkStrategy`, `replaceDocument: true`,
and stable metadata.

## Embeddings

Embeddings require `EMBEDDING_API_KEY` or `OPENAI_API_KEY`; runtime loads these
from the shell, `runtime/.env.local`, or `runtime/.env`.

For SiliconFlow use:

- `EMBEDDING_URL=https://api.siliconflow.cn/v1/embeddings`
- `EMBEDDING_MODEL=Qwen/Qwen3-Embedding-8B`
- `EMBEDDING_DIMENSION=4096`

If the provider rejects large requests or returns an empty JSON body, set
`EMBEDDING_BATCH_SIZE` lower and retry.

## Retrieval

For rule questions, call `retrieve` with structured case facts, English
rule-term queries, and normalized concepts. Never pass only the raw Chinese
question.
