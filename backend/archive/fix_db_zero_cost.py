"""
fix_db_zero_cost.py — Fix UPSC Prelims DB with ZERO API charges

Strategy:
  1. Delete garbage Hindi fragments + duplicates from DB
  2. Re-parse cached pages with proper garbage filtering
  3. Try Tesseract OCR (free, local) for missing questions
  4. Insert new questions with default tags (no API calls)

Cost: ₹0 (everything is local)

Run:
  python fix_db_zero_cost.py          # dry run
  python fix_db_zero_cost.py --apply  # actually fix
"""
import sys, os, re, hashlib, json, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import fitz
from config import supabase as sb

EXAM_NAME = "UPSC Prelims"
YEARS = [2020, 2021, 2022, 2023, 2024]
PDF_PATH = "/Users/niranjan/Downloads/upsc 2024-2020.pdf"
CACHE_DIR = Path("./cache")
DRY_RUN = "--apply" not in sys.argv

if DRY_RUN:
    print("\n🔍 DRY RUN mode. Use --apply to execute changes.\n")
else:
    print("\n🚀 APPLYING changes to DB (₹0 cost).\n")


# ══════════════════════════════════════════════════════════════════════════════
# GARBAGE DETECTION
# ══════════════════════════════════════════════════════════════════════════════

def is_garbage(q: dict) -> bool:
    """Detect garbage questions — Hindi fragments that survived non-ASCII stripping."""
    txt = (q.get("question_text") or "").strip()
    
    if len(txt) < 25:
        return True
    
    # Count real English words (3+ ASCII letters)
    real_words = re.findall(r'[a-zA-Z]{3,}', txt)
    if len(real_words) < 3:
        return True
    
    # If text is mostly whitespace/punctuation/digits with very few English chars
    alpha_chars = sum(1 for c in txt if c.isalpha() and c.isascii())
    if len(txt) > 20 and alpha_chars / len(txt) < 0.12:
        return True
    
    # Check options — real questions have at least 2 non-trivial options
    opts = [
        (q.get("option_a") or "").strip(),
        (q.get("option_b") or "").strip(),
        (q.get("option_c") or "").strip(),
        (q.get("option_d") or "").strip(),
    ]
    real_opts = [o for o in opts if len(o) >= 3 and len(re.findall(r'[a-zA-Z]{2,}', o)) >= 1]
    if len(real_opts) < 2:
        return True
    
    return False


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1: IDENTIFY AND DELETE GARBAGE
# ══════════════════════════════════════════════════════════════════════════════

print("STEP 1 — Identifying garbage questions in DB...")
print("─" * 60)

per_year_stats = {}

for year in YEARS:
    rows = sb.table("questions") \
        .select("id, question_text, option_a, option_b, option_c, option_d, question_hash") \
        .eq("exam_name", EXAM_NAME) \
        .eq("exam_year", year) \
        .order("created_at") \
        .execute()
    
    questions = rows.data or []
    
    # Identify garbage
    garbage_ids = {q["id"] for q in questions if is_garbage(q)}
    good_questions = [q for q in questions if q["id"] not in garbage_ids]
    
    # Identify duplicates among good questions
    text_map: dict[str, list] = {}
    for q in good_questions:
        key = re.sub(r'\s+', ' ', q["question_text"][:120].strip().lower())
        text_map.setdefault(key, []).append(q)
    
    dup_ids = set()
    for key, qs in text_map.items():
        if len(qs) > 1:
            qs.sort(key=lambda x: sum(1 for k in ("option_a","option_b","option_c","option_d") 
                                      if (x.get(k) or "").strip()), reverse=True)
            for q in qs[1:]:
                dup_ids.add(q["id"])
    
    to_delete = garbage_ids | dup_ids
    remaining = len(questions) - len(to_delete)
    
    # Get existing question hashes (to avoid re-inserting)
    existing_hashes = {q["question_hash"] for q in questions if q["id"] not in to_delete}
    
    per_year_stats[year] = {
        "total": len(questions),
        "garbage": len(garbage_ids),
        "duplicates": len(dup_ids),
        "to_delete": to_delete,
        "remaining": remaining,
        "existing_hashes": existing_hashes,
    }
    
    status = "✅" if remaining == 100 else f"→ {remaining} remain"
    print(f"  {year}: {len(questions)} total, {len(garbage_ids)} garbage, {len(dup_ids)} dups → delete {len(to_delete)} {status}")

# Actually delete if not dry run
if not DRY_RUN:
    print("\n  Deleting garbage...")
    total_deleted = 0
    for year in YEARS:
        to_delete = per_year_stats[year]["to_delete"]
        if not to_delete:
            continue
        delete_list = list(to_delete)
        for i in range(0, len(delete_list), 50):
            batch = delete_list[i:i+50]
            try:
                sb.table("explanations").delete().in_("question_id", batch).execute()
            except Exception:
                pass
            try:
                sb.table("questions").delete().in_("id", batch).execute()
                total_deleted += len(batch)
            except Exception as e:
                print(f"    ❌ Error: {e}")
    print(f"  ✅ Deleted {total_deleted} garbage questions")


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2: RE-PARSE CACHED PAGES TO FIND MISSING QUESTIONS (FREE)  
# ══════════════════════════════════════════════════════════════════════════════

