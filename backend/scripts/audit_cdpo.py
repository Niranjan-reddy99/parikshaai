import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv

# Add backend to path
backend_dir = Path(__file__).parent
sys.path.append(str(backend_dir))

from config import supabase
from pipeline import generate_single_explanation

def total_recall_cdpo():
    print("🚀 STARTING TOTAL RECALL: Mass Consistency Audit for CDPO Exam...")
    
    # 1. Find all CDPO questions
    res = supabase.table("questions").select("id, question_text, correct_answer").ilike("exam_name", "%CDPO%").execute()
    questions = res.data or []
    
    print(f"📋 Found {len(questions)} questions. Starting deep-verification...")
    
    corrections = 0
    errors = 0
    
    for i, q in enumerate(questions):
        q_id = q["id"]
        print(f"[{i+1}/{len(questions)}] Force-verifying Q_{q_id[:8]}...")
        
        try:
            # FORCE WIPE existing explanation for this audit
            supabase.table("explanations").delete().eq("question_id", q_id).execute()
            
            # generate_single_explanation will now trigger fresh CoT and sync to DB
            result = generate_single_explanation(q_id)
            
            if result:
                new_ans = result.get("verified_answer")
                old_ans = q.get("correct_answer")
                
                if new_ans != old_ans:
                    print(f"  🔄 FIXED: {old_ans} -> {new_ans} for '{q['question_text'][:40]}...'")
                    corrections += 1
                else:
                    print(f"  ✅ Correct as is ({new_ans})")
            else:
                print(f"  ❌ Generation failed for Q_{q_id[:8]}")
                errors += 1
                
        except Exception as e:
            print(f"  ❌ Error: {e}")
            errors += 1
        
        # Rate limit protection
        time.sleep(1)

    print("\n" + "="*50)
    print(f"🏁 TOTAL RECALL COMPLETE")
    print(f"✅ Questions Audited: {len(questions)}")
    print(f"🔄 Corrections Made: {corrections}")
    print(f"⚠️  Errors/Skipped: {errors}")
    print("="*50)

if __name__ == "__main__":
    load_dotenv()
    total_recall_cdpo()
