import os
import sys
import json
import asyncio
from dotenv import load_dotenv

sys.path.append(os.path.join(os.getcwd(), 'backend'))
load_dotenv('backend/.env')

from google import genai
from google.genai import types
from supabase import create_client

client = genai.Client(
    vertexai=True,
    project=os.getenv("GOOGLE_CLOUD_PROJECT"),
    location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
)
MODEL_ID = "publishers/google/models/gemini-2.5-flash"
sb = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

PROMPT = """You are an SSC Math expert. Give a SHORT, CONCISE step-by-step solution for this question.
- Max 3-4 lines only
- Only show the key math steps, no filler words
- Use %, x, / symbols directly

Output JSON with key "explanation" containing the solution string.

QUESTION: {question}
OPTIONS: A) {a}  B) {b}  C) {c}  D) {d}
CORRECT ANSWER: {ans}
"""

async def generate_one(q: dict) -> str:
    prompt = PROMPT.format(
        question=q['question_text'],
        a=q['option_a'], b=q['option_b'],
        c=q['option_c'], d=q['option_d'],
        ans=q['correct_answer'] or 'Unknown'
    )
    try:
        res = client.models.generate_content(
            model=MODEL_ID,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.1
            )
        )
        data = json.loads(res.text)
        return data.get("explanation", "")
    except Exception as e:
        print(f"  [!] Error for Q#{q['question_number']}: {e}")
        return ""

async def main():
    print("Fetching all questions...")
    res = sb.table("pattern_questions").select("*").order("question_number").execute()
    questions = res.data
    
    # Only process those WITHOUT explanations
    missing = [q for q in questions if not q.get('explanation') or len(q['explanation'].strip()) < 10]
    print(f"Total: {len(questions)} | Missing solutions: {len(missing)}")
    
    chunk_size = 20  # 20 concurrent requests with billing enabled
    synced = 0
    
    for i in range(0, len(missing), chunk_size):
        chunk = missing[i:i+chunk_size]
        print(f"  Processing {i+1}-{min(i+chunk_size, len(missing))}/{len(missing)}...")
        
        tasks = [generate_one(q) for q in chunk]
        results = await asyncio.gather(*tasks)
        
        for q, expl in zip(chunk, results):
            if expl:
                sb.table("pattern_questions").update({"explanation": expl}).eq("id", q['id']).execute()
                synced += 1
        
        # Small delay to be safe with rate limits
        await asyncio.sleep(1)
    
    # Final check
    res2 = sb.table("pattern_questions").select("explanation").execute()
    done = sum(1 for r in res2.data if r.get('explanation') and len(r['explanation'].strip()) > 10)
    print(f"\n✅ Done! {synced} synced this run. Total with solutions: {done}/341")

if __name__ == "__main__":
    asyncio.run(main())
