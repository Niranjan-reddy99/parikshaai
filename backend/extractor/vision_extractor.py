"""
vision_extractor.py — Gemini Vision extraction for Final Key PDFs
=================================================================
Use this for exam papers where correct answers are indicated VISUALLY
(rectangles/boxes drawn around the correct option number) rather than
listed in a separate key.

Typical use: APPSC Final Key PDFs with boxed answer options.

Cost (Gemini 2.0 Flash, 50-page paper):
  ~50 pages × ~800 image tokens = 40k tokens → ~$0.004 input
  Output JSON for 150 questions          → ~$0.006
  TOTAL: ~$0.01–0.02 per paper

Usage (CLI):
    python -m extractor.vision_extractor "paper.pdf" "APPSC Group II" 2025 --series A

Usage (as library):
    from extractor.vision_extractor import extract_with_vision
    questions = extract_with_vision("paper.pdf", "APPSC Group II", 2025, series="A")
"""
from __future__ import annotations

import datetime
import io
import json
import os
import re
import sys
import time
import hashlib
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
from ai_models import EXTRACTION_MODEL, get_genai_client
from dotenv import load_dotenv
from google.genai import types
from extraction_cleanup import clean_and_dedupe_questions

load_dotenv()

_CLIENT = get_genai_client()

# Use the same known-good Vertex model family as the universal extractor.
# The old 1.5-flash-002 publisher path is not available in this project and
# causes page-by-page 404s that surface as "No questions extracted from PDF".
VISION_MODEL = EXTRACTION_MODEL

CACHE_DIR = Path(__file__).parent.parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)

USD_TO_INR = 84
# gemini-2.0-flash pricing
_VISION_INPUT_PER_1M  = 0.10    # USD
_VISION_OUTPUT_PER_1M = 0.40    # USD


# ── Cost tracker (mirrors pipeline.py CostTracker) ───────────────────────────

class _VisionCostTracker:
    def __init__(self):
        self.steps: list[dict] = []
        self.total_input_tokens = 0
        self.total_output_tokens = 0

    def record(self, step: str, resp) -> None:
        try:
            meta = resp.usage_metadata
            inp = meta.prompt_token_count or 0
            out = meta.candidates_token_count or 0
        except Exception:
            inp, out = 0, 0
        self.total_input_tokens += inp
        self.total_output_tokens += out
        cost_usd = (inp / 1_000_000 * _VISION_INPUT_PER_1M +
                    out / 1_000_000 * _VISION_OUTPUT_PER_1M)
        self.steps.append({
            "step": step, "input_tokens": inp, "output_tokens": out,
            "cost_usd": cost_usd, "cost_inr": cost_usd * USD_TO_INR, "cached": False,
        })

    def total_inr(self) -> float:
        return round(sum(s["cost_inr"] for s in self.steps), 4)

    def print_summary(self):
        print("\n" + "─" * 60)
        print("💰 VISION EXTRACTION COST BREAKDOWN")
        print("─" * 60)
        print(f"  {'Step':<30} {'In tok':>8} {'Out tok':>9} {'₹ Cost':>9}")
        print(f"  {'─'*30} {'─'*8} {'─'*9} {'─'*9}")
        for s in self.steps:
            print(f"  {s['step']:<30} {s['input_tokens']:>8,} {s['output_tokens']:>9,} ₹{s['cost_inr']:.4f}")
        print(f"  {'─'*30} {'─'*8} {'─'*9} {'─'*9}")
        print(f"  {'VISION TOTAL':<30} {self.total_input_tokens:>8,} {self.total_output_tokens:>9,} ₹{self.total_inr():>8.4f}")
        print("─" * 60)

    def save_log(self, exam_name: str, year: int, num_questions: int, extra_steps: Optional[list] = None):
        log_path = CACHE_DIR / "cost_log.json"
        try:
            existing = json.loads(log_path.read_text()) if log_path.exists() else []
        except Exception:
            existing = []
        all_steps = self.steps + (extra_steps or [])
        total = sum(s.get("cost_inr", 0) for s in all_steps if not s.get("cached"))
        existing.append({
            "timestamp": datetime.datetime.now().isoformat(timespec="seconds"),
            "exam": f"{exam_name} {year}",
            "questions": num_questions,
            "total_inr": round(total, 4),
            "steps": all_steps,
        })
        log_path.write_text(json.dumps(existing, indent=2, ensure_ascii=False))
        print(f"  📋 Cost log saved → cache/cost_log.json")


