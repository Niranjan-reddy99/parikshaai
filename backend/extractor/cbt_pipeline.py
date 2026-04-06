"""
cbt_pipeline.py — CBT Exam Answer Key PDF Extractor
====================================================
Handles PDFs from Telegram channels (@EZSSC, @RankMitra, etc.) where:
  - LEFT  side: rendered IMAGE with ✓ (green = correct) / ✗ (red = wrong)
  - TEXT layer: question text + options (no color info)

Strategy:
  Step 1: detect_shifts()   — find shift boundaries from "Test Date:" headers (₹0)
  Step 2: extract_text()    — PyMuPDF text layer → Q text + 4 options (₹0)
  Step 3: extract_answers() — Gemini Vision on page image → correct option per Q (~₹0.40/390 pages)
  Step 4: merge()           — combine text questions with vision answers
  Step 5: tag_questions()   — subject/topic/difficulty via cheap model (reuse pipeline.py)
  Step 6: store_questions() — Supabase upsert with shift metadata (reuse pipeline.py)

Usage (CLI):
    python -m extractor.cbt_pipeline paper.pdf "AP High Court" 2025
    python -m extractor.cbt_pipeline part1.pdf "AP High Court" 2025 --dry-run

Works equally well on full 390-page PDFs or split 3-4 part PDFs.
Split PDFs are safe: cache is keyed by (pdf_hash + page_index).
"""
from __future__ import annotations

import io
import json
import os
import re
import sys
import time
import hashlib
import datetime
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY required in backend/.env")

genai.configure(api_key=GEMINI_API_KEY)

# Model for answer detection — flash-lite: cheapest vision model
_VISION_MODEL = genai.GenerativeModel("gemini-2.5-flash-lite")

CACHE_DIR = Path(__file__).parent.parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)

# DPI for page rendering — 150 is enough to see green/red colors clearly
_RENDER_DPI = 150
_MAT = fitz.Matrix(_RENDER_DPI / 72, _RENDER_DPI / 72)

# Cost tracking
_USD_TO_INR = 84
_INPUT_PRICE_PER_1M  = 0.10   # gemini-2.5-flash-lite USD
_OUTPUT_PRICE_PER_1M = 0.40


# ══════════════════════════════════════════════════════════════════════════════
# DATA CLASSES
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class ShiftInfo:
    test_date: str          # "24/08/2025"
    test_time: str          # "9:00 AM - 10:30 AM"
    subject: str            # "Common Test for Stenographer..."
    shift_label: str        # auto-generated: "24/08/2025 09:00 AM"
    start_page: int         # 0-indexed
    end_page: int           # 0-indexed inclusive


@dataclass
class CostTracker:
    steps: list[dict] = field(default_factory=list)
    total_input: int = 0
    total_output: int = 0

    def record(self, step: str, resp) -> None:
        try:
            meta = resp.usage_metadata
            inp = meta.prompt_token_count or 0
            out = meta.candidates_token_count or 0
        except Exception:
            inp, out = 0, 0
        self.total_input  += inp
        self.total_output += out
        cost_usd = (inp / 1_000_000 * _INPUT_PRICE_PER_1M +
                    out / 1_000_000 * _OUTPUT_PRICE_PER_1M)
        self.steps.append({"step": step, "in": inp, "out": out,
                           "inr": round(cost_usd * _USD_TO_INR, 5)})

    def total_inr(self) -> float:
        return round(sum(s["inr"] for s in self.steps), 4)

    def print_summary(self):
        print("\n" + "─" * 60)
        print("  CBT PIPELINE COST (vision for answers only)")
        print("─" * 60)
        for s in self.steps:
            print(f"  {s['step']:<35} in={s['in']:>6}  out={s['out']:>5}  ₹{s['inr']:.4f}")
        print(f"  {'─'*55}")
        print(f"  TOTAL: ₹{self.total_inr():.4f}  "
              f"(in={self.total_input:,}  out={self.total_output:,})")
        print("─" * 60)


# ══════════════════════════════════════════════════════════════════════════════
# RPM LIMITER — prevents 429 rate-limit errors on large PDFs
# ══════════════════════════════════════════════════════════════════════════════

