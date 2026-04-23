"""
Deep audit: show ALL garbage/short questions and duplicates per year.
"""
import sys, re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from config import supabase as sb

EXAM_NAME = "UPSC Prelims"
YEARS = [2020, 2021, 2022, 2023, 2024]

for year in YEARS:
    rows = sb.table("questions") \
        .select("id, question_text, option_a, option_b, option_c, option_d, question_hash") \
        .eq("exam_name", EXAM_NAME) \
        .eq("exam_year", year) \
        .order("created_at") \
        .execute()
    
    questions = rows.data or []
    count = len(questions)
    
    # Identify garbage: non-ASCII heavy, very short, or fragment-like
    garbage_ids = []
    good_ids = []
    
    for q in questions:
        txt = q["question_text"].strip()
        # Garbage criteria
        is_garbage = False
        
        # 1. Too short
        if len(txt) < 30:
            is_garbage = True
        
        # 2. Mostly non-printable/non-ASCII
        if txt:
            ascii_chars = sum(1 for c in txt if c.isascii() and c.isalpha())
            total_alpha = sum(1 for c in txt if c.isalpha())
            if total_alpha > 0 and ascii_chars / max(total_alpha, 1) < 0.5:
                is_garbage = True
        
        # 3. Answer fragment pattern
        frag = re.match(
            r'^(?:[A-D](?:\s*[,&]\s*[A-D])*(?:\s+(?:and|only|are correct))?'
            r'|All\s+of\s+the\s+above|None\s+of\s+the\s+above'
            r'|(?:Only\s+)?[1-4](?:\s+and\s+[1-4])?'
            r'|Both\s+[A-D]\s+and\s+[A-D])\s*$',
            txt, re.IGNORECASE
        )
        if frag:
            is_garbage = True
        
        # 4. Mostly whitespace/punctuation with very little real text
        real_words = len(re.findall(r'[a-zA-Z]{3,}', txt))
        if real_words < 3 and len(txt) < 80:
            is_garbage = True
        
        if is_garbage:
            garbage_ids.append(q["id"])
        else:
            good_ids.append(q["id"])
    
    # Check duplicates in good questions
    text_map: dict[str, list] = {}
    for q in questions:
        if q["id"] in garbage_ids:
            continue
        key = re.sub(r'\s+', ' ', q["question_text"][:100].strip().lower())
        text_map.setdefault(key, []).append(q["id"])
    
    dup_ids_to_remove = []
    for key, ids in text_map.items():
        if len(ids) > 1:
            dup_ids_to_remove.extend(ids[1:])  # keep first, remove rest
    
    total_to_delete = set(garbage_ids + dup_ids_to_remove)
    remaining = count - len(total_to_delete)
    
    print(f"\n{'='*60}")
    print(f"  {year}: {count} total → {len(garbage_ids)} garbage, {len(dup_ids_to_remove)} duplicates")
    print(f"  After cleanup: {remaining} remain (need 100)")
    print(f"  IDs to DELETE ({len(total_to_delete)}):")
    for qid in sorted(total_to_delete):
        # find the question
        q = next(x for x in questions if x["id"] == qid)
        reason = "garbage" if qid in garbage_ids else "duplicate"
        print(f"    {qid[:12]}... [{reason}] \"{q['question_text'][:50]}\"")

print(f"\n{'='*60}")
print("Run fix_db.py to delete these and get all years to exactly 100")
