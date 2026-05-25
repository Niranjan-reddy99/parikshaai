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
import concurrent.futures as _cf
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
from ai_models import EXTRACTION_MODEL, get_genai_client
from dotenv import load_dotenv
from google.genai import types
from extraction_cleanup import clean_and_dedupe_questions
from extractor.universal_extractor import _recover_inline_match_payload
from papers import resolve_paper_id, sync_paper_question_counts
from row_quality import merge_quality_fields

load_dotenv()

_CLIENT = get_genai_client()

# SDK-level HTTP timeout for vision calls — 120s is enough for large pages on Vertex AI.
# We pass this directly to generate_content (no thread executor) to avoid the executor-
# exhaustion bug where timed-out threads fill the pool and block subsequent submissions.
_HTTP_OPTS_VISION = types.HttpOptions(timeout=120_000)  # milliseconds


def _generate_content_with_vision_compat(*, model: str, contents: list, temperature: float, max_output_tokens: int):
    """
    Some installed google-genai SDK builds reject `http_options` during
    `generate_content(...)` calls. Fall back cleanly so extraction still runs.
    """
    config_kwargs = {
        "temperature": temperature,
        "max_output_tokens": max_output_tokens,
        "thinking_config": types.ThinkingConfig(thinking_budget=0),
    }
    try:
        return _CLIENT.models.generate_content(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(
                **config_kwargs,
                http_options=_HTTP_OPTS_VISION,
            ),
        )
    except TypeError as exc:
        if "http_options" not in str(exc):
            raise
        return _CLIENT.models.generate_content(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(**config_kwargs),
        )


# Two model tiers initially, now both standardized to flash:
# - VISION_LITE was used for simple green/red answer detection (Telegram CBT)
# - VISION_FULL was used for full extraction (question text + options + answer)
# Standardized to gemini-1.5-flash-002 for max accuracy in all modules as requested.
_VISION_MODEL      = EXTRACTION_MODEL
_VISION_FULL_MODEL = EXTRACTION_MODEL

CACHE_DIR = Path(__file__).parent.parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)

# ── ti-ligature OCR fix ──────────────────────────────────────────────────────
# Some PDFs (e.g. AP High Court Shift 5) use a fused 'ti' glyph that PyMuPDF
# cannot decode, turning "tion"→" on", "tive"→" ve", "ting"→" ng".
# Only patterns with near-zero false-positive risk are included.
_TI_LIG_PATTERNS = [
    (re.compile(r'([A-Za-z]) ng\b'),              r'\1ting'),
    (re.compile(r'([A-Za-z]) ve(ly|ness|r|rs|d|s)?\b'), r'\1tive\2'),
    (re.compile(r'(?<=[a-zA-Z])u on(s)?\b'),      r'ution\1'),
    (re.compile(r'uc on(s)?\b'),                   r'uction\1'),
    (re.compile(r'ec on(s)?\b'),                   r'ection\1'),
]
_TI_LIG_WORDS = [(re.compile(r'\bcompetive\b', re.I), 'competitive')]

def _fix_ti_ligature(text: str) -> str:
    for pat, repl in _TI_LIG_PATTERNS:
        text = pat.sub(repl, text)
    for pat, repl in _TI_LIG_WORDS:
        text = pat.sub(repl, text)
    return text

# DPI for page rendering
_RENDER_DPI      = 150                                        # answer-only detection (Telegram CBT)
_RENDER_DPI_FULL = 200                                        # full text extraction (TCSiON)
_RENDER_DPI_APHC = 250                                        # AP HC: 250 DPI makes green highlights clearly visible
_MAT      = fitz.Matrix(_RENDER_DPI / 72, _RENDER_DPI / 72)
_MAT_FULL = fitz.Matrix(_RENDER_DPI_FULL / 72, _RENDER_DPI_FULL / 72)
_MAT_APHC = fitz.Matrix(_RENDER_DPI_APHC / 72, _RENDER_DPI_APHC / 72)

# Minimum fraction of questions on a page that must have a non-null answer for
# the page to be considered successfully extracted and eligible for caching.
# If fewer than this fraction have answers, the cache is skipped so the next
# upload re-runs Gemini on that page instead of reusing stale nulls.
_APHC_MIN_ANSWER_FRACTION = 0.5

# Cost tracking — gemini-2.0-flash pricing (thinking_budget=0, no thinking tokens)
# NOTE: Google bills 30% more than calculated due to image rounding + billing granularity.
# We apply a 1.35x safety margin to match actual charges.
_USD_TO_INR = 84
_INPUT_PRICE_PER_1M  = 0.10    # gemini-2.0-flash USD per 1M input tokens
_OUTPUT_PRICE_PER_1M = 0.40    # gemini-2.0-flash USD per 1M output tokens
_BILLING_MARGIN      = 1.35    # actual Google billing is ~35% above raw token math


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

    def record(self, step: str, resp_or_input=None, output_tokens: int = 0, cached: bool = False) -> None:
        # Accept both calling conventions:
        #   record(step, gemini_response)          — cbt_pipeline internal calls
        #   record(step, input_tokens, output_tokens, cached=...)  — pipeline/vision_extractor calls
        if resp_or_input is None or isinstance(resp_or_input, int):
            inp = int(resp_or_input or 0)
            out = output_tokens
        else:
            try:
                meta = resp_or_input.usage_metadata
                inp = meta.prompt_token_count or 0
                out = meta.candidates_token_count or 0
            except Exception:
                inp, out = 0, 0
        if cached:
            self.steps.append({"step": step, "in": 0, "out": 0, "inr": 0})
            return
        self.total_input  += inp
        self.total_output += out
        cost_usd = (inp / 1_000_000 * _INPUT_PRICE_PER_1M +
                    out / 1_000_000 * _OUTPUT_PRICE_PER_1M) * _BILLING_MARGIN
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

def _interruptible_sleep(seconds: float) -> None:
    """Sleep in 1s chunks so the thread yields control and uvicorn can reload cleanly."""
    deadline = time.time() + seconds
    while time.time() < deadline:
        time.sleep(min(1.0, deadline - time.time()))


class RPMLimiter:
    """Thread-safe RPM limiter — allows bursting to max_rpm per 60s window."""
    def __init__(self, max_rpm: int = 60):
        import threading
        self.max_rpm = max_rpm
        self._timestamps: list[float] = []
        self._lock = threading.Lock()

    def wait(self) -> None:
        with self._lock:
            now = time.time()
            self._timestamps = [t for t in self._timestamps if now - t < 60.0]
            if len(self._timestamps) >= self.max_rpm:
                sleep_for = 60.0 - (now - self._timestamps[0]) + 0.5
                if sleep_for > 0:
                    print(f"  ⏳ RPM limit ({self.max_rpm}/min reached), "
                          f"waiting {sleep_for:.1f}s...")
                    _interruptible_sleep(sleep_for)
            self._timestamps.append(time.time())


# Vertex AI (paid) supports 1000+ RPM — 60 is conservative but safe.
# The old 13 RPM was for the free Developer API (15 RPM cap) and is not needed here.
_RPM = RPMLimiter(max_rpm=60)
_SHIFT_EXECUTOR = _cf.ThreadPoolExecutor(max_workers=1, thread_name_prefix="cbt-shift")


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


def detect_shifts(pdf_path: str, progress_callback=None) -> list[ShiftInfo]:
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
        if progress_callback:
            try:
                progress_callback(i + 1, total)
            except Exception:
                pass

    doc.close()

    if not raw_shifts:
        # No shift headers found — treat entire PDF as one shift
        print("  [shift] No shift headers found — treating as single shift")
        return [ShiftInfo(
            test_date="Unknown", test_time="Unknown",
            subject="Unknown", shift_label="Shift 1",
            start_page=0, end_page=total - 1,
        )]

    # Deduplicate: High Court PDFs stamp the shift header watermark on EVERY page.
    # Keep only the first page where each unique (date, time) combination appears.
    seen_shift_keys: set[str] = set()
    deduped_shifts: list[dict] = []
    for s in raw_shifts:
        key = f"{s['test_date']}|{s['test_time']}"
        if key not in seen_shift_keys:
            seen_shift_keys.add(key)
            deduped_shifts.append(s)
    if len(deduped_shifts) < len(raw_shifts):
        print(f"  [shift] Collapsed {len(raw_shifts)} header hits → {len(deduped_shifts)} unique shift(s) "
              f"(watermark repeated {len(raw_shifts) - len(deduped_shifts)} extra pages)")
    raw_shifts = deduped_shifts

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
# FORMAT DETECTION — TCSiON CAE vs Telegram CBT
# ══════════════════════════════════════════════════════════════════════════════

_TCSION_SIG_RE = re.compile(
    r'(TCSiON\s+CAE|Question\s+Number\s*:\s*\d+\s+Question\s+Id\s*:|tcsion\.com)',
    re.IGNORECASE
)

# TCSiON page header that appears at the top of every page:
#   "22/05/2023, 13:04"
#   "https://g06.tcsion.com/CAE/viewHtmlPDFAction.action"
#   "https://g06.tcsion.com/CAE/viewHtmlPDFAction.action"
#   "63/66"    ← page X/total
_TCSION_HEADER_RE = re.compile(
    r'\d{1,2}/\d{1,2}/\d{4},\s*\d{1,2}:\d{2}\s*\n'   # date+time line
    r'https?://[^\n]+tcsion[^\n]*\n'                   # URL line 1
    r'(?:https?://[^\n]+tcsion[^\n]*\n)?'              # URL line 2 (optional)
    r'\d{1,3}/\d{1,3}\s*\n',                           # page X/total line
    re.IGNORECASE
)


def _strip_tcsion_headers(text: str) -> str:
    """Remove TCSiON page header blocks (date, URL×2, page-of-total) from text."""
    # Strip the 3-4 line header pattern
    text = _TCSION_HEADER_RE.sub('\n', text)
    # Also strip any stray tcsion URLs and date lines that slipped through
    text = re.sub(r'https?://[^\n]*tcsion[^\n]*\n?', '', text, flags=re.IGNORECASE)
    text = re.sub(r'\d{1,2}/\d{1,2}/\d{4},\s*\d{1,2}:\d{2}\s*\n?', '', text)
    # Strip bare page-number lines like "63/66" or "4/66"
    text = re.sub(r'(?m)^\s*\d{1,3}/\d{1,3}\s*$\n?', '', text)
    return text


def _extract_unlabeled_tcs_options(opts_block: str) -> list[str]:
    """Handle TCSiON exports where 'Options :' is followed by 4 plain lines."""
    if not opts_block:
        return []
    lines = [ln.strip() for ln in opts_block.splitlines()]
    cleaned: list[str] = []
    for ln in lines:
        if not ln:
            continue
        if re.search(r'(?i)Question\s+Number\s*[:\s]\s*\d+', ln):
            break
        if _TCS_META_LINE.match(ln):
            continue
        ln = _TELUGU_CHAR_RE.sub('', ln).strip()
        ln = re.sub(r'\s+', ' ', ln).strip()
        if not ln:
            continue
        cleaned.append(ln)

    deduped: list[str] = []
    seen_norm: set[str] = set()
    for ln in cleaned:
        norm = ln.lower()
        if norm in seen_norm:
            continue
        seen_norm.add(norm)
        deduped.append(ln)
    return deduped[:4]

def _is_tcsion_format(pdf_path: str) -> bool:
    """Return True if this is a TCSiON CAE answer key PDF."""
    doc = fitz.open(pdf_path)
    for i in range(min(3, len(doc))):
        if _TCSION_SIG_RE.search(doc[i].get_text("text")):
            doc.close()
            return True
    doc.close()
    return False


# Telugu Unicode range U+0C00–U+0C7F
_TELUGU_CHAR_RE = re.compile(r'[\u0C00-\u0C7F]')
_TCS_META_LINE = re.compile(
    r'^(?:Options\s*:|Question\s+Id\s*:|Option\s+Shuffling\s*:|Is\s+Question\s+Mandatory\s*:|'
    r'Calculator\s*:|Response\s+Time\s*:|Think\s+Time\s*:|Minimum\s+Instruction\s+Time\s*:|'
    r'Correct\s+Marks\s*:|Wrong\s+Marks\s*:|https?://|[0-9]{1,2}/[0-9]{1,2}/[0-9]{4},)',
    re.IGNORECASE,
)
_MATCH_CODE_OPT_RE = re.compile(
    r'^\s*(?:'
    r'(?:\d+\s*[-–]\s*[A-D](?:\s*,\s*\d+\s*[-–]\s*[A-D]){1,7})'
    r'|'
    r'(?:[A-D]\s*[-–]\s*\d+(?:\s*,\s*[A-D]\s*[-–]\s*\d+){1,7})'
    r')\s*$',
    re.IGNORECASE,
)

def _is_mostly_telugu(text: str) -> bool:
    """Return True if >25% of alphabetic chars are Telugu script."""
    alpha = sum(1 for c in text if c.isalpha())
    if alpha == 0:
        return False
    telugu = sum(1 for c in text if '\u0C00' <= c <= '\u0C7F')
    return (telugu / alpha) > 0.40  # Increased threshold to be safer against bilingual English questions


def _regional_script_ratio(text: str) -> float:
    alpha = [c for c in (text or "") if c.isalpha()]
    if not alpha:
        return 0.0
    regional = sum(1 for c in alpha if '\u0C00' <= c <= '\u0C7F' or '\u0900' <= c <= '\u097F')
    return regional / len(alpha)


def _extract_match_payload(text: str) -> dict:
    if "__MATCH__:" not in text:
        raise ValueError("missing __MATCH__ payload")
    payload_text = text.split("__MATCH__:", 1)[1].strip()
    return json.loads(payload_text)


def _is_repair_row_usable(row: dict) -> bool:
    """
    A repair row should count as recovered only if it is genuinely publishable
    enough for the paper, not merely present.
    """
    text = str(row.get("question_text") or "").strip()
    options = [str(row.get(k) or "").strip() for k in ("option_a", "option_b", "option_c", "option_d")]
    q_type = str(row.get("question_type") or "").strip().lower()

    if not text or len(text) < 15:
        return False
    if _regional_script_ratio(" ".join([text] + options)) >= 0.12:
        return False

    if q_type == "match" or "match the following" in text.lower():
        if "__MATCH__:" not in text:
            return False
        try:
            payload = _extract_match_payload(text)
            col1 = [str(x).strip() for x in (payload.get("col1") or []) if str(x).strip()]
            col2 = [str(x).strip() for x in (payload.get("col2") or []) if str(x).strip()]
            if len(col1) < 2 or len(col2) < 2:
                return False
        except Exception:
            return False
        if not all(options):
            return False
        return True

    return all(options)


