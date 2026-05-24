import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Add backend to path
backend_dir = Path(__file__).parent
sys.path.append(str(backend_dir))

from config import supabase

def fix_economic_history():
    print("🎯 Targeting 'Economic History of India' for manual correction...")
    
    # 1. Find the question
    res = supabase.table("questions").select("id, question_text, correct_answer").ilike("question_text", "%Economic History of India%").execute()
    data = res.data or []
    
    if not data:
        print("❌ Could not find the question.")
        return

    for q in data:
        print(f"Found Q: {q['id'][:8]} | Current Ans: {q['correct_answer']}")
        
        # 2. Update to A (RC Dutt)
        print(f"✅ Forcing correct_answer to 'A' (RC Dutt) and clearing old explanation...")
        supabase.table("questions").update({"correct_answer": "A", "needs_review": False}).eq("id", q["id"]).execute()
        
        # 3. Wipe old mismatched explanation
        supabase.table("explanations").delete().eq("question_id", q["id"]).execute()

    print("🚀 SUCCESS. Question synced to RC Dutt.")

if __name__ == "__main__":
    load_dotenv()
    fix_economic_history()