# DPI for page rendering — bumped to 250 DPI for APPSC Boxed (dense Telugu + English + Match the Following)
# This significantly drops hallucination/missing option rates on complex tables
RENDER_DPI = 250
MAT = fitz.Matrix(RENDER_DPI / 72, RENDER_DPI / 72)


# ── Prompt ────────────────────────────────────────────────────────────────────

EXTRACTION_PROMPT = """You are an expert AI data extractor parsing an exam paper (APPSC / TSPSC / AP High Court Final Key PDF).

═══ FORMAT DETECTION (read this first) ═══
• Numbered options format: Options are labeled 1. 2. 3. 4. — output keys "1","2","3","4"
• Lettered options format: Options are labeled A. B. C. D. (or (A)(B)(C)(D)) — output keys "1","2","3","4" mapping A→1, B→2, C→3, D→4
• APPSC Final Key: correct answer shown by a RECTANGLE or BOX drawn around one option number
• Telegram CBT key: correct answer shown by green ✓ tick or checkmark beside an option
• Detect which format applies and extract accordingly — do NOT mix both formats

═══ CRITICAL RULES — FAILURE IS NOT AN OPTION ═══
1. LANGUAGE: Extract questions in ENGLISH ONLY. Skip Telugu/regional text entirely.
2. CORRECT ANSWER: Find the visually marked option (boxed rectangle OR green tick) and set "correct" to that option number (1/2/3/4). If no mark is visible, set "correct": null and "needs_review": true.
3. BLANK/COVER PAGES: If the page is blank, "ROUGH WORK", or a pure instruction page, return [].
4. MATCH THE FOLLOWING — FATAL ERROR PREVENTION:
   - Extract EXACTLY 4 distinct options. NEVER combine or merge Option 3 and Option 4.
   - Never drop pairings. Options must look like "1-A, 2-B, 3-C, 4-D" or "A-I, B-II, C-III, D-IV".
   - All 4 options must be present and non-empty.
5. ASSERTION-REASON: Extract the A and R statements completely with their labels. All 4 code options (e.g., "Both A and R are true") must be present.
6. CROSS-PAGE QUESTIONS (most important change):
   - If a question's TEXT is visible but OPTIONS are cut off at the bottom of the page:
     → Extract the question text and whatever options ARE visible.
     → Set "needs_review": true and "correct": null.
     → DO NOT skip the question — a partial extraction is better than losing it.
   - If only the tail end of a previous question's options appear at the top:
     → Skip those trailing lines (they belong to the previous page).
7. COUNT ACCURACY: The number of JSON objects MUST equal the number of distinct English question stems on this page. Never invent questions.
8. MULTI-LINE OPTIONS: Join multi-line option text into one continuous string.

═══ OUTPUT SCHEMA ═══
Return ONLY a valid JSON array — no markdown fences, no explanation text.
Each element:
{
  "q_num": <integer — the question number printed on the page>,
  "question": "<complete English question text as one string>",
  "options": {
    "1": "<option text>",
    "2": "<option text>",
    "3": "<option text>",
    "4": "<option text or empty string if cut off>"
  },
  "correct": "<1|2|3|4 or null if not determinable>",
  "has_image": <true if a diagram/figure/table is part of the question, else false>,
  "needs_review": <true if answer is uncertain OR options are incomplete, else false>
}

If no questions are on this page, return: []
"""


# ── Cache helpers ─────────────────────────────────────────────────────────────

def _page_cache_key(pdf_path: str, page_idx: int) -> str:
    pdf_hash = hashlib.sha256(Path(pdf_path).read_bytes()).hexdigest()[:16]
    return f"vision_v2_{pdf_hash}_p{page_idx:04d}.json"


