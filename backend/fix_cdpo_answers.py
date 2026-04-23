"""
fix_cdpo_answers.py
====================
Bulletproof answer synchronizer for CDPO TSPSC exam.
- Sends 50 questions per API call to Gemini
- Skips any question where AI returns null/invalid (leaves it unchanged)
- Logs every correction made
- Safe to re-run multiple times
"""
import os, sys, json, time
from pathlib import Path
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).parent))
load_dotenv()

from config import supabase
from google import genai
from google.genai import types

_CLIENT = genai.Client(
    vertexai=True,
    project=os.getenv("GOOGLE_CLOUD_PROJECT"),
    location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
)
MODEL_ID = "publishers/google/models/gemini-2.5-flash"

VALID_ANSWERS = {"A", "B", "C", "D"}

def build_prompt(questions: list[dict]) -> str:
    prompt = (
        "You are an expert in Indian competitive exams. For each question below, "
        "identify the single correct answer letter (A, B, C, or D).\n"
        "Output ONLY a JSON array: [{\"id\": \"<id>\", \"ans\": \"A\"}, ...]\n"
        "If you are unsure, still pick the best answer. Never output null.\n\n"
    )
    for q in questions:
        options = (
            f"A) {q['option_a']}  B) {q['option_b']}  "
            f"C) {q['option_c']}  D) {q['option_d']}"
        )
        prompt += f"ID: {q['id']}\nQ: {q['question_text']}\n{options}\n---\n"
    return prompt

def call_gemini(prompt: str) -> dict:
    """Returns {id: answer_letter} map. Skips invalid entries."""
    for attempt in range(3):
        try:
            resp = _CLIENT.models.generate_content(
                model=MODEL_ID,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    response_mime_type="application/json",
                ),
            )
            raw = resp.text or ""
            # Strip markdown fences if present
            if "```" in raw:
                raw = raw.split("```json")[-1].split("```")[0].strip()
            data = json.loads(raw)
            result = {}
            for item in data:
                qid = item.get("id")
                ans = (item.get("ans") or "").strip().upper()
                if qid and ans in VALID_ANSWERS:
                    result[qid] = ans
            return result
        except Exception as e:
            print(f"  ⚠️  Attempt {attempt+1}/3 failed: {e}")
            time.sleep(3)
    return {}

def fix_cdpo():
    print("⚡ CDPO FIX: Fetching all CDPO questions...")
    res = supabase.table("questions").select(
        "id, question_text, option_a, option_b, option_c, option_d, correct_answer"
    ).ilike("exam_name", "%CDPO%").execute()
    
    questions = res.data or []
    if not questions:
        print("❌ No CDPO questions found.")
        return

    print(f"📋 Found {len(questions)} questions. Processing in batches of 50...")
    
    chunks = [questions[i:i+25] for i in range(0, len(questions), 25)]
    total_fixed = 0
    total_skipped = 0

    for i, chunk in enumerate(chunks):
        print(f"\n🔄 Batch {i+1}/{len(chunks)} ({len(chunk)} questions)...")
        prompt = build_prompt(chunk)
        answer_map = call_gemini(prompt)
        
        if not answer_map:
            print(f"  ❌ Batch {i+1} got no valid answers — skipping")
            total_skipped += len(chunk)
            continue

        fixed_in_batch = 0
        for q in chunk:
            qid = q["id"]
            db_ans = (q.get("correct_answer") or "").strip().upper()
            ai_ans = answer_map.get(qid)

            if not ai_ans:
                # AI didn't return an answer for this Q — skip
                total_skipped += 1
                continue

            if ai_ans != db_ans:
                print(f"  ✅ FIXING Q_{qid[:8]}: '{db_ans}' → '{ai_ans}'  [{q['question_text'][:60]}...]")
                supabase.table("questions").update({
                    "correct_answer": ai_ans,
                    "needs_review": False,
                }).eq("id", qid).execute()
                total_fixed += 1
                fixed_in_batch += 1
            else:
                # Already correct — just mark as verified
                supabase.table("questions").update({"needs_review": False}).eq("id", qid).execute()

        print(f"  → Fixed {fixed_in_batch} in this batch")

    print("\n" + "="*55)
    print(f"🏁 DONE")
    print(f"✅ Questions corrected: {total_fixed}")
    print(f"⏭️  Skipped (AI returned null): {total_skipped}")
    print(f"📌 All remaining marked needs_review=False")
    print("="*55)

if __name__ == "__main__":
    fix_cdpo()