def _parse_tcsion_full_text(full_text: str) -> list[dict]:
    """Parse all questions from TCSiON CAE full PDF text.

    TCSiON format: each question appears TWICE — once in English, once in Telugu.
    Both repeat the same metadata header with the same Question Number.
    We keep only the English version (skip the block where question text is mostly Telugu).

    Each block looks like:
        Question Number : 1 Question Id : 630680220939 Option Shuffling : Yes ...
        Correct Marks : 1 Wrong Marks : 0
        <question text>
        Options :
        1. Option A
        2. Option B
        3. Option C
        4. Option D
    """
    # Strip TCSiON page headers BEFORE splitting — they break question block detection
    full_text = _strip_tcsion_headers(full_text)

    raw_blocks = re.split(r'(?i)(?=Question\s+Number\s*[:\s]\s*\d+)', full_text)
    seen: dict[int, dict] = {}

    for block in raw_blocks:
        block = block.strip()
        if not block:
            continue

        q_num_m = re.match(r'(?i)Question\s+Number\s*[:\s]\s*(\d+)', block)
        if not q_num_m:
            continue
        q_num = int(q_num_m.group(1))

        # Extract Question Id for robust deduplication (Number repeats across sections)
        q_id_m = re.search(r'(?i)Question\s+Id\s*[:\s]\s*(\d+)', block)
        unique_key = q_id_m.group(1) if q_id_m else f"q_{q_num}_{hash(block[:100])}"

        # Find where "Correct Marks" line ends — everything after is question content
        cm_m = re.search(r'Correct\s+Marks[^\n]*\n', block, re.IGNORECASE)
        if not cm_m:
            continue
        content = block[cm_m.end():].strip()
        # Strip any residual page headers inside content (belt+suspenders)
        content = _strip_tcsion_headers(content)

        # Split on "Options :" to separate question text from options
        opts_split = re.split(r'Options\s*:\s*\n', content, maxsplit=1, flags=re.IGNORECASE)
        if len(opts_split) < 2:
            continue

        q_text_raw = opts_split[0].strip()
        opts_raw   = opts_split[1].strip()

        # Parse numbered options 1–4 (may span multiple lines). Some papers
        # use plain unlabeled lines under "Options :", so support that too.
        opt_parts = re.split(r'(?m)^\s*(\d)\.\s+', opts_raw)
        opt_map: dict[str, str] = {}
        if len(opt_parts) >= 3:
            i = 1
            while i < len(opt_parts) - 1:
                num = opt_parts[i].strip()
                txt = opt_parts[i + 1].strip()
                txt = _TELUGU_CHAR_RE.sub('', txt).strip()
                txt = re.sub(r'\s*\d{1,3}\s*$', '', txt).strip()
                if num in ('1', '2', '3', '4') and txt:
                    opt_map[num] = txt
                i += 2
            opt_a = opt_map.get('1', '')
            opt_b = opt_map.get('2', '')
            opt_c = opt_map.get('3', '')
            opt_d = opt_map.get('4', '')
        else:
            unlabeled = _extract_unlabeled_tcs_options(opts_raw)
            opt_a = unlabeled[0] if len(unlabeled) > 0 else ''
            opt_b = unlabeled[1] if len(unlabeled) > 1 else ''
            opt_c = unlabeled[2] if len(unlabeled) > 2 else ''
            opt_d = unlabeled[3] if len(unlabeled) > 3 else ''

        if not (opt_a or opt_b):
            continue  # no usable options — skip

        if q_text_raw and _is_mostly_telugu(q_text_raw):
            continue  # skip Telugu version

        # Reject blocks where metadata header leaked into question_text.
        # For option-only recovery rows, allow a blank stem to survive so the
        # targeted repair worker can merge the recovered options into the
        # current stored row for this question number.
        if q_text_raw and re.match(r'Question\s+(Number|Id)\s*:', q_text_raw, re.IGNORECASE):
            continue  # metadata wasn't properly stripped — skip this block

        # Detect match/table questions with empty cell content
        # TCSiON match questions render their table as an image; the text layer
        # only has the labels (A. B. C. / i. ii. iii.) with no actual text.
        _EMPTY_MATCH = re.compile(
            r'^(?:[\s\n]*(?:[A-D]\.?|[ivIV]+\.?)\s*[\n]){3,}',
        )
        is_empty_match = bool(_EMPTY_MATCH.match(q_text_raw)) or (
            len(q_text_raw) < 40 and
            len(re.findall(r'(?m)^\s*[A-D]\.\s*$', q_text_raw)) >= 2
        )
        option_only_code_row = (
            not q_text_raw
            and all((x or "").strip() for x in (opt_a, opt_b, opt_c, opt_d))
            and all(_MATCH_CODE_OPT_RE.match(x or "") for x in (opt_a, opt_b, opt_c, opt_d))
        )
        if not option_only_code_row and (not q_text_raw or len(q_text_raw) < 8):
            continue

        q: dict = {
            'question_number': q_num,
            'question_text':   q_text_raw,
            'option_a': opt_a,
            'option_b': opt_b,
            'option_c': opt_c,
            'option_d': opt_d,
            'correct_answer': None,   # filled by vision step
            'exam_section':   'General Studies',
            'passage':        '',
            # Mark as needs_review if options incomplete OR the match table is empty
            'needs_review':   not (opt_a and opt_b and opt_c and opt_d) or is_empty_match,
        }
        if unique_key not in seen or len(q_text_raw) > len(seen[unique_key]['question_text']):
            seen[unique_key] = q

    raw_rows = list(seen.values())
    cleaned_rows = clean_and_dedupe_questions(raw_rows)
    kept_qnums = {
        int(q.get("question_number") or 0)
        for q in cleaned_rows
        if int(q.get("question_number") or 0) > 0
    }
    for q in raw_rows:
        qn = int(q.get("question_number") or 0)
        if qn <= 0 or qn in kept_qnums:
            continue
        opts = [str(q.get(k) or "").strip() for k in ("option_a", "option_b", "option_c", "option_d")]
        if (
            not str(q.get("question_text") or "").strip()
            and all(opts)
            and all(_MATCH_CODE_OPT_RE.match(opt) for opt in opts)
        ):
            cleaned_rows.append(q)
            kept_qnums.add(qn)

    cleaned_rows.sort(key=lambda item: int(item.get("question_number") or 0))
    return cleaned_rows


def extract_tcsion_questions(pdf_path: str, shift: ShiftInfo) -> list[dict]:
    """Extract questions from TCSiON CAE PDF for the given shift page range.

    Concatenates all page text then parses holistically because question blocks
    can span page boundaries in TCSiON PDFs.
    """
    doc = fitz.open(pdf_path)
    parts = []
    for page_idx in range(shift.start_page, shift.end_page + 1):
        t = doc[page_idx].get_text("text")
        if t.strip():
            parts.append(t)
    doc.close()

    questions = _parse_tcsion_full_text('\n'.join(parts))
    print(f'  [tcsion] Shift {shift.shift_label}: {len(questions)} English questions extracted (₹0)')
    return questions


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — TEXT EXTRACTION  (free, PyMuPDF)
# Parses question text + 4 options from the selectable text layer.
# Does NOT try to find correct answer — that's in the image only.
# ══════════════════════════════════════════════════════════════════════════════

# Section headers embedded in page text
_SECTION_RE = re.compile(r'Section\s*[:\s]+([A-Za-z][^\n]{3,80})', re.IGNORECASE)

# Question start: "Q.1", "Q. 1", "Q1" at start of line
_Q_RE = re.compile(r'Q\.?\s*(\d{1,3})\s+', re.MULTILINE)

# Options block: "Ans" (any case) followed by "1. ... 2. ... 3. ... 4. ..."
# Terminates at: next question, passage intro, shift header lines, or end-of-string
_ANS_BLOCK_RE = re.compile(
    r'(?i)Ans\s+1\.\s*(.+?)\n\s*2\.\s*(.+?)\n\s*3\.\s*(.+?)\n\s*4\.\s*(.+?)'
    r'(?=\n\s*Q\.?\s*\d+|\n\s*Direction|\n\s*Note\s*[:\-]'
    r'|\n\s*Read\s+the\s+|\n\s*Study\s+the\s+|\n\s*Based\s+on\s+'
    r'|\n\s*The\s+following\s+|\n\s*Comprehension|\n\s*Questions?\s*\d+'
    r'|\n\s*Test\s+(?:Date|Time)|\n\s*AP\s+High|\n\s*TSPSC|\n\s*APPSC'
    r'|\n\s*Subject\s*[:\s]|\n\s*Roll\s+No|\n\s*Candidate'
    r'|\s+\d{1,2}/\d{1,2}/\d{4}|\Z)',
    re.DOTALL | re.IGNORECASE
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
    r'(?:Direction[s]?|Note|Comprehension|Passage)\s*[:\-\(\)]?\s*(?:Questions?\s*\d+\s*(?:to|and|-|—)\s*\d+)?|'
    r'(?:Read\s+the\s+(?:following\s+)?passage|'
    r'Study\s+the\s+(?:following\s+)?passage|'
    r'Based\s+on\s+the\s+(?:following\s+)?passage|'
    r'The\s+following\s+passage\s+is\s+(?:given|provided)|'
    r'Answer\s+the\s+questions?\s+(?:based\s+on|according\s+to)|'
    r'Read\s+the\s+(?:following\s+)?text)',
    re.IGNORECASE
)


def _clean_noise(text: str) -> str:
    """Strip Telegram handles, exam headers, and page-number noise from text."""
    # MUST run first: join digits split across lines by column interleaving
    # e.g. "2\n016" (year 2016 split at column boundary) → "2016"
    # Without this, the standalone-digit stripper below deletes "016" leaving just "2".
    text = re.sub(r'(\d)\s*\n\s*(\d)', r'\1\2', text)
    # Telegram watermarks
    text = _TELEGRAM_RE.sub("", text)
    # Exam header lines at line-start (AP High Court, Test Date/Time, Subject, channel names)
    text = re.sub(
        r'(?m)^(?:AP High Court[^\n]*|TSPSC[^\n]*|APPSC[^\n]*|SSC\s+Updates[^\n]*|'
        r'RankMitra[^\n]*|EZSSC[^\n]*|Test\s+(?:Date|Time)[^\n]*|'
        r'Subject\s*[:\s][^\n]*|Roll\s+No[^\n]*|Candidate[^\n]*)\n?',
        "", text, flags=re.IGNORECASE
    )
    # Inline shift metadata (appears mid-line without leading newline in some PDFs)
    text = re.sub(r'(?i)\bTest\s+(?:Date|Time)\s*[:\s]+[^\n]+', '', text)
    text = re.sub(r'(?i)\bAP\s+High\s+Court\b[^\n]*', '', text)
    # Standalone page numbers (lines that are just digits)
    text = re.sub(r'(?m)^\s*\d{1,3}\s*$\n?', "", text)
    return text.strip()


def _clean_option_text(text: str) -> str:
    """Strip trailing page numbers, shift metadata, and junk from extracted option text."""
    # Join digits split across lines by column interleaving:
    # e.g. "1810 to 1\n858" (year 1858 split) → "1810 to 1858"
    # e.g. "1\n858" (year 1858 split at column boundary) → "1858"
    text = re.sub(r'(\d)\s*\n\s*(\d)', r'\1\2', text)
    # Strip shift metadata that leaked into option text
    text = re.sub(r'(?i)\bTest\s+(?:Date|Time)\s*[:\s]+[^\n]*', '', text)
    text = re.sub(r'(?i)\bAP\s+High\s+Court\b[^\n]*', '', text)
    # Strip everything from a bare date onward when it appears mid-option
    # e.g. "A-3, B-2, C-1 23/08/2025 4:00 PM – 5:30 PM Typist Field Assistant..."
    text = re.sub(r'\s+\d{1,2}/\d{1,2}/\d{4}.*$', '', text, flags=re.DOTALL)
    # Strip standalone date/time patterns
    text = re.sub(r'\b\d{1,2}/\d{1,2}/\d{4}\b', '', text)
    text = re.sub(r'\b\d{1,2}:\d{2}\s*[AP]M\s*[-–]\s*\d{1,2}:\d{2}\s*[AP]M\b', '', text, flags=re.IGNORECASE)
    # Strip "Subject : ..." that leaked in (shift header without "Test" prefix)
    text = re.sub(r'(?i)\bSubject\s*[:\s]+[^\n]*', '', text)
    # Strip trailing standalone page numbers (2-3 bare digits on their own line or at end),
    # but only when NOT immediately preceded by another digit (to avoid cutting year digits).
    text = re.sub(r'(?<!\d)\s*\d{2,3}\s*$', '', text)
    return text.strip()


def _clean_question_tail(text: str) -> str:
    """Remove trailing garbage lines from question text (single letters, stray numbers)."""
    # Join digits split across lines by column interleaving before tail-stripping
    text = re.sub(r'(\d)\s*\n\s*(\d)', r'\1\2', text)
    lines = text.split('\n')
    while lines:
        tail = lines[-1].strip()
        # Drop lines that are just option labels (A, B, C, D, a-d) or bare numbers
        if re.match(r'^[A-Da-d]$', tail) or re.match(r'^\d{1,3}$', tail) or not tail:
            lines.pop()
        else:
            break
    text = '\n'.join(lines).strip()
    # Also strip any trailing shift metadata
    text = re.sub(r'(?i)\s*(?:Test\s+(?:Date|Time)|AP\s+High\s+Court)[^\n]*$', '', text, flags=re.MULTILINE).strip()
    return text


