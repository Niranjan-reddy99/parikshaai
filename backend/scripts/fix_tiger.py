import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Add backend to path
backend_dir = Path(__file__).parent
sys.path.append(str(backend_dir))

from config import supabase

def force_fix_tiger_reserve():
    print("🎯 Targeting Tiger Reserve question for manual correction...")
    
    # 1. Find the question
    res = supabase.table("questions").select("id, question_text, correct_answer").ilike("question_text", "%tiger reserve%").ilike("question_text", "%largest%").execute()
    data = res.data or []
    
    if not data:
        print("❌ Could not find the question. Please check if it was deleted.")
        return

    for q in data:
        print(f"Found Q: {q['id'][:8]} | Current Ans: {q['correct_answer']} | Text: {q['question_text'][:50]}...")
        
        # 2. Update to A (Nagarjuna Sagar-Srisailam)
        print(f"✅ Forcing correct_answer to 'A' and clearing old explanations...")
        supabase.table("questions").update({"correct_answer": "A", "needs_review": False}).eq("id", q["id"]).execute()
        
        # 3. Wipe old mismatched explanation
        supabase.table("explanations").delete().eq("question_id", q["id"]).execute()

    print("🚀 DONE. The question is now hard-coded to 'A' in the database.")

if __name__ == "__main__":
    load_dotenv()
    force_fix_tiger_reserve()