def _load_page_cache(pdf_path: str, page_idx: int) -> Optional[list]:
    key = _page_cache_key(pdf_path, page_idx)
    cache_file = CACHE_DIR / key
    if cache_file.exists():
        try:
            data = json.loads(cache_file.read_text())
            if isinstance(data, list):
                for item in data:
                    if not isinstance(item, dict):
                        continue
                    q_text = str(item.get("question") or "")
                    if "EXTRACTION_FAILED" in q_text or item.get("q_num") == -1:
                        return None
            return data
        except Exception:
            return None
    return None


def _save_page_cache(pdf_path: str, page_idx: int, data: list) -> None:
    key = _page_cache_key(pdf_path, page_idx)
    (CACHE_DIR / key).write_text(json.dumps(data, ensure_ascii=False, indent=2))


# ── Core extraction ───────────────────────────────────────────────────────────

def _render_page_png(page: fitz.Page) -> bytes:
    """Render a PDF page to PNG bytes at RENDER_DPI."""
    pixmap = page.get_pixmap(matrix=MAT, colorspace=fitz.csRGB)
    return pixmap.tobytes("png")


_GENERATION_CONFIG = {
    "temperature": 0.0,
    "max_output_tokens": 4096,
}


def _extract_page(
    pdf_path: str,
    page_idx: int,
    page: fitz.Page,
    tracker: Optional[_VisionCostTracker] = None,
    retries: int = 3,
) -> list[dict]:
    """Extract questions from a single page using Gemini Vision.
    Returns list of question dicts, possibly empty if page has no questions.
    """
    cached = _load_page_cache(pdf_path, page_idx)
    if cached is not None:
        print(f"  [cache] page {page_idx + 1} — {len(cached)} questions")
        return cached

    png_bytes = _render_page_png(page)
    image_part = types.Part.from_bytes(data=png_bytes, mime_type="image/png")

    last_err = None
    for attempt in range(retries):
        try:
            resp = _CLIENT.models.generate_content(
                model=VISION_MODEL,
                contents=[EXTRACTION_PROMPT, image_part],
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    max_output_tokens=4096,
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )
            if tracker:
                tracker.record(f"Vision p{page_idx + 1}", resp)

            raw = resp.text.strip()
            # Strip markdown code fences if present
            raw = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
            raw = re.sub(r'\s*```$', '', raw, flags=re.MULTILINE)
            raw = raw.strip()

            if not raw or raw == "[]":
                _save_page_cache(pdf_path, page_idx, [])
                return []

            questions = json.loads(raw)
            if not isinstance(questions, list):
                raise ValueError(f"Expected list, got {type(questions)}")

            _save_page_cache(pdf_path, page_idx, questions)
            print(f"  [vision] page {page_idx + 1} — {len(questions)} questions extracted")
            return questions

        except json.JSONDecodeError as e:
            last_err = e
            print(f"  [warn] page {page_idx + 1} JSON parse error (attempt {attempt + 1}): {e}")
            # On retry, increase DPI for clearer image
            if attempt == 0:
                mat_hd = fitz.Matrix(200 / 72, 200 / 72)
                pixmap = page.get_pixmap(matrix=mat_hd, colorspace=fitz.csRGB)
                png_bytes = pixmap.tobytes("png")
                image_part = {"mime_type": "image/png", "data": png_bytes}
            time.sleep(2 ** attempt)

        except Exception as e:
            last_err = e
            print(f"  [warn] page {page_idx + 1} error (attempt {attempt + 1}): {e}")
            time.sleep(2 ** attempt)

    # All retries failed — do not poison cache with fake placeholder questions.
    print(f"  [error] page {page_idx + 1} failed after {retries} attempts: {last_err}")
    return []


# ── Option normalisation (1/2/3/4 → A/B/C/D) ─────────────────────────────────

_OPTION_MAP = {"1": "A", "2": "B", "3": "C", "4": "D",
               "A": "A", "B": "B", "C": "C", "D": "D"}


