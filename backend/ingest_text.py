"""
ingest_text.py — Import UPSC questions from clean text files into Supabase

This is the RELIABLE way to import questions:
  1. You provide clean text files (one per year) in extracted_text/
  2. This script parses questions, tags them with AI, generates explanations
  3. Stores everything in Supabase

Text Format Expected:
  Questions can be in any common format:
    1. Question text here?
    (a) Option A
    (b) Option B  
    (c) Option C
    (d) Option D

  OR:
    1. Question text here?
    a) Option A
    b) Option B
    c) Option C
    d) Option D

Cost: ~₹0.30 per 100 questions (tagging + explanations only)
      ~₹1.50 total for all 5 years

Usage:
  python ingest_text.py                          # process all .txt files in extracted_text/
  python ingest_text.py UPSC_Prelims_2024.txt    # process a specific file
  python ingest_text.py --nuke                   # delete existing + re-import all
"""
import sys, os, re, hashlib, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import google.generativeai as genai
from dotenv import load_dotenv
load_dotenv()

from config import supabase as sb
from pipeline import (
    CostTracker, tag_questions, generate_explanations_bulk,
)

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

EXAM_NAME = "UPSC Prelims"
TEXT_DIR = Path("./extracted_text")
NUKE = "--nuke" in sys.argv

tracker = CostTracker()


# ══════════════════════════════════════════════════════════════════════════════
# PARSER — handles common UPSC question text formats
# ══════════════════════════════════════════════════════════════════════════════

# Question start: "1." "1)" "Q1." "Q.1" etc.
_Q_START = re.compile(r'^(?:Q\.?\s*)?(\d{1,3})\s*[.)]\s+(.+)', re.MULTILINE)

# Options: (a) or a) or a. or (A) etc.
_OPT_ALPHA = re.compile(
    r'(?:^|\n)\s*[(\[]?([AaBbCcDd])[)\].)]\s+(.+?)(?=\n\s*[(\[]?[AaBbCcDd][)\].)]\s|\n\s*(?:Q\.?\s*)?\d{1,3}\s*[.)]\s|$)',
    re.DOTALL
)

# Numbered options: (1) (2) (3) (4) — used in "Consider the following" type questions
_OPT_NUM = re.compile(
    r'(?:^|\n)\s*\(([1-4])\)\s+(.+?)(?=\n\s*\([1-4]\)\s|\n\s*(?:Q\.?\s*)?\d{1,3}\s*[.)]\s|$)',
    re.DOTALL
)

_NUM_TO_LETTER = {"1": "A", "2": "B", "3": "C", "4": "D"}


