from __future__ import annotations

import argparse

from canonical_taxonomy import derive_canonical_taxonomy
from config import supabase
from pipeline import tag_questions, CostTracker, _question_supported_columns, _quality_update_payload
from row_quality import merge_quality_fields


TARGET_TOPICS = {
    "General",
    "Matching",
    "Matching Pairs",
    "Match the Following",
    "Statement Analysis",
    "Statements Analysis",
    "Statements based",
    "Telangana Specific",
}


def load_target_rows(limit: int | None = None) -> list[dict]:
    rows = []
    offset = 0
    target_list = ",".join(sorted(TARGET_TOPICS))
    while True:
        query = (
            supabase.table("questions")
            .select(
                "id, question_text, option_a, option_b, option_c, option_d, question_type, "
                "subject, topic, subtopic, difficulty"
            )
            .in_("topic", list(TARGET_TOPICS))
            .range(offset, offset + 499)
        )
        result = query.execute()
        batch = result.data or []
        if not batch:
            break
        rows.extend(batch)
        if limit and len(rows) >= limit:
            return rows[:limit]
        if len(batch) < 500:
            break
        offset += 500
    return rows


def run(limit: int | None = None) -> dict[str, int]:
    rows = load_target_rows(limit=limit)
    if not rows:
        return {"selected": 0, "updated": 0}

    tracker = CostTracker()
    tag_input = [
        {
            "question_text": row.get("question_text"),
            "option_a": row.get("option_a"),
            "option_b": row.get("option_b"),
            "option_c": row.get("option_c"),
            "option_d": row.get("option_d"),
            "question_type": row.get("question_type"),
            "id_db": row["id"],
        }
        for row in rows
    ]
    tagged = tag_questions(tag_input, "low-quality-retag", tracker=tracker)

    supported_cols = _question_supported_columns(supabase)
    updated = 0
    by_id = {row["id"]: row for row in rows}
    for item in tagged:
        current = by_id[item["id_db"]]
        patch = {
            "subject": item.get("subject") or current.get("subject") or "General Awareness",
            "topic": item.get("topic") or current.get("topic") or "General",
            "subtopic": item.get("subtopic") or current.get("subtopic"),
            "difficulty": item.get("difficulty") or current.get("difficulty") or "Medium",
        }
        canonical = derive_canonical_taxonomy(
            patch["subject"],
            patch["topic"],
            patch["subtopic"],
        )
        patch["subject"] = canonical["canonical_subject"]
        patch["topic"] = canonical["canonical_topic_family"]
        patch["subtopic"] = canonical["canonical_subtopic_family"]
        for key, value in canonical.items():
            if key in supported_cols:
                patch[key] = value
        merged = merge_quality_fields(
            current,
            patch,
            explanation_present=current.get("explanation_status") == "generated",
            explanation_contradiction=current.get("explanation_status") == "contradiction",
        )
        payload = _quality_update_payload(patch, merged, supported_cols)
        supabase.table("questions").update(payload).eq("id", item["id_db"]).execute()
        updated += 1

    tracker.print_summary()
    return {"selected": len(rows), "updated": updated}


def main() -> None:
    parser = argparse.ArgumentParser(description="AI-retag low-quality generic topic buckets.")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    print(run(limit=args.limit))


if __name__ == "__main__":
    main()
