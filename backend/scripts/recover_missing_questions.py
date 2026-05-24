from __future__ import annotations

import json
from collections import defaultdict

from config import supabase
from papers import latest_live_paper_rows, normalize_exam_name, refresh_paper_publish_state


SPLIT_VERSION_TARGETS = [
    ("AP HIGH COURT EXAM SHIFT 3", 2025),
    ("AP HIGH COURT EXAM SHIFT 4", 2025),
    ("AP HIGH COURT EXAM SHIFT 6", 2025),
]

REACTIVATE_TARGETS = [
    ("APSLPRB SI MAINS", 2023),
    ("UPSC Combined Geo-Scientist Preliminary Examination", 2026),
    ("APPSC FOREST SECTION OFFICER PAPER 1 MAINS", 2025),
    ("APPSC EO GRADE 3 PAPER 1", 2025),
    ("TSPSC GROUP 2 PAPER 4", 2024),
    ("TSPSC LIBRARIAN GS", 2023),
]


def _row_identity(row: dict) -> tuple[str, ...]:
    exam_name = normalize_exam_name(str(row.get("exam_name") or ""))
    exam_year = int(row.get("exam_year") or 0)
    qnum = row.get("question_number")
    if exam_name and exam_year > 0 and isinstance(qnum, int) and qnum > 0:
        return ("exam", exam_name, str(exam_year), str(qnum))
    qhash = str(row.get("question_hash") or "").strip()
    if qhash:
        return ("hash", qhash)
    return ("id", str(row.get("id") or ""))


def _usable_inactive(row: dict) -> bool:
    text = str(row.get("question_text") or "").strip()
    if len(text) < 15:
        return False
    filled = sum(
        1
        for key in ("option_a", "option_b", "option_c", "option_d")
        if str(row.get(key) or "").strip()
    )
    return filled >= 2


def _get_exam_papers(exam_name: str, exam_year: int) -> list[dict]:
    return (
        supabase.table("papers")
        .select("id, exam_name, exam_year, upload_version, publish_status, lifecycle_status")
        .eq("exam_name", normalize_exam_name(exam_name))
        .eq("exam_year", int(exam_year))
        .order("upload_version")
        .execute()
        .data
        or []
    )


def _selected_paper_for_exam(exam_name: str, exam_year: int) -> dict | None:
    rows = latest_live_paper_rows(exam_name=exam_name, exam_year=exam_year, sb=supabase)
    return rows[0] if rows else None


def _fetch_questions_for_exam(exam_name: str, exam_year: int) -> list[dict]:
    rows = []
    offset = 0
    while True:
        batch = (
            supabase.table("questions")
            .select(
                "id, paper_id, exam_name, exam_year, question_number, question_hash, "
                "is_active, question_text, option_a, option_b, option_c, option_d, "
                "public_visibility, structural_status"
            )
            .eq("exam_name", normalize_exam_name(exam_name))
            .eq("exam_year", int(exam_year))
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


def recover_split_versions(exam_name: str, exam_year: int) -> dict:
    papers = _get_exam_papers(exam_name, exam_year)
    selected = _selected_paper_for_exam(exam_name, exam_year)
    if not papers or not selected:
        return {"exam_name": exam_name, "exam_year": exam_year, "moved": 0, "reason": "no-selected-paper"}

    target_paper_id = selected["id"]
    rows = _fetch_questions_for_exam(exam_name, exam_year)

    target_rows = [r for r in rows if str(r.get("paper_id") or "") == str(target_paper_id) and r.get("is_active") is True]
    target_keys = {_row_identity(r) for r in target_rows}
    moved = 0
    touched_papers: set[str] = {str(target_paper_id)}

    for row in rows:
        row_paper_id = str(row.get("paper_id") or "")
        if not row_paper_id or row_paper_id == str(target_paper_id):
            continue
        if row.get("is_active") is not True:
            continue
        key = _row_identity(row)
        if key in target_keys:
            continue
        (
            supabase.table("questions")
            .update({"paper_id": target_paper_id})
            .eq("id", row["id"])
            .execute()
        )
        moved += 1
        target_keys.add(key)
        touched_papers.add(row_paper_id)

    for paper_id in touched_papers:
        refresh_paper_publish_state(paper_id, sb=supabase)

    return {
        "exam_name": exam_name,
        "exam_year": exam_year,
        "target_paper_id": target_paper_id,
        "moved": moved,
    }


def recover_usable_inactive(exam_name: str, exam_year: int) -> dict:
    selected = _selected_paper_for_exam(exam_name, exam_year)
    if not selected:
        return {"exam_name": exam_name, "exam_year": exam_year, "reactivated": 0, "reason": "no-selected-paper"}

    rows = _fetch_questions_for_exam(exam_name, exam_year)
    target_paper_id = str(selected["id"])
    reactivated = 0
    for row in rows:
        if str(row.get("paper_id") or "") != target_paper_id:
            continue
        if row.get("is_active") is True:
            continue
        if not _usable_inactive(row):
            continue
        (
            supabase.table("questions")
            .update({
                "is_active": True,
                "public_visibility": "visible",
            })
            .eq("id", row["id"])
            .execute()
        )
        reactivated += 1

    refresh_paper_publish_state(target_paper_id, sb=supabase)
    return {
        "exam_name": exam_name,
        "exam_year": exam_year,
        "target_paper_id": target_paper_id,
        "reactivated": reactivated,
    }


def main() -> int:
    split_reports = [recover_split_versions(exam, year) for exam, year in SPLIT_VERSION_TARGETS]
    reactivate_reports = [recover_usable_inactive(exam, year) for exam, year in REACTIVATE_TARGETS]
    print(json.dumps({
        "split_reports": split_reports,
        "reactivate_reports": reactivate_reports,
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
