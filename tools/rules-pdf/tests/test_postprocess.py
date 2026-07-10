from rules_pdf.postprocess import RulePdfMetadata, postprocess_markdown


def test_postprocess_wbsc_headings_and_frontmatter() -> None:
    markdown = postprocess_markdown(
        """
2025-2026 | WBSC OFFICIAL RULES OF BASEBALL
17
# RULE 10 BASE RUNNING

10.7 When Runners are Out

A runner is out when tagged while off base.
""",
        RulePdfMetadata(
            title="WBSC Official Rules of Baseball",
            source="WBSC",
            edition="2025-2026",
            source_url="https://example.test/rules.pdf",
        ),
    )

    assert markdown.startswith('---\ntitle: "WBSC Official Rules of Baseball"')
    assert 'source: "WBSC"' in markdown
    assert 'edition: "2025-2026"' in markdown
    assert 'source_url: "https://example.test/rules.pdf"' in markdown
    assert "WBSC OFFICIAL RULES" not in markdown
    assert "\n17\n" not in markdown
    assert "## Rule 10. BASE RUNNING" in markdown
    assert "### 10.7 When Runners are Out" in markdown
    assert "A runner is out when tagged while off base." in markdown


def test_postprocess_chapter_and_appendix_headings() -> None:
    markdown = postprocess_markdown(
        """
CHAPTER 01 INTRODUCTION
APPENDIX 1 FIELD DIMENSIONS
A1.2 Home Plate
Text remains unchanged.
""",
        RulePdfMetadata(title="Rules", source="WBSC"),
    )

    assert "# Chapter 01. INTRODUCTION" in markdown
    assert "# APPENDIX 1 FIELD DIMENSIONS" in markdown
    assert "## A1.2 Home Plate" in markdown
    assert "Text remains unchanged." in markdown
