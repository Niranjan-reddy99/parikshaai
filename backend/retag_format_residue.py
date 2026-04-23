from __future__ import annotations

import argparse
import json
import re
from typing import Any

from google.genai import types

from ai_models import TAGGING_MODEL, get_genai_client
from canonical_taxonomy import derive_canonical_taxonomy
from config import supabase
from pipeline import _question_supported_columns, _quality_update_payload, CostTracker
from row_quality import merge_quality_fields


TARGET_TOPICS = {
    "General",
    "Matching",
    "Matching Pairs",
    "Statement Analysis",
    "Statements Analysis",
    "Statements based",
    "Telangana Specific",
}

_CLIENT = get_genai_client()

PROMPT = """You are classifying competitive-exam PYQs into a clean product taxonomy.

Return ONLY a JSON array. Schema:
[{{"id": 1, "subject": "...", "topic": "...", "subtopic": "...", "difficulty": "Easy|Medium|Hard"}}]

Allowed subjects:
History | Geography | Polity | Economy | Environment | Science & Technology | General Science | Current Affairs | Mathematics | Quantitative Aptitude | Logical Reasoning | Mental Ability | English Language | Computer Knowledge | General Awareness | Social Issues | International Relations

Critical rules:
- NEVER use question-format labels as topic or subtopic.
- Forbidden topic/subtopic labels: General, Matching, Match the Following, Matching Pairs, Statement Analysis, Statements Analysis, Statements based, Telangana Specific.
- If the question says "match the following", "consider the following statements", chronology, assertion-reason, etc., IGNORE that format and classify by the actual knowledge domain.
- Use broad parent topics for product clarity:
  - all air/water/noise/plastic pollution style questions -> topic "Pollution"
  - all tribal society/tribal welfare style questions -> topic "Tribal Communities" or "Tribal Welfare & Development"
  - all caste/social stratification style questions -> topic "Caste & Social Stratification"
  - all Telangana-history/place/culture rows -> topic "Telangana History" or "Telangana Culture"
- subtopic should be a useful child bucket under the broad topic, not a format label.

Questions:
{questions}
"""


def _load_rows(limit: int | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        result = (
            supabase.table("questions")
            .select("id, question_text, option_a, option_b, option_c, option_d, question_type, subject, topic, subtopic, difficulty")
            .in_("topic", list(TARGET_TOPICS))
            .range(offset, offset + 199)
            .execute()
        )
        batch = result.data or []
        if not batch:
            break
        rows.extend(batch)
        if limit and len(rows) >= limit:
            return rows[:limit]
        if len(batch) < 200:
            break
        offset += 200
    return rows


def _build_batch_prompt(batch: list[dict[str, Any]]) -> str:
    blocks = []
    for idx, row in enumerate(batch, start=1):
        opts = []
        for label, key in (("A", "option_a"), ("B", "option_b"), ("C", "option_c"), ("D", "option_d")):
            val = str(row.get(key) or "").strip()
            if val:
                opts.append(f"{label}) {val[:160]}")
        q_type = str(row.get("question_type") or "").strip()
        blocks.append(
            f"Q{idx} [db_id={row['id']}]\n"
            f"Current tags: subject={row.get('subject')}, topic={row.get('topic')}, subtopic={row.get('subtopic')}\n"
            f"Question type: {q_type or 'unknown'}\n"
            f"Question: {str(row.get('question_text') or '')[:700]}\n"
            + ("\n".join(opts) if opts else "")
        )
    return PROMPT.format(questions="\n\n".join(blocks))


def _call_batch(batch: list[dict[str, Any]], tracker: CostTracker) -> list[dict[str, Any]]:
    prompt = _build_batch_prompt(batch)
    resp = _CLIENT.models.generate_content(
        model=TAGGING_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.1,
            max_output_tokens=4096,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    tracker.record_from_response("Format residue retag", resp)
    raw = (resp.text or "").strip()
    raw = re.sub(r"^```json\s*|^```|\s*```$", "", raw, flags=re.MULTILINE).strip()
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError("Model did not return a JSON array")
    return data


def run(limit: int | None = None) -> dict[str, int]:
    rows = _load_rows(limit=limit)
    if not rows:
        return {"selected": 0, "updated": 0}

    tracker = CostTracker()
    supported_cols = _question_supported_columns(supabase)
    updated = 0
    batch_size = 20
    for start in range(0, len(rows), batch_size):
        batch = rows[start:start + batch_size]
        data = _call_batch(batch, tracker)
        by_index = {i + 1: row for i, row in enumerate(batch)}
        by_id = {str(row["id"]): row for row in batch}
        for idx, item in enumerate(data, start=1):
            item_id = item.get("id", idx)
            current = by_id.get(str(item_id))
            if current is None:
                try:
                    current = by_index.get(int(item_id))
                except Exception:
                    current = None
            if not current:
                continue
            patch = {
                "subject": str(item.get("subject") or current.get("subject") or "General Awareness").strip(),
                "topic": str(item.get("topic") or current.get("topic") or "General Awareness").strip(),
                "subtopic": str(item.get("subtopic") or current.get("subtopic") or "").strip() or None,
                "difficulty": str(item.get("difficulty") or current.get("difficulty") or "Medium").strip(),
            }
            canonical = derive_canonical_taxonomy(patch["subject"], patch["topic"], patch["subtopic"])
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
            supabase.table("questions").update(payload).eq("id", current["id"]).execute()
            updated += 1

    tracker.print_summary()
    return {"selected": len(rows), "updated": updated}


def main() -> None:
    parser = argparse.ArgumentParser(description="Semantically retag residual format-labelled rows.")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    print(run(limit=args.limit))


if __name__ == "__main__":
    main()
