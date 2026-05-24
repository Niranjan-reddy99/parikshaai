"""Repair flattened match-the-following questions for TSPSC DAO GS 2023.

Converts plain-text DAO match questions into the structured __MATCH__ payload
used by the frontend table renderer, and re-fixes malformed older repairs.
"""
from __future__ import annotations

import json

from config import supabase
from extractor.universal_extractor import _recover_inline_match_payload


EXAM_NAME = "TSPSC DAO GS"
EXAM_YEAR = 2023


def main() -> None:
    offset = 0
    repaired = 0
    scanned = 0

    while True:
        res = (
            supabase.table("questions")
            .select("id, question_number, question_text, question_type")
            .eq("exam_name", EXAM_NAME)
            .eq("exam_year", EXAM_YEAR)
            .eq("is_active", True)
            .range(offset, offset + 999)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break

        for row in rows:
            scanned += 1
            text = row.get("question_text") or ""
            source_text = text

            if "__MATCH__:" in text:
                prefix, _, suffix = text.partition("__MATCH__:")
                source_text = prefix.strip()
                try:
                    payload_line = suffix.strip().splitlines()[0].strip()
                    payload = json.loads(payload_line)
                    col1 = payload.get("col1") or []
                    col2 = payload.get("col2") or []
                    if col1 and col2:
                        new_text = source_text + "\n\n__MATCH__:" + json.dumps(
                            {"col1": col1, "col2": col2},
                            ensure_ascii=False,
                        )
                        if new_text != text:
                            (
                                supabase.table("questions")
                                .update({"question_text": new_text, "question_type": "Match"})
                                .eq("id", row["id"])
                                .execute()
                            )
                            repaired += 1
                            print(f"[repair] Q{row.get('question_number')}: cleaned malformed match payload")
                        continue
                except Exception:
                    pass

            recovered = _recover_inline_match_payload(source_text)
            if not recovered:
                continue

            intro, col1, col2 = recovered
            new_text = intro + "\n\n__MATCH__:" + json.dumps(
                {"col1": col1, "col2": col2},
                ensure_ascii=False,
            )
            (
                supabase.table("questions")
                .update({"question_text": new_text, "question_type": "Match"})
                .eq("id", row["id"])
                .execute()
            )
            repaired += 1
            print(f"[repair] Q{row.get('question_number')}: match table restored")

        if len(rows) < 1000:
            break
        offset += 1000

    print(f"[done] scanned={scanned} repaired={repaired}")


if __name__ == "__main__":
    main()