def _parse_page_questions(
    page_text: str,
    current_section: str,
    current_passage: str = "",
    page_idx: int = 0,
    carry_in: str = "",
) -> tuple[list[dict], str, str, str]:
    """
    Parse questions from a single page's text layer.

    Returns (questions_list, updated_section_name, updated_passage, carry_out).
    carry_out is non-empty when the last question on this page has no Ans block —
    it will be prepended to the next page so cross-page questions are not lost.
    Questions have: question_number, question_text, option_a–d, passage, section.
    correct_answer is intentionally left None (filled by vision step).
    """
    # Prepend any dangling question fragment from the previous page
    if carry_in:
        page_text = carry_in + "\n" + page_text

    # Strip noise first
    page_text = _clean_noise(page_text)

    # Update section if this page has a section header
    sec_m = _SECTION_RE.search(page_text)
    if sec_m:
        current_section = sec_m.group(1).strip()

    # Detect if this page introduces a new passage (preamble)
    first_q_match = re.search(r'Q\.?\s*\d+\s+', page_text)
    if first_q_match:
        preamble = page_text[:first_q_match.start()].strip()
        if preamble:
            if _PASSAGE_INTRO_RE.search(preamble) or len(preamble) > 150:
                current_passage = re.sub(r'\s+', ' ', preamble).strip()
    elif len(page_text) > 150:
        # Whole page is likely a passage
        current_passage = re.sub(r'\s+', ' ', page_text).strip()

    # Split page text into per-question chunks using Q.N as boundary
    chunks = re.split(r'(?=Q\.?\s*\d+\s+)', page_text)

    questions: list[dict] = []
    carry_out: str = ""  # dangling incomplete question to carry to next page

    for chunk in chunks:
        chunk = chunk.strip()
        if not chunk:
            continue

        # Check for new passage in chunks that DON'T start with a question
        # (Split can happen if there is a massive gap or header between questions)
        q_m = _Q_RE.match(chunk)
        if not q_m:
            if _PASSAGE_INTRO_RE.search(chunk) or len(chunk) > 200:
                current_passage = re.sub(r'\s+', ' ', chunk).strip()
            continue

        q_num = int(q_m.group(1))

        # Extract question text: between Q.N and Ans (case-insensitive search)
        ans_m = re.search(r'\bAns\b', chunk, re.IGNORECASE)
        if not ans_m:
            # Question text is on this page but the Ans block is on the next page.
            # Save for carry-over — will be prepended to the next page before parsing.
            carry_out = chunk
            continue
        carry_out = ""  # this question is complete — clear any prior carry
        ans_pos = ans_m.start()

        q_text_raw = chunk[q_m.end():ans_pos].strip()
        # Remove embedded section headers
        q_text_raw = re.sub(_SECTION_RE, "", q_text_raw).strip()
        # Strip noise lines, then remove trailing single-char/number junk
        q_text_raw = _clean_noise(q_text_raw)
        q_text_raw = _clean_question_tail(q_text_raw)

        if not q_text_raw or len(q_text_raw) < 10:
            continue

        # Extract the 4 options from the Ans block
        ans_chunk = chunk[ans_pos:]
        opts_m = _ANS_BLOCK_RE.search(ans_chunk)

        opt_a = opt_b = opt_c = opt_d = ""
        if opts_m:
            opt_a = _clean_option_text(_clean_noise(opts_m.group(1).strip()))
            opt_b = _clean_option_text(_clean_noise(opts_m.group(2).strip()))
            opt_c = _clean_option_text(_clean_noise(opts_m.group(3).strip()))
            opt_d = _clean_option_text(_clean_noise(opts_m.group(4).strip()))

        if not opt_a:
            # Fallback: numbered list extraction
            nums = re.findall(r'(?:^|\n)\s*(\d)\.\s+(.+?)(?=\n\s*\d\.|\Z)',
                              ans_chunk, re.DOTALL)
            opt_map = {n: _clean_option_text(_clean_noise(t.strip())) for n, t in nums}
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
                "_page_idx":       page_idx,
            })
            
            # Check if a new passage starts AFTER this question in the SAME chunk
            if opts_m:
                tail = _clean_noise(ans_chunk[opts_m.end():].strip())
                if _PASSAGE_INTRO_RE.search(tail) or len(tail) > 200:
                    current_passage = re.sub(r'\s+', ' ', tail).strip()

    return questions, current_section, current_passage, carry_out


def extract_text_questions(
    pdf_path: str,
    shift: ShiftInfo,
    progress_callback=None,
) -> list[dict]:
    """
    Extract all questions from text layer for a given shift's page range.
    Auto-detects whether this is a TCSiON CAE PDF or a Telegram CBT PDF
    and routes to the correct parser. Cost: ₹0 (pure PyMuPDF, no API calls).
    progress_callback(done, total) is called after each page so the job row
    gets a heartbeat and the frontend can infer smooth progress.
    """
    # TCSiON PDFs need holistic parsing (questions span page boundaries)
    if _is_tcsion_format(pdf_path):
        print(f'  [format] TCSiON CAE detected — using TCSiON parser')
        return extract_tcsion_questions(pdf_path, shift)

    # Standard Telegram CBT format — page-by-page parsing
    print(f'  [format] Telegram CBT format detected — using standard parser')
    doc = fitz.open(pdf_path)
    all_questions: list[dict] = []
    current_section = 'General Knowledge'
    current_passage = ''
    carry_out = ''  # dangling question fragment that spans a page boundary

    pages = list(range(shift.start_page, shift.end_page + 1))
    total_pages = len(pages)
    for rel_idx, page_idx in enumerate(pages):
        page = doc[page_idx]
        page_text = page.get_text('text')
        page_text = _fix_ti_ligature(page_text)
        if not page_text.strip():
            if progress_callback:
                progress_callback(rel_idx + 1, total_pages)
            continue
        qs, current_section, current_passage, carry_out = _parse_page_questions(
            page_text, current_section, current_passage, page_idx, carry_in=carry_out
        )
        all_questions.extend(qs)
        if progress_callback:
            progress_callback(rel_idx + 1, total_pages)

    if carry_out:
        # Last page ended with a dangling question fragment — no following page to resolve it.
        # Parse it alone so it gets the needs_review flag instead of being silently dropped.
        qs, _, _, _ = _parse_page_questions(
            "", current_section, current_passage, shift.end_page + 1, carry_in=carry_out
        )
        all_questions.extend(qs)

    doc.close()

    questions = clean_and_dedupe_questions(all_questions)

    print(f'  [text] Shift {shift.shift_label}: {len(questions)} questions extracted (₹0)')
    return questions


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — VISION ANSWER DETECTION  (~₹0.001 per page)
# Renders page as image, asks Gemini: "which option is green/ticked?"
# Returns {q_num: "A"|"B"|"C"|"D"} per page, cached to avoid re-paying.
# ══════════════════════════════════════════════════════════════════════════════

# ── Telegram CBT answer-only prompt (used for non-TCSiON format) ──────────────
_ANSWER_PROMPT = """This is a page from an Indian state exam answer key PDF exported from a computer-based test (CBT).

Each question shows 4 answer options labeled 1, 2, 3, 4.
The CORRECT answer option is displayed in GREEN color with a ✓ (tick/checkmark) symbol.
The WRONG answer options are displayed in RED color with a ✗ (cross/X) symbol.

Your task: For EACH UNIQUE question number visible on this page:
1. Identify which option number (1, 2, 3, or 4) is the CORRECT answer (green with tick).
2. If the question has a 2-column TABLE (Match the following): also read and return the column data.

Return ONLY a JSON array. No markdown, no explanation. Just raw JSON.

Format for regular MCQ:
[{"q": 1, "ans": 3}, {"q": 2, "ans": 1}]

Format for Match-the-following (include match_left and match_right):
[{"q": 46, "ans": 2, "match_left": ["Item A", "Item B", "Item C", "Item D"], "match_right": ["Desc 1", "Desc 2", "Desc 3", "Desc 4"]}]

Rules:
- "q" = the question number
- "ans" = 1, 2, 3, or 4 — the option shown in GREEN with a ✓ tick; null if unclear
- "match_left" = Column A items IN ORDER (only for questions with a 2-column table)
- "match_right" = Column B items IN ORDER (only for questions with a 2-column table)
- Only add match_left/match_right when a table is visible — omit entirely for plain MCQs
- If the page has no questions, return: []
"""

# ── TCSiON full-extraction prompt (question text + answer in one vision pass) ──
_TCSION_FULL_PROMPT = """This is a page from a TCSiON CAE computer-based exam answer key PDF.

Each question appears TWICE on this page:
  1st: ENGLISH version
  2nd: TELUGU (or regional language) version
Both versions have the same question number.

The CORRECT answer option is shown in GREEN with a ✓ tick mark.
Wrong options are shown in RED with a ✗ mark.

YOUR TASK: Extract ONLY the ENGLISH version of each unique question.
For each question return:
  "q"    - question number (from "Question Number : N")
  "text" - FULL English question text.
  "question_type" - "mcq" or "match"
  For normal MCQs also return:
  "a"    - English option 1 text
  "b"    - English option 2 text
  "c"    - English option 3 text
  "d"    - English option 4 text
  For "Match the following" table questions return instead:
  "match_left"  - ordered English items from the left column/list
  "match_right" - ordered English items from the right column/list
  "a","b","c","d" should still contain the answer-code options printed below the table
  "ans"  - option number that is GREEN with ✓ (1, 2, 3, or 4). null if unclear.

STRICT RULES:
- Skip Telugu/regional language versions entirely (same q_num already seen)
- Skip page headers (date, URL like tcsion.com, page numbers like 4/66)
- Skip cover pages, instruction pages — return [] for those
- Do NOT repeat the same question number twice
- "text" must be English only, complete sentence, no Telugu characters
- Options must be English only
- If the question is a table-based "Match the following", you MUST read the table and return the left and right column items in arrays.
- Do NOT flatten the table into one paragraph if you can read the rows.
- Do NOT return placeholders like "[table image]" unless the table is genuinely unreadable.

Return ONLY a valid JSON array. No markdown backticks, no explanation:
[{"q":1,"text":"...","question_type":"mcq","a":"...","b":"...","c":"...","d":"...","ans":2}, {"q":4,"text":"Match the following athletes with their respective sports:","question_type":"match","match_left":["Sharath Kamal","Nikhat Zareen","Lakshya Sen","Seema Punia"],"match_right":["Discus throw","Badminton","Table tennis","Boxing"],"a":"1-B, 2-C, 3-D, 4-A","b":"1-C, 2-D, 3-B, 4-A","c":"1-A, 2-B, 3-C, 4-D","d":"1-C, 2-B, 3-D, 4-A","ans":2}]

If no English questions on this page: []
"""

_TCSION_TARGET_PROMPT_TEMPLATE = """This is a page from a TCSiON CAE computer-based exam answer key PDF.

Extract ONLY question number {target_qn} from this page.

Rules:
- If question {target_qn} is not present on this page, return []
- Return ONLY the ENGLISH version
- If it is a "Match the following" question, return:
  - "question_type": "match"
  - "match_left": [...]
  - "match_right": [...]
  - and keep "a","b","c","d" as the answer-code options
- If it is a normal MCQ, return:
  - "question_type": "mcq"
  - "a","b","c","d"
- "ans" must be the GREEN correct option number (1/2/3/4) or null

Return ONLY a JSON array:
[{{"q": {target_qn}, "text": "...", "question_type":"mcq", "a":"...", "b":"...", "c":"...", "d":"...", "ans": 2}}]
or [] if not present.
"""

_NUM_TO_LETTER = {"1": "A", "2": "B", "3": "C", "4": "D",
                  1: "A", 2: "B", 3: "C", 4: "D"}


def _page_ans_cache_key(pdf_hash: str, page_idx: int) -> Path:
    return CACHE_DIR / f"cbt_v11_ans_{pdf_hash}_p{page_idx:04d}.json"


def _page_tcsion_cache_key(pdf_hash: str, page_idx: int) -> Path:
    """Separate cache namespace for TCSiON full-extraction (text+answer together)."""
    return CACHE_DIR / f"tcsion_v12_{pdf_hash}_p{page_idx:04d}.json"


def _normalize_tcsion_match_question(item: dict, q_text: str) -> tuple[str, str]:
    match_left = [str(x).strip() for x in (item.get("match_left") or []) if str(x).strip()]
    match_right = [str(x).strip() for x in (item.get("match_right") or []) if str(x).strip()]
    question_type = str(item.get("question_type") or "").strip().lower()

    if question_type == "match" and len(match_left) >= 2 and len(match_right) >= 2:
        intro = q_text or "Match the following:"
        payload = json.dumps({"col1": match_left, "col2": match_right}, ensure_ascii=False)
        return intro + "\n\n__MATCH__:" + payload, "Match"

    inline_rows = re.findall(
        r'(?mi)^\s*(?:\d+|[A-D])\.\s*(.+?)\s{2,}(?:\d+|[A-D])\.\s*(.+?)\s*$',
        q_text,
    )
    if question_type == "match" and len(inline_rows) >= 2:
        left = [left.strip() for left, _ in inline_rows if left.strip()]
        right = [right.strip() for _, right in inline_rows if right.strip()]
        if len(left) >= 2 and len(right) >= 2:
            intro_lines = []
            for line in q_text.splitlines():
                if re.match(r'(?i)^\s*(?:\d+|[A-D])\.\s*.+?\s{2,}(?:\d+|[A-D])\.\s*.+$', line.strip()):
                    break
                if line.strip():
                    intro_lines.append(line.strip())
            intro = "\n".join(intro_lines).strip() or "Match the following:"
            payload = json.dumps({"col1": left, "col2": right}, ensure_ascii=False)
            return intro + "\n\n__MATCH__:" + payload, "Match"

    recovered = _recover_inline_match_payload(q_text)
    if recovered:
        intro, col1, col2 = recovered
        payload = json.dumps({"col1": col1, "col2": col2}, ensure_ascii=False)
        return intro + "\n\n__MATCH__:" + payload, "Match"

    return q_text, "Match" if question_type == "match" else ""


