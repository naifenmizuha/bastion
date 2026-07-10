from __future__ import annotations

import stat
from pathlib import Path

from rules_pdf.cli import main


def fake_marker(tmp_path: Path, body: str, exit_code: int = 0) -> Path:
    script = tmp_path / "marker_single_fake.py"
    script.write_text(
        f"""#!/usr/bin/env python3
import pathlib
import sys

args = sys.argv[1:]
if {exit_code!r} != 0:
    print("fake marker failed", file=sys.stderr)
    raise SystemExit({exit_code!r})

out = pathlib.Path(args[args.index("--output_dir") + 1])
out.mkdir(parents=True, exist_ok=True)
(out / "converted.md").write_text({body!r}, encoding="utf-8")
""",
        encoding="utf-8",
    )
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    return script


def test_convert_uses_marker_and_writes_postprocessed_markdown(tmp_path: Path) -> None:
    pdf = tmp_path / "rules.pdf"
    pdf.write_bytes(b"%PDF fake")
    out = tmp_path / "rules.md"
    marker = fake_marker(
        tmp_path,
        "WBSC OFFICIAL RULES OF BASEBALL\n\nRULE 10 BASE RUNNING\n\n10.7 When Runners are Out\n",
    )

    code = main(
        [
            "convert",
            "--pdf",
            str(pdf),
            "--out",
            str(out),
            "--title",
            "WBSC Official Rules of Baseball",
            "--source",
            "WBSC",
            "--edition",
            "2025-2026",
            "--source-url",
            "https://example.test/rules.pdf",
            "--marker-bin",
            str(marker),
        ]
    )

    assert code == 0
    markdown = out.read_text(encoding="utf-8")
    assert 'title: "WBSC Official Rules of Baseball"' in markdown
    assert "## Rule 10. BASE RUNNING" in markdown
    assert "### 10.7 When Runners are Out" in markdown


def test_convert_reports_missing_pdf(tmp_path: Path, capsys) -> None:
    out = tmp_path / "rules.md"
    code = main(
        [
            "convert",
            "--pdf",
            str(tmp_path / "missing.pdf"),
            "--out",
            str(out),
            "--title",
            "Rules",
            "--source",
            "WBSC",
        ]
    )

    assert code == 1
    assert "PDF not found" in capsys.readouterr().err


def test_convert_reports_marker_failure(tmp_path: Path, capsys) -> None:
    pdf = tmp_path / "rules.pdf"
    pdf.write_bytes(b"%PDF fake")
    marker = fake_marker(tmp_path, "", exit_code=9)

    code = main(
        [
            "convert",
            "--pdf",
            str(pdf),
            "--out",
            str(tmp_path / "rules.md"),
            "--title",
            "Rules",
            "--source",
            "WBSC",
            "--marker-bin",
            str(marker),
        ]
    )

    assert code == 1
    assert "marker conversion failed" in capsys.readouterr().err


def test_convert_reports_missing_marker_output(tmp_path: Path, capsys) -> None:
    pdf = tmp_path / "rules.pdf"
    pdf.write_bytes(b"%PDF fake")
    marker = tmp_path / "marker_single_fake.py"
    marker.write_text(
        """#!/usr/bin/env python3
import pathlib
import sys
out = pathlib.Path(sys.argv[sys.argv.index("--output_dir") + 1])
out.mkdir(parents=True, exist_ok=True)
""",
        encoding="utf-8",
    )
    marker.chmod(marker.stat().st_mode | stat.S_IXUSR)

    code = main(
        [
            "convert",
            "--pdf",
            str(pdf),
            "--out",
            str(tmp_path / "rules.md"),
            "--title",
            "Rules",
            "--source",
            "WBSC",
            "--marker-bin",
            str(marker),
        ]
    )

    assert code == 1
    assert "did not produce a Markdown file" in capsys.readouterr().err
