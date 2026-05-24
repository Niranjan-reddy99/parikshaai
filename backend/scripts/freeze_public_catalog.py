from __future__ import annotations

import json
import os

# Freeze against the current selector, not any older practice_ready snapshot.
os.environ["PUBLIC_USE_PRACTICE_READY"] = "0"

from config import supabase
from main import _build_catalog_from_meta, _collect_public_question_meta_rows


def _chunked(seq: list[str], size: int) -> list[list[str]]:
    return [seq[i:i + size] for i in range(0, len(seq), size)]


def main() -> int:
    rows = _collect_public_question_meta_rows()
    selected_ids = sorted({str(row.get("id") or "").strip() for row in rows if row.get("id")})
    if not selected_ids:
        print(json.dumps({"selected": 0, "updated_true": 0, "updated_false": 0, "catalog": {}}, indent=2))
        return 0

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

    catalog = _build_catalog_from_meta(rows)
    print(json.dumps({
        "selected": len(selected_ids),
        "updated_true": len(to_enable),
        "updated_false": len(to_disable),
        "catalog": {
            "total_questions": catalog.get("total_questions"),
            "commissions": sorted((catalog.get("commission_map") or {}).keys()),
        },
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