class RPMLimiter:
    """Tracks API call timestamps and blocks when approaching rate limit."""
    def __init__(self, max_rpm: int = 13):
        self.max_rpm = max_rpm          # stay under free-tier 15 RPM
        self._timestamps: list[float] = []

    def wait(self) -> None:
        now = time.time()
        # Evict timestamps older than 60s
        self._timestamps = [t for t in self._timestamps if now - t < 60.0]
        if len(self._timestamps) >= self.max_rpm:
            # Sleep until the oldest call is 60s old
            sleep_for = 60.0 - (now - self._timestamps[0]) + 0.5
            if sleep_for > 0:
                print(f"  ⏳ RPM limit ({self.max_rpm}/min reached), "
                      f"waiting {sleep_for:.1f}s...")
                time.sleep(sleep_for)
        self._timestamps.append(time.time())


_RPM = RPMLimiter(max_rpm=13)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — SHIFT DETECTION  (free, PyMuPDF)
# ══════════════════════════════════════════════════════════════════════════════

# Matches: "Test Date  24/08/2025" or "Test Date: 24/08/2025"
_DATE_RE  = re.compile(r'Test\s*Date[:\s]+(\d{1,2}/\d{1,2}/\d{4})')
# Matches: "Test Time  9:00 AM - 10:30 AM"
_TIME_RE  = re.compile(r'Test\s*Time[:\s]+([\d:]+\s*[AP]M\s*[-–]\s*[\d:]+\s*[AP]M)',
                        re.IGNORECASE)
# Matches: "Subject  Common Test for..."
_SUBJ_RE  = re.compile(r'Subject\s*[:\s]+(.{10,150}?)(?:\n|$)')


def detect_shifts(pdf_path: str) -> list[ShiftInfo]:
    """
    Scan every page for Test Date / Test Time header blocks.
    Returns a list of ShiftInfo with page ranges for each shift.

    For a 390-page PDF with 5 days × 3 shifts = 15 shifts, this correctly
    identifies each shift's start/end page with zero API calls.
    """
    doc = fitz.open(pdf_path)
    total = len(doc)
    raw_shifts: list[dict] = []

    for i in range(total):
        text = doc[i].get_text("text")
        date_m = _DATE_RE.search(text)
        time_m = _TIME_RE.search(text)
        if date_m and time_m:
            subj_m = _SUBJ_RE.search(text)
            subject = subj_m.group(1).strip() if subj_m else ""
            test_time = time_m.group(1).strip()
            # Normalize time for label: "9:00 AM - 10:30 AM" → "09:00 AM"
            start_time = test_time.split("-")[0].strip().split("–")[0].strip()
            label = f"{date_m.group(1)} {start_time}"
            raw_shifts.append({
                "test_date": date_m.group(1),
                "test_time": test_time,
                "subject":   subject,
                "label":     label,
                "page":      i,
            })

    doc.close()

    if not raw_shifts:
        # No shift headers found — treat entire PDF as one shift
        print("  [shift] No shift headers found — treating as single shift")
        return [ShiftInfo(
            test_date="Unknown", test_time="Unknown",
            subject="Unknown", shift_label="Shift 1",
            start_page=0, end_page=total - 1,
        )]

    shifts: list[ShiftInfo] = []
    for idx, s in enumerate(raw_shifts):
        end = raw_shifts[idx + 1]["page"] - 1 if idx + 1 < len(raw_shifts) else total - 1
        shifts.append(ShiftInfo(
            test_date  = s["test_date"],
            test_time  = s["test_time"],
            subject    = s["subject"],
            shift_label= s["label"],
            start_page = s["page"],
            end_page   = end,
        ))

    print(f"  [shift] Detected {len(shifts)} shift(s):")
    for sh in shifts:
        pages = sh.end_page - sh.start_page + 1
        print(f"    • {sh.shift_label}  pages {sh.start_page+1}–{sh.end_page+1} ({pages} pages)")

    return shifts


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — TEXT EXTRACTION  (free, PyMuPDF)
# Parses question text + 4 options from the selectable text layer.
# Does NOT try to find correct answer — that's in the image only.
# ══════════════════════════════════════════════════════════════════════════════

