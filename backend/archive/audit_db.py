"""
Audit DB: Check for duplicate/extra/missing questions per year.
Shows EXACTLY what's wrong so we can fix it.

Run: python audit_db.py
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from config import supabase as sb

EXAM_NAME = "UPSC Prelims"
YEARS = [2020, 2021, 2022, 2023, 2024]

print(f"\n{'='*70}")
print(f"  DATABASE AUDIT: {EXAM_NAME}")
print(f"{'='*70}\n")

for year in YEARS:
    rows = sb.table("questions") \
        .select("id, question_text, option_a, option_b, question_hash, created_at") \
        .eq("exam_name", EXAM_NAME) \
        .eq("exam_year", year) \
        .order("created_at") \
        .execute()
    
    questions = rows.data or []
    count = len(questions)
    
    # Check for duplicate question texts (different hashes but same content)
    text_map: dict[str, list] = {}
    for q in questions:
        key = q["question_text"][:80].strip().lower()
        text_map.setdefault(key, []).append(q)
    
    duplicates = {k: v for k, v in text_map.items() if len(v) > 1}
    
    # Check for very short questions (likely garbage)
    short_qs = [q for q in questions if len(q["question_text"].strip()) < 30]
    
    # Check for questions that look like answer fragments
    import re
    fragment_pattern = re.compile(
        r'^(?:[A-D](?:\s*[,&]\s*[A-D])*(?:\s+(?:and|only|are correct))?'
        r'|All\s+of\s+the\s+above|None\s+of\s+the\s+above'
        r'|(?:Only\s+)?[1-4](?:\s+and\s+[1-4])?'
        r'|Both\s+[A-D]\s+and\s+[A-D])\s*$',
        re.IGNORECASE
    )
    fragments = [q for q in questions if fragment_pattern.match(q["question_text"].strip())]
    
    status = "✅" if count == 100 else ("⚠️  EXTRA" if count > 100 else "⚠️  MISSING")
    print(f"  {year}: {count}/100  {status}")
    
    if duplicates:
        print(f"    📋 Duplicate texts: {len(duplicates)}")
        for key, qs in list(duplicates.items())[:3]:
            print(f"       \"{key[:60]}...\" × {len(qs)}")
            for q in qs:
                print(f"         id={q['id'][:8]}... hash={q['question_hash'][:12]}...")
    
    if short_qs:
        print(f"    📏 Short questions (<30 chars): {len(short_qs)}")
        for q in short_qs[:3]:
            print(f"       \"{q['question_text'][:60]}\"")
    
    if fragments:
        print(f"    🗑️  Fragment questions: {len(fragments)}")
        for q in fragments[:3]:
            print(f"       \"{q['question_text'][:60]}\"")
    
    if count > 100:
        extra = count - 100
        print(f"    ❌ Need to DELETE {extra} extra questions")
    elif count < 100:
        missing = 100 - count
        print(f"    ❌ Still MISSING {missing} questions")

print(f"\n{'='*70}")
print(f"  TOTALS")
print(f"{'='*70}")
total = sum(1 for yr in YEARS for _ in range(1))  # placeholder
print(f"  Run 'python fix_db.py' to clean up extras and fill gaps")
print()