def _normalise_question(raw: dict, exam_name: str, year: int, series: str) -> Optional[dict]:
    """Convert raw vision output to the pipeline.py / Supabase schema.

    pipeline.py expects: question_text, option_a, option_b, option_c, option_d,
                         correct_answer (A/B/C/D), subject, topic, difficulty, question_number
    """
    try:
        q_num = raw.get("q_num")
        question_text = (raw.get("question") or "").strip()
        if not question_text or len(question_text) < 5:
            return None

        opts_raw = raw.get("options") or {}
        # Accept {1:..., 2:..., 3:..., 4:...} or {A:..., B:..., C:..., D:...}
        mapped: dict[str, str] = {}
        for k, v in opts_raw.items():
            norm_k = _OPTION_MAP.get(str(k).strip().upper())
            if norm_k:
                mapped[norm_k] = str(v).strip()

        partial = len(mapped) < 4  # cross-page question with cut-off options

        correct_raw = str(raw.get("correct") or "").strip()
        answer = _OPTION_MAP.get(correct_raw.upper()) if correct_raw else None

        return {
            # ── pipeline.py / Supabase column names ──────────────────────────
            "question_text": question_text,
            "option_a": mapped.get("A", ""),
            "option_b": mapped.get("B", ""),
            "option_c": mapped.get("C", ""),
            "option_d": mapped.get("D", ""),
            "correct_answer": answer or "",   # empty = needs_review
            "question_number": q_num,
            "subject": "Unclassified",        # filled by tag_questions()
            "topic": "Unclassified",
            "subtopic": None,
            "difficulty": "Medium",
            # ── extra metadata ────────────────────────────────────────────────
            "has_image": bool(raw.get("has_image")),
            "needs_review": bool(raw.get("needs_review")) or answer is None or partial,
            "series": series,
        }
    except Exception as e:
        print(f"  [warn] normalise error: {e} | raw={raw}")
        return None


# ── Main entry point ──────────────────────────────────────────────────────────