# Section headers embedded in page text
_SECTION_RE = re.compile(r'Section\s*[:\s]+([A-Za-z][^\n]{3,80})', re.IGNORECASE)

# Question start: "Q.1", "Q. 1", "Q1" at start of line
_Q_RE = re.compile(r'Q\.?\s*(\d{1,3})\s+', re.MULTILINE)

# Options block: "Ans" followed by "1. ... 2. ... 3. ... 4. ..."
# Terminates at: next question, shift header lines, or end-of-string
_ANS_BLOCK_RE = re.compile(
    r'Ans\s+1\.\s*(.+?)\n\s*2\.\s*(.+?)\n\s*3\.\s*(.+?)\n\s*4\.\s*(.+?)'
    r'(?=\n\s*Q\.?\s*\d+|\n\s*Test\s+(?:Date|Time)|\n\s*AP\s+High|\n\s*TSPSC|\n\s*APPSC|\Z)',
    re.DOTALL
)

# Telegram handle/watermark patterns — strip before parsing
_TELEGRAM_RE = re.compile(
    r'(?:Join\s+(?:us\s+)?(?:on\s+)?(?:telegram\s+)?)?@[A-Za-z][A-Za-z0-9_]{2,}[\s,]*|'
    r't(?:elegram)?\.me/[A-Za-z][A-Za-z0-9_/]+[\s,]*|'
    r'(?:Download|Get|Follow|Subscribe)\s+(?:from\s+)?(?:on\s+)?@\S+[\s,]*|'
    r'(?:Telegram|TG)\s*[:\-]\s*@\S+[\s,]*',
    re.IGNORECASE
)

# Passage/direction intro patterns
_PASSAGE_INTRO_RE = re.compile(
    r'(?:Direction[s]?\s*[:\-]\s*|Note\s*[:\-]\s*)?'
    r'(?:Read\s+the\s+(?:following\s+)?passage|'
    r'Study\s+the\s+(?:following\s+)?passage|'
    r'Based\s+on\s+the\s+(?:following\s+)?passage|'
    r'The\s+following\s+passage\s+(?:is\s+)?(?:given|provided)|'
    r'Read\s+the\s+(?:following\s+)?text)',
    re.IGNORECASE
)


def _clean_noise(text: str) -> str:
    """Strip Telegram handles, exam headers, and page-number noise from text."""
    # Telegram watermarks
    text = _TELEGRAM_RE.sub("", text)
    # Exam header lines (AP High Court, Test Date/Time, Subject, channel names)
    text = re.sub(
        r'(?m)^(?:AP High Court[^\n]*|TSPSC[^\n]*|APPSC[^\n]*|SSC\s+Updates[^\n]*|'
        r'RankMitra[^\n]*|EZSSC[^\n]*|Test\s+(?:Date|Time)[^\n]*|'
        r'Subject\s*[:\s][^\n]*|Roll\s+No[^\n]*|Candidate[^\n]*)\n?',
        "", text, flags=re.IGNORECASE
    )
    # Standalone page numbers (lines that are just digits)
    text = re.sub(r'(?m)^\s*\d{1,3}\s*$\n?', "", text)
    return text.strip()


