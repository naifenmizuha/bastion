from __future__ import annotations

import json
import re
from dataclasses import dataclass


HEADER_PATTERNS = (
    re.compile(r"^2025-2026\s*\|\s*WBSC OFFICIAL RULES OF BASEBALL$", re.I),
    re.compile(r"^WBSC OFFICIAL RULES OF BASEBALL$", re.I),
)


@dataclass(frozen=True)
class RulePdfMetadata:
    title: str
    source: str
    edition: str | None = None
    language: str = "en"
    source_url: str | None = None


def frontmatter(metadata: RulePdfMetadata) -> str:
    lines = [
        "---",
        f"title: {json.dumps(metadata.title)}",
        f"source: {json.dumps(metadata.source)}",
    ]
    if metadata.edition:
        lines.append(f"edition: {json.dumps(metadata.edition)}")
    lines.append(f"language: {json.dumps(metadata.language)}")
    if metadata.source_url:
        lines.append(f"source_url: {json.dumps(metadata.source_url)}")
    lines.extend(["---", ""])
    return "\n".join(lines) + "\n"


def _compact_title(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _is_page_artifact(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if re.fullmatch(r"\d+", stripped):
        return True
    return any(pattern.match(stripped) for pattern in HEADER_PATTERNS)


def _strip_existing_frontmatter(text: str) -> str:
    return re.sub(r"\A---\n.*?\n---\n+", "", text, flags=re.S)


def _normalize_heading(line: str) -> str | None:
    plain = re.sub(r"^#{1,6}\s+", "", line).strip()

    chapter = re.match(r"^CHAPTER\s+([0-9A-Z]+)\.?\s+(.+)$", plain, re.I)
    if chapter:
        return f"# Chapter {chapter.group(1).rstrip('.')}. {_compact_title(chapter.group(2))}"

    rule = re.match(r"^RULE\s+([A-Z0-9.]+)\.?\s+(.+)$", plain, re.I)
    if rule:
        return f"## Rule {rule.group(1).rstrip('.')}. {_compact_title(rule.group(2))}"

    numbered = re.match(r"^([0-9]+(?:\.[0-9]+)+)\s+(.+)$", plain)
    if numbered:
        return f"### {numbered.group(1)} {_compact_title(numbered.group(2))}"

    appendix = re.match(r"^(APPENDIX\s+\d+)\s+(.+)$", plain, re.I)
    if appendix:
        return f"# {appendix.group(1).upper()} {_compact_title(appendix.group(2))}"

    appendix_section = re.match(r"^([A-Z]\d+(?:\.\d+)*)\s+(.+)$", plain)
    if appendix_section:
        return f"## {appendix_section.group(1)} {_compact_title(appendix_section.group(2))}"

    return None


def postprocess_markdown(markdown: str, metadata: RulePdfMetadata) -> str:
    """Clean Marker Markdown without rewriting rule text."""
    body = _strip_existing_frontmatter(markdown).replace("\r\n", "\n").replace("\r", "\n")
    output: list[str] = []

    for raw_line in body.split("\n"):
        line = raw_line.strip()
        if _is_page_artifact(line):
            continue
        if not line:
            if output and output[-1] != "":
                output.append("")
            continue

        heading = _normalize_heading(line)
        output.append(heading if heading else raw_line.rstrip())

    cleaned = "\n".join(output).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return frontmatter(metadata) + cleaned + "\n"