def _merge_tcsion_text_layer_fallback(page_text: str, questions: list[dict]) -> list[dict]:
    """
    Vision is best for the table itself, but TCS iON pages often expose the
    answer-code options cleanly in the text layer. If vision returns a partial
    row (for example only option_a / option_b for a match question), fill the
    missing option slots from the page text parser instead of keeping a broken row.
    """
    try:
        parsed = _parse_tcsion_full_text(page_text)
    except Exception:
        return questions

    by_qnum = {
        int(q.get("question_number")): q
        for q in parsed
        if isinstance(q.get("question_number"), int)
    }

    merged: list[dict] = []
    for q in questions:
        qn = int(q.get("question_number") or 0)
        fallback = by_qnum.get(qn)
        if not fallback:
            merged.append(q)
            continue

        updated = dict(q)
        for key in ("option_a", "option_b", "option_c", "option_d"):
            if not (updated.get(key) or "").strip():
                updated[key] = (fallback.get(key) or "").strip()

        if (
            updated.get("question_type") == "MCQ"
            and fallback.get("question_text")
            and len((updated.get("question_text") or "").strip()) < 20
        ):
            updated["question_text"] = fallback["question_text"]

        if not all((updated.get(k) or "").strip() for k in ("option_a", "option_b", "option_c", "option_d")):
            updated["needs_review"] = True
        merged.append(updated)
    return merged


def _tcsion_local_context_text(page: 'fitz.Page') -> str:
    """
    TCS iON questions frequently spill across page boundaries.
    For repair fallback, parse the current page together with the next page so
    the English block can recover missing options / trailing lines.
    """
    try:
        doc = page.parent
        page_idx = page.number
        parts = [page.get_text("text")]
        if doc is not None and page_idx + 1 < len(doc):
            parts.append(doc[page_idx + 1].get_text("text"))
        return "\n".join(p for p in parts if p)
    except Exception:
        return page.get_text("text")


def _seed_unresolved_manual_repair_drafts(
    exam_name: str,
    exam_year: int,
    question_numbers: list[int],
) -> int:
    """
    Permanent fallback:
    if auto-repair still cannot recover a numbered question and there is no row
    at all for that number, create an inactive manual-repair draft so Content
    Audit always has something actionable. This prevents repeated "come back and
    ask again" loops for the same paper.
    """
    if not question_numbers:
        return 0

    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from pipeline import get_supabase, _question_supported_columns, _merge_canonical_taxonomy

    sb = get_supabase()
    supported_cols = _question_supported_columns(sb)

    existing = sb.table("questions").select("question_number").eq("exam_name", exam_name).eq("exam_year", exam_year).in_("question_number", question_numbers).execute()
    existing_qnums = {
        int(row["question_number"])
        for row in (existing.data or [])
        if isinstance(row.get("question_number"), int)
    }
    missing_qnums = [n for n in question_numbers if n not in existing_qnums]
    if not missing_qnums:
        return 0

    paper_id = resolve_paper_id(exam_name=exam_name, exam_year=exam_year, sb=sb)
    rows = []
    for qn in missing_qnums:
        row = {
            "exam_name": exam_name,
            "exam_year": exam_year,
            "paper_id": paper_id,
            "question_number": qn,
            "question_text": f"[Manual repair required for Question #{qn}. Automatic extraction could not recover this row from the latest upload.]",
            "option_a": "",
            "option_b": "",
            "option_c": "",
            "option_d": "",
            "correct_answer": "A",
            "subject": "General Knowledge",
            "topic": "General",
            "subtopic": "",
            "difficulty": "Medium",
            "question_type": "mcq",
            "concept": "",
            "passage": "",
            "is_active": False,
            "needs_review": True,
            "question_hash": f"manual_repair_{exam_name.strip().lower()}_{int(exam_year)}_{qn}",
        }
        row = _merge_canonical_taxonomy(row, supported_cols)
        merged_quality = merge_quality_fields(row, explanation_present=False)
        row.update({k: v for k, v in merged_quality.items() if k in supported_cols})
        rows.append({k: v for k, v in row.items() if k in supported_cols})

    if rows:
        sb.table("questions").upsert(rows, on_conflict="question_hash").execute()
        if paper_id:
            sync_paper_question_counts(paper_id, sb=sb)
    return len(rows)


def _extract_tcsion_page(
    pdf_path: str,
    pdf_hash: str,
    page_idx: int,
    page: 'fitz.Page',
    tracker: CostTracker,
    retries: int = 3,
) -> list[dict]:
    """
    Single Gemini Vision call that extracts BOTH question content AND correct
    answer from one TCSiON page. Returns list of question dicts ready to store.
    Cached per page so re-runs are free.
    """
    cache_file = _page_tcsion_cache_key(pdf_hash, page_idx)
    if cache_file.exists():
        try:
            data = json.loads(cache_file.read_text())
            print(f"  [cache] tcsion page {page_idx+1}: {len(data)} questions")
            return data
        except Exception:
            pass

    # Render at 200 DPI for sharp text — needed for accurate bilingual extraction
    page_text = _tcsion_local_context_text(page)
    pix = page.get_pixmap(matrix=_MAT_FULL, colorspace=fitz.csRGB)
    png_bytes = pix.tobytes("png")
    image_part = types.Part.from_bytes(data=png_bytes, mime_type="image/png")

    last_err = None
    for attempt in range(retries):
        try:
            _RPM.wait()
            resp = _generate_content_with_vision_compat(
                model=_VISION_FULL_MODEL,
                contents=[_TCSION_FULL_PROMPT, image_part],
                temperature=0.0,
                max_output_tokens=4096,
            )
            tracker.record(f"tcsion_p{page_idx+1}", resp)

            raw = (resp.text or "").strip()
            raw = re.sub(r"^```(?:json)?", "", raw).strip().rstrip("`").strip()

            if not raw or raw == "[]":
                cache_file.write_text("[]")
                return []

            items = json.loads(raw)
            if not isinstance(items, list):
                raise ValueError(f"Expected list, got {type(items)}")

            questions = []
            for item in items:
                q_num = item.get("q")
                if q_num is None:
                    continue
                q_num = int(q_num)

                ans_raw = item.get("ans")
                correct_letter = _NUM_TO_LETTER.get(ans_raw) if ans_raw is not None else None

                q_text = (item.get("text") or "").strip()
                opt_a  = (item.get("a") or "").strip()
                opt_b  = (item.get("b") or "").strip()
                opt_c  = (item.get("c") or "").strip()
                opt_d  = (item.get("d") or "").strip()
                normalized_q_text, normalized_q_type = _normalize_tcsion_match_question(item, q_text)

                if not normalized_q_text or len(normalized_q_text) < 5:
                    continue  # skip empty/noise

                questions.append({
                    "question_number": q_num,
                    "question_text":   normalized_q_text,
                    "option_a":        opt_a,
                    "option_b":        opt_b,
                    "option_c":        opt_c,
                    "option_d":        opt_d,
                    "correct_answer":  correct_letter,
                    "exam_section":    "General Studies",
                    "passage":         "",
                    "question_type":   normalized_q_type or ("Match" if "__MATCH__:" in normalized_q_text else "MCQ"),
                    "needs_review":    (correct_letter is None) or not (opt_a and opt_b and opt_c and opt_d),
                    "_page_idx":       page_idx,
                })

            questions = _merge_tcsion_text_layer_fallback(page_text, questions)
            cache_file.write_text(json.dumps(questions))
            print(f"  [tcsion-vision] page {page_idx+1}: {len(questions)} questions extracted")
            return questions

        except json.JSONDecodeError as e:
            last_err = e
            print(f"  [warn] tcsion page {page_idx+1} JSON error (attempt {attempt+1}): {e}")
            if attempt == 0:
                # Retry at even higher DPI (250) for problematic pages
                mat3 = fitz.Matrix(250 / 72, 250 / 72)
                pix2 = page.get_pixmap(matrix=mat3, colorspace=fitz.csRGB)
                png_bytes = pix2.tobytes("png")
                image_part = types.Part.from_bytes(data=png_bytes, mime_type="image/png")
            time.sleep(2 ** attempt)

        except Exception as e:
            last_err = e
            err_str = str(e)
            if "429" in err_str or "quota" in err_str.lower():
                wait = 60 * (attempt + 1)
                print(f"  ⏳ Rate limited. Waiting {wait}s...")
                _interruptible_sleep(wait)
            else:
                print(f"  [warn] tcsion page {page_idx+1} error (attempt {attempt+1}): {e}")
                time.sleep(2 ** attempt)

    print(f"  [error] tcsion page {page_idx+1} failed after {retries} attempts: {last_err}")
    cache_file.write_text("[]")
    return []


def _extract_tcsion_target_question(
    pdf_path: str,
    pdf_hash: str,
    page_idx: int,
    page: 'fitz.Page',
    target_qn: int,
    tracker: CostTracker,
    retries: int = 2,
) -> list[dict]:
    """
    Strong fallback for unresolved TCS iON targets:
    ask the model for one exact question number on one page.
    This is slower than the normal page parser, but bounded and deterministic.
    """
    cache_file = CACHE_DIR / f"tcsion_target_v1_{pdf_hash}_q{target_qn}_p{page_idx:04d}.json"
    if cache_file.exists():
        try:
            return json.loads(cache_file.read_text())
        except Exception:
            pass

    page_text = _tcsion_local_context_text(page)
    pix = page.get_pixmap(matrix=_MAT_FULL, colorspace=fitz.csRGB)
    png_bytes = pix.tobytes("png")
    image_part = types.Part.from_bytes(data=png_bytes, mime_type="image/png")
    prompt = _TCSION_TARGET_PROMPT_TEMPLATE.format(target_qn=int(target_qn))

    last_err = None
    for attempt in range(retries):
        try:
            _RPM.wait()
            resp = _generate_content_with_vision_compat(
                model=_VISION_FULL_MODEL,
                contents=[prompt, image_part],
                temperature=0.0,
                max_output_tokens=2048,
            )
            tracker.record(f"tcsion_target_q{target_qn}_p{page_idx+1}", resp)
            raw = (resp.text or "").strip()
            raw = re.sub(r"^```(?:json)?", "", raw).strip().rstrip("`").strip()
            if not raw or raw == "[]":
                cache_file.write_text("[]")
                return []
            items = json.loads(raw)
            if not isinstance(items, list):
                raise ValueError(f"Expected list, got {type(items)}")

            questions = []
            for item in items:
                q_num = int(item.get("q") or 0)
                if q_num != int(target_qn):
                    continue
                ans_raw = item.get("ans")
                correct_letter = _NUM_TO_LETTER.get(ans_raw) if ans_raw is not None else None
                q_text = (item.get("text") or "").strip()
                opt_a = (item.get("a") or "").strip()
                opt_b = (item.get("b") or "").strip()
                opt_c = (item.get("c") or "").strip()
                opt_d = (item.get("d") or "").strip()
                normalized_q_text, normalized_q_type = _normalize_tcsion_match_question(item, q_text)
                if not normalized_q_text or len(normalized_q_text) < 5:
                    continue
                questions.append({
                    "question_number": q_num,
                    "question_text": normalized_q_text,
                    "option_a": opt_a,
                    "option_b": opt_b,
                    "option_c": opt_c,
                    "option_d": opt_d,
                    "correct_answer": correct_letter,
                    "exam_section": "General Studies",
                    "passage": "",
                    "question_type": normalized_q_type or ("Match" if "__MATCH__:" in normalized_q_text else "MCQ"),
                    "needs_review": (correct_letter is None) or not (opt_a and opt_b and opt_c and opt_d),
                })
            questions = _merge_tcsion_text_layer_fallback(page_text, questions)
            cache_file.write_text(json.dumps(questions))
            return questions
        except Exception as e:
            last_err = e
            time.sleep(2 ** attempt)

    print(f"  [error] tcsion target q{target_qn} page {page_idx+1} failed after {retries} attempts: {last_err}")
    cache_file.write_text("[]")
    return []


def extract_tcsion_vision(
    pdf_path: str,
    pdf_hash: str,
    shift: 'ShiftInfo',
    tracker: CostTracker,
    progress_callback=None,
) -> list[dict]:
    """
    Full TCSiON extraction via vision: reads question text + correct answer
    from rendered page images. Replaces text-regex extraction + separate
    answer-vision step entirely. One Gemini call per page, results cached.
    """
    doc = fitz.open(pdf_path)
    seen: dict[int, dict] = {}
    total_pages = shift.end_page - shift.start_page + 1

    for i, page_idx in enumerate(range(shift.start_page, shift.end_page + 1)):
        page_qs = _extract_tcsion_page(pdf_path, pdf_hash, page_idx, doc[page_idx], tracker)
        for q in page_qs:
            n = q["question_number"]
            if n not in seen:
                seen[n] = q
            else:
                # Prefer the more complete version: replace if new has all 4 options
                # and the stored one doesn't. TCSiON PDFs show each question twice;
                # the first occurrence (preview page) often has partial options.
                existing = seen[n]
                existing_opts = sum(1 for k in ("option_a","option_b","option_c","option_d") if existing.get(k))
                new_opts = sum(1 for k in ("option_a","option_b","option_c","option_d") if q.get(k))
                if new_opts > existing_opts:
                    seen[n] = q
        if progress_callback:
            progress_callback(i + 1, total_pages)

    doc.close()

    questions = clean_and_dedupe_questions(list(seen.values()))
    found_ans = sum(1 for q in questions if q.get("correct_answer"))
    print(f"  [tcsion-vision] Shift {shift.shift_label}: "
          f"{len(questions)} questions, {found_ans} with answers")
    return questions


# ── AP High Court vision extraction ─────────────────────────────────────────

_AP_HC_SIG_RE = re.compile(r'AP\s+High\s+Court|APHC\s+CBT|High\s+Court.*Hyderabad|Hyderabad.*High\s+Court', re.IGNORECASE)

