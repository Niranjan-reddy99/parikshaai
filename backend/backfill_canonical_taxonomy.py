from __future__ import annotations

import argparse
from typing import Any

from canonical_taxonomy import derive_canonical_taxonomy
from config import supabase


def iter_questions(exam_name: str | None = None, exam_year: int | None = None):
    offset = 0
    while True:
        query = supabase.table("questions").select("*").range(offset, offset + 999)
        if exam_name:
            query = query.eq("exam_name", exam_name)
        if exam_year:
            query = query.eq("exam_year", exam_year)
        result = query.execute()
        rows = result.data or []
        if not rows:
            break
        for row in rows:
            yield row
        if len(rows) < 1000:
            break
        offset += 1000


def build_patch(row: dict[str, Any]) -> dict[str, str] | None:
    canonical = derive_canonical_taxonomy(
        row.get("subject"),
        row.get("topic"),
        row.get("subtopic"),
    )
    changed: dict[str, str] = {}
    if (row.get("subject") or "") != canonical["canonical_subject"]:
        changed["subject"] = canonical["canonical_subject"]
    if (row.get("topic") or "") != canonical["canonical_topic_family"]:
        changed["topic"] = canonical["canonical_topic_family"]
    if (row.get("subtopic") or "") != canonical["canonical_subtopic_family"]:
        changed["subtopic"] = canonical["canonical_subtopic_family"]
    if "canonical_subject" in row and (row.get("canonical_subject") or "") != canonical["canonical_subject"]:
        changed["canonical_subject"] = canonical["canonical_subject"]
    if "canonical_topic_family" in row and (row.get("canonical_topic_family") or "") != canonical["canonical_topic_family"]:
        changed["canonical_topic_family"] = canonical["canonical_topic_family"]
    if "canonical_subtopic_family" in row and (row.get("canonical_subtopic_family") or "") != canonical["canonical_subtopic_family"]:
        changed["canonical_subtopic_family"] = canonical["canonical_subtopic_family"]
    return changed or None


def _flush_updates(pending_rows: list[dict[str, Any]]) -> None:
    if not pending_rows:
        return
    supabase.table("questions").upsert(pending_rows, on_conflict="id").execute()


def run_backfill(*, exam_name: str | None = None, exam_year: int | None = None, dry_run: bool = False) -> dict[str, int]:
    scanned = 0
    updated = 0
    pending_rows: list[dict[str, Any]] = []
    for row in iter_questions(exam_name=exam_name, exam_year=exam_year):
        scanned += 1
        patch = build_patch(row)
        if not patch:
            continue
        if dry_run:
            print(f"DRY RUN {row['id']}: {patch}")
            updated += 1
            continue
        updated_row = dict(row)
        updated_row.update(patch)
        pending_rows.append(updated_row)
        updated += 1
        if len(pending_rows) >= 200:
            _flush_updates(pending_rows)
            pending_rows = []
            print(f"Updated {updated} questions...")
    if not dry_run:
        _flush_updates(pending_rows)
    return {"scanned": scanned, "updated": updated}


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill canonical taxonomy fields for questions.")
    parser.add_argument("--exam-name", dest="exam_name")
    parser.add_argument("--exam-year", dest="exam_year", type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    result = run_backfill(
        exam_name=args.exam_name,
        exam_year=args.exam_year,
        dry_run=args.dry_run,
    )
    print(result)


if __name__ == "__main__":
    main()
