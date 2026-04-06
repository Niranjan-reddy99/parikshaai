import sys
sys.path.insert(0, '/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend')
from config import supabase
from collections import Counter

r = supabase.table('questions') \
    .select('id,question_text,option_a,correct_answer,subject,topic,question_number') \
    .eq('exam_name', 'TSPSC GROUP 3 PAPER 1') \
    .eq('exam_year', 2023) \
    .limit(200) \
    .execute()

qs = r.data
print(f'Total in DB: {len(qs)}')

# ── 1. Questions with number > 150 ────────────────────────────────────────────
over_150 = [q for q in qs if q.get('question_number') and q['question_number'] > 150]
print(f'\n=== QUESTION NUMBER > 150 ({len(over_150)} found) ===')
for q in sorted(over_150, key=lambda x: x['question_number']):
    print(f"  Q#{q['question_number']} [{len(q['question_text'])}c] {q['question_text'][:80]!r}")
    print(f"  id={q['id']}")
    print()

# ── 2. Duplicate question numbers ─────────────────────────────────────────────
from collections import defaultdict
by_num = defaultdict(list)
for q in qs:
    num = q.get('question_number')
    if num:
        by_num[num].append(q)

dupes = {n: qs for n, qs in by_num.items() if len(qs) > 1}
print(f'=== DUPLICATE QUESTION NUMBERS ({len(dupes)} groups) ===')
for num, group in sorted(dupes.items()):
    print(f'  Q#{num} — {len(group)} copies:')
    for q in group:
        print(f"    [{len(q['question_text'])}c] {q['question_text'][:70]!r}")
        print(f"    id={q['id']}")
    print()

# ── 3. Questions with no number (null/0) ──────────────────────────────────────
no_num = [q for q in qs if not q.get('question_number')]
print(f'=== NO QUESTION NUMBER ({len(no_num)} found) ===')
for q in no_num:
    print(f"  [{len(q['question_text'])}c] {q['question_text'][:80]!r}")
    print(f"  id={q['id']}")
    print()

# ── 4. Number distribution summary ───────────────────────────────────────────
nums = sorted([q['question_number'] for q in qs if q.get('question_number')])
print(f'=== QUESTION NUMBER RANGE ===')
print(f'  Min: {min(nums) if nums else "none"}  Max: {max(nums) if nums else "none"}')
print(f'  Count with number: {len(nums)}  |  Unique numbers: {len(set(nums))}')
if len(nums) != len(set(nums)):
    duped_nums = [n for n in set(nums) if nums.count(n) > 1]
    print(f'  Duped numbers: {duped_nums}')
