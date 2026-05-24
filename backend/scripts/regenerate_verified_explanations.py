from __future__ import annotations

import json
import sys

from config import supabase
from pipeline import (
    _explanation_contradicts_answer,
    _explanation_is_flagged_unreliable,
    generate_single_explanation,
)


def main() -> int:
    exam_prefix = sys.argv[1].strip() if len(sys.argv) > 1 else None

    rows = []
    offset = 0
    while True:
        q = supabase.table("questions").select(
            "id, exam_name, exam_year, question_number, correct_answer, needs_review, explanation_status"
        ).eq("needs_review", False).range(offset, offset + 999)
        if exam_prefix:
            q = q.ilike("exam_name", f"{exam_prefix}%")
        batch = q.execute().data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    ids = [str(r["id"]) for r in rows if r.get("id")]
    expl_rows = []
    for i in range(0, len(ids), 200):
        chunk = ids[i:i + 200]
        expl_rows.extend(
            supabase.table("explanations")
            .select("question_id, explanation, source")
            .in_("question_id", chunk)
            .execute()
            .data
            or []
        )
    expl_map = {str(r["question_id"]): r for r in expl_rows if r.get("question_id")}

    targets = []
    for row in rows:
        qid = str(row.get("id") or "")
        expl = expl_map.get(qid)
        if not expl:
            continue
        text = str(expl.get("explanation") or "").strip()
        source = str(expl.get("source") or "")
        ans = str(row.get("correct_answer") or "").strip().upper()
        if not ans:
            continue
        if "unverified-answer" in source or _explanation_is_flagged_unreliable(text) or _explanation_contradicts_answer(text, ans):
            targets.append({
                "id": qid,
                "exam_name": row.get("exam_name"),
                "exam_year": row.get("exam_year"),
                "question_number": row.get("question_number"),
            })

    repaired = 0
    hidden = 0
    failed: list[dict] = []
    for item in targets:
        qid = item["id"]
        try:
            supabase.table("explanations").delete().eq("question_id", qid).execute()
            supabase.table("questions").update({"explanation_status": "missing"}).eq("id", qid).execute()
            result = generate_single_explanation(qid)
            if not result:
                failed.append(item)
                continue
            if result.get("source") == "hidden-contradiction" or not str(result.get("explanation") or "").strip():
                hidden += 1
            else:
                repaired += 1
        except Exception:
            failed.append(item)

    print(json.dumps({
        "exam_prefix": exam_prefix,
        "targets": len(targets),
        "repaired": repaired,
        "hidden": hidden,
        "failed": failed[:50],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
