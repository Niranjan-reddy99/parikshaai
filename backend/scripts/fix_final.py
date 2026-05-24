"""
fix_final.py — DEFINITIVE fix for UPSC Prelims database

Root cause: Hindi text was extracted, stripped to garbage, inserted with unique hashes.
Fix: nuke DB, re-extract using the proper extract_text(), apply garbage filter, 
     Vision recovery for genuinely missing questions.

Cost: ~₹1.5-2 max (Vision for missing + tagging + explanations)

Run:
  python fix_final.py --dry       # preview (₹0) — shows how many regex finds
  python fix_final.py --apply     # actually fix (~₹1.5-2)
"""
import sys, os, re, hashlib, json, tempfile, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import fitz
import google.generativeai as genai
from dotenv import load_dotenv
load_dotenv()

from config import supabase as sb
from pipeline import (
    CostTracker, CACHE_DIR, extract_text, parse_questions_local,
    detect_year_boundaries, _parse_vision_json,
    tag_questions, generate_explanations_bulk,
)

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

EXAM_NAME = "UPSC Prelims"
YEARS = [2020, 2021, 2022, 2023, 2024]
PDF_PATH = "/Users/niranjan/Downloads/upsc 2024-2020.pdf"

MODE = "dry"
if "--apply" in sys.argv:
    MODE = "apply"

tracker = CostTracker()

# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

_nonascii = re.compile(r'[^\x00-\x7F]+')
_multispace = re.compile(r'  +')


def is_garbage(q: dict) -> bool:
    """Detect Hindi garbage that survived non-ASCII stripping."""
    txt = (q.get("question_text") or "").strip()
    if len(txt) < 25:
        return True
    words = re.findall(r'[a-zA-Z]{3,}', txt)
    if len(words) < 3:
        return True
    alpha = sum(1 for c in txt if c.isalpha() and c.isascii())
    if alpha / max(len(txt), 1) < 0.12:
        return True
    # Check options — real questions have at least 2 substantive English options
    opts = [(q.get(f"option_{x}") or "").strip() for x in "abcd"]
    real_opts = [o for o in opts if len(o) >= 3 and re.search(r'[a-zA-Z]{2,}', o)]
    if len(real_opts) < 2:
        return True
    return False


def sanitize_q(q: dict) -> dict:
    """Strip non-ASCII chars from all fields."""
    for f in ("question_text", "option_a", "option_b", "option_c", "option_d"):
        if q.get(f):
            q[f] = _multispace.sub(' ', _nonascii.sub(' ', q[f])).strip()
    return q


def make_hash(q: dict) -> str:
    h = f"{(q.get('question_text') or '').strip().lower()}|{q.get('option_a','')}|{q.get('option_b','')}"
    return hashlib.sha256(h.encode()).hexdigest()


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1: CURRENT STATE + NUKE
# ══════════════════════════════════════════════════════════════════════════════

print(f"\n{'='*60}")
print(f"  DEFINITIVE FIX — {EXAM_NAME}")
print(f"  Mode: {'DRY RUN (₹0)' if MODE == 'dry' else 'APPLYING (~₹1.5-2)'}")
print(f"{'='*60}\n")

print("STEP 1 — Current DB state")
print("─" * 50)

for year in YEARS:
    res = sb.table("questions").select("id", count="exact") \
        .eq("exam_name", EXAM_NAME).eq("exam_year", year).execute()
    print(f"  {year}: {res.count or 0} questions")

if MODE == "apply":
    print("\n  🗑️  Deleting ALL UPSC Prelims questions (clean slate)...")
    for year in YEARS:
        rows = sb.table("questions").select("id") \
            .eq("exam_name", EXAM_NAME).eq("exam_year", year).execute()
        ids = [r["id"] for r in (rows.data or [])]
        for i in range(0, len(ids), 50):
            batch = ids[i:i+50]
            try:
                sb.table("explanations").delete().in_("question_id", batch).execute()
            except Exception:
                pass
            sb.table("questions").delete().in_("id", batch).execute()
    print("  ✅ DB cleared for UPSC Prelims")


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2: DETECT YEAR BOUNDARIES (Tesseract, free)
# ══════════════════════════════════════════════════════════════════════════════

print(f"\nSTEP 2 — Detecting year boundaries (Tesseract, ₹0)")
print("─" * 50)

groups = detect_year_boundaries(PDF_PATH)
src_doc = fitz.open(PDF_PATH)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3: PER-YEAR EXTRACTION + PARSING + VISION RECOVERY
# ══════════════════════════════════════════════════════════════════════════════

print(f"\nSTEP 3 — Extract + Parse + Vision recovery per year")
print("─" * 50)