def _parse_page_questions(
    page_text: str,
    current_section: str,
    current_passage: str = "",
) -> tuple[list[dict], str, str]:
    """
    Parse questions from a single page's text layer.

    Returns (questions_list, updated_section_name, updated_passage).
    Questions have: question_number, question_text, option_a–d, passage, section.
    correct_answer is intentionally left None (filled by vision step).
    """
    # Strip noise first
    page_text = _clean_noise(page_text)

    # Update section if this page has a section header
    sec_m = _SECTION_RE.search(page_text)
    if sec_m:
        current_section = sec_m.group(1).strip()

    # Detect if this page introduces a new passage
    # Passage text = block before the first Q.N that matches a passage intro
    first_q_match = re.search(r'Q\.?\s*\d+\s+', page_text)
    preamble = page_text[:first_q_match.start()].strip() if first_q_match else ""

    if preamble and _PASSAGE_INTRO_RE.search(preamble):
        # Full preamble is the new passage (intro line + passage body)
        current_passage = re.sub(r'\s+', ' ', preamble).strip()
    elif preamble and len(preamble) > 150 and not first_q_match:
        # Long text block with no questions = likely a passage page
        current_passage = re.sub(r'\s+', ' ', preamble).strip()

    # Split page text into per-question chunks using Q.N as boundary
    chunks = re.split(r'(?=Q\.?\s*\d+\s+)', page_text)

    questions: list[dict] = []

    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue

        # Must start with Q.N
        q_m = _Q_RE.match(chunk)
        if not q_m:
            continue

        q_num = int(q_m.group(1))

        # Extract question text: between Q.N and Ans
        ans_pos = chunk.find("Ans")
        if ans_pos == -1:
            continue  # No options block — skip

        q_text_raw = chunk[q_m.end():ans_pos].strip()
        # Remove embedded section headers
        q_text_raw = re.sub(_SECTION_RE, "", q_text_raw).strip()
        # Strip any remaining noise lines
        q_text_raw = _clean_noise(q_text_raw)

        if not q_text_raw or len(q_text_raw) < 10:
            continue

        # Extract the 4 options from the Ans block
        ans_chunk = chunk[ans_pos:]
        opts_m = _ANS_BLOCK_RE.search(ans_chunk)

        opt_a = opt_b = opt_c = opt_d = ""
        if opts_m:
            opt_a = _clean_noise(opts_m.group(1).strip())
            opt_b = _clean_noise(opts_m.group(2).strip())
            opt_c = _clean_noise(opts_m.group(3).strip())
            opt_d = _clean_noise(opts_m.group(4).strip())
            # Clean trailing page numbers
            for _o in [opt_a, opt_b, opt_c, opt_d]:
                _o = re.sub(r'\s*\d{2,3}\s*$', '', _o).strip()

        if not opt_a:
            # Fallback: numbered list extraction
            nums = re.findall(r'(?:^|\n)\s*(\d)\.\s+(.+?)(?=\n\s*\d\.|\Z)',
                              ans_chunk, re.DOTALL)
            opt_map = {n: _clean_noise(t.strip()) for n, t in nums}
            opt_a = opt_map.get("1", "")
            opt_b = opt_map.get("2", "")
            opt_c = opt_map.get("3", "")
            opt_d = opt_map.get("4", "")

        if q_text_raw and len(q_text_raw) > 10 and (opt_a or opt_b):
            questions.append({
                "question_number": q_num,
                "question_text":   q_text_raw,
                "option_a": opt_a,
                "option_b": opt_b,
                "option_c": opt_c,
                "option_d": opt_d,
                "correct_answer":  None,   # filled by vision
                "exam_section":    current_section,
                "passage":         current_passage,   # empty string if no passage
                "needs_review":    not (opt_a and opt_b and opt_c and opt_d),
            })

    return questions, current_section, current_passage


def extract_text_questions(pdf_path: str, shift: ShiftInfo) -> list[dict]:
    """
    Extract all questions from text layer for a given shift's page range.
    Cost: ₹0 (pure PyMuPDF, no API calls).
    """
    doc = fitz.open(pdf_path)
    all_questions: list[dict] = []
    current_section = "General Knowledge"
    current_passage = ""

    for page_idx in range(shift.start_page, shift.end_page + 1):
        page = doc[page_idx]
        page_text = page.get_text("text")
        if not page_text.strip():
            continue
        qs, current_section, current_passage = _parse_page_questions(
            page_text, current_section, current_passage
        )
        all_questions.extend(qs)

    doc.close()

    # Deduplicate by question_number — keep longest question_text
    seen: dict[int, dict] = {}
    for q in all_questions:
        n = q["question_number"]
        if n not in seen or len(q["question_text"]) > len(seen[n]["question_text"]):
            seen[n] = q
    questions = sorted(seen.values(), key=lambda q: q["question_number"])

    print(f"  [text] Shift {shift.shift_label}: {len(questions)} questions extracted (₹0)")
    return questions


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — VISION ANSWER DETECTION  (~₹0.001 per page)
# Renders page as image, asks Gemini: "which option is green/ticked?"
# Returns {q_num: "A"|"B"|"C"|"D"} per page, cached to avoid re-paying.
# ══════════════════════════════════════════════════════════════════════════════

