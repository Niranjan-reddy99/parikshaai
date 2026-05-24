"""
Repair the 34 broken TSPSC LIBRARIAN GS questions where options are empty.

Root cause: extract_tcsion_vision() took the first occurrence of each question
(preview page, often with partial options) and discarded the second occurrence
(answer-review page, which had all 4 options). The good data is already in cache.

This script reads both cache entries for each broken question, picks the more
complete one, and updates the DB.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import supabase

CACHE_DIR = Path(__file__).parent / "cache"
PDF_HASH   = "3f05d54cc05b5a4f"
EXAM_NAME  = "TSPSC LIBRARIAN GS"
SOURCE_PDF = "/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/uploads/pdfs/3f05d54cc05b5a4f412446494dbeda974fe3296e6d2c89d9fd7c5b97f45a2e88_1779348847595.pdf"

BROKEN_QNUMS = [6,7,11,18,21,30,31,45,48,52,58,59,62,64,65,66,67,71,80,81,87,96,109,110,111,131,136,140,141,145,149]


def _option_count(q: dict) -> int:
    return sum(1 for k in ("option_a","option_b","option_c","option_d") if (q.get(k) or "").strip())


def load_best_from_cache(qnum: int) -> dict | None:
    best: dict | None = None
    best_count = -1
    for f in sorted(CACHE_DIR.glob(f"tcsion_v12_{PDF_HASH}_p*.json")):
        try:
            data = json.loads(f.read_text())
        except Exception:
            continue
        for q in data:
            if q.get("question_number") != qnum:
                continue
            cnt = _option_count(q)
            if cnt > best_count:
                best = q
                best_count = cnt
    return best


def run(dry_run: bool = False) -> None:
    print(f"Repairing {len(BROKEN_QNUMS)} broken questions for {EXAM_NAME}")
    print(f"Dry run: {dry_run}\n")

    repaired = 0
    still_broken = 0

    for qnum in BROKEN_QNUMS:
        best = load_best_from_cache(qnum)
        if not best:
            print(f"  Q{qnum}: no cache entry found — skipping")
            still_broken += 1
            continue

        cnt = _option_count(best)
        if cnt < 4:
            print(f"  Q{qnum}: best cache has only {cnt}/4 options — skipping (still needs manual review)")
            still_broken += 1
            continue

        opt_a = (best.get("option_a") or "").strip()
        opt_b = (best.get("option_b") or "").strip()
        opt_c = (best.get("option_c") or "").strip()
        opt_d = (best.get("option_d") or "").strip()
        answer = best.get("correct_answer") or ""

        print(f"  Q{qnum}: A='{opt_a[:30]}' B='{opt_b[:30]}' C='{opt_c[:30]}' D='{opt_d[:30]}' ans={answer}")

        if dry_run:
            repaired += 1
            continue

        result = (
            supabase.table("questions")
            .update({
                "option_a":      opt_a,
                "option_b":      opt_b,
                "option_c":      opt_c,
                "option_d":      opt_d,
                "correct_answer": answer or None,
                "needs_review":  False,
                "structural_status": "valid",
                "answer_status":     "verified" if answer else "ai_inferred",
                "primary_issue_code": None,
                "issue_codes":   [],
                "practice_ready": True,
            })
            .eq("exam_name", EXAM_NAME)
            .eq("question_number", qnum)
            .eq("source_pdf", SOURCE_PDF)
            .execute()
        )
        updated = len(result.data) if result.data else 0
        if updated:
            print(f"    → updated {updated} row(s)")
            repaired += 1
        else:
            print(f"    → WARNING: no rows matched for Q{qnum}")
            still_broken += 1

    print(f"\nDone. Repaired: {repaired} | Still broken: {still_broken}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