VISION_PROMPT = (
    "This is a page from the UPSC Civil Services Preliminary Exam (bilingual: English + Hindi).\n\n"
    "Extract ONLY the ENGLISH questions. Return ONLY a JSON array — no markdown.\n\n"
    "Format: [{\"number\": 15, \"text\": \"Full question text including any statement labels\", "
    "\"options\": {\"A\": \"option\", \"B\": \"option\", \"C\": \"option\", \"D\": \"option\"}, "
    "\"answer\": null}]\n\n"
    "RULES:\n"
    "- ONLY English. COMPLETELY IGNORE Hindi/Devanagari text.\n"
    "- Options labeled (a)(b)(c)(d) → map to A/B/C/D.\n"
    "- Preserve exact question numbers as printed.\n"
    "- Return [] if no English questions.\n"
    "- Do NOT hallucinate or invent questions."
)

all_year_questions: dict[int, list] = {}

for year in sorted(groups.keys()):
    if year not in YEARS:
        continue
    
    page_indices = groups[year]
    print(f"\n  📅 {year} — {len(page_indices)} PDF pages")
    
    # Create temp PDF for this year
    tmp = tempfile.NamedTemporaryFile(suffix=f"_{year}.pdf", delete=False)
    tmp.close()
    year_doc = fitz.open()
    year_doc.insert_pdf(src_doc, from_page=page_indices[0], to_page=page_indices[-1])
    year_doc.save(tmp.name)
    year_doc.close()
    
    try:
        # ── Use the PROPER extract_text with skip_bilingual=True ──────
        # This uses cached pages if available, does smart block-level extraction
        pages = extract_text(tmp.name, tracker, skip_bilingual=True)
        
        # ── Parse with regex (free) ──────────────────────────────────
        questions = parse_questions_local(pages)
        
        # ── Sanitize (strip Hindi chars) + filter garbage ────────────
        questions = [sanitize_q(q) for q in questions]
        before_filter = len(questions)
        questions = [q for q in questions if not is_garbage(q)]
        
        # ── Dedup by question number (keep longest text) ─────────────
        by_num: dict[int, dict] = {}
        for q in questions:
            n = q["question_number"]
            if n not in by_num or len(q["question_text"]) > len(by_num[n]["question_text"]):
                by_num[n] = q
        questions = sorted(by_num.values(), key=lambda q: q["question_number"])
        
        found_nums = {q["question_number"] for q in questions}
        missing = sorted(n for n in range(1, 101) if n not in found_nums)
        
        print(f"     Regex: {before_filter} raw → {len(questions)} after garbage filter (₹0)")
        print(f"     Missing: {len(missing)} questions")
        if missing:
            print(f"     Missing numbers: {missing[:20]}{'...' if len(missing) > 20 else ''}")
        
        # ── Vision recovery for missing (API cost, only in apply mode) ──
        if missing and MODE == "apply":
            print(f"     🔍 Vision recovery for {len(missing)} missing questions...")
            
            import PIL.Image as PILImage
            import io as _io
            
            vision_model = genai.GenerativeModel("gemini-2.5-flash-lite")
            doc = fitz.open(tmp.name)
            all_pdf_pages = list(doc)
            
            # Build page → question number mapping from extracted text
            _qn_pat = re.compile(r'(?:^|\n)\s*(?:Q\.?\s*)?(\d{1,3})[.)]\s+\S', re.MULTILINE)
            page_q_nums = []
            for pg_text in pages:
                nums = {int(m.group(1)) for m in _qn_pat.finditer(pg_text)}
                page_q_nums.append(nums)
            
            # Map each missing Q to its target page(s)
            target_pages: set[int] = set()
            for mq in missing:
                for pi, nums in enumerate(page_q_nums):
                    if not nums:
                        continue
                    lo, hi = min(nums), max(nums)
                    if lo - 5 <= mq <= hi + 5:
                        target_pages.add(pi)
                        break
            
            # Also add pages around each target (questions can span pages)
            expanded = set()
            for pi in target_pages:
                expanded.add(pi)
                if pi + 1 < len(pages):
                    expanded.add(pi + 1)
            target_pages = expanded
            
            print(f"     Targeting {len(target_pages)} pages for Vision")
            
            # Convert extracted-page index → PDF page index
            total_pdf = len(all_pdf_pages)
            total_ext = max(len(pages), 1)
            
            recovered = []
            missing_set = set(missing)
            
            for ext_idx in sorted(target_pages):
                pdf_idx = min(round(ext_idx * total_pdf / total_ext), total_pdf - 1)
                
                # Send single page to Vision
                pg = all_pdf_pages[pdf_idx]
                pix = pg.get_pixmap(dpi=200)
                img = PILImage.open(_io.BytesIO(pix.tobytes("png")))
                
                try:
                    resp = vision_model.generate_content(
                        [VISION_PROMPT, img],
                        generation_config=genai.GenerationConfig(temperature=0.1, max_output_tokens=8192),
                        request_options={"timeout": 120},
                    )
                    tracker.record_from_response(f"Vision p{pdf_idx+1}", resp)
                    
                    qs = _parse_vision_json(resp.text or "")
                    for q in qs:
                        q = sanitize_q(q)
                        if q["question_number"] in missing_set and not is_garbage(q):
                            recovered.append(q)
                            missing_set.discard(q["question_number"])
                    
                    time.sleep(0.3)
                except Exception as e:
                    err = str(e)
                    if "no valid" in err or "safety" in err.lower():
                        print(f"     ⚠️  Page {pdf_idx+1} safety-blocked, skipping")
                    else:
                        print(f"     ⚠️  Vision error page {pdf_idx+1}: {err[:80]}")
            
            doc.close()
            
            # Merge recovered into questions
            existing_map = {q["question_number"]: q for q in questions}
            for q in recovered:
                if q["question_number"] not in existing_map:
                    existing_map[q["question_number"]] = q
            questions = sorted(existing_map.values(), key=lambda q: q["question_number"])
            
            still_missing = sorted(n for n in range(1, 101) if n not in {q["question_number"] for q in questions})
            print(f"     ✅ Vision recovered: {len(recovered)} → total now: {len(questions)}/100")
            if still_missing:
                print(f"     Still missing ({len(still_missing)}): {still_missing}")
        
        all_year_questions[year] = questions
    
    finally:
        os.unlink(tmp.name)

