"""
fix_ti_ligature.py — Batch fix OCR ti-ligature drops in questions table.

Some PDFs use a 'ti' ligature glyph that Tesseract cannot read, producing:
  "tion" → " on"   (solution → "solu on")
  "tive" → " ve"   (narrative → "narra ve")
  "ting" → " ng"   (conflicting → "conflic ng")

Safe patterns only — verified against dry-run to avoid false positives like
"based on", "rivers on", "Group on Piracy".

Run: cd backend && python fix_ti_ligature.py [--dry-run] [--exam "EXAM NAME"]
"""
from __future__ import annotations
import argparse, re
from dotenv import load_dotenv
load_dotenv()
from config import supabase

# ── Only patterns with near-zero false-positive risk ─────────────────────────
#
# "X ng" — English has no common standalone word "ng"; nearly always "ting" drop
# "X ve" — "ve" is not a standalone English word; nearly always "tive" drop
# "u on" — "u on" as two words is essentially nonexistent in formal text → "ution"
# "uc on" — 3-char: "production", "construction", "instruction" etc. → "uction"
# "ec on" — 3-char: "section", "election", "direction" etc. → "ection"
#
# NOT included (too many false positives with preposition "on"):
#   generic "a on", "e on", "c on", "n on", "s on" → would corrupt "based on",
#   "rivers on", "Group on Piracy", "one on each floor" etc.

_PATTERNS: list[tuple[re.Pattern, str]] = [
    # ting — safest of all
    (re.compile(r'([A-Za-z]) ng\b'), r'\1ting'),
    # tive / tively / tiveness / tiver / tived / tives
    (re.compile(r'([A-Za-z]) ve(ly|ness|r|rs|d|s)?\b'), r'\1tive\2'),
    # ution / utions — "u on" never two words in formal text
    (re.compile(r'(?<=[a-zA-Z])u on(s)?\b'), r'ution\1'),
    # uction / uctions — construction, production, instruction
    (re.compile(r'uc on(s)?\b'), r'uction\1'),
    # ection / ections — section, election, direction, protection
    (re.compile(r'ec on(s)?\b'), r'ection\1'),
]

# Words that still come out wrong after regex (double ti-ligature drops)
_WORD_FIXES: list[tuple[re.Pattern, str]] = [
    (re.compile(r'\bcompetive\b', re.I), 'competitive'),
    (re.compile(r'\bcompetively\b', re.I), 'competitively'),
    (re.compile(r'\brepeti ve\b', re.I), 'repetitive'),
    (re.compile(r'\bquantita ve\b', re.I), 'quantitative'),
    (re.compile(r'\bquali ta ve\b', re.I), 'qualitative'),
    (re.compile(r'\bintuitive\b'), 'intuitive'),  # usually fine
]


def fix_ti_ligature(text: str) -> str:
    if not text:
        return text
    for pat, repl in _PATTERNS:
        text = pat.sub(repl, text)
    for pat, repl in _WORD_FIXES:
        text = pat.sub(repl, text)
    return text


FIELDS = ["question_text", "option_a", "option_b", "option_c", "option_d"]

_DETECT = re.compile(r'[A-Za-z] (?:ng|ve)\b|u on\b|uc on\b|ec on\b')


def _needs_fix(row: dict) -> bool:
    return any(_DETECT.search(row.get(f) or "") for f in FIELDS)


def run(dry_run: bool, exam: str | None, limit: int) -> None:
    print(f"{'[DRY RUN] ' if dry_run else ''}Scanning questions for ti-ligature drops...")

    q = (
        supabase.table("questions")
        .select("id," + ",".join(FIELDS))
        .eq("is_active", True)
        .limit(limit)
    )
    if exam:
        q = q.ilike("exam_name", f"%{exam}%")

    rows = q.execute().data or []
    print(f"  Fetched {len(rows)} questions to scan.")

    fixed = 0
    for row in rows:
        if not _needs_fix(row):
            continue
        patch: dict = {}
        for f in FIELDS:
            orig = row.get(f) or ""
            if not orig:
                continue
            updated = fix_ti_ligature(orig)
            if updated != orig:
                patch[f] = updated

        if not patch:
            continue

        fixed += 1
        if dry_run:
            sample_field = next(iter(patch))
            orig_sample = (row.get(sample_field) or "")[:100]
            new_sample  = patch[sample_field][:100]
            print(f"  [{row['id'][:8]}] {sample_field}:")
            print(f"    BEFORE: {orig_sample!r}")
            print(f"    AFTER:  {new_sample!r}")
        else:
            try:
                supabase.table("questions").update(patch).eq("id", row["id"]).execute()
            except Exception as e:
                print(f"  [warn] Failed to update {row['id'][:8]}: {e}")

    print(f"\n  {'Would fix' if dry_run else 'Fixed'} {fixed}/{len(rows)} questions.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--exam", help="Filter by exam name (partial match)")
    parser.add_argument("--limit", type=int, default=9999)
    args = parser.parse_args()
    run(dry_run=args.dry_run, exam=args.exam, limit=args.limit)
