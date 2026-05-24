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

import concurrent.futures as _cf
import json
import os
import re
import sys
import time

from dotenv import load_dotenv
load_dotenv()

from google import genai
from google.genai import types
from supabase import create_client

# ── Config ────────────────────────────────────────────────────────────────────
_CLIENT = genai.Client(
    vertexai=True,
    project=os.getenv("GOOGLE_CLOUD_PROJECT"),
    location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
)
_EXECUTOR = _cf.ThreadPoolExecutor(max_workers=2, thread_name_prefix="repair-expl")

sb = create_client(
    os.getenv("SUPABASE_URL", ""),
    os.getenv("SUPABASE_SERVICE_KEY", ""),
)

MODEL   = "publishers/google/models/gemini-2.5-flash"
DRY_RUN = "--dry-run" in sys.argv

_CONSIDER_OPTS = re.compile(
    r'\b(A only|B only|C only|both a and b|neither a nor b|all of the above)\b',
    re.IGNORECASE,
)

PROMPT_TMPL = """You are an expert tutor for Indian government exams.

For each question below, write a clear 2-3 sentence explanation of WHY the correct answer is right.
The correct answer letter maps to the option shown. Be factual. Return ONLY a JSON array, no markdown.

Format: [{{"id": 1, "explanation": "..."}} , ...]

Questions:
{questions_text}"""


def _is_consider_type(q: dict) -> bool:
    opts = " ".join([
        q.get("option_a") or "", q.get("option_b") or "",
        q.get("option_c") or "", q.get("option_d") or "",
    ])
    return bool(_CONSIDER_OPTS.search(opts))


def fetch_affected() -> list[dict]:
    print("🔍 Fetching all questions to find affected ones...")
    all_qs: list[dict] = []
    offset = 0
    while True:
        batch = sb.table("questions").select(
            "id,exam_name,exam_year,question_text,option_a,option_b,option_c,option_d,correct_answer"
        ).eq("is_active", True).range(offset, offset + 999).execute().data or []
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
    deleted = 0
    for i in range(0, len(question_ids), 100):
        chunk = question_ids[i:i+100]
        r = sb.table("explanations").delete().in_("question_id", chunk).execute()
        deleted += len(r.data or [])
    return deleted


def _call_api(prompt: str) -> list[dict]:
    for attempt in range(3):
        try:
            fut = _EXECUTOR.submit(
                _CLIENT.models.generate_content,
                model=MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.2,
                    max_output_tokens=8192,
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )
            try:
                resp = fut.result(timeout=90)
            except _cf.TimeoutError:
                print(f"    ⚠️  Timed out after 90s (attempt {attempt+1})")
                time.sleep(5)
                continue
            raw = (resp.text or "").strip()
            if raw.startswith("```"):
                raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
            data = json.loads(raw)
            if isinstance(data, list):
                return data
        except json.JSONDecodeError:
            print(f"    ⚠️  JSON error attempt {attempt+1}, retrying...")
            time.sleep(2 ** attempt)
        except Exception as e:
            err = str(e)
            if "429" in err or "quota" in err.lower():
                wait = 60 * (attempt + 1)
                print(f"    ⏳ Rate limited, waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"    ❌ API error: {e}")
                break
    return []


def regenerate(questions: list[dict]) -> int:
    BATCH = 15
    generated = 0
    batches = [questions[i:i+BATCH] for i in range(0, len(questions), BATCH)]

    for bn, batch in enumerate(batches, 1):
        correct_letter_map = "abcd"
        qs_text = "\n\n".join(
            f"{i+1}. {q['question_text'][:300]}\n"
            f"   A) {q.get('option_a','')[:100]}  B) {q.get('option_b','')[:100]}\n"
            f"   C) {q.get('option_c','')[:100]}  D) {q.get('option_d','')[:100]}\n"
            f"   Correct: {q.get('correct_answer','A')}"
            for i, q in enumerate(batch)
        )
        prompt = PROMPT_TMPL.format(questions_text=qs_text)

        print(f"  🧠 Batch {bn}/{len(batches)}: generating {len(batch)} explanations...")
        if DRY_RUN:
            print("    [DRY RUN — skipping API call]")
            continue

        data = _call_api(prompt)
        if data:
            id_map = {e.get("id", i+1): e.get("explanation", "") for i, e in enumerate(data)}
            rows = [
                {"question_id": q["id"], "explanation": id_map.get(i+1, "").strip(), "source": "repaired"}
                for i, q in enumerate(batch)
                if id_map.get(i+1, "").strip() and len(id_map.get(i+1, "").strip()) > 10
            ]
            if rows:
                sb.table("explanations").upsert(rows, on_conflict="question_id").execute()
                generated += len(rows)
                print(f"    ✅ Saved {len(rows)} explanations")

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
    print(f"\n💰 Estimated cost: ₹{cost_est:.4f} (~{len(affected)} questions)")

    if not DRY_RUN:
        if input("\nProceed? (y/N): ").strip().lower() != "y":
            print("Aborted.")
            return

    if not DRY_RUN:
        ids = [q["id"] for q in affected]
        print(f"\n🗑️  Deleting {len(ids)} stale explanations...")
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