src_doc.close()


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4: TAG + STORE + EXPLAIN
# ══════════════════════════════════════════════════════════════════════════════

print(f"\nSTEP 4 — Tag + Store + Explain")
print("─" * 50)

if MODE == "dry":
    print("\n  📊 DRY RUN RESULTS:")
    total = 0
    total_missing = 0
    for year in YEARS:
        qs = all_year_questions.get(year, [])
        total += len(qs)
        gap = max(0, 100 - len(qs))
        total_missing += gap
        status = "✅" if len(qs) >= 100 else f"⚠️  {len(qs)}/100 ({gap} need Vision)"
        print(f"    {year}: {status}")
    
    print(f"\n    Regex alone: {total}/500")
    print(f"    Vision needed for: {total_missing} questions (~{total_missing // 6} page scans)")
    est_vision = total_missing // 6 * 0.035
    est_tag = 0.10
    est_expl = 0.50
    est_total = est_vision + est_tag + est_expl
    print(f"\n    💰 Estimated cost:")
    print(f"       Vision:        ₹{est_vision:.2f}")
    print(f"       Tagging:       ₹{est_tag:.2f}")
    print(f"       Explanations:  ₹{est_expl:.2f}")
    print(f"       ─────────────────────")
    print(f"       TOTAL:         ₹{est_total:.2f}")
    print(f"\n    Run: python fix_final.py --apply")

elif MODE == "apply":
    total_stored = 0
    for year in YEARS:
        qs = all_year_questions.get(year, [])
        if not qs:
            print(f"  {year}: no questions — skipping")
            continue
        
        print(f"\n  {year}: tagging {len(qs)} questions...")
        qs = tag_questions(qs, EXAM_NAME, tracker=tracker)
        
        # Build rows for insertion
        rows = []
        seen_hashes = set()
        for q in qs:
            qhash = make_hash(q)
            if qhash in seen_hashes:
                continue
            seen_hashes.add(qhash)
            
            row = {
                "question_text": (q.get("question_text") or "").strip(),
                "option_a": (q.get("option_a") or "").strip(),
                "option_b": (q.get("option_b") or "").strip(),
                "option_c": (q.get("option_c") or "").strip(),
                "option_d": (q.get("option_d") or "").strip(),
                "correct_answer": ((q.get("correct_answer") or "A").upper() + "A")[:1],
                "subject": q.get("subject") or "General Knowledge",
                "topic": q.get("topic") or "General",
                "subtopic": q.get("subtopic"),
                "difficulty": q.get("difficulty") or "Medium",
                "question_type": "MCQ",
                "concept": None,
                "exam_name": EXAM_NAME,
                "exam_year": year,
                "source_pdf": Path(PDF_PATH).name,
                "question_hash": qhash,
                "is_active": True,
            }
            if row["question_text"] and len(row["question_text"]) >= 10:
                if row["correct_answer"] not in "ABCD":
                    row["correct_answer"] = "A"
                rows.append(row)
        
        if rows:
            for i in range(0, len(rows), 50):
                batch = rows[i:i+50]
                try:
                    sb.table("questions").upsert(batch, on_conflict="question_hash").execute()
                except Exception as e:
                    print(f"    ❌ Insert error: {e}")
            total_stored += len(rows)
            print(f"    ✅ Stored {len(rows)} questions")
        
        # Generate explanations
        print(f"    Generating explanations...")
        generate_explanations_bulk(EXAM_NAME, year, tracker=tracker)
    
    # Final report
    tracker.print_summary()
    
    print(f"\n{'='*60}")
    print(f"  ✅ FINAL DB STATE:")
    total = 0
    for year in YEARS:
        res = sb.table("questions").select("id", count="exact") \
            .eq("exam_name", EXAM_NAME).eq("exam_year", year).execute()
        count = res.count or 0
        total += count
        status = "✅" if count == 100 else f"⚠️  {count}/100"
        print(f"    {year}: {status}")
    print(f"    TOTAL: {total}/500")
    print(f"    💰 Actual cost: ₹{tracker.total_inr()}")
    print(f"{'='*60}\n")
