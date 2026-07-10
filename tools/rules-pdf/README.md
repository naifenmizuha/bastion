# Bastion Rules PDF

Convert official baseball rules PDFs into Markdown suitable for
`baseball_rule_ingest`.

```bash
uv run --with marker-pdf rules-pdf convert \
  --pdf rules.pdf \
  --out rules.md \
  --title "WBSC Official Rules of Baseball" \
  --source WBSC \
  --edition 2025-2026 \
  --source-url "https://static.wbsc.org/uploads/federations/0/cms/documents/d3d36a7c-4a8a-1cca-adc1-d4edff1efc30.pdf"
```

For tests and postprocessing-only development, `uv run pytest` does not install
Marker. The `--with marker-pdf` flag is only needed for real PDF conversion.

This tool uses Marker (`marker_single`) for PDF conversion, then performs a
small WBSC-friendly cleanup pass. It does not translate or rewrite rule text.