_AP_HC_VISION_PROMPT = """This is a page from an AP High Court computer-based exam (CBT) answer key PDF.

ANSWER DETECTION — READ THIS FIRST:
This is the OFFICIAL ANSWER KEY, not a candidate's attempt. Every question has exactly one correct answer already marked.
The CORRECT answer option is shown with a GREEN/TEAL filled background or a GREEN ✓ tick mark next to it.
The WRONG answer options are shown with a RED filled background or a RED ✗ cross mark.
DO NOT guess — if you can see the green/teal highlight, use it. If the page is a question paper without color marks (no green/red), set "ans": null for all questions on that page.

Layout:
- Each question starts with "Q.N" or just "N." followed by the question text.
- Options are numbered "1." "2." "3." "4." below each question.
- The page header contains "AP High Court", "Test Date", "Test Time", "Subject", Roll No — SKIP all of this.
- Page numbers (standalone digits or "Page N of M") — SKIP.
- The PDF may be 2-column layout — read both columns left to right.
- If the paper is bilingual (English + Telugu), extract ONLY the English version.

YOUR TASK: For every question visible on this page, extract:
  "q"         - question number (integer)
  "text"      - COMPLETE question text in English (full sentence, no truncation)
  "passage"   - if this question is based on a passage/text/paragraph shown above the question(s), include the FULL passage text here. If no passage, omit or use "".
  "has_image" - true if the question contains a figure/diagram/shape, OR if the answer options are figures/images
  "a"         - COMPLETE text of option 1 (full value — years, names, dates, etc.)
  "b"         - COMPLETE text of option 2
  "c"         - COMPLETE text of option 3
  "d"         - COMPLETE text of option 4
  "ans"       - which option number is CORRECT (1, 2, 3, or 4). null if you cannot tell.

MATCH-THE-FOLLOWING RULES (CRITICAL):
- When you see a question with two columns (Column I / Column II, List I / List II, or items labeled I/II/III/IV paired with a/b/c/d or 1/2/3/4):
  - "text" = the question stem only (e.g. "Match the following columns I and II about Constitutional Amendment Acts:")
  - "match_left"  = ordered list of items from the LEFT column (Column I / List I), e.g. ["42nd Amendment", "44th Amendment", "61st Amendment", "73rd Amendment"]
  - "match_right" = ordered list of items from the RIGHT column (Column II / List II), e.g. ["Voting age reduced", "Panchayati Raj", "Fundamental Duties", "Right to Property removed"]
  - "a", "b", "c", "d" = the answer-code options printed below the table (e.g. "I-a, II-b, III-c, IV-d")
  - "ans" = the highlighted correct option as usual (1, 2, 3, or 4)
- Extract ALL rows from both columns — do NOT skip or truncate any items.
- IMAGE TABLE (very common in these PDFs): If the match table is rendered as a GRAPHIC/IMAGE (you can see the question stem text but the two-column table is a picture and you cannot clearly read individual cell values):
  - STILL include this question in your output with its correct question number.
  - Set "text" = the question stem you can see (e.g. "Match the following:")
  - Set "has_image": true
  - Set "match_left": [] and "match_right": [] (empty — cannot read from image)
  - The answer-code options (a/b/c/d) are usually text BELOW the image — extract them if visible.
  - CRITICAL: Do NOT use text from the question above or below as the "text" value. The "text" must be the stem of THIS question only. If you cannot determine the stem, use "Match the following:" as a safe default.

PASSAGE RULES (very important):
- If you see a block of text above a group of questions (reading comprehension, "based on the following passage", "read the following", etc.), that block is a PASSAGE.
- Copy the FULL passage text into the "passage" field of EVERY question that belongs to it on this page.
- Do NOT put the passage text inside "text" — "text" is only the question itself (e.g. "What is the main idea of the passage?").
- If a question starts with "Q.N Based on the above passage..." or similar, its passage is shown earlier on this page or on a previous page — include the passage text if visible on this page.

FIGURE/VISUAL QUESTION RULES:
- If the answer options are FIGURES or IMAGES (not text) — e.g. figure embedding, analogy, matrix, spatial reasoning — set:
    "has_image": true
    "a": "[Figure 1]"
    "b": "[Figure 2]"
    "c": "[Figure 3]"
    "d": "[Figure 4]"
    "ans": whichever figure option is highlighted GREEN / has ✓ (1, 2, 3, or 4), or null if unclear.
- If the question stem has a diagram/figure but options are text, set "has_image": true and extract option text normally.
- If purely text-based (no figures), omit "has_image" or set false.

CRITICAL RULES:
- NEVER truncate option text — "2016", "1858", "1810 to 1858", "Rs. 2,000" must appear in full.
- If a question spans the bottom of this page and is cut off, include what is visible.
- Skip cover pages, instruction pages, blank pages — return [] for those.
- Do NOT repeat the same question number twice.
- Return ONLY a valid JSON array, no markdown, no explanation:

[{"q":1,"text":"When was the AP High Court established?","a":"1954","b":"1956","c":"1958","d":"1960","ans":2},{"q":15,"text":"Match the following columns I and II about Constitutional Amendment Acts:","match_left":["42nd Amendment Act","44th Amendment Act","61st Amendment Act","73rd Amendment Act"],"match_right":["Fundamental Duties added","Right to Property removed","Voting age reduced to 18 years","Panchayati Raj"],"a":"I-c, II-d, III-a, IV-b","b":"I-a, II-b, III-c, IV-d","c":"I-d, II-c, III-b, IV-a","d":"I-b, II-a, III-d, IV-c","ans":1},{"q":72,"text":"Select the option in which the given figure is embedded.","has_image":true,"a":"[Figure 1]","b":"[Figure 2]","c":"[Figure 3]","d":"[Figure 4]","ans":3}]

If no questions on this page: []
"""


def _page_ap_hc_cache_key(pdf_hash: str, page_idx: int) -> Path:
    # v6: invalidate older APHC caches so pages are re-extracted through the
    # SDK-compatible path and can repopulate missing passage fields.
    return CACHE_DIR / f"aphc_v6_{pdf_hash}_p{page_idx:04d}.json"


def _is_ap_hc_format(pdf_path: str) -> bool:
    """Return True if this is an AP High Court CBT PDF."""
    doc = fitz.open(pdf_path)
    for i in range(min(3, len(doc))):
        if _AP_HC_SIG_RE.search(doc[i].get_text("text")):
            doc.close()
            return True
    doc.close()
    return False


def _extract_ap_hc_page(
    pdf_hash: str,
    page_idx: int,
    png_bytes: bytes,
    tracker: CostTracker,
    retries: int = 3,
) -> list[dict]:
    """Vision extraction for one AP High Court page. Returns list of question dicts."""
    cache_file = _page_ap_hc_cache_key(pdf_hash, page_idx)
    if cache_file.exists():
        try:
            data = json.loads(cache_file.read_text())
            print(f"  [cache] aphc page {page_idx+1}: {len(data)} questions")
            return data
        except Exception:
            pass

    image_part = types.Part.from_bytes(data=png_bytes, mime_type="image/png")
    last_err = None

    for attempt in range(retries):
        try:
            _RPM.wait()
            resp = _generate_content_with_vision_compat(
                model=_VISION_FULL_MODEL,
                contents=[_AP_HC_VISION_PROMPT, image_part],
                temperature=0.0,
                max_output_tokens=4096,
            )
            tracker.record(f"aphc_p{page_idx+1}", resp)

            raw = (resp.text or "").strip()
            raw = re.sub(r"^```(?:json)?", "", raw).strip().rstrip("`").strip()

            if not raw or raw == "[]":
                cache_file.write_text("[]")
                return []

            items = json.loads(raw)
            if not isinstance(items, list):
                raise ValueError(f"Expected list, got {type(items)}")

            questions = []
            for item in items:
                q_num = item.get("q")
                if q_num is None:
                    continue
                try:
                    q_num = int(q_num)
                except (TypeError, ValueError):
                    continue

                ans_raw = item.get("ans")
                correct_letter = _NUM_TO_LETTER.get(ans_raw) if ans_raw is not None else None

                q_text    = (item.get("text") or "").strip()
                opt_a     = (item.get("a") or "").strip()
                opt_b     = (item.get("b") or "").strip()
                opt_c     = (item.get("c") or "").strip()
                opt_d     = (item.get("d") or "").strip()
                has_image = bool(item.get("has_image"))
                passage   = (item.get("passage") or "").strip()

                if not q_text or len(q_text) < 5:
                    continue

                # Handle match-the-following: embed column data into __MATCH__: payload
                match_left  = [str(x).strip() for x in (item.get("match_left") or []) if str(x).strip()]
                match_right = [str(x).strip() for x in (item.get("match_right") or []) if str(x).strip()]
                if match_left and match_right and len(match_left) >= 2 and len(match_right) >= 2:
                    payload = json.dumps({"col1": match_left, "col2": match_right}, ensure_ascii=False)
                    q_text = q_text + "\n\n__MATCH__:" + payload
                    q_type = "Match"
                elif item.get("has_image") and (item.get("match_left") is not None or "match" in q_text.lower()):
                    # Image-rendered match table: Gemini flagged has_image=true and returned empty columns.
                    # Store as Match type with has_image=true so the UI shows the page image instead.
                    q_type = "Match"
                    has_image = True
                else:
                    # Attempt inline recovery in case model dumped columns into text
                    recovered = _recover_inline_match_payload(q_text)
                    if recovered:
                        intro, col1, col2 = recovered
                        payload = json.dumps({"col1": col1, "col2": col2}, ensure_ascii=False)
                        q_text = intro + "\n\n__MATCH__:" + payload
                        q_type = "Match"
                    else:
                        q_type = "MCQ"

                # For figure-option questions the options are "[Figure N]" — not missing
                has_text_options = opt_a and not opt_a.startswith("[Figure")

                questions.append({
                    "question_number": q_num,
                    "question_text":   q_text,
                    "option_a":        opt_a,
                    "option_b":        opt_b,
                    "option_c":        opt_c,
                    "option_d":        opt_d,
                    "correct_answer":  correct_letter,
                    "exam_section":    "General Studies",
                    "passage":         passage,
                    "question_type":   q_type,
                    "has_image":       has_image,
                    # needs_review: true only if answer is missing AND it's not an image question
                    # (image-match questions intentionally have empty options — that's expected)
                    "needs_review":    (correct_letter is None) or (not has_image and not has_text_options),
                    "_page_idx":       page_idx,
                })

            # Only cache if enough answers were detected.
            # Pages where Gemini returned mostly null answers are NOT cached so
            # the next upload will re-run vision on them instead of reusing stale nulls.
            found = sum(1 for q in questions if q.get("correct_answer"))
            if not questions or (found / len(questions)) >= _APHC_MIN_ANSWER_FRACTION:
                cache_file.write_text(json.dumps(questions))
            else:
                print(f"  [aphc-vision] page {page_idx+1}: only {found}/{len(questions)} answers — NOT caching (will retry next upload)")
            print(f"  [aphc-vision] page {page_idx+1}: {len(questions)} questions extracted, {found} with answers")
            return questions

        except json.JSONDecodeError as e:
            last_err = e
            print(f"  [warn] aphc page {page_idx+1} JSON error (attempt {attempt+1}): {e}")
            if attempt == 0:
                # Retry at higher DPI for problematic pages — caller must pass new bytes;
                # we simply retry with the same image (higher DPI render is done outside)
                pass
            time.sleep(2 ** attempt)

        except Exception as e:
            last_err = e
            err_str = str(e)
            if "429" in err_str or "quota" in err_str.lower():
                wait = 60 * (attempt + 1)
                print(f"  ⏳ Rate limited. Waiting {wait}s...")
                _interruptible_sleep(wait)
            elif "timed out" in err_str.lower():
                # Vertex AI was slow — give it 30s before retrying, not 1-4s
                wait = 30 * (attempt + 1)
                print(f"  [warn] aphc page {page_idx+1} timed out (attempt {attempt+1}), waiting {wait}s...")
                _interruptible_sleep(wait)
            else:
                print(f"  [warn] aphc page {page_idx+1} error (attempt {attempt+1}): {e}")
                time.sleep(2 ** attempt)

    print(f"  [error] aphc page {page_idx+1} failed after {retries} attempts: {last_err}")
    cache_file.write_text("[]")
    return []


def extract_ap_hc_vision(
    pdf_path: str,
    pdf_hash: str,
    shift: 'ShiftInfo',
    tracker: CostTracker,
    progress_callback=None,
    parallel_workers: int = 2,
) -> list[dict]:
    """
    Full AP High Court vision extraction — Gemini reads each page image and
    returns question text + all 4 options + correct answer in one shot.
    No regex, no text-layer parsing. Runs 2 pages in parallel (4 caused 429s).
    """
    import threading as _threading
    doc = fitz.open(pdf_path)
    page_indices = list(range(shift.start_page, shift.end_page + 1))
    total_pages = len(page_indices)

    # Pre-render all pages in main thread (fitz is not thread-safe).
    # 250 DPI (_MAT_APHC) makes green option highlights clearly distinguishable.
    page_images: dict[int, bytes] = {}
    for page_idx in page_indices:
        pix = doc[page_idx].get_pixmap(matrix=_MAT_APHC, colorspace=fitz.csRGB)
        page_images[page_idx] = pix.tobytes("png")
    doc.close()

    seen: dict[int, dict] = {}
    done_count = [0]
    lock = _threading.Lock()

    def _process_page(page_idx: int) -> list[dict]:
        return _extract_ap_hc_page(pdf_hash, page_idx, page_images[page_idx], tracker)

    # Collect results keyed by page so we can process in page order for passage carry-forward
    page_results: dict[int, list[dict]] = {}

    with _cf.ThreadPoolExecutor(max_workers=parallel_workers, thread_name_prefix="aphc-vis") as pool:
        futures = {pool.submit(_process_page, idx): idx for idx in page_indices}
        for fut in _cf.as_completed(futures):
            page_idx = futures[fut]
            page_qs = fut.result()
            with lock:
                page_results[page_idx] = page_qs
                done_count[0] += 1
                if progress_callback:
                    progress_callback(done_count[0], total_pages)

    # Process pages in order so passage carry-forward works correctly:
    # If page N ends with passage questions, page N+1 questions that have no passage
    # inherit the last seen passage (common when a passage spans a page boundary).
    last_passage = ""
    for page_idx in sorted(page_results.keys()):
        page_qs = page_results[page_idx]
        for q in page_qs:
            if q.get("passage"):
                last_passage = q["passage"]
            elif last_passage:
                # This question has no passage on its page — carry forward from previous page
                q["passage"] = last_passage
            n = q["question_number"]
            if n not in seen:
                seen[n] = q
        # Reset after every page. Gemini re-extracts the passage on every page it appears,
        # so cross-page carry is never needed. Keeping last_passage alive across pages
        # causes Q61's sentence-rearrangement "passage" to bleed into Q62-Q64.
        last_passage = ""

    questions = clean_and_dedupe_questions(list(seen.values()))
    found_ans = sum(1 for q in questions if q.get("correct_answer"))
    with_passage = sum(1 for q in questions if q.get("passage"))
    print(f"  [aphc-vision] Shift {shift.shift_label}: "
          f"{len(questions)} questions, {found_ans} with answers, {with_passage} with passage")
    return questions


