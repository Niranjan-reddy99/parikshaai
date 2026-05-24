"""
parse_and_ingest.py — Parse UPSC text file using Gemini + store in DB

The text file has garbled two-column layout (left/right columns merged).
Regex can't handle this reliably. So we send the English text to Gemini
to extract structured questions.

Cost breakdown:
  - Gemini parsing:   ~₹1.50 (5 years × ₹0.30)
  - AI tagging:       ~₹0.10
  - Explanations:     ~₹0.50
  - TOTAL:            ~₹2.10

Run:
  python parse_and_ingest.py --dry     # show English text extraction only (₹0)
  python parse_and_ingest.py --nuke    # delete old + parse + tag + store (~₹2)
"""
import sys, os, re, hashlib, json, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import google.generativeai as genai
from dotenv import load_dotenv
load_dotenv()

from config import supabase as sb
from pipeline import CostTracker, tag_questions, generate_explanations_bulk

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

EXAM_NAME = "UPSC Prelims"
TEXT_FILE = "/Users/niranjan/Downloads/upsc 2024-2020.txt"
YEARS = [2020, 2021, 2022, 2023, 2024]

MODE = "dry"
if "--apply" in sys.argv or "--nuke" in sys.argv:
    MODE = "apply"
NUKE = "--nuke" in sys.argv

tracker = CostTracker()

# ── Hindi detection ──
_DEVANAGARI = re.compile(r'[\u0900-\u097F]')

PARSE_PROMPT = """You are parsing a UPSC Civil Services Preliminary Examination question paper.

The text below is GARBLED because it was extracted from a two-column PDF layout.
Questions and options from different columns are interleaved and mixed together.
Your job is to reconstruct ALL 100 questions correctly.

RULES:
- Extract ALL questions numbered 1 to 100
- Each question has exactly 4 options: (a), (b), (c), (d)
- Ignore all Hindi/Devanagari text completely
- Ignore page numbers, headers, footers, "KSPC-P-GSPO", "C.S. (P)" markers
- Reconstruct broken sentences by understanding the context
- Options may appear as "(a) text" or just "text" on separate lines
- Return ONLY valid JSON array, no markdown fences

OUTPUT FORMAT (JSON array):
[
  {
    "n": 1,
    "q": "Full question text here?",
    "a": "Option A text",
    "b": "Option B text",
    "c": "Option C text",
    "d": "Option D text"
  },
  ...
]

TEXT TO PARSE:
"""


def split_by_year(raw: str) -> dict[int, str]:
    """Split combined text file by year using C.S. (P) markers."""
    year_pattern = re.compile(r'C\.S\.\s*\(P\)\s*-\s*(20\d{2})')
    lines = raw.split('\n')
    
    year_first: dict[int, int] = {}
    for i, line in enumerate(lines):
        m = year_pattern.search(line)
        if m:
            yr = int(m.group(1))
            if yr not in year_first:
                year_first[yr] = i
    
    texts: dict[int, str] = {}
    sorted_yrs = sorted(year_first.keys(), key=lambda y: year_first[y])
    for idx, yr in enumerate(sorted_yrs):
        start = year_first[yr]
        end = year_first[sorted_yrs[idx + 1]] if idx + 1 < len(sorted_yrs) else len(lines)
        texts[yr] = '\n'.join(lines[start:end])
    
    return texts


def extract_english_pages(text: str) -> str:
    """Keep only English pages (skip Hindi pages)."""
    pages = text.split('\f')
    english = []
    
    for page in pages:
        page = page.strip()
        if not page or len(page) < 30:
            continue
        
        dev_count = len(_DEVANAGARI.findall(page))
        ascii_alpha = sum(1 for c in page if c.isascii() and c.isalpha())
        total = dev_count + ascii_alpha
        
        if total == 0:
            continue
        
        # Skip pages that are >25% Hindi
        if dev_count / total > 0.25:
            continue
        
        # Remove common noise
        cleaned = re.sub(r'C\.S\.\s*\(P\)\s*-\s*20\d{2}', '', page)
        cleaned = re.sub(r'KSPC-P-GSPO', '', cleaned)
        cleaned = re.sub(r'\(\d{1,2}-A\)', '', cleaned)
        cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
        
        if cleaned and len(cleaned) > 30:
            english.append(cleaned)
    
    return '\n\n'.join(english)


