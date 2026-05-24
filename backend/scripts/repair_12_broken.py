"""
Repair remaining 12 broken TSPSC LIBRARIAN GS questions by extracting
options from the Telugu-version answer review page (next page after the broken one).
Those pages have all 4 options visible with green/red marks.
"""
import fitz, json, re, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent / "extractor"))

from extractor.cbt_pipeline import (
    _generate_content_with_vision_compat, CostTracker,
    _NUM_TO_LETTER, _RPM, _VISION_FULL_MODEL
)
from google.genai import types
from config import supabase

PDF_PATH   = "uploads/pdfs/3f05d54cc05b5a4f412446494dbeda974fe3296e6d2c89d9fd7c5b97f45a2e88_1779348847595.pdf"
EXAM_NAME  = "TSPSC LIBRARIAN GS"
SOURCE_PDF = "/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/uploads/pdfs/3f05d54cc05b5a4f412446494dbeda974fe3296e6d2c89d9fd7c5b97f45a2e88_1779348847595.pdf"

# Hard-coded English translations for questions where Gemini returns Telugu options.
# Cross-verified from the Telugu answer-review page: existing partial English options
# match the Telugu equivalents, so only missing options need translation.
ENGLISH_OVERRIDES: dict[int, dict] = {
    18:  {"option_a": "Only I and II",   "option_b": "Only II and III",
          "option_c": "Only I and III",  "option_d": "I, II and III",
          "correct_answer": "D"},
    30:  {"option_a": "27 July",  "option_b": "28 July",
          "option_c": "29 July",  "option_d": "30 July",
          "correct_answer": "B"},
    58:  {"option_a": "Ryotwari settlement",      "option_b": "Mahalwari Settlement",
          "option_c": "Subsidiary alliance Settlement", "option_d": "Permanent Settlement",
          "correct_answer": "D"},
    64:  {"option_a": "Pradhan Mantri Jan Dhan Yojna (PMJDY)",
          "option_b": "Rashtriya Swasthya Bima Yojana (RSBY)",
          "option_c": "Pradhan Mantri Mudra Yojana",
          "option_d": "National Social Assistance Programme",
          "correct_answer": "A"},
    80:  {"option_a": "342 per km²", "option_b": "332 per km²",
          "option_c": "312 per km²", "option_d": "322 per km²",
          "correct_answer": "C"},
    109: {"option_a": "C A. Indrakaran Reddy", "option_b": "V. Srinivas Goud",
          "option_c": "T Harish Rao",          "option_d": "Guntakandla Jagadeesh Reddy",
          "correct_answer": "C"},
}

# broken_page + next_page (0-indexed)
TARGETS = {
    6:   (7,   8),
    18:  (21,  22),
    30:  (35,  36),
    31:  (36,  37),
    58:  (71,  72),
    62:  (76,  77),
    64:  (79,  80),
    67:  (82,  83),
    80:  (97,  98),
    81:  (98,  99),
    109: (134, 135),
    111: (136, 137),
}

def _make_prompt(qnum: int) -> str:
    return (
        f"This page from a TCSiON exam answer key PDF shows a question review. "
        f"The question text may be in Telugu but the answer options often contain English text "
        f"(Roman numerals like 'I, II, III', English names, dates, etc.).\n\n"
        f"Your task: Extract all 4 answer options and the correct answer for Question Number {qnum}.\n"
        f"- Find the section with 'Question Number : {qnum}' on this page\n"
        f"- Read ALL 4 option texts under 'Options :' (numbered 1., 2., 3., 4.)\n"
        f"- The CORRECT option has a GREEN check mark (tick), wrong options have RED X marks\n"
        f"- If option text appears to be Telugu characters you cannot read, write the Telugu text as-is\n\n"
        "Return ONLY a JSON object (no markdown, no code block):\n"
        "{\"a\":\"option1 text\",\"b\":\"option2 text\",\"c\":\"option3 text\",\"d\":\"option4 text\",\"ans\": 1}\n\n"
        f"If Question {qnum} is not on this page or options are unreadable, return the word: null"
    )


