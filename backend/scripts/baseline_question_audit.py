from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

from config import supabase

SNAPSHOT_DIR = Path(__file__).parent / "snapshots" / "question_baselines"
SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)


def _fetch_all_rows(table: str, columns: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            supabase.table(table)
            .select(columns)
            .range(offset, offset + 999)
            .execute()
            .data
            or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def _row_is_publicly_visible(row: dict[str, Any]) -> bool:
    visibility = row.get("public_visibility")
    if visibility is not None:
        return visibility == "visible"
    return bool(row.get("is_active", True))


def _normalize_shift_label(row: dict[str, Any]) -> str:
    return str(row.get("shift_label") or "").strip() or "NO_SHIFT"


def _identity_hash(ids: list[str]) -> str:
    joined = "\n".join(sorted(ids))
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def build_question_baseline(label: str | None = None) -> dict[str, Any]:
    question_rows = _fetch_all_rows(
        "questions",
        "id, exam_name, exam_year, shift_label, paper_id, is_active, public_visibility, "
        "practice_ready, needs_review, structural_status, explanation_status, created_at",
    )
    paper_rows = _fetch_all_rows(
        "papers",
        "id, exam_name, exam_year, upload_version, lifecycle_status, publish_status, "
        "question_count, visible_question_count, hidden_question_count, structural_issue_count",
    )
    explanation_rows = _fetch_all_rows("explanations", "question_id")

    explanation_ids = {
        str(row.get("question_id") or "").strip()
        for row in explanation_rows
        if str(row.get("question_id") or "").strip()
    }

    baseline_label = (label or "baseline").strip() or "baseline"
    question_ids = [
        str(row.get("id") or "").strip()
        for row in question_rows
        if str(row.get("id") or "").strip()
    ]

    grouped: dict[tuple[str, int, str], list[dict[str, Any]]] = defaultdict(list)
    for row in question_rows:
        exam_name = str(row.get("exam_name") or "").strip()
        exam_year = int(row.get("exam_year") or 0)
        shift_label = _normalize_shift_label(row)
        grouped[(exam_name, exam_year, shift_label)].append(row)

    exam_shift_counts: list[dict[str, Any]] = []
    for (exam_name, exam_year, shift_label), rows in sorted(
        grouped.items(),
        key=lambda item: (item[0][0], item[0][1], item[0][2]),
    ):
        ids = [
            str(row.get("id") or "").strip()
            for row in rows
            if str(row.get("id") or "").strip()
        ]
        visible = sum(1 for row in rows if _row_is_publicly_visible(row))
        active = sum(1 for row in rows if bool(row.get("is_active", True)))
        practice_ready = sum(1 for row in rows if bool(row.get("practice_ready", False)))
        needs_review = sum(1 for row in rows if bool(row.get("needs_review", False)))
        structural_broken = sum(1 for row in rows if str(row.get("structural_status") or "") == "broken")
        explanations = sum(1 for qid in ids if qid in explanation_ids)
        paper_ids = sorted(
            {
                str(row.get("paper_id") or "").strip()
                for row in rows
                if str(row.get("paper_id") or "").strip()
            }
        )
        exam_shift_counts.append({
            "exam_name": exam_name,
            "exam_year": exam_year,
            "shift_label": shift_label,
            "question_count": len(rows),
            "active_count": active,
            "visible_count": visible,
            "hidden_count": max(0, len(rows) - visible),
            "practice_ready_count": practice_ready,
            "needs_review_count": needs_review,
            "structural_broken_count": structural_broken,
            "explanation_count": explanations,
            "paper_ids": paper_ids,
            "question_id_hash": _identity_hash(ids),
            "question_ids": sorted(ids),
        })

    papers = sorted(
        [
            {
                "paper_id": str(row.get("id") or "").strip(),
                "exam_name": str(row.get("exam_name") or "").strip(),
                "exam_year": int(row.get("exam_year") or 0),
                "upload_version": int(row.get("upload_version") or 0),
                "lifecycle_status": str(row.get("lifecycle_status") or ""),
                "publish_status": str(row.get("publish_status") or ""),
                "question_count": int(row.get("question_count") or 0),
                "visible_question_count": int(row.get("visible_question_count") or 0),
                "hidden_question_count": int(row.get("hidden_question_count") or 0),
                "structural_issue_count": int(row.get("structural_issue_count") or 0),
            }
            for row in paper_rows
        ],
        key=lambda row: (row["exam_name"], row["exam_year"], row["upload_version"], row["paper_id"]),
    )

    snapshot = {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "label": baseline_label,
        "summary": {
            "question_count": len(question_ids),
            "explanation_count": len(explanation_ids),
            "paper_count": len(papers),
            "exam_year_shift_groups": len(exam_shift_counts),
            "question_id_hash": _identity_hash(question_ids),
        },
        "exam_shift_counts": exam_shift_counts,
        "papers": papers,
        "all_question_ids": sorted(question_ids),
    }
    return snapshot


def write_question_baseline(label: str | None = None) -> dict[str, Any]:
    snapshot = build_question_baseline(label=label)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    slug = snapshot["label"].strip().lower().replace(" ", "_")
    snapshot_path = SNAPSHOT_DIR / f"{stamp}_{slug}.json"
    snapshot_path.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False))
    return {
        "snapshot_path": str(snapshot_path.resolve()),
        "summary": snapshot["summary"],
    }


def main() -> int:
    result = write_question_baseline()
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
