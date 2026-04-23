"""
Fix the CISF 2026 questions that were incorrectly tagged as "General Knowledge".

Root causes fixed before running this:
  1. Taxonomy expanded — Mathematics, Quantitative Aptitude, Logical Reasoning added
  2. _call_tagger now strips __MATCH__: JSON before sending to AI
  3. max_output_tokens bumped 2048 → 4096 (was truncating JSON for >15 Qs)
  4. TAG_PROMPT_VERSION = "v3" busts stale cache (old "GK" answers never returned)

Run:
    cd backend && source venv/bin/activate
    python3 retag_cisf.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from pipeline import retag_exam

EXAM_NAME = "UPSC CISF AC(EXE) LDCE"
EXAM_YEAR = 2026

print(f"Re-tagging {EXAM_NAME} {EXAM_YEAR}...")
print("New taxonomy includes: Mathematics, Quantitative Aptitude, Logical Reasoning, etc.")
print("Stale 'General Knowledge' cache busted by TAG_PROMPT_VERSION=v3\n")

result = retag_exam(EXAM_NAME, EXAM_YEAR)
print(f"\nDone: {result['updated']}/{result['total']} questions updated.")