print(f"\nSTEP 2 — Re-parsing cached pages for missing questions (₹0)...")
print("─" * 60)

# Import local parsing (no API)
from pipeline import parse_questions_local, detect_year_boundaries

# Detect year boundaries
groups = detect_year_boundaries(PDF_PATH)
src_doc = fitz.open(PDF_PATH)

_nonascii = re.compile(r'[^\x00-\x7F]+')
_multispace = re.compile(r'  +')

new_questions_to_insert: dict[int, list] = {yr: [] for yr in YEARS}

for year in YEARS:
    remaining = per_year_stats[year]["remaining"]
    if remaining >= 100:
        print(f"  {year}: already has {remaining} questions — skipping")
        continue
    
    needed = 100 - remaining
    
    if year not in groups:
        print(f"  {year}: not found in PDF — skipping")
        continue
    
    page_indices = groups[year]
    
    # Create temp PDF for this year
    tmp = tempfile.NamedTemporaryFile(suffix=f"_{year}.pdf", delete=False)
    tmp.close()
    year_doc = fitz.open()
    year_doc.insert_pdf(src_doc, from_page=page_indices[0], to_page=page_indices[-1])
    year_doc.save(tmp.name)
    year_doc.close()
    
    try:
        # Check page cache
        pdf_bytes = Path(tmp.name).read_bytes()
        pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()[:16]
        page_cache = CACHE_DIR / f"pages_{pdf_hash}.json"
        
        if page_cache.exists():
            with open(page_cache) as f:
                pages = json.load(f)
            print(f"  {year}: using cached pages ({len(pages)} pages)")
        else:
            # Extract fresh (PyMuPDF only, no API)
            doc = fitz.open(tmp.name)
            pages = []
            for pg in doc:
                text = pg.get_text("text").strip()
                if text and len(text) > 50:
                    pages.append(text)
            doc.close()
            print(f"  {year}: extracted {len(pages)} pages fresh (PyMuPDF, ₹0)")
        
        # Parse questions locally
        questions = parse_questions_local(pages)
        
        # Strip non-ASCII (Hindi chars)
        for q in questions:
            for field in ("question_text", "option_a", "option_b", "option_c", "option_d"):
                if q.get(field):
                    q[field] = _multispace.sub(' ', _nonascii.sub(' ', q[field])).strip()
        
        # Filter garbage
        good_qs = [q for q in questions if not is_garbage(q)]
        
        # Check which are actually new (not already in DB by hash)
        existing_hashes = per_year_stats[year]["existing_hashes"]
        new_qs = []
        for q in good_qs:
            hash_input = (
                f"{(q.get('question_text') or '').strip().lower()}"
                f"|{q.get('option_a','')}"
                f"|{q.get('option_b','')}"
            )
            qhash = hashlib.sha256(hash_input.encode()).hexdigest()
            if qhash not in existing_hashes:
                q["question_hash"] = qhash
                new_qs.append(q)
                existing_hashes.add(qhash)  # prevent duplicates within this batch
        
        new_questions_to_insert[year] = new_qs
        print(f"  {year}: {len(good_qs)} good from regex, {len(new_qs)} NEW (not in DB), need {needed}")
        
    finally:
        os.unlink(tmp.name)

src_doc.close()


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3: TESSERACT OCR FOR STILL-MISSING QUESTIONS (FREE, LOCAL)
# ══════════════════════════════════════════════════════════════════════════════

print(f"\nSTEP 3 — Tesseract OCR for remaining gaps (₹0, local)...")
print("─" * 60)

try:
    import pytesseract
    from PIL import Image
    import io
    HAS_TESSERACT = True
except ImportError:
    HAS_TESSERACT = False
    print("  ⚠️  Tesseract/PIL not available — skipping OCR recovery")