_ANSWER_PROMPT = """This is a page from an Indian state exam answer key PDF exported from a computer-based test (CBT).

Each question shows 4 answer options labeled 1, 2, 3, 4.
The CORRECT answer option is displayed in GREEN color with a ✓ (tick/checkmark) symbol.
The WRONG answer options are displayed in RED color with a ✗ (cross/X) symbol.

Your task: For EACH question visible on this page, identify which option number (1, 2, 3, or 4) is the CORRECT answer (the one shown in green with a tick).

Return ONLY a JSON array. No markdown, no explanation. Just raw JSON.
Format: [{"q": 1, "ans": 3}, {"q": 2, "ans": 1}, {"q": 3, "ans": 4}]

Rules:
- "q" = the question number (the number after "Q.")
- "ans" = 1, 2, 3, or 4 — the option shown in GREEN with a ✓ tick
- If the page has no questions (cover page, instructions), return: []
- If you cannot clearly see which option is green/ticked for a question, use null: {"q": 5, "ans": null}
"""

_NUM_TO_LETTER = {"1": "A", "2": "B", "3": "C", "4": "D",
                  1: "A", 2: "B", 3: "C", 4: "D"}


def _page_ans_cache_key(pdf_path: str, page_idx: int) -> Path:
    pdf_hash = hashlib.sha256(Path(pdf_path).read_bytes()).hexdigest()[:16]
    return CACHE_DIR / f"cbt_ans_{pdf_hash}_p{page_idx:04d}.json"


