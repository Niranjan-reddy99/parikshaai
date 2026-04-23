"""
Repair script for UPSC CISF AC(EXE) LDCE 2026 paper.

Root cause: the OCR digit-drop recovery heuristic falsely promoted
numbered statements inside multi-item questions (e.g. "2. Atomic radius...")
as phantom questions Q12, Q13, etc. This cascaded into:
  - Real Q12/Q13 being skipped
  - Phantom questions with truncated text
  - AI defaulting to answer=A for almost every question
  - 143/146 questions with wrong answer

Fix:
  1. Delete all questions + explanations for CISF 2026
  2. Clear the pipeline extraction caches for this paper
  3. You can then re-upload the PDF — the fixed pipeline will extract correctly

Usage:
    cd backend && source venv/bin/activate
    python3 repair_cisf.py
"""
import sys, os, glob
sys.path.insert(0, os.path.dirname(__file__))
from config import supabase
from pathlib import Path

EXAM_NAME = 'UPSC CISF AC(EXE) LDCE'
EXAM_YEAR = 2026

print(f'=== Repairing {EXAM_NAME} {EXAM_YEAR} ===\n')

# ── Step 1: fetch question IDs ────────────────────────────────────────────────
print('Fetching questions...')
r = supabase.table('questions').select('id') \
    .eq('exam_name', EXAM_NAME).eq('exam_year', EXAM_YEAR).execute()
question_ids = [q['id'] for q in r.data]
print(f'  Found {len(question_ids)} questions to delete')

# ── Step 2: delete explanations first (FK constraint) ────────────────────────
if question_ids:
    print('Deleting explanations...')
    deleted_expls = 0
    CHUNK = 50
    for i in range(0, len(question_ids), CHUNK):
        chunk = question_ids[i:i+CHUNK]
        res = supabase.table('explanations').delete().in_('question_id', chunk).execute()
        deleted_expls += len(res.data or [])
    print(f'  Deleted {deleted_expls} explanations')

# ── Step 3: delete questions ──────────────────────────────────────────────────
    print('Deleting questions...')
    res = supabase.table('questions').delete() \
        .eq('exam_name', EXAM_NAME).eq('exam_year', EXAM_YEAR).execute()
    print(f'  Deleted {len(res.data or [])} questions')

# ── Step 4: clear pipeline caches ────────────────────────────────────────────
cache_dir = Path(__file__).parent / 'cache'
print('\nClearing pipeline caches...')
cleared = 0
for pattern in ['pages_*.json', 'vision_qs_*.json']:
    for f in glob.glob(str(cache_dir / pattern)):
        os.unlink(f)
        cleared += 1
# Clear all explanation caches (they contain wrong answers)
for f in glob.glob(str(cache_dir / 'expl_*.json')):
    os.unlink(f)
    cleared += 1
# Clear processed results cache
processed_dir = cache_dir / 'processed'
if processed_dir.exists():
    for f in glob.glob(str(processed_dir / '*.json')):
        os.unlink(f)
        cleared += 1
print(f'  Cleared {cleared} cache files')

# ── Step 5: verify ────────────────────────────────────────────────────────────
remaining = supabase.table('questions').select('id', count='exact') \
    .eq('exam_name', EXAM_NAME).eq('exam_year', EXAM_YEAR).execute()
print(f'\nVerification: {remaining.count} questions remaining (should be 0)')
print('\nDone. Re-upload the CISF PDF through the admin panel to re-extract.')
print('The fixed pipeline will correctly handle multi-statement questions.')
