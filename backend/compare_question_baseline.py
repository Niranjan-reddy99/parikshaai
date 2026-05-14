from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from baseline_question_audit import build_question_baseline


def _index_exam_shift(rows: list[dict[str, Any]]) -> dict[tuple[str, int, str], dict[str, Any]]:
    return {
        (
            str(row.get("exam_name") or ""),
            int(row.get("exam_year") or 0),
            str(row.get("shift_label") or ""),
        ): row
        for row in rows
    }


def compare_against_snapshot(snapshot_path: str) -> dict[str, Any]:
    path = Path(snapshot_path)
    baseline = json.loads(path.read_text())
    current = build_question_baseline(label="current_compare")

    baseline_ids = set(baseline.get("all_question_ids") or [])
    current_ids = set(current.get("all_question_ids") or [])

    missing_ids = sorted(baseline_ids - current_ids)
    added_ids = sorted(current_ids - baseline_ids)

    baseline_groups = _index_exam_shift(baseline.get("exam_shift_counts") or [])
    current_groups = _index_exam_shift(current.get("exam_shift_counts") or [])
    all_keys = sorted(set(baseline_groups) | set(current_groups))

    group_diffs: list[dict[str, Any]] = []
    for key in all_keys:
        before = baseline_groups.get(key)
        after = current_groups.get(key)
        if before == after:
            continue
        group_diffs.append({
            "exam_name": key[0],
            "exam_year": key[1],
            "shift_label": key[2],
            "before_question_count": int((before or {}).get("question_count") or 0),
            "after_question_count": int((after or {}).get("question_count") or 0),
            "before_visible_count": int((before or {}).get("visible_count") or 0),
            "after_visible_count": int((after or {}).get("visible_count") or 0),
            "before_explanation_count": int((before or {}).get("explanation_count") or 0),
            "after_explanation_count": int((after or {}).get("explanation_count") or 0),
            "before_hash": (before or {}).get("question_id_hash"),
            "after_hash": (after or {}).get("question_id_hash"),
        })

    return {
        "snapshot_path": str(path.resolve()),
        "baseline_summary": baseline.get("summary") or {},
        "current_summary": current.get("summary") or {},
        "missing_question_ids": missing_ids,
        "added_question_ids": added_ids,
        "group_differences": group_diffs,
        "ok": not missing_ids and not added_ids and not group_diffs,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("Usage: python compare_question_baseline.py SNAPSHOT_PATH")
        return 1
    result = compare_against_snapshot(argv[1])
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
