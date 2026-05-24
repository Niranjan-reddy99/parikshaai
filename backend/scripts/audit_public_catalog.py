from __future__ import annotations

import json
from collections import defaultdict

from config import supabase
from papers import latest_live_paper_rows, normalize_exam_name


def main() -> int:
    selected = latest_live_paper_rows(sb=supabase)
    selected_ids = {str(row["id"]) for row in selected}
    selected_exam_keys = {(normalize_exam_name(str(row["exam_name"])), int(row["exam_year"])) for row in selected}

    rows = []
    offset = 0
    while True:
        res = (
            supabase.table("questions")
            .select(
                "id, exam_name, exam_year, paper_id, question_number, question_hash, "
                "is_active, structural_status, public_visibility"
            )
            .eq("is_active", True)
            .neq("structural_status", "broken")
            .range(offset, offset + 999)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    def row_identity(row: dict) -> tuple[str, ...]:
        exam_name = normalize_exam_name(str(row.get("exam_name") or ""))
        exam_year = int(row.get("exam_year") or 0)
        qnum = row.get("question_number")
        if exam_name and exam_year > 0 and isinstance(qnum, int) and qnum > 0:
            return ("exam", exam_name, str(exam_year), str(qnum))
        qhash = str(row.get("question_hash") or "").strip()
        if qhash:
            return ("hash", qhash)
        return ("id", str(row.get("id") or ""))

    seen = set()
    exam_counts: dict[tuple[str, int], int] = defaultdict(int)
    commission_counts: dict[str, int] = defaultdict(int)

    for row in rows:
        exam_name = normalize_exam_name(str(row.get("exam_name") or ""))
        exam_year = int(row.get("exam_year") or 0)
        if not exam_name or exam_year <= 0:
            continue
        paper_id = row.get("paper_id")
        if paper_id:
            if str(paper_id) not in selected_ids:
                continue
        else:
            if (exam_name, exam_year) not in selected_exam_keys:
                continue
        key = row_identity(row)
        if key in seen:
            continue
        seen.add(key)
        exam_counts[(exam_name, exam_year)] += 1
        commission = exam_name.split()[0].upper() if exam_name else "GENERAL"
        commission_counts[commission] += 1

    selected_summary = sorted(
        [
            {
                "exam_name": row["exam_name"],
                "exam_year": row["exam_year"],
                "upload_version": row["upload_version"],
                "publish_status": row["publish_status"],
                "question_count": row["question_count"],
                "visible_question_count": row["visible_question_count"],
                "hidden_question_count": row["hidden_question_count"],
                "selected_live_count": exam_counts.get((normalize_exam_name(str(row["exam_name"])), int(row["exam_year"])), 0),
            }
            for row in selected
        ],
        key=lambda r: (r["exam_name"], -int(r["exam_year"])),
    )

    print(json.dumps(
        {
            "total_questions": sum(exam_counts.values()),
            "commission_counts": dict(sorted(commission_counts.items())),
            "selected_papers": selected_summary,
        },
        indent=2,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