def extract_answers_vision(
    pdf_path: str,
    pdf_hash: str,
    shift: ShiftInfo,
    tracker: CostTracker,
    progress_callback=None,
    parallel_workers: int = 4,
) -> dict[int, dict]:
    """
    Run vision answer detection for all pages in a shift in parallel.
    Uses 4 concurrent threads — safe because _RPM is thread-safe and each page
    writes to its own cache file. Reduces wall-clock time ~4×.
    """
    import threading
    doc = fitz.open(pdf_path)
    page_indices = list(range(shift.start_page, shift.end_page + 1))
    total_pages = len(page_indices)

    # Pre-render all pages to PNG bytes in the main thread (fitz is not thread-safe)
    page_images: dict[int, bytes] = {}
    for page_idx in page_indices:
        pix = doc[page_idx].get_pixmap(matrix=_MAT, colorspace=fitz.csRGB)
        page_images[page_idx] = pix.tobytes("png")
    doc.close()

    all_answers: dict[int, dict] = {}
    done_count = [0]
    lock = threading.Lock()

    def _process_page(page_idx: int) -> tuple[int, dict[int, dict]]:
        """Process a single page — called from thread pool."""
        cache_file = _page_ans_cache_key(pdf_hash, page_idx)
        if cache_file.exists():
            try:
                data = json.loads(cache_file.read_text())
                result: dict[int, dict] = {}
                for k, v in data.items():
                    result[int(k)] = v if isinstance(v, dict) else {"ans": v}
                print(f"  [cache] page {page_idx+1}: {len(result)} answers")
                return page_idx, result
            except Exception:
                pass

        png_bytes = page_images[page_idx]
        image_part = types.Part.from_bytes(data=png_bytes, mime_type="image/png")
        last_err = None
        for attempt in range(3):
            try:
                _RPM.wait()
                resp = _generate_content_with_vision_compat(
                    model=_VISION_MODEL,
                    contents=[_ANSWER_PROMPT, image_part],
                    temperature=0.0,
                    max_output_tokens=1024,
                )
                tracker.record(f"ans_p{page_idx+1}", resp)

                raw = (resp.text or "").strip()
                raw = re.sub(r"^```(?:json)?", "", raw).strip().rstrip("`").strip()
                if not raw or raw == "[]":
                    cache_file.write_text("{}")
                    return page_idx, {}

                items = json.loads(raw)
                if not isinstance(items, list):
                    raise ValueError(f"Expected list, got {type(items)}")

                result = {}
                for item in items:
                    q_num = item.get("q")
                    ans_raw = item.get("ans")
                    if q_num is None:
                        continue
                    letter = _NUM_TO_LETTER.get(ans_raw) if ans_raw is not None else None
                    entry: dict = {"ans": letter}
                    ml = item.get("match_left")
                    mr = item.get("match_right")
                    if isinstance(ml, list) and isinstance(mr, list) and len(ml) >= 2 and len(mr) >= 2:
                        entry["match_left"] = [str(x).strip() for x in ml if str(x).strip()]
                        entry["match_right"] = [str(x).strip() for x in mr if str(x).strip()]
                    result[int(q_num)] = entry

                cache_file.write_text(json.dumps({str(k): v for k, v in result.items()}))
                n = len(result)
                match_n = sum(1 for v in result.values() if "match_left" in v)
                print(f"  [vision] page {page_idx+1}: {n} answers detected, {match_n} match tables extracted")
                return page_idx, result

            except json.JSONDecodeError as e:
                last_err = e
                print(f"  [warn] page {page_idx+1} JSON error (attempt {attempt+1}): {e}")
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

        print(f"  [error] page {page_idx+1} failed after 3 attempts: {last_err}")
        cache_file.write_text("{}")
        return page_idx, {}

    with _cf.ThreadPoolExecutor(max_workers=parallel_workers, thread_name_prefix="cbt-vis") as pool:
        futures = {pool.submit(_process_page, idx): idx for idx in page_indices}
        for fut in _cf.as_completed(futures):
            page_idx, page_answers = fut.result()
            with lock:
                for q_num, entry in page_answers.items():
                    if q_num not in all_answers:
                        all_answers[q_num] = entry
                done_count[0] += 1
                if progress_callback:
                    progress_callback(done_count[0], total_pages)

    found = sum(1 for v in all_answers.values() if v.get("ans") is not None)
    match_found = sum(1 for v in all_answers.values() if "match_left" in v)
    print(f"  [vision] Shift {shift.shift_label}: "
          f"{found}/{len(all_answers)} answers detected, {match_found} match tables extracted")
    return all_answers


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — MERGE text questions with vision answers
# ══════════════════════════════════════════════════════════════════════════════

