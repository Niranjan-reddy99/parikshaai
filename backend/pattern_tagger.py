"""Compatibility wrapper for the current rule-first pattern tagger.

Older admin code imported `run_pattern_tagger` from this module. Keep that API,
but route it to the app-facing `pattern_tag/trap_tag/skill_tag` pipeline instead
of the legacy `pattern_type/examiner_trap` columns.
"""
from __future__ import annotations

from typing import Optional

from auto_tag_patterns import run


def run_pattern_tagger(paper_id: Optional[str] = None, limit: int = 500) -> dict:
    return run(
        exam_name=None,
        exam_year=None,
        limit=limit,
        force=False,
        dry_run=False,
        paper_id=paper_id,
    )