def extract_from_next_page(doc, qnum: int, next_pg: int, tracker: CostTracker) -> dict | None:
    mat = fitz.Matrix(250 / 72, 250 / 72)
    pix = doc[next_pg].get_pixmap(matrix=mat, colorspace=fitz.csRGB)
    png_bytes = pix.tobytes("png")
    image_part = types.Part.from_bytes(data=png_bytes, mime_type="image/png")
    prompt = _make_prompt(qnum)

    for attempt in range(3):
        try:
            _RPM.wait()
            resp = _generate_content_with_vision_compat(
                model=_VISION_FULL_MODEL,
                contents=[prompt, image_part],
                temperature=0.0,
                max_output_tokens=1024,
            )
            raw = (resp.text or "").strip()
            raw = re.sub(r"^```(?:json)?", "", raw).strip().rstrip("`").strip()
            if not raw or raw == "null":
                return None
            item = json.loads(raw)
            if not item:
                return None
            opt_a = str(item.get("a") or "").strip()
            opt_b = str(item.get("b") or "").strip()
            opt_c = str(item.get("c") or "").strip()
            opt_d = str(item.get("d") or "").strip()
            ans_raw = item.get("ans")
            ans = _NUM_TO_LETTER.get(ans_raw) if ans_raw is not None else None
            return {
                "option_a": opt_a, "option_b": opt_b,
                "option_c": opt_c, "option_d": opt_d,
                "correct_answer": ans,
            }
        except Exception as e:
            print(f"    Attempt {attempt+1} error: {e}")
    return None


def run(dry_run: bool = False) -> None:
    doc = fitz.open(PDF_PATH)
    tracker = CostTracker()
    repaired = 0
    still_broken = 0

    for qnum, (broken_pg, next_pg) in TARGETS.items():
        print(f"  Q{qnum} (page {next_pg+1})...")

        # Use hard-coded English override if available (for Telugu-option pages)
        if qnum in ENGLISH_OVERRIDES:
            result = dict(ENGLISH_OVERRIDES[qnum])
            print(f"    [override] using pre-verified English translations")
        else:
            result = extract_from_next_page(doc, qnum, next_pg, tracker)

        if not result:
            print(f"    -> no data from next page")
            still_broken += 1
            continue

        cnt = sum(1 for k in ("option_a","option_b","option_c","option_d") if result.get(k))
        print(f"    {cnt}/4: A={repr(result.get('option_a',''))[:35]} "
              f"B={repr(result.get('option_b',''))[:35]} "
              f"C={repr(result.get('option_c',''))[:30]} "
              f"D={repr(result.get('option_d',''))[:30]} ans={result.get('correct_answer')}")

        if dry_run:
            repaired += 1
            continue

        if cnt < 3:
            print(f"    -> only {cnt}/4 options - keeping needs_review=True")
            still_broken += 1
            continue

        update = {
            "option_a":      result["option_a"],
            "option_b":      result["option_b"],
            "option_c":      result["option_c"],
            "option_d":      result["option_d"],
            "correct_answer": result["correct_answer"] or None,
            "needs_review":  cnt < 4 or not result.get("correct_answer"),
            "structural_status": "valid" if cnt == 4 else "broken",
            "answer_status":     "verified" if result.get("correct_answer") else "ai_inferred",
            "practice_ready": cnt == 4,
        }
        if cnt == 4:
            update["primary_issue_code"] = None
            update["issue_codes"] = []

        db_result = (
            supabase.table("questions")
            .update(update)
            .eq("exam_name", EXAM_NAME)
            .eq("question_number", qnum)
            .eq("source_pdf", SOURCE_PDF)
            .execute()
        )
        updated = len(db_result.data) if db_result.data else 0
        if updated:
            print(f"    -> updated {updated} row(s)")
            repaired += 1
        else:
            print(f"    -> WARNING: no DB rows matched")
            still_broken += 1

    doc.close()
    print(f"\nDone. Repaired: {repaired} | Still broken: {still_broken}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
