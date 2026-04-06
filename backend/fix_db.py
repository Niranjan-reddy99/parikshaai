"""
fix_db.py — Clean up UPSC Prelims database

What happened:
  The pipeline's regex parser picked up HINDI text as "questions" (because 
  skip_bilingual=True was set for UPSC). After non-ASCII stripping, Hindi text
  became meaningless fragments like ":\n1. \n \n2.\n" — these had unique hashes
  and were inserted as separate questions, creating EXTRAS.

This script:
  1. Identifies garbage questions (short, fragmentary, no real English words)
  2. Identifies duplicate questions (same text, different hashes)
  3. DELETES them from the questions table (and cascading explanations)
  4. Reports final state

Cost: ₹0 (pure database cleanup, no API calls)

Run:
  python fix_db.py          # dry run (shows what would be deleted)
  python fix_db.py --apply  # actually delete
"""
import sys, re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from config import supabase as sb

EXAM_NAME = "UPSC Prelims"
YEARS = [2020, 2021, 2022, 2023, 2024]
DRY_RUN = "--apply" not in sys.argv

if DRY_RUN:
    print("\n🔍 DRY RUN — showing what would be deleted. Run with --apply to execute.\n")
else:
    print("\n🚨 APPLYING CHANGES — deleting garbage questions from DB.\n")


def is_garbage(q: dict) -> bool:
    """Detect garbage questions that should never have been inserted."""
    txt = (q.get("question_text") or "").strip()
    
    # 1. Too short to be a real question
    if len(txt) < 30:
        return True
    
    # 2. Count real English words (3+ consecutive ASCII letters)
    real_words = re.findall(r'[a-zA-Z]{3,}', txt)
    if len(real_words) < 4:
        return True
    
    # 3. Ratio check: if more than 50% of the text is whitespace/punctuation/numbers
    #    with very few English words, it's likely stripped Hindi
    alpha_chars = sum(1 for c in txt if c.isalpha() and c.isascii())
    if len(txt) > 0 and alpha_chars / len(txt) < 0.15:
        return True
    
    # 4. Check options — if all 4 options are empty or very short, it's garbage
    opts = [
        (q.get("option_a") or "").strip(),
        (q.get("option_b") or "").strip(),
        (q.get("option_c") or "").strip(),
        (q.get("option_d") or "").strip(),
    ]
    non_empty_opts = [o for o in opts if len(o) >= 3]
    if len(non_empty_opts) < 2:
        return True
    
    return False


total_deleted = 0
total_remaining = 0

for year in YEARS:
    # Fetch all questions for this year
    rows = sb.table("questions") \
        .select("id, question_text, option_a, option_b, option_c, option_d, question_hash") \
        .eq("exam_name", EXAM_NAME) \
        .eq("exam_year", year) \
        .order("created_at") \
        .execute()
    
    questions = rows.data or []
    count = len(questions)
    
    # --- Identify garbage ---
    garbage_ids = set()
    good_questions = []
    
    for q in questions:
        if is_garbage(q):
            garbage_ids.add(q["id"])
        else:
            good_questions.append(q)
    
    # --- Identify duplicates (among good questions) ---
    text_map: dict[str, list] = {}
    for q in good_questions:
        key = re.sub(r'\s+', ' ', q["question_text"][:120].strip().lower())
        text_map.setdefault(key, []).append(q)
    
    dup_ids = set()
    for key, qs in text_map.items():
        if len(qs) > 1:
            # Keep the one with most options filled, remove rest
            qs.sort(key=lambda x: sum(1 for k in ("option_a","option_b","option_c","option_d") if x.get(k)), reverse=True)
            for q in qs[1:]:
                dup_ids.add(q["id"])
    
    all_to_delete = garbage_ids | dup_ids
    remaining = count - len(all_to_delete)
    
    print(f"{'='*60}")
    print(f"  {year}: {count} in DB → {len(garbage_ids)} garbage + {len(dup_ids)} duplicates = {len(all_to_delete)} to delete")
    print(f"  After cleanup: {remaining} remain", end="")
    
    if remaining == 100:
        print(" ✅")
    elif remaining > 100:
        print(f" (still {remaining - 100} extra)")
    else:
        print(f" ({100 - remaining} still missing)")
    
    total_remaining += remaining
    
    if all_to_delete and not DRY_RUN:
        # Delete explanations first (foreign key)
        delete_list = list(all_to_delete)
        
        # Batch delete in chunks of 50
        for i in range(0, len(delete_list), 50):
            batch = delete_list[i:i+50]
            try:
                sb.table("explanations").delete().in_("question_id", batch).execute()
            except Exception:
                pass  # OK if no explanations exist
            
            try:
                result = sb.table("questions").delete().in_("id", batch).execute()
                deleted = len(result.data) if result.data else len(batch)
                total_deleted += deleted
            except Exception as e:
                print(f"    ❌ Delete error: {e}")
        
        print(f"    ✅ Deleted {len(all_to_delete)} questions")
    elif all_to_delete and DRY_RUN:
        print(f"    Would delete {len(all_to_delete)} questions")

print(f"\n{'='*60}")
if DRY_RUN:
    print(f"  DRY RUN — would delete garbage/duplicates")
    print(f"  Run: python fix_db.py --apply")
else:
    print(f"  ✅ DELETED {total_deleted} garbage/duplicate questions")

print(f"\n  Final DB state:")
for year in YEARS:
    rows = sb.table("questions") \
        .select("id", count="exact") \
        .eq("exam_name", EXAM_NAME) \
        .eq("exam_year", year) \
        .execute()
    count = rows.count or 0
    status = "✅" if count == 100 else f"⚠️  {count}/100"
    print(f"    {year}: {status}")
print()
