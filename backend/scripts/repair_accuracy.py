import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Add backend to path
backend_dir = Path(__file__).parent
sys.path.append(str(backend_dir))

from config import supabase

def repair_cdpo_explanations():
    print("🔍 Searching for CDPO questions to repair...")
    
    # 1. Find all questions belonging to CDPO exam OR mentioning 'tiger reserve'
    res = supabase.table("questions").select("id").ilike("exam_name", "%CDPO%").execute()
    q_ids = [q["id"] for q in (res.data or [])]
    
    # Also add the specific Tiger Reserve question for immediate fix
    tiger_res = supabase.table("questions").select("id").ilike("question_text", "%tiger reserve%").ilike("question_text", "%largest%").execute()
    q_ids.extend([q["id"] for q in (tiger_res.data or [])])
    
    q_ids = list(set(q_ids)) # Unique
    
    if not q_ids:
        print("❌ No CDPO questions found. Check the exam name.")
        return

    print(f"🧹 Clearing {len(q_ids)} existing wrong explanations...")
    
    # 2. Delete existing explanations so they can be regenerated with high-accuracy CoT
    # We do them in batches of 100 to avoid Supabase limits
    batch_size = 100
    deleted_count = 0
    for i in range(0, len(q_ids), batch_size):
        batch = q_ids[i:i+batch_size]
        del_res = supabase.table("explanations").delete().in_("question_id", batch).execute()
        deleted_count += len(del_res.data or [])

    print(f"✅ Success! {deleted_count} wrong explanations cleared.")
    print("🚀 Next time you view a question in the app, a NEW high-accuracy explanation will auto-generate.")

if __name__ == "__main__":
    load_dotenv()
    repair_cdpo_explanations()