if HAS_TESSERACT:
    src_doc = fitz.open(PDF_PATH)
    groups2 = detect_year_boundaries(PDF_PATH)  # reuse
    
    for year in YEARS:
        remaining = per_year_stats[year]["remaining"]
        new_from_regex = len(new_questions_to_insert[year])
        projected = remaining + new_from_regex
        
        if projected >= 100:
            print(f"  {year}: projected {projected}/100 — no OCR needed")
            continue
        
        still_need = 100 - projected
        print(f"  {year}: projected {projected}/100, trying Tesseract for {still_need} more...")
        
        if year not in groups2:
            continue
        
        page_indices = groups2[year]
        
        # Find which question numbers we already have
        existing_nums = set()
        # From DB (good questions)
        db_rows = sb.table("questions") \
            .select("question_text") \
            .eq("exam_name", EXAM_NAME) \
            .eq("exam_year", year) \
            .execute()
        # We can't easily get question_number from DB, so use text-based dedup
        
        # From new regex questions
        for q in new_questions_to_insert[year]:
            existing_nums.add(q["question_number"])
        
        # OCR each page of this year and try to find questions
        ocr_qs = []
        for pi in page_indices:
            if pi >= len(src_doc):
                continue
            page = src_doc[pi]
            pix = page.get_pixmap(dpi=300)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            
            try:
                raw_text = pytesseract.image_to_string(img, lang='eng', config='--psm 6')
            except Exception:
                continue
            
            if not raw_text or len(raw_text) < 50:
                continue
            
            # Parse questions from OCR text
            parsed = parse_questions_local([raw_text])
            for q in parsed:
                # Strip non-ASCII
                for field in ("question_text", "option_a", "option_b", "option_c", "option_d"):
                    if q.get(field):
                        q[field] = _multispace.sub(' ', _nonascii.sub(' ', q[field])).strip()
                
                if not is_garbage(q):
                    # Check hash uniqueness
                    hash_input = (
                        f"{(q.get('question_text') or '').strip().lower()}"
                        f"|{q.get('option_a','')}"
                        f"|{q.get('option_b','')}"
                    )
                    qhash = hashlib.sha256(hash_input.encode()).hexdigest()
                    if qhash not in per_year_stats[year]["existing_hashes"]:
                        q["question_hash"] = qhash
                        ocr_qs.append(q)
                        per_year_stats[year]["existing_hashes"].add(qhash)
        
        if ocr_qs:
            new_questions_to_insert[year].extend(ocr_qs)
            print(f"  {year}: Tesseract recovered {len(ocr_qs)} additional questions")
        else:
            print(f"  {year}: Tesseract found 0 new questions")
    
    src_doc.close()


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4: INSERT NEW QUESTIONS WITH DEFAULT TAGS (₹0)
# ══════════════════════════════════════════════════════════════════════════════

print(f"\nSTEP 4 — Inserting new questions with default tags (₹0)...")
print("─" * 60)

total_new_inserted = 0

for year in YEARS:
    new_qs = new_questions_to_insert[year]
    if not new_qs:
        print(f"  {year}: no new questions to insert")
        continue
    
    if DRY_RUN:
        print(f"  {year}: would insert {len(new_qs)} new questions")
        continue
    
    rows_to_insert = []
    for q in new_qs:
        row = {
            "question_text": (q.get("question_text") or "").strip(),
            "option_a": (q.get("option_a") or "").strip(),
            "option_b": (q.get("option_b") or "").strip(),
            "option_c": (q.get("option_c") or "").strip(),
            "option_d": (q.get("option_d") or "").strip(),
            "correct_answer": ((q.get("correct_answer") or "A").upper() + "A")[:1],
            "subject": "General Knowledge",  # default — retag later for ₹0.20
            "topic": "General",
            "subtopic": None,
            "difficulty": "Medium",
            "question_type": "MCQ",
            "concept": None,
            "exam_name": EXAM_NAME,
            "exam_year": year,
            "source_pdf": Path(PDF_PATH).name,
            "question_hash": q["question_hash"],
            "is_active": True,
        }
        if row["question_text"] and len(row["question_text"]) >= 10:
            if row["correct_answer"] not in "ABCD":
                row["correct_answer"] = "A"
            rows_to_insert.append(row)
    
    # Dedup within batch
    seen_hashes = {}
    for r in rows_to_insert:
        seen_hashes[r["question_hash"]] = r
    rows_to_insert = list(seen_hashes.values())
    
    if rows_to_insert:
        try:
            result = sb.table("questions").upsert(rows_to_insert, on_conflict="question_hash").execute()
            inserted = len(result.data) if result.data else len(rows_to_insert)
            total_new_inserted += inserted
            print(f"  {year}: inserted {inserted} new questions")
        except Exception as e:
            print(f"  {year}: ❌ insert error: {e}")
    else:
        print(f"  {year}: nothing to insert")


# ══════════════════════════════════════════════════════════════════════════════
# FINAL REPORT
# ══════════════════════════════════════════════════════════════════════════════

print(f"\n{'='*60}")
if DRY_RUN:
    print("DRY RUN SUMMARY")
    print("─" * 60)
    for year in YEARS:
        remaining = per_year_stats[year]["remaining"]
        new = len(new_questions_to_insert[year])
        projected = remaining + new
        status = "✅" if projected >= 100 else f"⚠️  {projected}/100"
        print(f"  {year}: {per_year_stats[year]['total']} → delete {len(per_year_stats[year]['to_delete'])} "
              f"→ {remaining} + {new} new = {projected}  {status}")
    print(f"\nRun with --apply to execute. ₹0 cost guaranteed.")
else:
    print("✅ FIX COMPLETE (₹0 cost)")
    print("─" * 60)
    print(f"  New questions inserted: {total_new_inserted}")
    print(f"\n  Final DB state:")
    for year in YEARS:
        rows = sb.table("questions") \
            .select("id", count="exact") \
            .eq("exam_name", EXAM_NAME) \
            .eq("exam_year", year) \
            .execute()
        count = rows.count or 0
        status = "✅" if count == 100 else f"⚠️  {count}/100"
        print(f"    {year}: {status}")
    print(f"\n  💡 To add proper tags later: python pipeline.py retag (costs ~₹0.20)")
print(f"{'='*60}\n")
