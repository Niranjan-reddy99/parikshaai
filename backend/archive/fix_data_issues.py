"""
Fix two data issues in TSPSC GROUP 3 PAPER 1 2023:
1. Update question_text for 3 truncated "Identify the wrong pair" questions
2. Set has_image=True for diagram/chart/table questions
"""
import sys
sys.path.insert(0, '/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend')
from config import supabase

EXAM = 'TSPSC GROUP 3 PAPER 1'
YEAR = 2023

# ── 1. Fix truncated question texts ──────────────────────────────────────────
# These are real questions — the column-pair table layout wasn't captured.
# Options are stored correctly (A/B/C/D = the actual pairs). Only text needs fix.

truncated_fixes = [
    {
        'id': '1a7e18b1-a4f9-46ae-ae2c-bb40b9861746',
        'question_text': 'Identify the wrong pair :\n(1) Sahasralinga - Pillalamarri\n(2) Ekamukhalinga - Alampur\n(3) Chaturmukhalinga - Kaleshwaram\n(4) Panchamukhalinga - Warangal',
        # Note: answer D = (4) Panchamukhalinga-Warangal
    },
    {
        'id': '43b53f31-3d53-4503-a6fb-a6e4a0fbe13e',
        'question_text': 'Identify the incorrect pair :\n(1) Balinjasetti - Trading caste\n(2) Asamkhyatulu - Saiva Priests\n(3) Sani-Munnurvurus - Agricultural labour\n(4) Mahajanas - Brahmans living in agraharas',
        # Note: answer C = (3) Sani-Munnurvurus - Agricultural labour
    },
    {
        'id': 'b62f881a-1d86-4b16-98d9-3c13e7ea2d2e',
        'question_text': 'Identify the wrong pair :\nTribe - Folk Dances\n(1) Bodo - Bagurumba\n(2) Gond - Gaddi Nati\n(3) Santhal - Budigali\n(4) Gujjar-Bakerwals - Mangho',
        # Note: answer B = (2) Gond - Gaddi Nati
    },
]

print('=== Fixing truncated question texts ===')
for fix in truncated_fixes:
    r = supabase.table('questions').update({
        'question_text': fix['question_text']
    }).eq('id', fix['id']).execute()
    print(f"  Fixed id={fix['id'][:8]}... → {len(fix['question_text'])}c")

# ── 2. Flag diagram questions as needs_review=True ───────────────────────────
# has_image column not in schema — use needs_review as the flag instead.
# These questions have correct text+options but the chart/graph/table
# they reference was not captured. Mark for admin awareness.
diagram_question_numbers = [
    115,   # Cube net diagram (page 36)
    116,   # Pie chart - minimum female members (page 37)
    117,   # Pie chart - health clubs with more female (page 37)
    124,   # Table - campus recruitment (page 39)
    125,   # Table - campus recruitment (page 39)
    126,   # Bar graph - Brand A/B cars (page 40-41)
    127,   # Bar graph - Brand A/B cars (page 40-41)
]

print('\n=== Flagging diagram questions as needs_review ===')
for qnum in diagram_question_numbers:
    r = supabase.table('questions').update({'needs_review': True}) \
        .eq('exam_name', EXAM) \
        .eq('exam_year', YEAR) \
        .eq('question_number', qnum) \
        .execute()
    txt = r.data[0]['question_text'][:60] if r.data else 'NOT FOUND'
    print(f"  Q#{qnum} → {txt!r}")

# ── 3. Final state ────────────────────────────────────────────────────────────
total = supabase.table('questions').select('id', count='exact') \
    .eq('exam_name', EXAM).eq('exam_year', YEAR).execute()
flagged = supabase.table('questions').select('id', count='exact') \
    .eq('exam_name', EXAM).eq('exam_year', YEAR).eq('needs_review', True).execute()

print(f'\nTotal questions : {total.count}')
print(f'Needs review    : {flagged.count}')
print('Done.')