def _extract_answers_page(
    pdf_path: str,
    page_idx: int,
    page: fitz.Page,
    tracker: CostTracker,
    retries: int = 3,
) -> dict[int, Optional[str]]:
    """
    Returns {q_num: "A"|"B"|"C"|"D"|None} for all questions on this page.
    Cached per page — re-runs cost ₹0.
    """
    cache_file = _page_ans_cache_key(pdf_path, page_idx)
    if cache_file.exists():
        try:
            data = json.loads(cache_file.read_text())
            print(f"  [cache] page {page_idx+1}: {len(data)} answers")
            return {int(k): v for k, v in data.items()}
        except Exception:
            pass

    # Render page as image
    pix = page.get_pixmap(matrix=_MAT, colorspace=fitz.csRGB)
    png_bytes = pix.tobytes("png")
    image_part = {"mime_type": "image/png", "data": png_bytes}

    last_err = None
    for attempt in range(retries):
        try:
            _RPM.wait()
            resp = _VISION_MODEL.generate_content(
                [_ANSWER_PROMPT, image_part],
                generation_config=genai.GenerationConfig(
                    temperature=0.0, max_output_tokens=512
                ),
                request_options={"timeout": 60},
            )
            tracker.record(f"ans_p{page_idx+1}", resp)

            raw = (resp.text or "").strip()
            raw = re.sub(r"^```(?:json)?", "", raw).strip().rstrip("`").strip()

            if not raw or raw == "[]":
                cache_file.write_text("{}")
                return {}

            items = json.loads(raw)
            if not isinstance(items, list):
                raise ValueError(f"Expected list, got {type(items)}")

            result: dict[int, Optional[str]] = {}
            for item in items:
                q_num = item.get("q")
                ans_raw = item.get("ans")
                if q_num is None:
                    continue
                if ans_raw is None:
                    result[int(q_num)] = None
                else:
                    letter = _NUM_TO_LETTER.get(ans_raw)
                    result[int(q_num)] = letter  # None if unrecognised

            cache_file.write_text(json.dumps({str(k): v for k, v in result.items()}))
            n = len(result)
            print(f"  [vision] page {page_idx+1}: {n} answers detected")
            return result

        except json.JSONDecodeError as e:
            last_err = e
            print(f"  [warn] page {page_idx+1} JSON error (attempt {attempt+1}): {e}")
            # Retry at higher DPI for clearer color rendering
            if attempt == 0:
                mat2 = fitz.Matrix(200 / 72, 200 / 72)
                pix2 = page.get_pixmap(matrix=mat2, colorspace=fitz.csRGB)
                png_bytes = pix2.tobytes("png")
                image_part = {"mime_type": "image/png", "data": png_bytes}
            time.sleep(2 ** attempt)

        except Exception as e:
            last_err = e
            err_str = str(e)
            if "429" in err_str or "quota" in err_str.lower():
                wait = 60 * (attempt + 1)
                print(f"  ⏳ Rate limited. Waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"  [warn] page {page_idx+1} error (attempt {attempt+1}): {e}")
                time.sleep(2 ** attempt)

    print(f"  [error] page {page_idx+1} failed after {retries} attempts: {last_err}")
    cache_file.write_text("{}")
    return {}


def extract_answers_vision(
    pdf_path: str,
    shift: ShiftInfo,
    tracker: CostTracker,
    progress_callback=None,
) -> dict[int, Optional[str]]:
    """
    Run vision answer detection for all pages in a shift.
    Returns merged {q_num: "A"|"B"|"C"|"D"|None} for the entire shift.
    """
    doc = fitz.open(pdf_path)
    all_answers: dict[int, Optional[str]] = {}
    total_pages = shift.end_page - shift.start_page + 1

    for i, page_idx in enumerate(range(shift.start_page, shift.end_page + 1)):
        page_answers = _extract_answers_page(
            pdf_path, page_idx, doc[page_idx], tracker
        )
        # Merge: if same q_num appears on multiple pages (shouldn't happen), keep first
        for q_num, letter in page_answers.items():
            if q_num not in all_answers:
                all_answers[q_num] = letter

        if progress_callback:
            progress_callback(i + 1, total_pages)

    doc.close()

    found = sum(1 for v in all_answers.values() if v is not None)
    print(f"  [vision] Shift {shift.shift_label}: "
          f"{found}/{len(all_answers)} answers detected")
    return all_answers


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — MERGE text questions with vision answers
# ══════════════════════════════════════════════════════════════════════════════

def merge_questions_answers(
    questions: list[dict],
    answers: dict[int, Optional[str]],
    shift: ShiftInfo,
) -> list[dict]:
    """
    Inject correct_answer from vision into text-extracted questions.
    Also stamps each question with shift metadata.
    """
    merged = []
    no_ans = 0

    for q in questions:
        q_num = q["question_number"]
        answer = answers.get(q_num)

        if answer is None:
            no_ans += 1

        q_merged = {
            **q,
            "correct_answer": answer or "A",   # 'A' placeholder if unknown
            "needs_review":   (answer is None) or q.get("needs_review", False),
            # Shift metadata
            "shift_label":    shift.shift_label,
            "test_date":      shift.test_date,
            "test_time":      shift.test_time,
        }
        merged.append(q_merged)

    if no_ans:
        print(f"  [merge] {no_ans}/{len(questions)} questions have no detected answer "
              f"(marked needs_review=True)")
    return merged


# ══════════════════════════════════════════════════════════════════════════════
# MAIN PIPELINE FUNCTION
# ══════════════════════════════════════════════════════════════════════════════

def run_cbt_pipeline(
    pdf_path: str,
    exam_name: str,
    exam_year: int,
    dry_run: bool = False,
    specific_shift_idx: Optional[int] = None,
) -> dict:
    """
    Full CBT pipeline: shift detection → text extract → vision answers → tag → store.

    Args:
        pdf_path:           Path to the PDF (full or split part).
        exam_name:          e.g. "AP High Court Subordinate Posts"
        exam_year:          e.g. 2025
        dry_run:            If True, extract and tag but don't insert to DB.
        specific_shift_idx: Process only this shift index (0-based). None = all shifts.

    Returns:
        {"inserted": N, "skipped": N, "shifts_processed": N, "total_cost_inr": X}
    """
    pdf_path = str(Path(pdf_path).resolve())
    tracker = CostTracker()

    print(f"\n{'='*60}")
    print(f"  CBT PIPELINE — {exam_name} {exam_year}")
    print(f"  PDF: {Path(pdf_path).name}")
    print(f"{'='*60}")

    # ── Step 1: Detect shifts ──────────────────────────────────────────────
    print("\n[1/5] Detecting shifts...")
    shifts = detect_shifts(pdf_path)

    if specific_shift_idx is not None:
        if specific_shift_idx >= len(shifts):
            raise ValueError(f"shift_idx {specific_shift_idx} out of range "
                             f"(found {len(shifts)} shifts)")
        shifts = [shifts[specific_shift_idx]]
        print(f"  Processing only shift {specific_shift_idx}: {shifts[0].shift_label}")

    total_inserted = 0
    total_skipped  = 0

    for shift_num, shift in enumerate(shifts, 1):
        print(f"\n{'─'*60}")
        print(f"  SHIFT {shift_num}/{len(shifts)}: {shift.shift_label}")
        print(f"  Pages: {shift.start_page+1}–{shift.end_page+1} | "
              f"Subject: {shift.subject[:60]}")
        print(f"{'─'*60}")

        # ── Step 2: Extract text questions ────────────────────────────────
        print("\n[2/5] Extracting text (questions + options)...")
        questions = extract_text_questions(pdf_path, shift)

        if not questions:
            print(f"  [skip] No questions found for shift {shift.shift_label}")
            continue

        # ── Step 3: Vision answer detection ───────────────────────────────
        print(f"\n[3/5] Vision answer detection ({shift.end_page - shift.start_page + 1} pages)...")
        answers = extract_answers_vision(pdf_path, shift, tracker)

        # ── Step 4: Merge ─────────────────────────────────────────────────
        print("\n[4/5] Merging questions + answers...")
        merged = merge_questions_answers(questions, answers, shift)

        if dry_run:
            print(f"\n  [dry-run] {len(merged)} questions — NOT inserting to DB")
            print(f"  Sample:")
            for q in merged[:2]:
                print(f"    Q{q['question_number']}: {q['question_text'][:60]}...")
                print(f"      Answer: {q['correct_answer']} | "
                      f"needs_review: {q['needs_review']}")
            continue

        # ── Step 5: Tag with cheap model ───────────────────────────────────
        print(f"\n[5a/5] Tagging {len(merged)} questions...")
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from pipeline import tag_questions, store_questions, CostTracker as PipelineTracker

        tag_tracker = PipelineTracker()
        tagged = tag_questions(merged, exam_name, tracker=tag_tracker)

        # ── Step 6: Store to Supabase ──────────────────────────────────────
        print(f"\n[5b/5] Storing to Supabase...")
        result = store_questions(tagged, pdf_path, exam_name, exam_year)
        total_inserted += result.get("inserted", 0)
        total_skipped  += result.get("skipped", 0)
        print(f"  Shift {shift.shift_label}: "
              f"inserted={result.get('inserted', 0)}, "
              f"skipped={result.get('skipped', 0)}")

    # ── Cost summary ───────────────────────────────────────────────────────
    tracker.print_summary()
    print(f"\n  Shifts processed:  {len(shifts)}")
    print(f"  Total inserted:    {total_inserted}")
    print(f"  Total skipped:     {total_skipped}")

    return {
        "inserted":         total_inserted,
        "skipped":          total_skipped,
        "shifts_processed": len(shifts),
        "total_cost_inr":   tracker.total_inr(),
    }


# ══════════════════════════════════════════════════════════════════════════════
# CLI ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════════════════════════════
# BACKGROUND JOB WRAPPER  (called by FastAPI upload endpoint)
# ══════════════════════════════════════════════════════════════════════════════

def process_cbt_job_background(
    job_id: str,
    pdf_path: str,
    exam_name: str,
    exam_year: int,
    shift_label_override: Optional[str] = None,
) -> None:
    """
    Background thread entry point — mirrors process_job_background() in pipeline.py.
    Updates job progress/status in Supabase as the pipeline runs.
    """
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from config import supabase as sb

    def _upd(progress: Optional[int] = None, status: Optional[str] = None, error: Optional[str] = None):
        data: dict = {}
        if progress is not None:
            data["progress"] = progress
        if status:
            data["status"] = status
        if error:
            data["error_log"] = error
        if data:
            try:
                sb.table("jobs").update(data).eq("id", job_id).execute()
            except Exception:
                pass

    try:
        _upd(progress=2, status="processing")

        # Step 1: detect shifts
        _upd(progress=5)
        shifts = detect_shifts(pdf_path)

        # Apply manual shift label override when:
        # - Only one shift (split PDF / single-shift upload), OR
        # - Auto-detection returned "Unknown" (no headers found)
        if shift_label_override:
            if len(shifts) == 1 or shifts[0].shift_label in ("Shift 1", "Unknown"):
                for sh in shifts:
                    sh.shift_label = shift_label_override

        tracker = CostTracker()
        total_inserted = 0
        total_skipped  = 0
        n_shifts = len(shifts)

        for shift_num, shift in enumerate(shifts, 1):
            shift_base_progress = 10 + int(80 * (shift_num - 1) / n_shifts)
            shift_end_progress  = 10 + int(80 * shift_num / n_shifts)

            # Step 2: text extraction (free)
            _upd(progress=shift_base_progress + 2)
            questions = extract_text_questions(pdf_path, shift)
            if not questions:
                continue

            # Step 3: vision answers — update progress per page
            total_pages = shift.end_page - shift.start_page + 1
            vision_budget = int((shift_end_progress - shift_base_progress) * 0.6)

            def _vision_progress(done: int, total: int):
                p = shift_base_progress + 5 + int(vision_budget * done / max(total, 1))
                _upd(progress=min(p, shift_end_progress - 5))

            answers = extract_answers_vision(pdf_path, shift, tracker,
                                             progress_callback=_vision_progress)

            # Step 4: merge
            merged = merge_questions_answers(questions, answers, shift)

            # Step 5a: tag
            _upd(progress=shift_end_progress - 4)
            from pipeline import tag_questions, store_questions, CostTracker as _PCT
            tag_tracker = _PCT()
            tagged = tag_questions(merged, exam_name, tracker=tag_tracker)

            # Step 5b: store
            _upd(progress=shift_end_progress - 1)
            result = store_questions(tagged, pdf_path, exam_name, exam_year)
            total_inserted += result.get("inserted", 0)
            total_skipped  += result.get("skipped", 0)

        _upd(progress=100, status="completed")
        print(f"[CBT job {job_id}] done — inserted={total_inserted}, "
              f"skipped={total_skipped}, cost=₹{tracker.total_inr():.4f}")

    except Exception as e:
        import traceback
        print(f"[CBT job {job_id}] FAILED: {e}\n{traceback.format_exc()}")
        try:
            sb.table("jobs").update({
                "status": "failed", "error_log": str(e)
            }).eq("id", job_id).execute()
        except Exception:
            pass
    finally:
        try:
            os.unlink(pdf_path)
        except Exception:
            pass


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(
        description="CBT Answer Key PDF extractor (green/red color detection)"
    )
    ap.add_argument("pdf",       help="Path to PDF")
    ap.add_argument("exam_name", help='e.g. "AP High Court Subordinate Posts"')
    ap.add_argument("year",      type=int, help="Exam year e.g. 2025")
    ap.add_argument("--dry-run", action="store_true",
                    help="Extract and show sample, do not insert to DB")
    ap.add_argument("--shift",   type=int, default=None,
                    help="Process only this shift index (0-based)")
    args = ap.parse_args()

    result = run_cbt_pipeline(
        pdf_path    = args.pdf,
        exam_name   = args.exam_name,
        exam_year   = args.year,
        dry_run     = args.dry_run,
        specific_shift_idx = args.shift,
    )

    print(f"\nDone: {result}")
