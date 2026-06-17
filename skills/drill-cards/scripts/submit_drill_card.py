#!/usr/bin/env python3
"""Build and submit a DrillCard payload through a Feishu CLI command template."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from datetime import datetime
from typing import Any


ALLOWED_POSITIONS = {
    "投手",
    "捕手",
    "内野",
    "外野",
    "一垒",
    "二垒",
    "三垒",
    "游击",
    "跑垒",
    "打者",
    "全队",
}

ALLOWED_VENUES = {"无限制", "室内场地", "有网小场", "完整场地"}


def fail(message: str, exit_code: int = 2) -> None:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(exit_code)


def parse_positions(values: list[str]) -> list[str]:
    positions: list[str] = []
    for value in values:
        for item in value.split(","):
            position = item.strip()
            if not position:
                continue
            if position not in ALLOWED_POSITIONS:
                allowed = ", ".join(sorted(ALLOWED_POSITIONS))
                fail(f"unknown target position '{position}'. Allowed values: {allowed}")
            if position not in positions:
                positions.append(position)
    return positions


def build_payload(args: argparse.Namespace) -> dict[str, Any]:
    submitted_by = args.submitted_by or os.environ.get("DRILLCARD_DEFAULT_SUBMITTED_BY", "")
    if not submitted_by:
        fail("DRILLCARD_DEFAULT_SUBMITTED_BY is required, or pass --submitted-by")

    if args.participant_requirement < 1:
        fail("--participant-requirement must be at least 1")

    if args.venue_requirement not in ALLOWED_VENUES:
        allowed = ", ".join(sorted(ALLOWED_VENUES))
        fail(f"unknown venue requirement '{args.venue_requirement}'. Allowed values: {allowed}")

    submitted_at = args.submitted_at or datetime.now().astimezone().isoformat(timespec="seconds")

    return {
        "submitted_by": submitted_by,
        "submitted_at": submitted_at,
        "video_url": args.video_url,
        "recommendation_reason": args.recommendation_reason,
        "target_positions": parse_positions(args.target_position),
        "participant_requirement": args.participant_requirement,
        "venue_requirement": args.venue_requirement,
        "ai_summary": args.ai_summary,
        "is_enabled": False,
    }


def run_cli(command_template: str, payload_json: str) -> int:
    if "{payload}" not in command_template:
        fail("DRILLCARD_FEISHU_CREATE_RECORD_CMD must contain a {payload} placeholder")

    try:
        parts = shlex.split(command_template)
    except ValueError as exc:
        fail(f"cannot parse DRILLCARD_FEISHU_CREATE_RECORD_CMD: {exc}")

    if not parts:
        fail("DRILLCARD_FEISHU_CREATE_RECORD_CMD cannot be empty")

    argv = [part.replace("{payload}", payload_json) for part in parts]
    completed = subprocess.run(argv, check=False)
    return completed.returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="Submit a DrillCard record through a Feishu CLI adapter.")
    parser.add_argument("--video-url", required=True, help="Original training video URL.")
    parser.add_argument("--recommendation-reason", required=True, help="Why this video is worth collecting.")
    parser.add_argument(
        "--target-position",
        action="append",
        default=[],
        help="Target position label. Repeat or pass comma-separated labels. Leave omitted when uncertain.",
    )
    parser.add_argument(
        "--participant-requirement",
        type=int,
        default=1,
        help="Minimum participant count. Defaults to 1 when uncertain.",
    )
    parser.add_argument(
        "--venue-requirement",
        default="无限制",
        help="One of: 无限制, 室内场地, 有网小场, 完整场地. Defaults to 无限制.",
    )
    parser.add_argument("--ai-summary", required=True, help="AI summary in the required DrillCard format.")
    parser.add_argument("--submitted-by", help="Override DRILLCARD_DEFAULT_SUBMITTED_BY.")
    parser.add_argument("--submitted-at", help="Override submitted timestamp, usually for tests.")
    parser.add_argument("--dry-run", action="store_true", help="Print payload JSON without invoking the CLI.")
    args = parser.parse_args()

    payload = build_payload(args)
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))

    if args.dry_run:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    command_template = os.environ.get("DRILLCARD_FEISHU_CREATE_RECORD_CMD", "")
    if not command_template:
        fail("DRILLCARD_FEISHU_CREATE_RECORD_CMD is required unless --dry-run is used")

    return run_cli(command_template, payload_json)


if __name__ == "__main__":
    raise SystemExit(main())
