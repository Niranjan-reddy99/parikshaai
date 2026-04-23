"""
fix_duplicate_options.py
========================
Strips option lines that got embedded inside question_text ONLY when those
lines are exact duplicates of the stored option_a/b/c/d values.

Safe for statement-based questions:
  question_text = "Consider the following statements:\n1. Typhoid is water-borne.\n2. It is caused by Salmonella."
  option_a = "1 only"   ← "Typhoid is water-borne" ≠ "1 only" → statements are KEPT

Only strips when options are duplicated verbatim:
  question_text = "The bacteria causing typhoid is\n(1) Salmonella typhi\n(2) Typhoid Mary"
  option_a = "Salmonella typhi"   ← "Salmonella typhi" matches → STRIPPED

Run:
    cd backend && source venv/bin/activate
    python fix_duplicate_options.py [--dry-run] [--exam "TSLPRB SI MAINS GS"]
"""
from __future__ import annotations
import argparse
import re
from config import supabase

# Matches lines starting with (A), A., A), (1), 1., 1), [A], [1], etc.
_OPT_LINE_RE = re.compile(
    r'^\s*[\(\[]?\s*(?:[ABCD]|[1-4])\s*[\)\]\.]\s*(.+)',
    re.IGNORECASE
)


def _norm(s: str) -> str:
    """Lowercase + collapse whitespace for comparison."""
    return re.sub(r'\s+', ' ', (s or '').strip()).lower()


def strip_option_lines(text: str, opt_values: set[str]) -> str:
    """
    Remove trailing lines from text that are duplicates of MCQ options.

    A line is a duplicate only if its content (after stripping the prefix
    like "1." or "(A)") fuzzy-matches one of the known option values.
    Numbered statements that don't match any option are left untouched.
    """
    lines = text.split('\n')

    # Find the first line that (a) looks like an option line AND (b) its
    # content matches a stored option value → that's where options start.
    first_opt_idx = None
    for i, ln in enumerate(lines):
        m = _OPT_LINE_RE.match(ln)
        if not m:
            continue
        content = _norm(m.group(1))
        if any(content == v for v in opt_values):
            first_opt_idx = i
            break

    if first_opt_idx is None or first_opt_idx == 0:
        return text  # nothing to strip (or question starts with an option)

    return '\n'.join(lines[:first_opt_idx]).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true',
                        help='Print what would change, do not write to DB')
    parser.add_argument('--exam', default=None,
                        help='Limit to a specific exam name (partial match)')
    args = parser.parse_args()

    print("Fetching questions...")
    query = supabase.table("questions").select(
        "id,question_text,exam_name,option_a,option_b,option_c,option_d"
    )
    if args.exam:
        query = query.ilike("exam_name", f"%{args.exam}%")
    rows = query.execute().data or []
    print(f"  {len(rows)} questions loaded")

    updates = []
    for row in rows:
        orig = row.get("question_text") or ""
        opt_values = {
            _norm(row.get("option_a") or ""),
            _norm(row.get("option_b") or ""),
            _norm(row.get("option_c") or ""),
            _norm(row.get("option_d") or ""),
        } - {""}  # remove empty strings

        fixed = strip_option_lines(orig, opt_values)
        if fixed != orig:
            updates.append({
                "id": row["id"],
                "exam": row.get("exam_name", ""),
                "orig": orig,
                "fixed": fixed,
            })

    print(f"  {len(updates)} questions need fixing")
    if not updates:
        print("Nothing to do.")
        return

    if args.dry_run:
        for u in updates[:10]:
            print(f"\n[{u['exam']}] id={u['id']}")
            print(f"  BEFORE: {u['orig'][:150]!r}")
            print(f"  AFTER:  {u['fixed'][:150]!r}")
        if len(updates) > 10:
            print(f"  ... and {len(updates)-10} more")
        print("\n(dry-run: no changes written)")
        return

    fixed_count = 0
    BATCH = 50
    for i in range(0, len(updates), BATCH):
        batch = updates[i:i+BATCH]
        for u in batch:
            try:
                supabase.table("questions").update(
                    {"question_text": u["fixed"]}
                ).eq("id", u["id"]).execute()
                fixed_count += 1
            except Exception as e:
                print(f"  ERROR id={u['id']}: {e}")
        print(f"  Fixed {min(i+BATCH, len(updates))}/{len(updates)}...")

    print(f"\nDone. Fixed {fixed_count} questions.")


if __name__ == "__main__":
    main()
