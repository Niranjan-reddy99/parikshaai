"""
Repair missing UPSC Prelims questions without re-running the full pipeline.
Checks DB per year → runs Vision only on pages with missing Q numbers → upserts.

Run: python repair_missing.py
"""
import os, sys, re, tempfile, hashlib, time
import fitz
import google.generativeai as genai
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, str(Path(__file__).parent))

from pipeline import (
    get_supabase, extract_text, parse_questions_local,
    _targeted_vision_recovery, filter_english,
    tag_questions, store_questions, generate_explanations_bulk,
    detect_year_boundaries, CostTracker,
)

PDF_PATH = "/Users/niranjan/Downloads/upsc 2024-2020.pdf"
EXAM_NAME = "UPSC Prelims"

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
sb = get_supabase()
tracker = CostTracker()


def get_db_question_numbers(year: int) -> set[int]:
    """Return set of question numbers already in DB for this year."""
    rows = sb.table("questions") \
        .select("question_text") \
        .eq("exam_name", EXAM_NAME) \
        .eq("exam_year", year) \
        .execute()
    return set(range(1, len(rows.data) + 1))   # approximate via count


def get_db_count(year: int) -> int:
    rows = sb.table("questions") \
        .select("id", count="exact") \
        .eq("exam_name", EXAM_NAME) \
        .eq("exam_year", year) \
        .execute()
    return rows.count or 0


print(f"\n{'='*60}")
print(f"REPAIR: {EXAM_NAME} — checking DB gaps")
print(f"{'='*60}\n")

# ── 1. Check current DB state ─────────────────────────────────────────────────
per_year_count: dict[int, int] = {}
for yr in [2020, 2021, 2022, 2023, 2024]:
    count = get_db_count(yr)
    per_year_count[yr] = count
    status = "✅" if count == 100 else f"⚠️  {count}/100"
    print(f"  {yr}: {status}")

years_needing_repair = [yr for yr, cnt in per_year_count.items() if cnt < 100]
if not years_needing_repair:
    print("\n✅ All years complete — nothing to repair.")
    sys.exit(0)

print(f"\nYears needing repair: {years_needing_repair}")

# ── 2. Open PDF and detect year boundaries ────────────────────────────────────
print(f"\nOpening {PDF_PATH}...")
groups = detect_year_boundaries(PDF_PATH)
src_doc = fitz.open(PDF_PATH)

_nonascii  = re.compile(r'[^\x00-\x7F]+')
_multispace = re.compile(r'  +')

total_inserted = 0

for year in years_needing_repair:
    count_before = per_year_count[year]
    missing_count = 100 - count_before
    print(f"\n{'─'*60}")
    print(f"  Repairing {year} — {count_before}/100 in DB, need {missing_count} more")
    print(f"{'─'*60}")

    if year not in groups:
        print(f"  ⚠️  Year {year} not found in PDF boundaries — skipping")
        continue

    page_indices = groups[year]

    # Write year's pages to temp PDF
    tmp = tempfile.NamedTemporaryFile(suffix=f"_UPSC_Prelims_{year}.pdf", delete=False)
    tmp.close()
    year_doc = fitz.open()
    year_doc.insert_pdf(src_doc, from_page=page_indices[0], to_page=page_indices[-1])
    year_doc.save(tmp.name)
    year_doc.close()

    try:
        # Extract text (skip_bilingual=True for UPSC)
        pages = extract_text(tmp.name, tracker, skip_bilingual=True)

        # Parse questions locally
        questions = parse_questions_local(pages)

        # UPSC sanitization: strip non-ASCII so langdetect works
        for q in questions:
            for field in ("question_text", "option_a", "option_b", "option_c", "option_d"):
                if q.get(field):
                    q[field] = _multispace.sub(' ', _nonascii.sub(' ', q[field])).strip()

        # Find which Q numbers have valid text (≥10 chars)
        valid_questions = [
            q for q in questions
            if (q.get("question_text") or "").strip() and len((q.get("question_text") or "").strip()) >= 10
            and len(q.get("option_a") or "") >= 3
        ]
        found_valid = {q["question_number"] for q in valid_questions}
        missing = [n for n in range(1, 101) if n not in found_valid]

        print(f"  Regex found {len(found_valid)} valid questions, {len(missing)} to Vision-recover")

        # --- FIX: also store locally-parsed valid questions (they may be new) ---
        local_to_store = filter_english(valid_questions)
        if local_to_store:
            print(f"  Tagging {len(local_to_store)} local questions...")
            local_to_store = tag_questions(local_to_store, EXAM_NAME, None, tracker)
            print(f"  Storing {len(local_to_store)} local questions...")
            local_result = store_questions(local_to_store, Path(PDF_PATH).name, EXAM_NAME, year)
            local_ins = local_result["inserted"]
            total_inserted += local_ins
            print(f"  ✅ {year} local: inserted {local_ins}, skipped {local_result['skipped']}")

        if not missing:
            print(f"  ✅ All 100 questions found locally — skipping Vision")
            # check count after local insert
            current = get_db_count(year)
            print(f"  DB now: {current}/100")
            continue

        # Run targeted Vision with fixed logic (safety off, chunked)
        recovered = _targeted_vision_recovery(tmp.name, missing, pages, tracker)

        if not recovered:
            print(f"  ⚠️  Vision recovered 0 — nothing more to add for {year}")
            current = get_db_count(year)
            print(f"  DB now: {current}/100")
            continue

        # Sanitize recovered questions
        for q in recovered:
            for field in ("question_text", "option_a", "option_b", "option_c", "option_d"):
                if q.get(field):
                    q[field] = _multispace.sub(' ', _nonascii.sub(' ', q[field])).strip()

        # Filter English
        recovered = filter_english(recovered)
        if not recovered:
            print(f"  ⚠️  filter_english removed all recovered questions — nothing more for {year}")
            current = get_db_count(year)
            print(f"  DB now: {current}/100")
            continue

        print(f"  Tagging {len(recovered)} recovered questions...")
        recovered = tag_questions(recovered, EXAM_NAME, None, tracker)

        print(f"  Storing {len(recovered)} vision questions...")
        result = store_questions(recovered, Path(PDF_PATH).name, EXAM_NAME, year)
        inserted = result["inserted"]
        total_inserted += inserted
        print(f"  ✅ {year} vision: inserted {inserted}, skipped {result['skipped']}")
        if result["errors"]:
            print(f"  ⚠️  Errors: {result['errors']}")

        # Generate explanations only for the newly inserted questions
        if inserted > 0:
            print(f"  Generating explanations for new questions...")
            expl = generate_explanations_bulk(EXAM_NAME, year, None, tracker)
            print(f"  Explanations: {expl['generated']} new, {expl['skipped']} already existed")

    finally:
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)

src_doc.close()

print(f"\n{'='*60}")
print(f"✅ Repair complete — inserted {total_inserted} new questions")
tracker.print_summary()
print(f"{'='*60}\n")

# Final count
print("Final DB state:")
for yr in [2020, 2021, 2022, 2023, 2024]:
    count = get_db_count(yr)
    status = "✅" if count == 100 else f"⚠️  {count}/100"
    print(f"  {yr}: {status}")