def parse_gemini_response(text: str) -> list[dict]:
    """Parse Gemini's JSON response into question dicts."""
    # Strip markdown fences if present
    text = text.strip()
    if text.startswith('```'):
        text = re.sub(r'^```(?:json)?\s*', '', text)
        text = re.sub(r'\s*```$', '', text)
    
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Try to find JSON array in the text
        match = re.search(r'\[.*\]', text, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
            except json.JSONDecodeError:
                return []
        else:
            return []
    
    questions = []
    for item in data:
        if not isinstance(item, dict):
            continue
        q_num = item.get("n") or item.get("number") or 0
        q_text = item.get("q") or item.get("text") or item.get("question") or ""
        
        if not q_text or q_num < 1 or q_num > 100:
            continue
        
        questions.append({
            "question_number": int(q_num),
            "question_text": q_text.strip(),
            "option_a": (item.get("a") or item.get("A") or "").strip(),
            "option_b": (item.get("b") or item.get("B") or "").strip(),
            "option_c": (item.get("c") or item.get("C") or "").strip(),
            "option_d": (item.get("d") or item.get("D") or "").strip(),
            "correct_answer": None,
        })
    
    return questions


def make_hash(q: dict) -> str:
    h = f"{(q.get('question_text') or '').strip().lower()}|{q.get('option_a','')}|{q.get('option_b','')}"
    return hashlib.sha256(h.encode()).hexdigest()


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

print(f"\n{'='*60}")
print(f"  PARSE & INGEST — {EXAM_NAME}")
print(f"  Mode: {MODE.upper()}{' (+ NUKE old data)' if NUKE else ''}")
print(f"{'='*60}\n")

# Step 1: Split by year
raw = Path(TEXT_FILE).read_text(encoding='utf-8')
year_texts = split_by_year(raw)

print("STEP 1 — Year detection + English extraction")
print("─" * 50)

english_texts: dict[int, str] = {}
for yr in sorted(year_texts.keys()):
    if yr not in YEARS:
        continue
    eng = extract_english_pages(year_texts[yr])
    english_texts[yr] = eng
    # Count tokens roughly (4 chars ≈ 1 token)
    est_tokens = len(eng) // 4
    print(f"  {yr}: {len(eng)} chars English text (~{est_tokens} tokens)")

if MODE == "dry":
    total_tokens = sum(len(t) // 4 for t in english_texts.values())
    est_cost = total_tokens * 0.075 / 1_000_000 * 85  # input INR
    est_cost += 500 * 75 / 1_000_000 * 0.30 * 85  # output est
    print(f"\n  Total input: ~{total_tokens} tokens")
    print(f"  Estimated Gemini parsing cost: ~₹{est_cost:.2f}")
    print(f"  + Tagging: ~₹0.10")
    print(f"  + Explanations: ~₹0.50")
    print(f"\n  Run: python parse_and_ingest.py --nuke")
    sys.exit(0)


# Step 2: Nuke old data if requested
if NUKE:
    print(f"\nSTEP 2 — Cleaning old data")
    print("─" * 50)
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
        print(f"  {year}: deleted {len(ids)} old questions")
    print("  ✅ Clean slate")


# Step 3: Parse with Gemini
print(f"\nSTEP 3 — Parsing with Gemini (₹0.30/year)")
print("─" * 50)

model = genai.GenerativeModel("gemini-2.5-flash-lite")
all_questions: dict[int, list] = {}

for year in sorted(english_texts.keys()):
    eng_text = english_texts[year]
    print(f"\n  📅 {year}: sending to Gemini...")
    
    prompt = PARSE_PROMPT + eng_text
    
    try:
        resp = model.generate_content(
            prompt,
            generation_config=genai.GenerationConfig(
                temperature=0.1,
                max_output_tokens=32768,
            ),
            request_options={"timeout": 180},
        )
        tracker.record_from_response(f"Parse {year}", resp)
        
        questions = parse_gemini_response(resp.text or "")
        
        # Dedup by number
        seen: dict[int, dict] = {}
        for q in questions:
            n = q["question_number"]
            if n not in seen or len(q["question_text"]) > len(seen[n]["question_text"]):
                seen[n] = q
        questions = sorted(seen.values(), key=lambda q: q["question_number"])
        
        all_questions[year] = questions
        
        found = sorted(q["question_number"] for q in questions)
        missing = [n for n in range(1, 101) if n not in found]
        
        if not missing:
            print(f"     ✅ {len(questions)}/100 — ALL questions extracted!")
        elif len(missing) <= 10:
            print(f"     ⚠️  {len(questions)}/100 — missing: {missing}")
        else:
            print(f"     ⚠️  {len(questions)}/100 — {len(missing)} missing")
        
        time.sleep(1)  # Rate limiting
        
    except Exception as e:
        print(f"     ❌ Error: {e}")
        all_questions[year] = []


# Step 3b: Retry for missing questions
for year in sorted(all_questions.keys()):
    qs = all_questions[year]
    found_nums = {q["question_number"] for q in qs}
    missing = sorted(n for n in range(1, 101) if n not in found_nums)
    
    if not missing or len(missing) > 30:
        continue
    
    print(f"\n  🔄 {year}: retrying for {len(missing)} missing questions...")
    
    retry_prompt = (
        f"From this UPSC {year} question paper text, extract ONLY questions numbered: {missing}\n"
        f"The text has garbled two-column layout. Return JSON array with same format as before.\n\n"
        f"TEXT:\n{english_texts[year]}"
    )
    
    try:
        resp = model.generate_content(
            retry_prompt,
            generation_config=genai.GenerationConfig(temperature=0.2, max_output_tokens=16384),
            request_options={"timeout": 120},
        )
        tracker.record_from_response(f"Retry {year}", resp)
        
        extra_qs = parse_gemini_response(resp.text or "")
        for q in extra_qs:
            if q["question_number"] in missing and q["question_number"] not in found_nums:
                qs.append(q)
                found_nums.add(q["question_number"])
        
        all_questions[year] = sorted(qs, key=lambda q: q["question_number"])
        still_missing = [n for n in range(1, 101) if n not in found_nums]
        
        if not still_missing:
            print(f"     ✅ Now {len(qs)}/100 — all recovered!")
        else:
            print(f"     {len(qs)}/100 — still missing: {still_missing}")
        
        time.sleep(1)
    except Exception as e:
        print(f"     ❌ Retry error: {e}")


# Step 4: Tag + Store + Explain
print(f"\nSTEP 4 — Tagging + Storing + Explanations")
print("─" * 50)

total_stored = 0
for year in sorted(all_questions.keys()):
    qs = all_questions[year]
    if not qs:
        print(f"  {year}: no questions — skipping")
        continue
    
    print(f"\n  📅 {year}: tagging {len(qs)} questions...")
    qs = tag_questions(qs, EXAM_NAME, tracker=tracker)
    
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
            "exam_name": EXAM_NAME,
            "exam_year": year,
            "source_pdf": "upsc 2024-2020.txt",
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
                print(f"    ❌ DB error: {e}")
        total_stored += len(rows)
        print(f"    ✅ Stored {len(rows)} questions")
    
    print(f"    Generating explanations...")
    expl = generate_explanations_bulk(EXAM_NAME, year, tracker=tracker)
    print(f"    Explanations: {expl.get('generated', 0)} new, {expl.get('skipped', 0)} existing")


# ══════════════════════════════════════════════════════════════════════════════
# FINAL REPORT
# ══════════════════════════════════════════════════════════════════════════════

tracker.print_summary()

print(f"\n{'='*60}")
print(f"  ✅ DONE!")
print(f"     Stored: {total_stored} questions")
print(f"     Cost:   ₹{tracker.total_inr()}")
print(f"\n  Final DB:")
total = 0
for year in YEARS:
    res = sb.table("questions").select("id", count="exact") \
        .eq("exam_name", EXAM_NAME).eq("exam_year", year).execute()
    count = res.count or 0
    total += count
    status = "✅" if count >= 95 else f"⚠️  {count}/100"
    print(f"    {year}: {status}")
print(f"    TOTAL: {total}/500")
print(f"{'='*60}\n")
