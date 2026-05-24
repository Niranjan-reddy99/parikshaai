"""
repair_match_questions.py — Repair match-the-following questions across all papers.

Two strategies, applied in order:
  1. TEXT RECOVERY  — question has match content in question_text but no __MATCH__:
                      → recover column structure using _recover_inline_match_payload
  2. RE-EXTRACTION  — question_text is only the fallback hint (text was overwritten)
                      → re-run Gemini extraction on that page using the stored PDF path

Usage:
    cd backend && source venv/bin/activate
    python repair_match_questions.py                  # all papers, real run
    python repair_match_questions.py --dry-run        # show what would change
    python repair_match_questions.py --exam "APPSC Group II" --year 2024
    python repair_match_questions.py --no-reextract   # text-only recovery, skip PDF re-extraction
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from config import supabase
from extractor.universal_extractor import _recover_inline_match_payload

_FALLBACK_HINT = "Refer to the attached image for the exact question/table."

_MATCH_KEYWORDS = (
    "match the following",
    "match the columns",
    "match the list",
    "column i",
    "list i",
)


def _is_match_like(text: str) -> bool:
    t = text.lower()
    return any(kw in t for kw in _MATCH_KEYWORDS)


def _is_only_fallback(text: str) -> bool:
    return text.strip() == _FALLBACK_HINT


def fetch_candidate_questions(exam_name: str | None, exam_year: int | None) -> list[dict]:
    """Fetch all match-type or match-keyword questions that need repair."""
    offset = 0
    rows: list[dict] = []
    while True:
        q = (
            supabase.table("questions")
            .select("id, question_number, question_text, question_type, paper_id, exam_name, exam_year, is_active")
            .eq("is_active", True)
        )
        if exam_name:
            q = q.eq("exam_name", exam_name)
        if exam_year:
            q = q.eq("exam_year", exam_year)
        res = q.range(offset, offset + 999).execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    # Filter: match-type questions WITHOUT __MATCH__: already
    candidates = []
    for row in rows:
        text = str(row.get("question_text") or "")
        q_type = str(row.get("question_type") or "").lower()
        if "__MATCH__:" in text:
            continue  # already structured
        if q_type == "match" or _is_match_like(text):
            candidates.append(row)

    return candidates


def try_text_recovery(row: dict, dry_run: bool) -> bool:
    """Attempt inline text recovery. Returns True if repaired."""
    text = str(row.get("question_text") or "")
    if _is_only_fallback(text):
        return False  # nothing to recover from

    result = _recover_inline_match_payload(text)
    if not result:
        return False

    intro, col1, col2 = result
    payload = json.dumps({"col1": col1, "col2": col2}, ensure_ascii=False)
    new_text = intro + "\n\n__MATCH__:" + payload

    print(f"  [TEXT] Q#{row.get('question_number')} — recovered {len(col1)}×{len(col2)} table")
    print(f"         col1: {col1}")
    print(f"         col2: {col2}")

    if not dry_run:
        supabase.table("questions").update({
            "question_text": new_text,
            "question_type": "Match",
            "needs_review": False,
        }).eq("id", row["id"]).execute()

    return True


def fetch_paper_pdf_path(paper_id: str) -> str | None:
    if not paper_id:
        return None
    res = supabase.table("papers").select("source_pdf_path").eq("id", paper_id).limit(1).execute()
    data = res.data or []
    if not data:
        return None
    path = data[0].get("source_pdf_path")
    if path and Path(path).exists():
        return path
    return None


def try_reextract(row: dict, dry_run: bool) -> bool:
    """Re-extract the specific page from the source PDF using Gemini. Returns True if repaired."""
    page_idx = row.get("_page_idx")
    if page_idx is None:
        return False

    paper_id = row.get("paper_id")
    pdf_path = fetch_paper_pdf_path(paper_id)
    if not pdf_path:
        print(f"  [SKIP] Q#{row.get('question_number')} — PDF not on disk (paper_id={paper_id})")
        return False

    print(f"  [PDF]  Q#{row.get('question_number')} — re-extracting page {page_idx} from {Path(pdf_path).name}")
    if dry_run:
        print(f"         (dry-run: would call Gemini on page {page_idx})")
        return False

    try:
        import fitz
        from extractor.universal_extractor import (
            UNIVERSAL_PROMPT,
            _CLIENT,
            _HTTP_OPTS_BEST,
            _VISION_BEST,
            _clean_json_response,
            _normalise_question,
            _recover_inline_match_payload as recover,
        )
        from google.genai import types as gtypes

        doc = fitz.open(pdf_path)
        if page_idx >= len(doc):
            print(f"         page {page_idx} out of range (doc has {len(doc)} pages)")
            return False

        page = doc[page_idx]
        mat = fitz.Matrix(300 / 72, 300 / 72)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        img_bytes = pix.tobytes("png")

        response = _CLIENT.models.generate_content(
            model=_VISION_BEST,
            contents=[
                gtypes.Part.from_bytes(data=img_bytes, mime_type="image/png"),
                UNIVERSAL_PROMPT,
            ],
            config=gtypes.GenerateContentConfig(
                http_options=_HTTP_OPTS_BEST,
                temperature=0.0,
                response_mime_type="application/json",
            ),
        )
        raw_text = _clean_json_response(response.text or "")
        items = json.loads(raw_text)
        if not isinstance(items, list):
            return False

        q_num = row.get("question_number")
        target = None
        for item in items:
            n = item.get("question_number")
            if n is not None and int(n) == int(q_num):
                target = item
                break

        if not target:
            print(f"         Q#{q_num} not found in re-extracted page")
            return False

        # Use normalise_question to build the structured question_text
        normalised = _normalise_question(target)
        if not normalised:
            return False

        new_text = normalised.get("question_text") or normalised.get("question") or ""
        if "__MATCH__:" not in new_text:
            # Try inline recovery from the newly extracted text
            rr = recover(new_text)
            if rr:
                intro2, col1, col2 = rr
                new_text = intro2 + "\n\n__MATCH__:" + json.dumps({"col1": col1, "col2": col2}, ensure_ascii=False)
            else:
                print(f"         still no match structure after re-extraction")
                return False

        print(f"         ✓ repaired from PDF")
        supabase.table("questions").update({
            "question_text": new_text,
            "question_type": "Match",
            "needs_review": False,
        }).eq("id", row["id"]).execute()
        return True

    except Exception as exc:
        print(f"         re-extraction failed: {exc}")
        return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--exam", default=None)
    parser.add_argument("--year", type=int, default=None)
    parser.add_argument("--no-reextract", action="store_true", help="Skip PDF re-extraction, text recovery only")
    args = parser.parse_args()

    print(f"Scanning for broken match-the-following questions"
          + (f" in {args.exam}" if args.exam else " across all papers")
          + (f" {args.year}" if args.year else "")
          + (" [DRY RUN]" if args.dry_run else ""))

    candidates = fetch_candidate_questions(args.exam, args.year)
    print(f"Found {len(candidates)} candidate questions\n")

    text_repaired = 0
    pdf_repaired = 0
    skipped = 0

    for row in candidates:
        exam = row.get("exam_name", "?")
        year = row.get("exam_year", "?")
        print(f"\n[{exam} {year}] Q#{row.get('question_number')} (id={row['id'][:8]}...)")
        text = str(row.get("question_text") or "")
        print(f"  text preview: {text[:120].replace(chr(10), ' ')}")

        if try_text_recovery(row, args.dry_run):
            text_repaired += 1
            continue

        if _is_only_fallback(text) and not args.no_reextract:
            if try_reextract(row, args.dry_run):
                pdf_repaired += 1
            else:
                skipped += 1
        else:
            print(f"  [SKIP] could not recover (no column structure found in text)")
            skipped += 1

    print(f"\n{'='*60}")
    print(f"Text-recovered : {text_repaired}")
    print(f"PDF-reextracted: {pdf_repaired}")
    print(f"Skipped        : {skipped}")
    print(f"Total scanned  : {len(candidates)}")
    if args.dry_run:
        print("(DRY RUN — no changes written)")


if __name__ == "__main__":
    main()
