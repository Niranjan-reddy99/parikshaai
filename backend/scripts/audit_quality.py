import os
import sys
import json
import time
from pathlib import Path
from dotenv import load_dotenv

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))
load_dotenv('backend/.env')

from google import genai
from google.genai import types
from supabase import create_client

# ── Config ────────────────────────────────────────────────────────────────────
client = genai.Client(
    vertexai=True,
    project=os.getenv("GOOGLE_CLOUD_PROJECT"),
    location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
)

# Use Gemini 2.5 Pro for high-accuracy auditing
AUDITOR_MODEL = "publishers/google/models/gemini-2.5-pro"
sb = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

PROMPT_TEMPLATE = """You are a High-Accuracy Auditor for Indian Competitive Exams (UPSC, SSC, State PSC).
Your task is to verify if the provided 'Correct Answer' is factually accurate for the given question and options.

QUESTION: {question}
OPTIONS:
A) {a}
B) {b}
C) {c}
D) {d}

CURRENT DB ANSWER: {ans}

INSTRUCTIONS:
1. Determine the factually correct answer.
2. If the 'CURRENT DB ANSWER' is wrong, identify the CORRECT option letter (A, B, C, or D).
3. Write a concise, 3-4 line explanation justifying the correct answer.
4. Ensure the explanation explicitly supports the option letter you choose.

OUTPUT FORMAT (JSON ONLY):
{{
  "is_correct": true,
  "correct_option": "A",
  "explanation": "concise explanation here",
  "confidence": 0.95,
  "mismatch_found": false
}}
"""

def audit_one_question(q: dict):
    prompt = PROMPT_TEMPLATE.format(
        question=q['question_text'],
        a=q.get('option_a', ''),
        b=q.get('option_b', ''),
        c=q.get('option_c', ''),
        d=q.get('option_d', ''),
        ans=q.get('correct_answer', '')
    )
    
    try:
        response = client.models.generate_content(
            model=AUDITOR_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0
            )
        )
        
        audit_res = json.loads(response.text)
        
        # 1. Update Questions Table (only if mismatch)
        if audit_res.get('mismatch_found') or not audit_res.get('is_correct'):
            new_ans = audit_res.get('correct_option', '').strip().upper()
            if new_ans in ['A', 'B', 'C', 'D']:
                print(f"  [!] MISMATCH: Changing {q['correct_answer']} -> {new_ans}")
                sb.table("questions").update({"correct_answer": new_ans}).eq("id", q['id']).execute()
            else:
                print(f"  [!] Error: AI returned invalid answer '{new_ans}'")

        # 2. Update/Insert Explanations Table (always update with the better reasoning)
        expl_data = {
            "question_id": q['id'],
            "explanation": audit_res['explanation']
        }
        sb.table("explanations").upsert(expl_data, on_conflict="question_id").execute()
        
        return True
    except Exception as e:
        print(f"  [!] Error auditing Q {q['id']}: {e}")
        return False

def main():
    # Audit the specific questions found in research
    target_ids = ["6fe3e121-8894-4e55-8142-d02a35856654", "732f9e97-ea11-4d67-95e5-19b3f9ef79cc"]
    
    print(f"🚀 Starting Quality Audit for {len(target_ids)} questions...")
    
    for qid in target_ids:
        res = sb.table("questions").select("*").eq("id", qid).execute()
        if not res.data:
            print(f"  [?] Q {qid} not found")
            continue
            
        question = res.data[0]
        print(f"Auditing Q: {question['question_text'][:50]}...")
        success = audit_one_question(question)
        if success:
            print(f"  [+] Audit complete for {qid}")

if __name__ == "__main__":
    main()
