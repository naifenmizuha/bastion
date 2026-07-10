from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from .postprocess import RulePdfMetadata, postprocess_markdown


class RulesPdfError(RuntimeError):
    pass


def _markdown_candidates(directory: Path, pdf: Path) -> list[Path]:
    candidates = sorted(directory.rglob("*.md"))
    if not candidates:
        return []
    exact = [candidate for candidate in candidates if candidate.stem == pdf.stem]
    return exact or sorted(candidates, key=lambda path: path.stat().st_size, reverse=True)


def _run_marker(
    *,
    pdf: Path,
    workdir: Path,
    marker_bin: str,
    force_ocr: bool,
    page_range: str | None,
) -> Path:
    command = [
        marker_bin,
        str(pdf),
        "--output_format",
        "markdown",
        "--output_dir",
        str(workdir),
    ]
    if force_ocr:
        command.append("--force_ocr")
    if page_range:
        command.extend(["--page_range", page_range])

    try:
        result = subprocess.run(
            command,
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except FileNotFoundError as error:
        raise RulesPdfError(
            f"marker executable not found: {marker_bin}. Run `uv sync` or pass --marker-bin."
        ) from error

    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "unknown error").strip()
        raise RulesPdfError(f"marker conversion failed: {detail}")

    candidates = _markdown_candidates(workdir, pdf)
    if not candidates:
        raise RulesPdfError(
            f"marker completed but did not produce a Markdown file under {workdir}"
        )
    return candidates[0]


def convert(args: argparse.Namespace) -> int:
    pdf = Path(args.pdf).expanduser().resolve()
    if not pdf.is_file():
        raise RulesPdfError(f"PDF not found: {pdf}")

    output = Path(args.out).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    marker_bin = args.marker_bin or os.environ.get("RULES_PDF_MARKER_BIN") or "marker_single"
    metadata = RulePdfMetadata(
        title=args.title,
        source=args.source,
        edition=args.edition,
        language=args.language,
        source_url=args.source_url,
    )

    workdir_path: Path | None = None
    try:
        if args.keep_workdir:
            workdir_path = Path(tempfile.mkdtemp(prefix="bastion-rules-pdf-"))
        else:
            workdir_path = Path(tempfile.mkdtemp(prefix="bastion-rules-pdf-"))

        marker_markdown = _run_marker(
            pdf=pdf,
            workdir=workdir_path,
            marker_bin=marker_bin,
            force_ocr=args.force_ocr,
            page_range=args.page_range,
        )
        output.write_text(
            postprocess_markdown(marker_markdown.read_text(encoding="utf-8"), metadata),
            encoding="utf-8",
        )
        print(f"Wrote {output}")
        if args.keep_workdir:
            print(f"Kept Marker workdir {workdir_path}")
        return 0
    finally:
        if workdir_path and not args.keep_workdir:
            shutil.rmtree(workdir_path, ignore_errors=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="rules-pdf",
        description="Convert official baseball rules PDFs to ingestible Markdown.",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    convert_parser = subcommands.add_parser("convert", help="Convert a PDF with Marker")
    convert_parser.add_argument("--pdf", required=True, help="Input PDF path")
    convert_parser.add_argument("--out", required=True, help="Markdown output path")
    convert_parser.add_argument("--title", required=True, help="Document title")
    convert_parser.add_argument("--source", required=True, help="Source name, e.g. WBSC")
    convert_parser.add_argument("--edition", help="Edition string, e.g. 2025-2026")
    convert_parser.add_argument("--language", default="en", help="Document language")
    convert_parser.add_argument("--source-url", help="Official source URL")
    convert_parser.add_argument("--force-ocr", action="store_true", help="Pass --force_ocr to Marker")
    convert_parser.add_argument("--page-range", help='Pass --page_range to Marker, e.g. "0,5-10"')
    convert_parser.add_argument("--keep-workdir", action="store_true", help="Keep Marker temporary output directory")
    convert_parser.add_argument("--marker-bin", help=argparse.SUPPRESS)
    convert_parser.set_defaults(func=convert)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except RulesPdfError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
