"""
inject_answers.py — Inject TSPSC tabular answer key into Supabase.

Handles TSPSC answer key PDFs where answers are in a table like:
    Q.No.  Key    Q.No.  Key    Q.No.  Key
    1      3      2      1      3      4   ...

or compact rows like:
    1. 3   2. 1   3. 4   4. 2  ...

Usage:
    python inject_answers.py "answer_key.pdf" "TSPSC Group 2" 2024

    # Dry run (no DB writes, just print what would be updated):
    python inject_answers.py "answer_key.pdf" "TSPSC Group 2" 2024 --dry-run

    # If the key PDF has multiple series (A/B/C/D), specify which series:
    python inject_answers.py "answer_key.pdf" "TSPSC Group 2" 2024 --series A
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
from dotenv import load_dotenv

load_dotenv()

_NUM_TO_LETTER = {"1": "A", "2": "B", "3": "C", "4": "D"}


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Extract raw text from the answer key PDF
# ══════════════════════════════════════════════════════════════════════════════

def extract_key_text(pdf_path: str) -> str:
    """Extract all text from the answer key PDF (plain text, no bilingual filter needed)."""
    doc = fitz.open(pdf_path)
    pages: list[str] = []
    for page in doc:
        text = page.get_text("text").strip()
        if text:
            pages.append(text)
    doc.close()
    return "\n".join(pages)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Parse Q.No → Key pairs from the extracted text
# ══════════════════════════════════════════════════════════════════════════════

# Matches: "1  3", "1. 3", "1) 3", "Q.1  3" where second token is 1-4
_PAIR_PATTERN = re.compile(
    r'(?:Q\.?\s*)?(\d{1,3})\s*[.):]?\s+([1-4])(?=\s|$|\b)',
)

# Compact "1.3" / "1:3" / "1-3" formats (Q.No attached to key with separator)
_COMPACT_PATTERN = re.compile(
    r'\b(\d{1,3})[.:\-]([1-4])\b'
)


def _detect_series_block(text: str, series: Optional[str]) -> str:
    """
    If the answer key has multiple series sections (Series-A, Series-B, etc.),
    extract only the block for the requested series.
    If no series label found, or series=None, return full text.
    """
    if not series:
        return text

    # Common headers: "Series-A", "Series A", "SERIES - A", "SET A", "Code A"
    pattern = re.compile(
        r'(?:Series|SET|Code|SERIES)\s*[-–—]?\s*' + re.escape(series.upper()),
        re.IGNORECASE,
    )
    matches = list(pattern.finditer(text))
    if not matches:
        print(f"  ⚠️  Series '{series}' not found in key — using full text")
        return text

    # Find the start of the requested series block
    start = matches[0].start()
    # Find the start of the NEXT series block (if any), which is the end of ours
    all_series = re.compile(
        r'(?:Series|SET|Code|SERIES)\s*[-–—]?\s*[A-D]', re.IGNORECASE
    )
    all_m = [m for m in all_series.finditer(text) if m.start() > start]
    end = all_m[0].start() if all_m else len(text)

    block = text[start:end]
    print(f"  📋 Series '{series}' block: {len(block)} chars, starts at pos {start}")
    return block


def parse_answer_key(text: str, series: Optional[str] = None) -> dict[int, str]:
    """
    Parse all (question_number → correct_letter) pairs from the key text.

    Returns dict like {1: 'C', 2: 'A', 3: 'D', ...}
    """
    block = _detect_series_block(text, series)

    # Normalise: replace multiple spaces/tabs with single space
    block = re.sub(r'[ \t]+', ' ', block)

    key_map: dict[int, str] = {}

    # Strategy 1: look for "Q.No" and "Key" column headers followed by tabular data
    # Typical TSPSC format:
    #   Q.No.  Key  Q.No.  Key  Q.No.  Key
    #   1      3    2      1    3      4
    #   ...
    # Detect if this pattern exists (3+ "Q.No" occurrences → tabular layout)
    if len(re.findall(r'Q\.?\s*No', block, re.IGNORECASE)) >= 2:
        # Strip column headers; remaining numbers alternate between q_num and key
        stripped = re.sub(r'(?:Q\.?\s*No\.?|Key|S\.?\s*No\.?)', ' ', block, flags=re.IGNORECASE)
        tokens = re.findall(r'\b(\d{1,3})\b', stripped)
        # Pair them up: (q_num, key) alternating
        i = 0
        while i < len(tokens) - 1:
            q = int(tokens[i])
            k = tokens[i + 1]
            if 1 <= q <= 300 and k in "1234":
                letter = _NUM_TO_LETTER[k]
                if q not in key_map:
                    key_map[q] = letter
                i += 2
            else:
                i += 1

        if key_map:
            print(f"  ✅ Tabular-header strategy: found {len(key_map)} pairs")
            return key_map

    # Strategy 2: general "number [sep] 1-4" pair matching
    for m in _PAIR_PATTERN.finditer(block):
        q = int(m.group(1))
        k = m.group(2)
        if 1 <= q <= 300 and q not in key_map:
            key_map[q] = _NUM_TO_LETTER[k]

    if not key_map:
        # Strategy 3: compact "1.3" / "2:1" format
        for m in _COMPACT_PATTERN.finditer(block):
            q = int(m.group(1))
            k = m.group(2)
            if 1 <= q <= 300 and q not in key_map:
                key_map[q] = _NUM_TO_LETTER[k]

    # Sanity check: reject isolated pairs with implausible gaps (e.g. q > 300)
    key_map = {q: v for q, v in key_map.items() if 1 <= q <= 300}

    print(f"  ✅ Pair-match strategy: found {len(key_map)} pairs")
    return key_map


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Update Supabase
# ══════════════════════════════════════════════════════════════════════════════

def inject_into_db(
    key_map: dict[int, str],
    exam_name: str,
    exam_year: int,
    dry_run: bool = False,
) -> dict:
    """
    Update correct_answer in Supabase for each question matched by question_number.
    Matches on: exam_name + exam_year + question_number.
    """
    from config import supabase as sb

    exam_name = exam_name.strip()

    # Fetch all question_number → id mappings for this exam+year
    res = sb.table("questions").select(
        "id, question_number, correct_answer, question_text"
    ).eq("exam_name", exam_name).eq("exam_year", exam_year).eq("is_active", True).execute()

    db_questions = res.data or []
    if not db_questions:
        print(f"  ❌ No questions found in DB for '{exam_name}' ({exam_year})")
        return {"updated": 0, "not_found": len(key_map), "errors": []}

    # Build lookup: question_number → row
    db_map: dict[int, dict] = {}
    for row in db_questions:
        qn = row.get("question_number")
        if qn is not None:
            db_map[int(qn)] = row

    print(f"  📊 DB has {len(db_map)} questions with question_number set")
    print(f"  📋 Answer key has {len(key_map)} entries")

    updated = 0
    not_found: list[int] = []
    already_correct = 0
    errors: list[str] = []

    # Sort by question number for readable output
    for q_num in sorted(key_map.keys()):
        new_answer = key_map[q_num]
        row = db_map.get(q_num)

        if not row:
            not_found.append(q_num)
            continue

        if row["correct_answer"] == new_answer:
            already_correct += 1
            continue

        if dry_run:
            print(f"  [DRY RUN] Q{q_num}: {row['correct_answer']} → {new_answer}  |  {row['question_text'][:60]}")
            updated += 1
            continue

        try:
            sb.table("questions").update(
                {"correct_answer": new_answer}
            ).eq("id", row["id"]).execute()
            updated += 1
        except Exception as e:
            errors.append(f"Q{q_num}: {e}")

    return {
        "updated": updated,
        "already_correct": already_correct,
        "not_found_in_db": not_found,
        "errors": errors,
    }


# ══════════════════════════════════════════════════════════════════════════════
# CLI entry point
# ══════════════════════════════════════════════════════════════════════════════

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Inject TSPSC tabular answer key into Supabase"
    )
    parser.add_argument("pdf_path",  help="Path to answer key PDF")
    parser.add_argument("exam_name", help='Exam name, e.g. "TSPSC Group 2"')
    parser.add_argument("year",      type=int, help="Exam year, e.g. 2024")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print what would be updated without writing to DB"
    )
    parser.add_argument(
        "--series", default=None,
        help="Answer key series/set letter, e.g. A (only needed for multi-series keys)"
    )
    parser.add_argument(
        "--dump-text", action="store_true",
        help="Print extracted PDF text (useful for debugging parse failures)"
    )
    args = parser.parse_args()

    pdf_path = Path(args.pdf_path)
    if not pdf_path.exists():
        print(f"❌ PDF not found: {pdf_path}")
        sys.exit(1)

    print(f"\n📄 Answer Key: {pdf_path.name}")
    print(f"   Exam: {args.exam_name} ({args.year})")
    if args.series:
        print(f"   Series: {args.series}")
    if args.dry_run:
        print("   Mode: DRY RUN — no DB writes\n")

    # Step 1: Extract text
    text = extract_key_text(str(pdf_path))
    print(f"  ✅ Extracted {len(text)} chars from PDF")

    if args.dump_text:
        print("\n" + "─" * 60)
        print(text[:3000])
        print("─" * 60 + "\n")

    # Step 2: Parse pairs
    key_map = parse_answer_key(text, series=args.series)
    if not key_map:
        print(
            "\n❌ No Q.No → Key pairs found. Try --dump-text to inspect the raw PDF text.\n"
            "   Common issues:\n"
            "   1. Scanned/image PDF — use Gemini Vision extraction instead\n"
            "   2. Key is in a different format — check with --dump-text\n"
            "   3. Wrong --series specified"
        )
        sys.exit(1)

    # Print the key map for verification
    sorted_keys = sorted(key_map.items())
    preview = "  ".join(f"Q{q}:{v}" for q, v in sorted_keys[:20])
    print(f"  Preview (first 20): {preview}")
    if len(sorted_keys) > 20:
        print(f"  ... and {len(sorted_keys) - 20} more")

    # Step 3: Inject
    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Updating DB...")
    result = inject_into_db(key_map, args.exam_name, args.year, dry_run=args.dry_run)

    print(f"\n{'─' * 50}")
    print(f"  ✅ Updated:          {result['updated']}")
    print(f"  ✅ Already correct:  {result.get('already_correct', 0)}")
    nf = result.get("not_found_in_db", [])
    print(f"  ⚠️  Not found in DB: {len(nf)}" + (f" → Q{nf[:10]}" if nf else ""))
    if result.get("errors"):
        print(f"  ❌ Errors:           {len(result['errors'])}")
        for e in result["errors"][:5]:
            print(f"     {e}")

    if nf and len(nf) > 10:
        print(
            "\n  ℹ️  Many questions not found. Possible causes:\n"
            "     1. question_number column not yet in DB — run the migration SQL first\n"
            "     2. Questions were uploaded without question_number — re-run pipeline.py\n"
            "     3. Exam name mismatch — check exact name in DB"
        )

    print(f"{'─' * 50}\n")


if __name__ == "__main__":
    main()