def merge_questions_answers(
    questions: list[dict],
    answers: dict[int, dict],
    shift: ShiftInfo,
) -> list[dict]:
    """
    Inject correct_answer from vision into text-extracted questions.
    Also wires match table data (match_left/match_right) into __MATCH__: payload.
    Stamps each question with shift metadata.
    """
    merged = []
    no_ans = 0

    for q in questions:
        q_num = q["question_number"]
        entry = answers.get(q_num) or {}
        answer = entry.get("ans")

        if answer is None:
            no_ans += 1

        q_merged = {
            **q,
            "correct_answer": answer or "",
            "needs_review":   (answer is None) or q.get("needs_review", False),
            "shift_label":    shift.shift_label,
            "test_date":      shift.test_date,
            "test_time":      shift.test_time,
        }

        # Wire match table columns from vision into structured __MATCH__: payload
        match_left = entry.get("match_left")
        match_right = entry.get("match_right")
        if (isinstance(match_left, list) and isinstance(match_right, list)
                and len(match_left) >= 2 and len(match_right) >= 2
                and "__MATCH__:" not in (q.get("question_text") or "")):
            intro = (q.get("question_text") or "Match the following:").strip()
            payload = json.dumps({"col1": match_left, "col2": match_right}, ensure_ascii=False)
            q_merged["question_text"] = intro + "\n\n__MATCH__:" + payload
            q_merged["question_type"] = "Match"
            q_merged["needs_review"] = answer is None

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
    expected_count: int = 0,
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
    pdf_hash = hashlib.sha256(Path(pdf_path).read_bytes()).hexdigest()[:16]
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
        answers = extract_answers_vision(pdf_path, pdf_hash, shift, tracker)

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

    if total_inserted == 0 and not dry_run:
        raise RuntimeError(
            "No questions were found in the PDF text layer. "
            "This usually happens with scanned/image-based TSPSC papers. "
            "FIX: Please delete this exam and re-upload using the 'Universal/Vision' or 'Scanned' option."
        )

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
    expected_count: int = 0,
    force_replace: bool = False,
) -> None:
    """
    Background thread entry point — mirrors process_job_background() in pipeline.py.
    Updates job progress/status in Supabase as the pipeline runs.
    """
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from config import supabase as sb
    from papers import mark_paper_lifecycle, paper_id_for_job, should_delete_pdf_after_job

    def _upd(progress: Optional[int] = None, status: Optional[str] = None, error: Optional[str] = None):
        data: dict = {}
        if progress is not None:
            data["progress"] = progress
        if status:
            data["status"] = status
        # In CBT we might have multiple messages, but usually we just set the final gap list.
        if error:
            data["error_log"] = error
        if data:
            try:
                sb.table("jobs").update(data).eq("id", job_id).execute()
            except Exception:
                pass

    try:
        _upd(progress=2, status="processing")

        # Throttle helper: only write to Supabase every 3 s so we don't spam
        # the DB with hundreds of updates for large PDFs.
        import time as _time
        _last_upd_ts: list[float] = [0.0]

        def _throttled_upd(progress: Optional[int] = None, error: Optional[str] = None, force: bool = False):
            now = _time.monotonic()
            if not force and now - _last_upd_ts[0] < 3.0:
                return
            _last_upd_ts[0] = now
            _upd(progress=progress, error=error)

        # Calculate hash ONCE at start to prevent FileNotFoundError in large loops
        print(f"[CBT job {job_id[:12]}] Generating PDF hash...")
        pdf_hash = hashlib.sha256(Path(pdf_path).read_bytes()).hexdigest()[:16]

        # Step 1: detect shifts — write progress to error_log (TEXT, no CHECK constraint)
        # keeping status="processing" so the frontend polling branch stays correct.
        _upd(progress=5, error="Scanning shift page 0 of ?...")

        def _shift_scan_cb(done: int, total: int):
            p = 5 + int(5 * done / max(total, 1))  # 5 → 10 %
            _throttled_upd(progress=p, error=f"Scanning shift page {done} of {total}...")

        shifts = detect_shifts(pdf_path, progress_callback=_shift_scan_cb)

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

        # Detect format ONCE — TCSiON and AP High Court use unified vision extraction,
        # Telegram CBT falls back to text-layer + separate vision answer detection
        is_tcsion = _is_tcsion_format(pdf_path)
        is_ap_hc  = not is_tcsion and _is_ap_hc_format(pdf_path)
        if is_tcsion:
            _upd(progress=10, error="TCSiON format detected — using vision extraction...")
            print(f"  [format] TCSiON CAE detected — using unified vision pipeline")
        elif is_ap_hc:
            _upd(progress=10, error="AP High Court format detected — using vision extraction...")
            print(f"  [format] AP High Court CBT detected — using unified vision pipeline")
        else:
            print(f"  [format] Telegram CBT format — using text + vision pipeline")

        for shift_num, shift in enumerate(shifts, 1):
            shift_base_progress = 10 + int(80 * (shift_num - 1) / n_shifts)
            shift_end_progress  = 10 + int(80 * shift_num / n_shifts)
            vision_budget = int((shift_end_progress - shift_base_progress) * 0.85)

            def _vision_progress(done: int, total: int,
                                  _base=shift_base_progress, _end=shift_end_progress,
                                  _budget=vision_budget, _sh=shift):
                p = _base + 5 + int(_budget * done / max(total, 1))
                msg = f"Reading page {done} of {total} in {_sh.shift_label}..."
                _upd(progress=min(p, _end - 5), error=msg)

            if is_tcsion:
                # ── TCSiON: single vision pass → question text + answer together ──
                _upd(progress=shift_base_progress + 2,
                     error=f"Extracting {shift.shift_label} via vision...")
                merged = extract_tcsion_vision(
                    pdf_path, pdf_hash, shift, tracker,
                    progress_callback=_vision_progress,
                )
                for q in merged:
                    q.setdefault("shift_label", shift.shift_label)
                    q.setdefault("test_date",   shift.test_date)
                    q.setdefault("test_time",   shift.test_time)
            elif is_ap_hc:
                # ── AP High Court: single vision pass → question text + options + answer ──
                _upd(progress=shift_base_progress + 2,
                     error=f"Extracting {shift.shift_label} via vision...")
                merged = extract_ap_hc_vision(
                    pdf_path, pdf_hash, shift, tracker,
                    progress_callback=_vision_progress,
                )
                for q in merged:
                    q.setdefault("shift_label", shift.shift_label)
                    q.setdefault("test_date",   shift.test_date)
                    q.setdefault("test_time",   shift.test_time)
                # Upload per-question cropped images (question region includes all 4 option figures)
                image_qs = [q for q in merged if q.get("has_image") and q.get("_page_idx") is not None]
                if image_qs:
                    _upd(error=f"Uploading images for {len(image_qs)} figure question(s)...")
                    try:
                        from extractor.universal_extractor import _upload_page_images, _propagate_di_images  # type: ignore
                        merged = _upload_page_images(merged, pdf_path, exam_name, exam_year, sb)
                        merged = _propagate_di_images(merged)
                        print(f"  [aphc-img] Uploaded {len(image_qs)} question image(s)")
                    except Exception as _img_err:
                        print(f"  [aphc-img] Image upload failed: {_img_err}")
            else:
                # ── Telegram CBT: text layer for questions, vision for answers ──
                _upd(progress=shift_base_progress + 2,
                     error=f"Reading text layer page 0 of ? in {shift.shift_label}...")

                def _text_layer_progress(done: int, total: int,
                                          _base=shift_base_progress, _sh=shift):
                    # Map text-layer pages to a 3% band before vision starts
                    p = _base + 2 + int(3 * done / max(total, 1))
                    _throttled_upd(
                        progress=p,
                        error=f"Reading text layer page {done} of {total} in {_sh.shift_label}...",
                    )

                questions = extract_text_questions(pdf_path, shift, progress_callback=_text_layer_progress)
                if not questions:
                    continue
                answers = extract_answers_vision(pdf_path, pdf_hash, shift, tracker,
                                                 progress_callback=_vision_progress)
                merged = merge_questions_answers(questions, answers, shift)

            if not merged:
                print(f"  [warn] Shift {shift.shift_label}: no questions extracted — skipping")
                continue

            # Validation
            if expected_count > 0 and len(merged) != expected_count:
                print(f"  [warn] Shift {shift.shift_label}: found {len(merged)}, "
                      f"expected {expected_count}")

            # Step 5a: upload images for any figure/graph/table questions not already uploaded
            _image_qs = [q for q in merged if q.get("has_image") and not q.get("image_url")]
            if _image_qs:
                _upd(error=f"Uploading images for {len(_image_qs)} figure question(s)...")
                try:
                    from extractor.universal_extractor import _upload_page_images, _propagate_di_images  # type: ignore
                    merged = _upload_page_images(merged, pdf_path, exam_name, exam_year, sb)
                    merged = _propagate_di_images(merged)
                except Exception as _img_err:
                    print(f"  [cbt-img] Image upload failed (non-fatal): {_img_err}")

            # Step 5b: tag
            _upd(progress=shift_end_progress - 4)
            from pipeline import tag_questions, store_questions, CostTracker as _PCT
            tag_tracker = _PCT()
            tagged = tag_questions(merged, exam_name, tracker=tag_tracker)

            # Step 5b: store
            _upd(progress=shift_end_progress - 2)
            result = store_questions(tagged, pdf_path, exam_name, exam_year, job_id=job_id, force_replace=force_replace)
            total_inserted += result.get("inserted", 0)
            total_skipped  += result.get("skipped", 0)
            
        if total_inserted == 0:
            print(f"[CBT job {job_id}] zero questions found in text layer. Falling back to Universal/Vision extractor.")
            # Status "recovering" is used to show the user we are attempting a deeper scan
            _upd(status="processing", error="Auto-Recovery: Text extraction failed. Switching to Deep Vision engine (Guaranteed extraction)...")
            
            # Local import to avoid circular dependency
            from extractor.universal_extractor import process_universal_job_background
            return process_universal_job_background(
                job_id=job_id,
                pdf_path=pdf_path,
                exam_name=exam_name,
                exam_year=exam_year
            )

        # ── Detect missing question numbers ───────────────────────────────────
        missing_log = ""
        missing_after_repair: list[str] = []
        try:
            from config import supabase as _sb  # type: ignore
            current_paper_id = paper_id_for_job(job_id, sb=_sb)
            stored_rows = (
                _sb.table("questions")
                .select("question_number, option_a, option_b, option_c, option_d, is_active")
                .eq("paper_id", current_paper_id)
                .execute()
                .data
                or []
            )
            all_qns = [r["question_number"] for r in stored_rows if isinstance(r.get("question_number"), int)]
            if all_qns:
                max_qn = max(expected_count or 0, max(all_qns))
                if max_qn > 0:
                    extracted_set = set(all_qns)
                    missing_nums = [i for i in range(1, max_qn + 1) if i not in extracted_set]
                    incomplete_nums = sorted({
                        int(r["question_number"])
                        for r in stored_rows
                        if isinstance(r.get("question_number"), int)
                        and (
                            sum(1 for k in ("option_a", "option_b", "option_c", "option_d") if str(r.get(k) or "").strip()) < 4
                            or r.get("is_active") is False
                        )
                    })
                    target_repair_nums = sorted(set(missing_nums + incomplete_nums))
                    if target_repair_nums:
                        print(
                            f"[CBT job {job_id}] ⚠️ "
                            f"{len(missing_nums)} missing + {len(incomplete_nums)} incomplete Qs: "
                            f"{target_repair_nums[:20]}"
                        )

                        # ── Auto-repair: clear partial/failed-page caches and re-extract ──
                        if (is_ap_hc or is_tcsion) and shifts and Path(pdf_path).exists():
                            _upd(progress=92, error=f"Auto-repairing {len(target_repair_nums)} broken questions...")
                            print(f"[CBT job {job_id}] Auto-repair: identifying pages with missing/incomplete questions...")

                            cache_prefix = "aphc_v5" if is_ap_hc else "tcsion_v12"

                            # Build a map of page_idx → question numbers in that page's cache
                            page_to_qnums: dict[int, set] = {}
                            for cf in CACHE_DIR.glob(f"{cache_prefix}_{pdf_hash}_p*.json"):
                                try:
                                    stem_part = cf.stem.split("_p")[-1]
                                    pidx = int(stem_part)
                                    data = json.loads(cf.read_text())
                                    page_to_qnums[pidx] = {int(q.get("question_number", 0)) for q in data if q.get("question_number")}
                                except Exception:
                                    pass

                            # For each missing question, find which page it belongs to
                            # by checking which page has its immediate neighbors (M-1, M+1, M-2, M+2)
                            missing_set_int = set(target_repair_nums)
                            pages_to_invalidate: set[int] = set()
                            for m in missing_set_int:
                                neighbors = {m - 2, m - 1, m + 1, m + 2}
                                for pidx, qnums in page_to_qnums.items():
                                    if qnums & neighbors:
                                        pages_to_invalidate.add(pidx)
                                        break
                                else:
                                    # No neighbor found — also delete [] caches as fallback
                                    for cf in CACHE_DIR.glob(f"{cache_prefix}_{pdf_hash}_p*.json"):
                                        if cf.read_text().strip() == "[]":
                                            try:
                                                pages_to_invalidate.add(int(cf.stem.split("_p")[-1]))
                                            except Exception:
                                                pass

                            # Delete the identified page caches
                            for pidx in pages_to_invalidate:
                                cf = CACHE_DIR / f"{cache_prefix}_{pdf_hash}_p{pidx:04d}.json"
                                if cf.exists():
                                    cf.unlink()
                            print(f"[CBT job {job_id}] Cleared caches for pages: {sorted(pages_to_invalidate)}")

                            try:
                                _upd(progress=93, error=f"Re-scanning PDF for {len(target_repair_nums)} broken questions...")
                                repair_merged = (
                                    extract_ap_hc_vision(pdf_path, pdf_hash, shifts[0], tracker)
                                    if is_ap_hc
                                    else extract_tcsion_vision(pdf_path, pdf_hash, shifts[0], tracker)
                                )
                                missing_set_int = set(target_repair_nums)
                                repair_hits = [q for q in repair_merged if int(q.get("question_number") or 0) in missing_set_int]

                                if repair_hits:
                                    from pipeline import tag_questions, store_questions
                                    tagged_repair = tag_questions(repair_hits, exam_name, tracker=tracker)
                                    repair_result = store_questions(tagged_repair, pdf_path, exam_name, exam_year, job_id=job_id, force_replace=True)
                                    total_inserted += repair_result.get("inserted", 0)
                                    print(f"[CBT job {job_id}] Auto-repair recovered {len(repair_hits)} questions")
                                else:
                                    print(f"[CBT job {job_id}] Auto-repair: re-scan found no hits for missing Qs")

                                # Re-check what's still missing after repair
                                stored_rows2 = (
                                    _sb.table("questions")
                                    .select("question_number, option_a, option_b, option_c, option_d, is_active")
                                    .eq("paper_id", current_paper_id)
                                    .execute()
                                    .data
                                    or []
                                )
                                all_qns2 = [r["question_number"] for r in stored_rows2 if isinstance(r.get("question_number"), int)]
                                if all_qns2:
                                    extracted2 = set(all_qns2)
                                    max_qn2 = max(expected_count or 0, max(all_qns2))
                                    missing_after_repair = [str(i) for i in range(1, max_qn2 + 1) if i not in extracted2]
                                    incomplete_after_repair = sorted({
                                        int(r["question_number"])
                                        for r in stored_rows2
                                        if isinstance(r.get("question_number"), int)
                                        and (
                                            sum(1 for k in ("option_a", "option_b", "option_c", "option_d") if str(r.get(k) or "").strip()) < 4
                                            or r.get("is_active") is False
                                        )
                                    })
                                    missing_after_repair.extend(str(n) for n in incomplete_after_repair if str(n) not in missing_after_repair)
                            except Exception as _repair_err:
                                print(f"[CBT job {job_id}] Auto-repair failed (non-fatal): {_repair_err}")
                                missing_after_repair = [str(n) for n in target_repair_nums]
                        else:
                            missing_after_repair = [str(n) for n in target_repair_nums]

                        if missing_after_repair:
                            missing_log = f"Missing questions ({len(missing_after_repair)}): {', '.join(missing_after_repair)}"
                            print(f"[CBT job {job_id}] Still missing after repair: {missing_log}")
        except Exception as _me:
            print(f"[CBT job {job_id}] Missing-Q check failed (non-fatal): {_me}")

        # ── Post-store activation pass ─────────────────────────────────────────
        # Any question that has valid text + 4 options + valid answer but ended up
        # is_active=False (due to old pipeline, manual lock race, or upsert edge
        # case) is activated here. This is the permanent catch-all so we never
        # finish a job with avoidable inactive questions.
        try:
            from config import supabase as _sb2  # type: ignore
            from pipeline import _is_publish_blocked  # type: ignore
            inactive_res = _sb2.table("questions").select(
                "id, question_text, option_a, option_b, option_c, option_d, "
                "correct_answer, question_number, question_type, has_image, image_url, "
                "topic, needs_review, exam_name"
            ).eq("exam_name", exam_name).eq("exam_year", exam_year).eq("is_active", False).execute()
            inactive_qs = inactive_res.data or []
            to_activate = []
            for iq in inactive_qs:
                if iq.get("needs_review"):
                    continue
                text = (iq.get("question_text") or "").strip()
                if not text or len(text) < 15:
                    continue
                opts = [iq.get("option_a",""), iq.get("option_b",""), iq.get("option_c",""), iq.get("option_d","")]
                if sum(1 for o in opts if o and o.strip()) < 4:
                    continue
                if (iq.get("correct_answer") or "").strip().upper() not in ("A","B","C","D"):
                    continue
                blocked, _ = _is_publish_blocked(iq, exam_name)
                if not blocked:
                    to_activate.append(iq["id"])
            if to_activate:
                for _id in to_activate:
                    try:
                        _sb2.table("questions").update({"is_active": True}).eq("id", _id).execute()
                    except Exception:
                        pass
                print(f"[CBT job {job_id}] ✅ Post-store activation: activated {len(to_activate)} question(s) that had valid content but were inactive")
        except Exception as _act_err:
            print(f"[CBT job {job_id}] Post-store activation failed (non-fatal): {_act_err}")

        _upd(progress=100, status="completed", error=missing_log)
        mark_paper_lifecycle(
            paper_id_for_job(job_id, sb=sb),
            "ingested",
            last_job_id=job_id,
            sb=sb,
        )
        print(f"[CBT job {job_id}] done — inserted={total_inserted}, "
              f"skipped={total_skipped}, cost=₹{tracker.total_inr():.4f}")

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[CBT job {job_id}] FAILED: {e}\n{tb}")
        # Always write a non-empty error — str(e) can be blank for some exceptions
        err_msg = str(e) or f"{type(e).__name__}: (no message)"
        
        # Format for display: User-friendly message first, then technical details
        final_log = f"⚠️ EXTRACTION ERROR:\n{err_msg}\n\n"
        final_log += f"{'='*50}\nTECHNICAL DETAILS (for support):\n{tb[-1000:]}"
        
        try:
            sb.table("jobs").update({
                "status": "failed",
                "error_log": final_log[:2000],  # Supabase text column limit safety
            }).eq("id", job_id).execute()
            mark_paper_lifecycle(
                paper_id_for_job(job_id, sb=sb),
                "failed",
                last_job_id=job_id,
                sb=sb,
            )
        except Exception as inner:
            print(f"[CBT job {job_id}] Could not write error to DB: {inner}")
    finally:
        # If we didn't fall back, clean up. 
        # If we DID fall back, universal_extractor will clean up.
        if should_delete_pdf_after_job(pdf_path):
            try:
                os.unlink(pdf_path)
            except Exception:
                pass


