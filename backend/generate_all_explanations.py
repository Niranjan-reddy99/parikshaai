"""
Generate explanations for ALL questions across ALL exams that are missing one.

Uses Vertex AI (same as pipeline.py) — requires GOOGLE_CLOUD_PROJECT in backend/.env

Skips:
  - Questions with no correct_answer (no answer key uploaded)
  - Questions that already have an explanation

Usage:
    python generate_all_explanations.py [--dry-run] [--exam "NAME YEAR"]

Options:
    --dry-run          Count missing, estimate cost, exit without API calls
    --exam "NAME YEAR" Limit to one exam (e.g. "UPSC IAS 2024")
"""
from __future__ import annotations

import concurrent.futures as _cf
import os
import sys
import re
import time
import json
from typing import Any

from ai_models import EXPLANATION_MODEL, get_genai_client
from dotenv import load_dotenv
load_dotenv()

from google.genai import types
from supabase import create_client

# ── Config ────────────────────────────────────────────────────────────────────
_CLIENT = get_genai_client()
_EXECUTOR = _cf.ThreadPoolExecutor(max_workers=2, thread_name_prefix="explainer")

sb = create_client(
    os.getenv("SUPABASE_URL", ""),
    os.getenv("SUPABASE_SERVICE_KEY", ""),
)

DRY_RUN     = "--dry-run" in sys.argv
EXAM_FILTER = next((sys.argv[i+1] for i, a in enumerate(sys.argv) if a == "--exam" and i+1 < len(sys.argv)), None)

BATCH_SIZE = 15
MODEL = EXPLANATION_MODEL

PROMPT = """You are an expert tutor for Indian government exams (UPSC, CISF, SSC, APPSC, TSPSC, etc.).

For each question below, write a clear 2-3 sentence explanation of WHY the correct answer is right.
Be factual and concise. Return ONLY a JSON array. No markdown, no commentary.

Format: [{{"id": 1, "explanation": "..."}} , ...]

Questions:
{questions_text}"""


# ── Helpers ───────────────────────────────────────────────────────────────────
def _extract_json_list(raw: str) -> list[dict] | None:
    raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        pass
    # Try to find JSON array inside the text
    m = re.search(r'\[.*\]', raw, re.DOTALL)
    if m:
        try:
            data = json.loads(m.group())
            if isinstance(data, list):
                return data
        except json.JSONDecodeError:
            pass
    return None


def fetch_all_questions() -> list[dict]:
    all_qs: list[dict] = []
    offset = 0
    while True:
        q = sb.table("questions").select(
            "id, exam_name, exam_year, question_text, option_a, option_b, option_c, option_d, correct_answer"
        ).eq("is_active", True).not_.is_("correct_answer", "null").neq("correct_answer", "").neq("correct_answer", "?")
        if EXAM_FILTER:
            parts = EXAM_FILTER.rsplit(" ", 1)
            if len(parts) == 2 and parts[1].isdigit():
                q = q.eq("exam_name", parts[0]).eq("exam_year", int(parts[1]))
            else:
                q = q.eq("exam_name", EXAM_FILTER)
        batch = (q.range(offset, offset + 999).execute().data or [])
        all_qs.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return all_qs


def fetch_existing_ids(ids: list[str]) -> set[str]:
    existing: set[str] = set()
    for i in range(0, len(ids), 100):
        chunk = ids[i:i+100]
        r = sb.table("explanations").select("question_id").in_("question_id", chunk).execute()
        existing.update(row["question_id"] for row in (r.data or []))
    return existing


def save_explanations(rows: list[dict]) -> None:
    for i in range(0, len(rows), 500):
        sb.table("explanations").upsert(rows[i:i+500], on_conflict="question_id").execute()


def build_prompt(batch: list[dict]) -> str:
    qs_text = "\n\n".join(
        f"{i+1}. {q['question_text'][:300]}\n"
        f"   A) {q.get('option_a','')[:100]}  B) {q.get('option_b','')[:100]}\n"
        f"   C) {q.get('option_c','')[:100]}  D) {q.get('option_d','')[:100]}\n"
        f"   Correct Answer: {q.get('correct_answer','A')}"
        for i, q in enumerate(batch)
    )
    return PROMPT.format(questions_text=qs_text)


