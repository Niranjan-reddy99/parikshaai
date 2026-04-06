"""
Repair explanations for "Consider the following statements" questions.

These questions have options like:
  A) A only   B) B only   C) Both A and B   D) Neither A nor B

Explanations generated during early debugging runs may be wrong because
options were empty/missing at that time. This script:
  1. Finds affected questions across ALL exams
  2. Deletes their bad explanations
  3. Regenerates them with full option text (costs ~₹0.04 total)

Usage:
    python repair_explanations.py [--dry-run]
"""
from __future__ import annotations

import re
import sys
import json
import time
import hashlib
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

import os
import google.generativeai as genai
from supabase import create_client

genai.configure(api_key=os.environ["GEMINI_API_KEY"])
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])

DRY_RUN = "--dry-run" in sys.argv
MODEL = genai.GenerativeModel("gemini-2.5-flash-lite")

# Options that indicate a "consider the following" style question
_CONSIDER_OPTS = re.compile(
    r'\b(A only|B only|C only|both a and b|neither a nor b|all of the above)\b',
    re.IGNORECASE
)


def _is_consider_type(q: dict) -> bool:
    """True if question has statement-style options."""
    opts = " ".join([
        q.get("option_a") or "",
        q.get("option_b") or "",
        q.get("option_c") or "",
        q.get("option_d") or "",
    ])
    return bool(_CONSIDER_OPTS.search(opts))


def fetch_affected() -> list[dict]:
    print("🔍 Fetching all questions to find affected ones...")
    # Fetch in pages to avoid Supabase 1000-row limit
    all_qs = []
    offset = 0
    while True:
        r = sb.table("questions").select(
            "id, exam_name, exam_year, question_text, option_a, option_b, option_c, option_d, correct_answer"
        ).eq("is_active", True).range(offset, offset + 999).execute()
        batch = r.data or []
        all_qs.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    affected = [q for q in all_qs if _is_consider_type(q)]
    print(f"  Total questions: {len(all_qs)}")
    print(f"  Affected (consider-type): {len(affected)}")
    return affected


def delete_explanations(question_ids: list[str]) -> int:
    if not question_ids:
        return 0
    r = sb.table("explanations").delete().in_("question_id", question_ids).execute()
    return len(r.data or [])


def regenerate(questions: list[dict]) -> int:
    PROMPT_TMPL = """You are an expert tutor for Indian government exams.

For each question below, write a clear 2-3 sentence explanation of WHY the correct answer is right.
The correct answer letter maps to the option shown. Be factual. Return ONLY a JSON array, no markdown.

Format: [{{"id": 1, "explanation": "..."}} , ...]

Questions:
{questions_text}"""

    BATCH = 15
    generated = 0
    batches = [questions[i:i+BATCH] for i in range(0, len(questions), BATCH)]

    for bn, batch in enumerate(batches, 1):
        qs_text = "\n\n".join(
            f"{i+1}. {q['question_text'][:300]}\n"
            f"   A) {q.get('option_a','')[:100]}  B) {q.get('option_b','')[:100]}\n"
            f"   C) {q.get('option_c','')[:100]}  D) {q.get('option_d','')[:100]}\n"
            f"   Correct Answer: {q.get('correct_answer','A')} "
            f"(= {q.get('option_' + 'abcd'[ord(q.get('correct_answer','A').upper()[0]) - ord('A')], '') if q.get('correct_answer') else ''})"
            for i, q in enumerate(batch)
        )
        prompt = PROMPT_TMPL.format(questions_text=qs_text)

        print(f"  🧠 Batch {bn}/{len(batches)}: generating {len(batch)} explanations...")
        if DRY_RUN:
            print("    [DRY RUN — skipping API call]")
            continue

        for attempt in range(3):
            try:
                resp = MODEL.generate_content(
                    prompt,
                    generation_config=genai.GenerationConfig(temperature=0.2, max_output_tokens=8192),
                    request_options={"timeout": 90},
                )
                raw = (resp.text or "").strip()
                if raw.startswith("```"):
                    import re as _re
                    raw = _re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
                data = json.loads(raw)
                if isinstance(data, list):
                    id_map = {e.get("id", i+1): e.get("explanation", "") for i, e in enumerate(data)}
                    rows = []
                    for i, q in enumerate(batch):
                        text = id_map.get(i+1, "").strip()
                        if text and len(text) > 10:
                            rows.append({"question_id": q["id"], "explanation": text, "source": "repaired"})
                    if rows:
                        sb.table("explanations").upsert(rows, on_conflict="question_id").execute()
                        generated += len(rows)
                        print(f"    ✅ Saved {len(rows)} explanations")
                    break
            except json.JSONDecodeError:
                print(f"    ⚠️  JSON error attempt {attempt+1}, retrying...")
                time.sleep(2)
            except Exception as e:
                print(f"    ❌ Error: {e}")
                break

        if bn < len(batches):
            time.sleep(1)

    return generated


def main():
    if DRY_RUN:
        print("🔵 DRY RUN mode — no API calls, no DB writes\n")

    affected = fetch_affected()
    if not affected:
        print("✅ No affected questions found.")
        return

    print(f"\n📋 Affected questions by exam:")
    by_exam: dict[str, int] = {}
    for q in affected:
        key = f"{q['exam_name']} {q['exam_year']}"
        by_exam[key] = by_exam.get(key, 0) + 1
    for exam, count in sorted(by_exam.items()):
        print(f"   {exam}: {count} questions")

    cost_est = len(affected) * 0.0018
    print(f"\n💰 Estimated regeneration cost: ₹{cost_est:.4f} (~{len(affected)} questions)")

    if not DRY_RUN:
        confirm = input("\nProceed? (y/N): ").strip().lower()
        if confirm != "y":
            print("Aborted.")
            return

    ids = [q["id"] for q in affected]
    print(f"\n🗑️  Deleting {len(ids)} bad explanations...")
    if not DRY_RUN:
        deleted = delete_explanations(ids)
        print(f"  Deleted: {deleted}")

    print(f"\n✍️  Regenerating {len(affected)} explanations...")
    generated = regenerate(affected)

    if not DRY_RUN:
        print(f"\n✅ Done! Regenerated {generated}/{len(affected)} explanations.")
    else:
        print(f"\n✅ Dry run complete. Would regenerate {len(affected)} explanations.")


if __name__ == "__main__":
    main()