def recover_missing_cbt_questions_only(
    pdf_path: str,
    exam_name: str,
    exam_year: int,
    *,
    missing_numbers: list[int],
    job_id: str | None = None,
) -> dict:
    """
    Targeted repair path for CBT/TCS iON papers.

    The generic missing-question recovery worker is tuned for normal PDFs and
    split-page OCR recovery. CBT exports, especially TCS iON table questions,
    need to be re-read by the CBT extractor itself or we keep replaying the
    same broken rows.
    """
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from config import supabase as sb
    from pipeline import tag_questions, store_questions, generate_explanations_bulk
    from papers import resolve_paper_id

    missing_set = {int(n) for n in missing_numbers if int(n) > 0}
    if not missing_set:
        return {"recovered": 0, "inserted": 0, "missing_numbers": []}

    def _upd(progress: Optional[int] = None, status: Optional[str] = None, error: Optional[str] = None):
        if not job_id:
            return
        data: dict[str, object] = {}
        if progress is not None:
            data["progress"] = progress
        if status:
            data["status"] = status
        if error is not None:
            data["error_log"] = error
        if data:
            try:
                sb.table("jobs").update(data).eq("id", job_id).execute()
            except Exception:
                pass

    tracker = CostTracker()
    exam_name = exam_name.strip()
    current_paper_id = resolve_paper_id(exam_name=exam_name, exam_year=exam_year, sb=sb)

    is_tcsion = _is_tcsion_format(pdf_path)
    pdf_hash = hashlib.sha256(Path(pdf_path).read_bytes()).hexdigest()[:16]

    recovered: list[dict] = []
    total_target_count = max(len(missing_set), 1)
    persisted_qnums: set[int] = set()
    current_rows_by_qnum: dict[int, dict] = {}
    if current_paper_id:
        try:
            existing_rows = (
                sb.table("questions")
                .select(
                    "id, question_number, question_text, option_a, option_b, option_c, option_d, "
                    "correct_answer, exam_section, passage, subject, topic, subtopic, difficulty, "
                    "canonical_subject, canonical_topic_family, canonical_subtopic_family, "
                    "needs_review, is_active, question_type"
                )
                .eq("paper_id", current_paper_id)
                .in_("question_number", sorted(missing_set))
                .execute()
                .data
                or []
            )
            for row in existing_rows:
                qn = int(row.get("question_number") or 0)
                if qn > 0:
                    current_rows_by_qnum[qn] = row
        except Exception:
            current_rows_by_qnum = {}

    def _merge_hit_with_current_row(hit: dict) -> dict:
        qn = int(hit.get("question_number") or 0)
        base = current_rows_by_qnum.get(qn)
        if not base:
            return hit
        merged = dict(base)
        merged.update({k: v for k, v in hit.items() if k not in {"id", "paper_id"}})
        if not str(merged.get("question_text") or "").strip():
            merged["question_text"] = str(base.get("question_text") or "").strip()
        for key in ("option_a", "option_b", "option_c", "option_d"):
            if not str(merged.get(key) or "").strip():
                merged[key] = str(base.get(key) or "").strip()
        merged["needs_review"] = not all(
            str(merged.get(k) or "").strip() for k in ("question_text", "option_a", "option_b", "option_c", "option_d")
        )
        return merged

    def _flush_recovered_incremental(hits: list[dict], label: str) -> list[int]:
        if not hits:
            return []
        hits = [_merge_hit_with_current_row(q) for q in hits]
        usable_hits = [
            q for q in hits
            if int(q.get("question_number") or 0) > 0 and _is_repair_row_usable(q)
        ]
        if not usable_hits:
            return []

        by_qnum: dict[int, dict] = {}
        for q in usable_hits:
            qn = int(q.get("question_number") or 0)
            current = by_qnum.get(qn)
            score = len((q.get("question_text") or "").strip()) + sum(
                len((q.get(k) or "").strip()) for k in ("option_a", "option_b", "option_c", "option_d")
            )
            current_score = -1
            if current:
                current_score = len((current.get("question_text") or "").strip()) + sum(
                    len((current.get(k) or "").strip()) for k in ("option_a", "option_b", "option_c", "option_d")
                )
            if current is None or score >= current_score:
                by_qnum[qn] = q

        fresh = [q for qn, q in by_qnum.items() if qn not in persisted_qnums]
        if not fresh:
            return []

        cleaned_hits = clean_and_dedupe_questions(fresh)
        tagged_hits = tag_questions(cleaned_hits, exam_name, tracker=tracker)
        if not tagged_hits:
            return []

        store_questions(
            tagged_hits,
            pdf_path,
            exam_name,
            exam_year,
            paper_id=current_paper_id,
            job_id=job_id,
            force_replace=True,
        )
        stored_numbers = [
            int(q.get("question_number") or 0)
            for q in tagged_hits
            if int(q.get("question_number") or 0) > 0
        ]
        persisted_qnums.update(stored_numbers)
        print(f"  [repair-store] {label}: stored question numbers {stored_numbers}")
        return stored_numbers

    def _report_target_progress(stage_floor: int, stage_ceiling: int, label: str):
        recovered_qnums = {
            int(q.get("question_number") or 0)
            for q in recovered
            if int(q.get("question_number") or 0) > 0 and _is_repair_row_usable(q)
        }
        pct = stage_floor + int((stage_ceiling - stage_floor) * len(recovered_qnums) / total_target_count)
        _upd(
            progress=max(stage_floor, min(stage_ceiling, pct)),
            status=label,
            error=f"Repairing CBT rows: recovered {len(recovered_qnums)}/{total_target_count} targets",
        )

    _upd(progress=5, status="processing", error=f"Repairing CBT rows: {sorted(missing_set)[:20]}")

    # Fast path for TCS iON exports:
    # these PDFs usually expose the real question number in the text layer on
    # each page ("Question Number : 17 ..."). For repairs we should not scan
    # the full paper/shift again. First identify the exact target pages cheaply,
    # then run vision only on those pages.
    if is_tcsion:
        doc = fitz.open(pdf_path)
        total_pages = len(doc)
        page_index_by_qnum: dict[int, list[int]] = {}

        try:
            full_text = "\n".join(doc[i].get_text("text") for i in range(total_pages))
            holistic_hits = [
                _merge_hit_with_current_row(q)
                for q in _parse_tcsion_full_text(full_text)
                if int(q.get("question_number") or 0) in missing_set
            ]
            if holistic_hits:
                recovered.extend(holistic_hits)
                _flush_recovered_incremental(holistic_hits, "holistic-tcs-parse")
                _report_target_progress(20, 35, "Recovered target rows from holistic TCS parse...")
        except Exception as e:
            print(f"  [warn] holistic TCS parse failed during repair: {e}")

        for i in range(total_pages):
            text = doc[i].get_text("text")
            q_num_matches = re.findall(r'(?i)Question\s+Number\s*[:\s]\s*(\d+)', text)
            for raw_qn in q_num_matches:
                qn = int(raw_qn)
                if qn in missing_set:
                    page_index_by_qnum.setdefault(qn, [])
                    if i not in page_index_by_qnum[qn]:
                        page_index_by_qnum[qn].append(i)
            p = 5 + int(25 * (i + 1) / max(total_pages, 1))
            _upd(progress=min(p, 30), error=f"Locating target CBT pages: page {i + 1} of {total_pages}...")

        target_qnums = sorted(page_index_by_qnum.keys())

        # Fallback only if text-layer page targeting failed badly.
        if not target_qnums:
            doc.close()
            def _shift_scan_progress(done: int, total: int):
                p = 5 + int(7 * done / max(total, 1))
                _upd(
                    progress=min(p, 12),
                    status=f"Detecting CBT shifts: page {done} of {total}...",
                )
            shifts = detect_shifts(pdf_path, progress_callback=_shift_scan_progress)
        else:
            candidate_pages: list[int] = []
            for qn in sorted(page_index_by_qnum.keys()):
                for page_idx in page_index_by_qnum[qn]:
                    for neighbor in (page_idx - 1, page_idx, page_idx + 1):
                        if 0 <= neighbor < total_pages and neighbor not in candidate_pages:
                            candidate_pages.append(neighbor)

            for idx, page_idx in enumerate(candidate_pages, 1):
                _upd(
                    progress=30 + int(45 * idx / max(len(candidate_pages), 1)),
                    status=f"Re-extracting targeted CBT page {idx} of {len(candidate_pages)}...",
                )
                page_qs = _extract_tcsion_page(pdf_path, pdf_hash, page_idx, doc[page_idx], tracker)
                hits = [
                    q for q in page_qs
                    if int(q.get("question_number") or 0) in missing_set and _is_repair_row_usable(q)
                ]
                if hits:
                    recovered.extend(hits)
                    _flush_recovered_incremental(
                        hits,
                        f"targeted-page p{page_idx + 1}",
                    )
                    _report_target_progress(35, 70, f"Recovered target rows from targeted CBT pages ({idx}/{len(candidate_pages)})...")
            doc.close()
            recovered_qnums = {int(q.get("question_number") or 0) for q in recovered}
            remaining_targets = sorted(n for n in missing_set if n not in recovered_qnums)
            if remaining_targets:
                doc = fitz.open(pdf_path)
                total_pages = len(doc)
                deep_recovered: list[dict] = []
                total_steps = max(len(remaining_targets) * total_pages, 1)
                step = 0
                for target_qn in remaining_targets:
                    found_this_target = False
                    for page_idx in range(total_pages):
                        step += 1
                        p = 55 + int(30 * step / total_steps)
                        _upd(
                            progress=min(p, 85),
                            status=f"Deep recovery for Q{target_qn}: page {page_idx + 1} of {total_pages}...",
                        )
                        hits = _extract_tcsion_target_question(
                            pdf_path,
                            pdf_hash,
                            page_idx,
                            doc[page_idx],
                            target_qn,
                            tracker,
                        )
                        hits = [
                            q for q in hits
                            if int(q.get("question_number") or 0) == target_qn and _is_repair_row_usable(q)
                        ]
                        if hits:
                            deep_recovered.extend(hits)
                            recovered.extend(hits)
                            _flush_recovered_incremental(
                                hits,
                                f"deep-target q{target_qn} p{page_idx + 1}",
                            )
                            _report_target_progress(60, 85, f"Deep recovery found Q{target_qn}...")
                            found_this_target = True
                            break
                    if not found_this_target:
                        print(f"  [warn] Deep target recovery could not find Q{target_qn}")
                doc.close()
                if deep_recovered:
                    # hits were already added to recovered as they landed so progress
                    # stays truthful while deep recovery is still running
                    pass
                recovered_qnums = {int(q.get("question_number") or 0) for q in recovered}
                missing_set = {n for n in missing_set if n not in recovered_qnums}
                shifts = []
            else:
                shifts = []
    else:
        # For targeted repair uploads on non-TCS iON CBT PDFs, full shift
        # detection is wasted time and is the main reason the job appears
        # frozen at 5%. Use a single bounded scan over the whole PDF instead.
        try:
            doc = fitz.open(pdf_path)
            total_pages = len(doc)
            doc.close()
        except Exception:
            total_pages = 1
        _upd(
            progress=12,
            status="Skipping shift detection for repair upload. Starting a single-shift CBT scan...",
        )
        shifts = [ShiftInfo(
                test_date="Unknown",
                test_time="Unknown",
                subject="Unknown",
                shift_label="Shift 1",
                start_page=0,
                end_page=max(total_pages - 1, 0),
            )]

    if shifts and missing_set:
        n_shifts = max(len(shifts), 1)
        for shift_num, shift in enumerate(shifts or [], 1):
            base = 10 + int(55 * (shift_num - 1) / n_shifts)
            end = 10 + int(55 * shift_num / n_shifts)
            _upd(progress=base, error=f"Scanning {shift.shift_label} for target rows...")

            def _repair_progress(done: int, total: int):
                p = base + 2 + int(max(end - base - 4, 1) * done / max(total, 1))
                _upd(
                    progress=min(p, end - 1),
                    error=f"Scanning {shift.shift_label}: page {done} of {total}...",
                )

            if is_tcsion:
                merged = extract_tcsion_vision(
                    pdf_path,
                    pdf_hash,
                    shift,
                    tracker,
                    progress_callback=_repair_progress,
                )
                for q in merged:
                    q.setdefault("shift_label", shift.shift_label)
                    q.setdefault("test_date", shift.test_date)
                    q.setdefault("test_time", shift.test_time)
            else:
                questions = extract_text_questions(pdf_path, shift)
                _upd(progress=base + 1, error=f"Reading text layer for {shift.shift_label}...")
                answers = extract_answers_vision(
                    pdf_path,
                    pdf_hash,
                    shift,
                    tracker,
                    progress_callback=_repair_progress,
                )
                merged = merge_questions_answers(questions, answers, shift)

            if not merged:
                continue

            shift_hits = [q for q in merged if int(q.get("question_number") or 0) in missing_set]
            shift_hits = [q for q in shift_hits if _is_repair_row_usable(q)]
            if shift_hits:
                recovered.extend(shift_hits)
                _flush_recovered_incremental(
                    shift_hits,
                    f"shift-scan {shift.shift_label}",
                )
                recovered_qnums = {int(q.get("question_number") or 0) for q in recovered}
                missing_set = {n for n in missing_set if n not in recovered_qnums}
                _report_target_progress(base + 5, end, f"Recovered {len(recovered_qnums)} target CBT rows so far...")
            _upd(progress=end, error=f"Recovered {len(recovered)} target CBT rows so far...")
            if not missing_set:
                break

    if not recovered:
        _upd(progress=100, status="completed", error="CBT repair finished, but no target rows were recovered.")
        tracker.print_summary()
        return {"recovered": 0, "inserted": 0, "missing_numbers": sorted(missing_set)}

    by_qnum: dict[int, dict] = {}
    for q in recovered:
        qn = int(q.get("question_number") or 0)
        if qn <= 0:
            continue
        current = by_qnum.get(qn)
        score = len((q.get("question_text") or "").strip()) + sum(
            len((q.get(k) or "").strip()) for k in ("option_a", "option_b", "option_c", "option_d")
        )
        current_score = -1
        if current:
            current_score = len((current.get("question_text") or "").strip()) + sum(
                len((current.get(k) or "").strip()) for k in ("option_a", "option_b", "option_c", "option_d")
            )
        if current is None or score >= current_score:
            by_qnum[qn] = q

    target_qnums = {int(n) for n in missing_numbers if int(n) > 0}
    usable_target_rows = [
        q
        for qn, q in by_qnum.items()
        if qn in target_qnums and _is_repair_row_usable(q)
    ]
    cleaned = clean_and_dedupe_questions(usable_target_rows)
    _upd(progress=75, error="Tagging repaired CBT rows...")
    tagged = tag_questions(cleaned, exam_name, tracker=tracker)

    if tagged:
        _upd(progress=88, error="Saving repaired CBT rows...")
        result = store_questions(tagged, pdf_path, exam_name, exam_year, job_id=job_id)
        _upd(progress=95, error="Refreshing explanations for repaired CBT rows...")
        expl_result = generate_explanations_bulk(exam_name, exam_year, job_id, tracker)
    else:
        result = {"inserted": 0, "updated": 0}
        expl_result = {"generated": 0}

    recovered_final_qnums = {
        int(q.get("question_number") or 0)
        for q in tagged
        if int(q.get("question_number") or 0) > 0 and _is_repair_row_usable(q)
    }
    unresolved_targets = sorted(
        int(n) for n in missing_numbers
        if int(n) > 0 and int(n) not in recovered_final_qnums
    )
    seeded_manual_drafts = _seed_unresolved_manual_repair_drafts(
        exam_name,
        exam_year,
        unresolved_targets,
    )

    tracker.print_summary()
    partial_target_qnums = sorted(
        qn for qn, q in by_qnum.items()
        if qn in target_qnums and qn not in recovered_final_qnums and not _is_repair_row_usable(q)
    )
    summary = f"Recovered {len(tagged)} usable CBT repair rows"
    if partial_target_qnums:
        summary += f"; partial/incomplete: {partial_target_qnums}"
    if unresolved_targets:
        summary += f"; unresolved: {unresolved_targets}"
        if seeded_manual_drafts:
            summary += f"; manual drafts seeded: {seeded_manual_drafts}"
    _upd(progress=100, status="completed", error=summary)
    result.update({
        "recovered": len(tagged),
        "missing_numbers": unresolved_targets,
        "partial_targets": partial_target_qnums,
        "unresolved_targets": unresolved_targets,
        "manual_drafts_seeded": seeded_manual_drafts,
        "generated_explanations": expl_result.get("generated", 0),
    })
    return result


def process_cbt_missing_questions_job_background(
    job_id: str,
    pdf_path: str,
    exam_name: str,
    exam_year: int,
    missing_numbers: list[int],
) -> None:
    """Background worker for targeted CBT re-upload repairs."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from config import supabase as sb
    from papers import mark_paper_lifecycle, paper_id_for_job, should_delete_pdf_after_job

    try:
        recover_missing_cbt_questions_only(
            pdf_path,
            exam_name,
            exam_year,
            missing_numbers=missing_numbers,
            job_id=job_id,
        )
        mark_paper_lifecycle(
            paper_id_for_job(job_id, sb=sb),
            "ingested",
            last_job_id=job_id,
            sb=sb,
        )
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[CBT repair job {job_id}] FAILED: {e}\n{tb}")
        try:
            sb.table("jobs").update({
                "status": "failed",
                "error_log": (str(e) or tb)[-2000:],
            }).eq("id", job_id).execute()
            mark_paper_lifecycle(
                paper_id_for_job(job_id, sb=sb),
                "failed",
                last_job_id=job_id,
                sb=sb,
            )
        except Exception:
            pass
    finally:
        if should_delete_pdf_after_job(pdf_path):
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
