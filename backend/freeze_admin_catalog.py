from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from config import supabase

SNAPSHOT_DIR = Path(__file__).parent / "snapshots" / "catalog"
SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)


def _chunked(seq: list[str], size: int) -> list[list[str]]:
    return [seq[i:i + size] for i in range(0, len(seq), size)]


def _collect_active_admin_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            supabase.table("questions")
            .select(
                "id, exam_name, exam_year, subject, topic, subtopic, difficulty, "
                "needs_review, is_active, paper_id, question_number, "
                "structural_status, public_visibility, created_at"
            )
            .eq("is_active", True)
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


def freeze_current_admin_catalog(snapshot_label: Optional[str] = None) -> dict[str, Any]:
    from main import _build_catalog_from_meta, _dedupe_admin_meta_rows

    active_rows = _collect_active_admin_rows()
    deduped_rows = _dedupe_admin_meta_rows(active_rows)
    selected_ids = sorted({str(row.get("id") or "").strip() for row in deduped_rows if row.get("id")})

    existing_true: list[str] = []
    offset = 0
    while True:
        batch = (
            supabase.table("questions")
            .select("id")
            .eq("practice_ready", True)
            .range(offset, offset + 999)
            .execute()
            .data
            or []
        )
        existing_true.extend(str(row["id"]) for row in batch if row.get("id"))
        if len(batch) < 1000:
            break
        offset += 1000

    selected_set = set(selected_ids)
    existing_set = set(existing_true)
    to_enable = sorted(selected_set - existing_set)
    to_disable = sorted(existing_set - selected_set)

    for chunk in _chunked(to_enable, 200):
        supabase.table("questions").update({"practice_ready": True}).in_("id", chunk).execute()

    for chunk in _chunked(to_disable, 200):
        supabase.table("questions").update({"practice_ready": False}).in_("id", chunk).execute()

    catalog = _build_catalog_from_meta(deduped_rows)
    commission_counts = {
        commission: sum(int(exam.get("count") or 0) for exam in (exam_map or {}).values())
        for commission, exam_map in (catalog.get("commission_map") or {}).items()
    }
    exam_keys = sorted(
        {
            f"{str(row.get('exam_name') or '').strip()}::{int(row.get('exam_year') or 0)}"
            for row in deduped_rows
            if str(row.get("exam_name") or "").strip() and int(row.get("exam_year") or 0) > 0
        }
    )

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    slug = (snapshot_label or "admin_on").strip().lower().replace(" ", "_")
    snapshot_path = SNAPSHOT_DIR / f"{stamp}_{slug}.json"
    snapshot = {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "label": snapshot_label or "admin_on",
        "selected_question_count": len(selected_ids),
        "commission_counts": commission_counts,
        "exam_keys": exam_keys,
        "question_ids": selected_ids,
        "catalog": catalog,
    }
    snapshot_path.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False))

    return {
        "selected": len(selected_ids),
        "updated_true": len(to_enable),
        "updated_false": len(to_disable),
        "snapshot_path": str(snapshot_path.resolve()),
        "catalog": {
            "total_questions": catalog.get("total_questions"),
            "commissions": sorted((catalog.get("commission_map") or {}).keys()),
            "commission_counts": commission_counts,
        },
    }


def main() -> int:
    result = freeze_current_admin_catalog()
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