def parse_text_file(filepath: Path) -> tuple[list[dict], int]:
    """Parse a text file into structured question dicts.
    
    Returns: (questions, year) where year is extracted from filename.
    """
    text = filepath.read_text(encoding='utf-8')
    
    # Extract year from filename: UPSC_Prelims_2024.txt
    year_match = re.search(r'(\d{4})', filepath.stem)
    year = int(year_match.group(1)) if year_match else 0
    
    # Remove page markers from our extraction script
    text = re.sub(r'---\s*PAGE\s+\d+\s*---', '', text)
    
    # Clean common noise
    text = re.sub(r'\bP\.?T\.?O\.?\b', '', text, flags=re.IGNORECASE)
    text = re.sub(r'Page\s+\d+\s+of\s+\d+', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\n{3,}', '\n\n', text)
    
    # Join bare question-number lines with following text
    text = re.sub(r'(\n(?:Q\.?\s*)?\d{1,3}[.)]\s*)\n\s+(?=\S)', r'\1 ', text)
    
    # Split on question starts
    splits = list(_Q_START.finditer(text))
    questions = []
    prev_q_num = 0
    
    for idx, match in enumerate(splits):
        q_num = int(match.group(1))
        
        # Sequential validation (allow gaps up to 10)
        if q_num <= prev_q_num or q_num > prev_q_num + 10:
            continue
        prev_q_num = q_num
        
        # Get block text
        start = match.start()
        end = len(text)
        for j in range(idx + 1, len(splits)):
            fn = int(splits[j].group(1))
            if fn > q_num and fn <= q_num + 10:
                end = splits[j].start()
                break
        block = text[start:end].strip()
        
        # Detect format: alpha options (a/b/c/d) or numeric (1/2/3/4)
        first_alpha = re.search(r'\n\s*[(\[]?[AaBbCcDd][)\].)]\s+', block)
        first_num = re.search(r'\n\s*\([1-4]\)\s+', block)
        
        use_numeric = False
        q_text = ""
        opts_block = ""
        
        if first_alpha and first_num and first_alpha.start() < first_num.start():
            # Statements (A/B/C/D) then answer choices (1/2/3/4)
            q_text = block[:first_num.start()].strip()
            opts_block = block[first_num.start():]
            use_numeric = True
        elif first_num and (not first_alpha or first_num.start() <= first_alpha.start()):
            q_text = block[:first_num.start()].strip()
            opts_block = block[first_num.start():]
            use_numeric = True
        elif first_alpha:
            q_text = block[:first_alpha.start()].strip()
            opts_block = block[first_alpha.start():]
        else:
            q_text = block
        
        # Remove question number prefix
        q_text = re.sub(r'^(?:Q\.?\s*)?\d{1,3}\s*[.)]\s+', '', q_text).strip()
        
        # Parse options
        opts = {"A": None, "B": None, "C": None, "D": None}
        
        if use_numeric:
            for m in _OPT_NUM.finditer("\n" + opts_block):
                letter = _NUM_TO_LETTER.get(m.group(1))
                if letter and not opts[letter]:
                    opts[letter] = m.group(2).strip()
        else:
            for m in _OPT_ALPHA.finditer("\n" + opts_block):
                letter = m.group(1).upper()
                if letter in opts and not opts[letter]:
                    opts[letter] = m.group(2).strip()
        
        opt_count = sum(1 for v in opts.values() if v and len(v) >= 2)
        
        if q_text and len(q_text) >= 15 and opt_count >= 2:
            questions.append({
                "question_number": q_num,
                "question_text": q_text,
                "option_a": opts["A"] or "",
                "option_b": opts["B"] or "",
                "option_c": opts["C"] or "",
                "option_d": opts["D"] or "",
                "correct_answer": None,
            })
    
    # Dedup by question number
    seen = {}
    for q in questions:
        n = q["question_number"]
        if n not in seen or len(q["question_text"]) > len(seen[n]["question_text"]):
            seen[n] = q
    questions = sorted(seen.values(), key=lambda q: q["question_number"])
    
    return questions, year


def make_hash(q: dict) -> str:
    h = f"{(q.get('question_text') or '').strip().lower()}|{q.get('option_a','')}|{q.get('option_b','')}"
    return hashlib.sha256(h.encode()).hexdigest()


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

print(f"\n{'='*60}")
print(f"  TEXT INGESTION PIPELINE — {EXAM_NAME}")
print(f"{'='*60}\n")

# Find text files
if len(sys.argv) > 1 and not sys.argv[1].startswith("--"):
    files = [TEXT_DIR / sys.argv[1]]
else:
    files = sorted(TEXT_DIR.glob("*.txt"))

if not files:
    print(f"  ❌ No .txt files found in {TEXT_DIR.absolute()}")
    print(f"  Run extract_text_from_pdf.py first, or place text files there.")
    sys.exit(1)

# Nuke existing if requested
if NUKE:
    print("  🗑️  Nuking existing UPSC Prelims questions...")
    for year in [2020, 2021, 2022, 2023, 2024]:
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
    print("  ✅ DB cleared\n")

# Process each file
total_stored = 0

for filepath in files:
    if not filepath.exists():
        print(f"  ❌ File not found: {filepath}")
        continue
    
    print(f"  📄 {filepath.name}")
    questions, year = parse_text_file(filepath)
    
    if not year:
        print(f"     ⚠️  Can't detect year from filename — skipping")
        continue
    
    print(f"     Parsed: {len(questions)} questions for {year}")
    
    # Show what we found
    found_nums = sorted(q["question_number"] for q in questions)
    missing = [n for n in range(1, 101) if n not in found_nums]
    if missing:
        print(f"     Missing ({len(missing)}): {missing[:15]}{'...' if len(missing) > 15 else ''}")
    else:
        print(f"     ✅ All 100 questions found!")
    
    if not questions:
        continue
    
    # Tag with AI
    print(f"     Tagging {len(questions)} questions...")
    questions = tag_questions(questions, EXAM_NAME, tracker=tracker)
    
    # Build rows for DB
    rows = []
    seen_hashes = set()
    for q in questions:
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
            "source_pdf": filepath.name,
            "question_hash": qhash,
            "is_active": True,
        }
        if row["question_text"] and len(row["question_text"]) >= 10:
            if row["correct_answer"] not in "ABCD":
                row["correct_answer"] = "A"
            rows.append(row)
    
    # Store in Supabase
    if rows:
        for i in range(0, len(rows), 50):
            batch = rows[i:i+50]
            try:
                sb.table("questions").upsert(batch, on_conflict="question_hash").execute()
            except Exception as e:
                print(f"     ❌ DB error: {e}")
        total_stored += len(rows)
        print(f"     ✅ Stored {len(rows)} questions")
    
    # Generate explanations
    print(f"     Generating explanations...")
    expl = generate_explanations_bulk(EXAM_NAME, year, tracker=tracker)
    print(f"     Explanations: {expl.get('generated', 0)} new")

# Final report
tracker.print_summary()

print(f"\n{'='*60}")
print(f"  ✅ DONE!")
print(f"     Total stored: {total_stored} questions")
print(f"     Cost: ₹{tracker.total_inr()}")
print(f"\n  Final DB state:")
for year in [2020, 2021, 2022, 2023, 2024]:
    res = sb.table("questions").select("id", count="exact") \
        .eq("exam_name", EXAM_NAME).eq("exam_year", year).execute()
    count = res.count or 0
    status = "✅" if count == 100 else f"⚠️  {count}/100"
    print(f"     {year}: {status}")
total = sum(
    (sb.table("questions").select("id", count="exact")
     .eq("exam_name", EXAM_NAME).eq("exam_year", yr).execute()).count or 0
    for yr in [2020, 2021, 2022, 2023, 2024]
)
print(f"     TOTAL: {total}/500")
print(f"{'='*60}\n")