def extract_with_vision(
    pdf_path: str,
    exam_name: str,
    year: int,
    series: str = "",
    start_page: int = 0,
    end_page: Optional[int] = None,
    tracker: Optional[_VisionCostTracker] = None,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> list[dict]:
    """
    Extract questions from a Final Key / Answer Key PDF using Gemini Vision.

    Args:
        pdf_path:   Path to the PDF file.
        exam_name:  e.g. "APPSC Group II Mains Paper I"
        year:       e.g. 2025
        series:     Paper series letter, e.g. "A" (stored but not required)
        start_page: 0-indexed first page to process (default 0)
        end_page:   0-indexed exclusive end page (default = all pages)
        tracker:    Optional cost tracker (created internally if None)

    Returns:
        List of question dicts ready for tagging + DB insert.
    """
    pdf_path = str(Path(pdf_path).resolve())
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    end_page = end_page or total_pages

    print(f"\n[vision] {exam_name} {year} — {total_pages} pages total, processing {start_page+1}–{end_page}")
    print(f"[vision] Model: {VISION_MODEL} | DPI: {RENDER_DPI} | Thinking: OFF")

    all_questions: list[dict] = []

    total_pages_to_process = min(end_page, total_pages) - start_page
    for page_idx in range(start_page, min(end_page, total_pages)):
        page = doc[page_idx]
        raw_qs = _extract_page(pdf_path, page_idx, page, tracker=tracker)

        for raw in raw_qs:
            q = _normalise_question(raw, exam_name, year, series)
            if q:
                q["_page_idx"] = page_idx
                all_questions.append(q)

        if progress_callback:
            progress_callback(page_idx - start_page + 1, total_pages_to_process)

        # Rate limit: ~2 requests/sec to stay under free-tier limits
        # Remove this sleep if you're on a paid plan
        time.sleep(0.5)

    doc.close()

    deduped = clean_and_dedupe_questions(all_questions)

    needs_review_count = sum(1 for q in deduped if q.get("needs_review"))
    no_answer_count = sum(1 for q in deduped if not q.get("correct_answer"))

    print(f"\n[vision] Extracted {len(deduped)} questions")
    print(f"[vision] Needs review: {needs_review_count} | No answer detected: {no_answer_count}")

    return deduped


# ── Background job entry point (for FastAPI upload endpoint) ──────────────────

def process_vision_job_background(
    job_id: str,
    pdf_path: str,
    exam_name: str,
    exam_year: int,
    series: str = "",
) -> None:
    """
    Drop-in replacement for pipeline.process_job_background when use_vision=True.
    Updates the jobs table with progress/status as it runs.
    """
    import sys
    import traceback
    sys.path.insert(0, str(Path(__file__).parent.parent))

    try:
        from config import supabase  # type: ignore
        from papers import mark_paper_lifecycle, paper_id_for_job, should_delete_pdf_after_job
        from pipeline import tag_questions, store_questions  # type: ignore
        from typing import Optional, Callable
    except ImportError as e:
        print(f"[vision-job] Import error: {e}")
        print(traceback.format_exc())
        return

    def _update(status: str, progress: int, error: str = "") -> None:
        payload: dict = {"status": status, "progress": progress}
        if error:
            payload["error_log"] = error
        try:
            supabase.table("jobs").update(payload).eq("id", job_id).execute()
        except Exception as ue:
            print(f"[vision-job] DB update error: {ue}")

    try:
        _update("processing", 5)
        print(f"[vision-job] Starting job {job_id[:12]} — PDF: {pdf_path}")
        
        doc = fitz.open(pdf_path)
        total_pages = len(doc)
        doc.close()
        print(f"[vision-job] PDF has {total_pages} pages")

        # --- Vision extraction with progress ---
        _update("processing", 10, "Starting page extraction...")
        tracker = _VisionCostTracker()
        
        def _vision_progress(current_page: int, num_pages: int) -> None:
            # Map 0 -> nums_pages to 10% -> 60%
            pct = 10 + int(50 * (current_page / max(1, num_pages)))
            _update("processing", pct, f"Vision extracting page {current_page} of {num_pages}...")
            
        # Use extract_with_vision and update progress smoothly
        questions = extract_with_vision(
            pdf_path, exam_name, exam_year, series=series, tracker=tracker,
            progress_callback=_vision_progress
        )
        _update("processing", 60, "Vision extraction complete.")
        print(f"[vision-job] Vision extracted {len(questions)} questions")

        # Hard sanity gate: a large exam paper should never "successfully"
        # complete with only a tiny handful of extracted rows.
        if total_pages >= 20 and len(questions) < 20:
            _update("failed", 0, f"Suspiciously low extraction count: {len(questions)} questions from {total_pages} pages")
            print(f"[vision-job] FAILED — suspiciously low extraction count ({len(questions)} from {total_pages} pages)")
            return

        if not questions:
            _update("failed", 0, "No questions extracted from PDF")
            print(f"[vision-job] FAILED — no questions found in PDF")
            return

        # --- AI tagging ---
        from pipeline import CostTracker as PipelineCostTracker, repair_structurally_broken_rows  # type: ignore
        tag_tracker = PipelineCostTracker()
        print(f"\n[vision-job] Tagging {len(questions)} questions...")
        tagged = tag_questions(questions, exam_name, tracker=tag_tracker)
        _update("processing", 80)

        # --- DB insert ---
        print(f"\n[vision-job] Inserting {len(tagged)} questions to Supabase...")
        result = store_questions(tagged, pdf_path, exam_name, exam_year, job_id=job_id)
        inserted = result.get("inserted", 0)
        skipped = result.get("skipped", 0)
        print(f"[vision-job] Done — inserted: {inserted}, skipped: {skipped}")

        repair_result = repair_structurally_broken_rows(
            pdf_path,
            exam_name,
            exam_year,
            job_id=job_id,
            tracker=tag_tracker,
        )
        if repair_result.get("targeted"):
            print(
                f"[vision-job] Broken-row repair recovered {repair_result.get('recovered', 0)}/"
                f"{repair_result.get('targeted', 0)} targeted rows"
            )
        tracker.save_log(exam_name, exam_year, inserted, extra_steps=tag_tracker.steps)

        # ── Detect missing question numbers and report in admin dashboard ─────
        missing_log = ""
        try:
            stored_res = supabase.table("questions").select("question_number").eq("exam_name", exam_name).eq("exam_year", exam_year).execute()
            all_qns = [r["question_number"] for r in (stored_res.data or []) if isinstance(r.get("question_number"), int)]
            if all_qns:
                max_qn = max(all_qns)
                if max_qn > 0:
                    extracted_set = set(all_qns)
                    missing_nums = [str(i) for i in range(1, max_qn + 1) if i not in extracted_set]
                    if missing_nums:
                        missing_log = f"Missing questions ({len(missing_nums)}): {', '.join(missing_nums)}"
                        print(f"[vision-job] ⚠️ {missing_log}")
        except Exception as _me:
            print(f"[vision-job] Missing-Q check failed (non-fatal): {_me}")

        _update("completed", 100, missing_log)
        mark_paper_lifecycle(
            paper_id_for_job(job_id, sb=supabase),
            "ingested",
            last_job_id=job_id,
            sb=supabase,
        )
        print(f"[vision-job] ✅ Job {job_id[:12]} COMPLETED — {inserted} questions stored")

    except Exception as e:
        tb = traceback.format_exc()
        print(f"[vision-job] ❌ Job {job_id[:12]} CRASHED:\n{tb}")
        _update("failed", 0, f"{type(e).__name__}: {str(e)[:200]}")
        try:
            mark_paper_lifecycle(
                paper_id_for_job(job_id, sb=supabase),
                "failed",
                last_job_id=job_id,
                sb=supabase,
            )
        except Exception:
            pass
    finally:
        if should_delete_pdf_after_job(pdf_path):
            os.unlink(pdf_path)


# ── CLI entry ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Gemini Vision extractor for Final Key PDFs")
    parser.add_argument("pdf", help="Path to PDF")
    parser.add_argument("exam_name", help='Exam name, e.g. "APPSC Group II Mains Paper I"')
    parser.add_argument("year", type=int, help="Exam year, e.g. 2025")
    parser.add_argument("--series", default="", help="Paper series letter (e.g. A)")
    parser.add_argument("--start-page", type=int, default=0, help="0-indexed start page")
    parser.add_argument("--end-page", type=int, default=None, help="0-indexed exclusive end page")
    parser.add_argument("--dry-run", action="store_true", help="Extract but don't insert to DB")
    args = parser.parse_args()

    tracker = _VisionCostTracker()

    questions = extract_with_vision(
        args.pdf, args.exam_name, args.year,
        series=args.series,
        start_page=args.start_page,
        end_page=args.end_page,
        tracker=tracker,
    )

    if args.dry_run:
        tracker.print_summary()
        print(f"\n[dry-run] {len(questions)} questions extracted. Sample:")
        for q in questions[:3]:
            print(json.dumps(q, indent=2, ensure_ascii=False))
        sys.exit(0)

    # ── Tag with cheap model (subject/topic/difficulty) ──────────────────────
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from pipeline import tag_questions, store_questions, CostTracker  # type: ignore

    tag_tracker = CostTracker()
    print(f"\n[tag] Tagging {len(questions)} questions...")
    tagged = tag_questions(questions, args.exam_name, tracker=tag_tracker)

    print(f"\n[insert] Inserting {len(tagged)} questions to Supabase...")
    result = store_questions(tagged, str(args.pdf), args.exam_name, args.year)
    print(f"[insert] Done — inserted: {result['inserted']}, skipped (duplicates): {result['skipped']}")
    if result.get("errors"):
        print(f"[insert] Errors: {result['errors']}")

    # ── Cost summary ─────────────────────────────────────────────────────────
    tracker.print_summary()
    tag_tracker.print_summary()
    total_inr = tracker.total_inr() + tag_tracker.total_inr()
    print(f"\n  💰 TOTAL COST THIS RUN: ₹{total_inr:.4f}")
    tracker.save_log(args.exam_name, args.year, len(tagged), extra_steps=tag_tracker.steps)