def call_api(prompt: str) -> list[dict]:
    for attempt in range(5):
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
                print(f"    ⚠️  Timed out after 90s (attempt {attempt+1}), retrying...")
                time.sleep(5)
                continue
            raw = (resp.text or "").strip()
            data = _extract_json_list(raw)
            if data is not None:
                return data
            print(f"    ⚠️  JSON error (attempt {attempt+1}), retrying...")
            time.sleep(3)
        except Exception as e:
            err = str(e)
            if "429" in err or "RESOURCE_EXHAUSTED" in err or "quota" in err.lower():
                wait = 60 * (attempt + 1)
                print(f"    ⏳ Rate limited, waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"    ❌ API error: {e}")
                break
    return []


def call_api_single(q: dict) -> dict | None:
    qs_text = (
        f"1. {q['question_text'][:400]}\n"
        f"   A) {q.get('option_a','')[:120]}  B) {q.get('option_b','')[:120]}\n"
        f"   C) {q.get('option_c','')[:120]}  D) {q.get('option_d','')[:120]}\n"
        f"   Correct Answer: {q.get('correct_answer','A')}"
    )
    result = call_api(PROMPT.format(questions_text=qs_text))
    return result[0] if result else None


# ── Main ───────────────────────────────────────────────────────────────────────
def main() -> None:
    if DRY_RUN:
        print("🔵 DRY RUN — no API calls, no writes\n")

    print("🔍 Fetching questions with correct_answer...")
    all_qs = fetch_all_questions()
    print(f"  Found {len(all_qs)} questions with an answer key")

    ids = [q["id"] for q in all_qs]
    print("🔍 Checking existing explanations...")
    existing_ids = fetch_existing_ids(ids)
    print(f"  Already have explanations: {len(existing_ids)}")

    pending = [q for q in all_qs if q["id"] not in existing_ids]
    print(f"  Missing explanations: {len(pending)}")

    if not pending:
        print("✅ All questions already have explanations!")
        return

    by_exam: dict[str, int] = {}
    for q in pending:
        key = f"{q['exam_name']} {q['exam_year']}"
        by_exam[key] = by_exam.get(key, 0) + 1
    print(f"\n📋 Missing by exam:")
    for exam, count in sorted(by_exam.items()):
        print(f"   {exam}: {count}")

    cost_est = len(pending) * 0.0015
    print(f"\n💰 Estimated cost: ₹{cost_est:.2f} for {len(pending)} questions")

    if DRY_RUN:
        print("\n✅ Dry run done — no changes made.")
        return

    confirm = input("\nProceed? (y/N): ").strip().lower()
    if confirm != "y":
        print("Aborted.")
        return

    batches = [pending[i:i+BATCH_SIZE] for i in range(0, len(pending), BATCH_SIZE)]
    generated = 0
    failed = 0

    print(f"\n📝 Generating in {len(batches)} batches of {BATCH_SIZE}...\n")

    for bn, batch in enumerate(batches, 1):
        print(f"🧠 Batch {bn}/{len(batches)} ({len(batch)} questions)...", end=" ", flush=True)

        explanations = call_api(build_prompt(batch))

        if not explanations:
            print(f"↩️  batch failed — retrying individually")
            explanations = []
            for qi, q in enumerate(batch):
                item = call_api_single(q)
                if item:
                    item["id"] = qi + 1
                    explanations.append(item)
                    print(f"  ✅ Q{qi+1}", end=" ")
                else:
                    failed += 1
                    print(f"  ❌ Q{qi+1}", end=" ")
                time.sleep(1)
            print()

        if explanations:
            id_map = {e.get("id", i+1): e.get("explanation", "") for i, e in enumerate(explanations)}
            rows = []
            for i, q in enumerate(batch):
                text = str(id_map.get(i+1, "")).strip()
                if text and len(text) > 10:
                    rows.append({
                        "question_id": q["id"],
                        "explanation": text,
                        "source": "gemini-2.5-flash",
                    })
            if rows:
                save_explanations(rows)
                generated += len(rows)
                print(f"✅ saved {len(rows)}")
            else:
                print("⚠️  no valid explanations in response")
        else:
            print("❌ all retries failed")
            failed += len(batch)

        if bn < len(batches):
            time.sleep(1.2)

    print(f"\n{'='*50}")
    print(f"✅ Done!  Generated: {generated}  |  Failed: {failed}  |  Already existed: {len(existing_ids)}")


if __name__ == "__main__":
    main()
