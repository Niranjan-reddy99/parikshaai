from __future__ import annotations

import json
from collections import defaultdict

from config import supabase
from papers import latest_live_paper_rows


def main() -> int:
    selected = latest_live_paper_rows(sb=supabase)
    selected_ids = {str(row["id"]) for row in selected}

    rows = []
    offset = 0
    while True:
        res = (
            supabase.table("questions")
            .select(
                "id, paper_id, exam_name, exam_year, question_number, "
                "is_active, structural_status, public_visibility, "
                "question_text, option_a, option_b, option_c, option_d"
            )
            .in_("paper_id", list(selected_ids))
            .range(offset, offset + 999)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    by_exam: dict[tuple[str, int], dict[str, int]] = defaultdict(lambda: {
        "total": 0,
        "active": 0,
        "inactive": 0,
        "inactive_usable": 0,
        "broken": 0,
        "hidden_visible_text": 0,
    })

    for row in rows:
        key = (str(row.get("exam_name") or ""), int(row.get("exam_year") or 0))
        bucket = by_exam[key]
        bucket["total"] += 1
        text = str(row.get("question_text") or "").strip()
        opts = [
            str(row.get("option_a") or "").strip(),
            str(row.get("option_b") or "").strip(),
            str(row.get("option_c") or "").strip(),
            str(row.get("option_d") or "").strip(),
        ]
        filled = sum(1 for o in opts if o)
        usable = len(text) >= 15 and filled >= 2
        if row.get("is_active") is True:
            bucket["active"] += 1
        else:
            bucket["inactive"] += 1
            if usable:
                bucket["inactive_usable"] += 1
        if str(row.get("structural_status") or "") == "broken":
            bucket["broken"] += 1
        if str(row.get("public_visibility") or "") != "visible" and usable:
            bucket["hidden_visible_text"] += 1

    out = sorted(
        [
            {
                "exam_name": exam_name,
                "exam_year": exam_year,
                **stats,
            }
            for (exam_name, exam_year), stats in by_exam.items()
        ],
        key=lambda r: (r["inactive_usable"], r["inactive"], r["hidden_visible_text"]),
        reverse=True,
    )
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
