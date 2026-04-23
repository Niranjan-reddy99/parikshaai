"""
universal_extractor.py — Vision-first universal question extractor
==================================================================
Replaces the broken regex pipeline for ALL paper types.

Handles: MCQ, Match-the-following, Assertion-Reason, Statement-based,
         Table/chart, bilingual PDFs (English only), boxed/printed/X/NA answers.

Usage (as library):
    from extractor.universal_extractor import extract_universal
    questions = extract_universal("paper.pdf", "APPSC Group II", 2025)

Usage (background job):
    from extractor.universal_extractor import process_universal_job_background
    process_universal_job_background(job_id, pdf_path, exam_name, year, answer_key_map)
"""
from __future__ import annotations

import concurrent.futures as _cf
import datetime
import hashlib
import json
import os
import re
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Callable, Optional

import fitz  # PyMuPDF
from ai_models import (
    ANSWER_MODEL,
    EXTRACTION_MODEL,
    EXTRACTION_REPAIR_MODEL,
    get_genai_client,
)
from dotenv import load_dotenv
from google.genai import types
from extraction_cleanup import clean_and_dedupe_questions, clean_extracted_question
load_dotenv()

_CLIENT = get_genai_client()

# ── API call timeout constants ────────────────────────────────────────────────
# HttpOptions still used for SDK-level retry on 429/5xx.
# Python-level timeouts (30s / 60s) are enforced by _timed_generate() via
# concurrent.futures so a hung API call can never stall the pipeline forever.
_HTTP_OPTS_CHEAP = types.HttpOptions(
    timeout=35000,
    retry_options=types.HttpRetryOptions(attempts=2, initial_delay=5.0, max_delay=15.0, exp_base=2.0),
)
_HTTP_OPTS_BEST = types.HttpOptions(
    timeout=65000,
    retry_options=types.HttpRetryOptions(attempts=2, initial_delay=10.0, max_delay=30.0, exp_base=2.0),
)

_EXECUTOR = _cf.ThreadPoolExecutor(max_workers=4, thread_name_prefix="genai")


def _timed_generate(model: str, contents: Any, config: types.GenerateContentConfig,
                    timeout_secs: int, label: str) -> Any:
    """
    Call generate_content() with a guaranteed Python-level timeout.
    Even if the SDK never honours its own http_options.timeout (e.g. on Vertex AI),
    future.result(timeout=N) will raise TimeoutError after N seconds.
    """
    fut = _EXECUTOR.submit(_CLIENT.models.generate_content,
                           model=model, contents=contents, config=config)
    try:
        return fut.result(timeout=timeout_secs)
    except _cf.TimeoutError:
        raise TimeoutError(f"[{label}] Gemini API timed out after {timeout_secs}s")

# ── Model configuration — one shared source of truth ─────────────────────────
_TEXT_MODEL      = EXTRACTION_MODEL
_VISION_CHEAP    = EXTRACTION_MODEL
_VISION_BEST     = EXTRACTION_REPAIR_MODEL
_AI_ANSWER_MODEL = ANSWER_MODEL

# ── Paths ─────────────────────────────────────────────────────────────────────
CACHE_DIR = Path(__file__).parent.parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)

# ── Render DPI — 200 base for stability, bumped to 300+ on retry ─────────────
RENDER_DPI_BASE = 200
RENDER_DPI_RETRY = 350

# ── Per-job cost tracking (thread-local so concurrent jobs don't mix) ─────────
_USD_TO_INR = 84.0
# (input $/1M tokens, output $/1M tokens) — non-thinking, ≤200K context
_MODEL_PRICING: dict[str, tuple[float, float]] = {
    # Vertex AI model names (publishers/google/models/ prefix)
    "publishers/google/models/gemini-1.5-flash-002": (0.075, 0.30),
    "publishers/google/models/gemini-1.5-pro-002":   (1.25, 5.00),
    "publishers/google/models/gemini-2.0-flash":     (0.10, 0.40),
    "publishers/google/models/gemini-2.0-flash-lite": (0.075, 0.30),
    # Legacy short names (kept for cache compatibility)
    "gemini-1.5-flash": (0.075, 0.30),
    "gemini-1.5-pro":   (1.25, 5.00),
    "gemini-2.0-flash": (0.10, 0.40),
}

_tls: threading.local = threading.local()


def _init_job_tracking() -> None:
    _tls.steps = []


def _track_usage(step: str, resp, model: str = "publishers/google/models/gemini-2.0-flash") -> None:
    """Record token usage from a generate_content response into thread-local tracker."""
    meta = getattr(resp, "usage_metadata", None)
    if not meta:
        return
    inp = int(getattr(meta, "prompt_token_count", 0) or 0)
    out = int(getattr(meta, "candidates_token_count", 0) or 0)
    in_rate, out_rate = _MODEL_PRICING.get(model, (0.10, 0.40))
    cost_usd = (inp * in_rate + out * out_rate) / 1_000_000
    if not hasattr(_tls, "steps"):
        _tls.steps = []
    _tls.steps.append({
        "step": step,
        "input_tokens": inp,
        "output_tokens": out,
        "cost_usd": cost_usd,
        "cost_inr": round(cost_usd * _USD_TO_INR, 6),
        "cached": False,
    })


def _flush_cost_log(exam: str, questions_count: int) -> None:
    """Append accumulated job cost to cache/cost_log.json and reset tracker."""
    steps = list(getattr(_tls, "steps", []))
    total_usd = sum(s["cost_usd"] for s in steps)
    entry = {
        "timestamp": datetime.datetime.now().isoformat()[:19],
        "exam": exam,
        "questions": questions_count,
        "total_inr": round(total_usd * _USD_TO_INR, 4),
        "steps": steps,
    }
    log_path = CACHE_DIR / "cost_log.json"
    runs: list = []
    if log_path.exists():
        try:
            runs = json.loads(log_path.read_text())
        except Exception:
            runs = []
    runs.append(entry)
    try:
        log_path.write_text(json.dumps(runs, indent=2))
    except Exception as e:
        print(f"[cost] Failed to write cost log: {e}")
    _tls.steps = []

# ── Instruction page detection — page-level skip ──────────────────────────────
# If the page TEXT (first 1500 chars) matches this, the whole page is skipped
# before any AI call. Catches cover/instruction pages that numbered items trick us.
_PAGE_INSTR_HEADER_RE = re.compile(
    r'(?:'
    # Classic headers
    r'\bInstructions?\s+to\s+(?:Candidates?|Examinees?|Students?)\b|'
    r'\bGeneral\s+Instructions?\b|'
    r'\bImportant\s+Instructions?\b|'
    r'\bInstructions?\s+(?:for\s+(?:Candidates?|Filling)|Carefully)\b|'
    r'\bDirections?\s+for\s+(?:Answering|Filling|Candidates?)\b|'
    r'\bNote\s+(?:to\s+)?Candidates?\b|'
    # "Please check the Question/Test Booklet" — the exact phrase from Group 1 papers
    r'Please\s+check\s+(?:the\s+)?(?:Question|Test|Answer)\s+Booklet|'
    # Time/marks on instruction page
    r'\bTime\s+Allowed\s*[:\-]\s*\d|'
    r'\bMaximum\s+Marks\s*[:\-]\s*\d|'
    r'\bTotal\s+(?:Marks|Questions?)\s*[:\-]\s*\d|'
    # "This booklet contains X questions"
    r'\bThis\s+(?:Question\s+)?(?:Paper|Booklet|Test\s+Booklet)\s+(?:contains?|has\b)|'
    # OMR/answer sheet instructions
    r'\bSeparate\s+(?:Optical\s+Mark\s+Reader|OMR)\b|'
    r'\bOMR\s+Answer\s+Sheet\b|'
    r'(?:before|after)\s+the\s+(?:commencement|end)\s+of\s+(?:the\s+)?exam'
    r')',
    re.IGNORECASE,
)

# ── Scrambled/Encrypted Text Detection — forces Vision mode ───────────────────
def _is_text_scrambled(text: str) -> bool:
    """Detect if PDF selectable text is scrambled (CIDs or junk)."""
    if not text or len(text) < 100:
        return False
        
    # 1. CID check — common in encrypted/custom-font PDFs like UPSC
    if "(cid:" in text.lower():
        return True
        
    # 2. Non-printable density check
    control_chars = sum(1 for c in text if ord(c) < 32 and c not in '\n\r\t')
    if control_chars / len(text) > 0.10:
        return True
        
    # 3. High-entropy "word" check (Long strings of characters with no vowels/spaces)
    # This catches PDFs where text is just a stream of randomized characters.
    if re.search(r'[bcdfghjklmnpqrstvwxyz]{15,}', text.lower()):
        return True
        
    return False


def _looks_like_scanned_doc(doc: fitz.Document, sample_pages: int = 5) -> bool:
    """
    Treat near-zero selectable text as a scanned/Xerox PDF.
    This steers fully image-based papers into the dedicated scanned extractor,
    which uses column-wise OCR and stronger vision prompts.
    """
    if len(doc) == 0:
        return False

    texts = [
        (doc[i].get_text("text") or "").strip()
        for i in range(min(sample_pages, len(doc)))
    ]
    if not texts:
        return False

    avg_chars = sum(len(text) for text in texts) / len(texts)
    sparse_pages = sum(1 for text in texts if len(text) < 25)
    return avg_chars < 50 or sparse_pages >= max(2, len(texts) - 1)


def _trailing_missing_question_block(current_questions: list[dict], expected_count: int) -> list[int]:
    if expected_count <= 0:
        return []

    nums = sorted(
        q["question_number"]
        for q in current_questions
        if isinstance(q.get("question_number"), int)
    )
    if not nums:
        return list(range(1, expected_count + 1))

    max_qn = max(nums)
    if max_qn >= expected_count:
        return []

    missing = [n for n in range(1, expected_count + 1) if n not in set(nums)]
    if not missing:
        return []

    tail_start = max_qn + 1
    trailing = [n for n in missing if n >= tail_start]
    if trailing and trailing == list(range(tail_start, expected_count + 1)):
        return trailing
    return []

# ── Instruction ITEM detection — post-extraction line-level filter ─────────────
# Matches question_text of items that are instruction lines, not real questions.
_INSTR_ITEM_RE = re.compile(
    r'\b(?:'
    # Original patterns
    r'hall\s+ticket|omr\s+answer\s+sheet|darkening\s+(?:appropriate\s+)?circles?|'
    r'invigilator|rough\s+work\s+(?:should\s+be\s+done|only\s+in)|'
    r'question\s+booklet\s+(?:number|no\.?)|answer\s+sheet\s+is\s+invalidated|'
    r'no\s+correspondence\s+will\s+be\s+entertained|'
    r'discrepancy\s+between\s+english\s+(?:&|and)\s+(?:telugu|hindi|urdu)|'
    r'(?:use\s+of\s+)?calculators?,?\s+mathematical\s+tables?|'
    r'electronic\s+gadgets?\s+is\s+strictly\s+prohibited|'
    r'sign(?:ature)?\s+(?:in\s+the\s+space\s+provided|of\s+the\s+invigilator)|'
    r'bio[-\s]?data\s+printed\s+against|nominal\s+rolls?|'
    # New patterns — generic instruction directives
    r'candidates?\s+(?:are\s+)?(?:instructed|advised|required|should\s+not|must\s+not|will\s+not)|'
    r'candidates?\s+(?:are|were)\s+(?:allowed|permitted|asked|told|given)|'
    r'do\s+not\s+(?:open|write\s+on|start\s+writing|fold|tear|damage)|'
    r'write\s+your\s+(?:name|roll\s+number|registration\s+number|admit\s+card)|'
    r'(?:fill|mark|darken|shade)\s+(?:in\s+)?(?:the\s+)?(?:appropriate|correct|relevant)\s+(?:circle|oval|bubble|box)|'
    r'use\s+(?:only\s+)?(?:blue|black)\s+(?:ink\s+)?(?:ball\s+point\s+)?pen|'
    r'mobile\s+phones?\s+(?:are\s+)?(?:not\s+allowed|prohibited|strictly)|'
    r'calculators?\s+(?:are\s+)?(?:not\s+allowed|prohibited)|'
    r'negative\s+marking|wrong\s+answer\s+(?:will\s+)?(?:carry|result\s+in|attract)|'
    r'(?:all|each)\s+(?:questions?\s+carry|correct\s+answer\s+carries?)\s+(?:equal|\d)|'
    r'(?:answer|attempt)\s+all\s+(?:the\s+)?questions?|'
    r'this\s+(?:paper|booklet|examination)\s+(?:has|contains?|consists?\s+of)\s+\d|'
    r'(?:total\s+)?(?:time|duration)\s+(?:of\s+(?:the\s+)?(?:exam|test|paper)\s+)?(?:is|allowed)\s*[:,]?\s*\d|'
    r'(?:maximum\s+)?(?:total\s+)?marks?\s+(?:for\s+(?:this\s+)?(?:paper|exam|test)\s+)?(?:is|are|:)\s*\d|'
    r'switch\s+off\s+your|'
    r'read\s+(?:each\s+)?question\s+carefully\s+before|'
    r'(?:rough\s+)?work\s+(?:may\s+be\s+done|should\s+be\s+done|(?:if\s+any\s+)?done)\s+(?:in|on|at)|'
    r'ensure\s+that\s+(?:your|the)\s+(?:question|answer|omr)|'
    r'(?:booklet|paper)\s+(?:series|code|set)\s*[:\-]?\s*[A-Z\d]'
    r')\b',
    re.IGNORECASE,
)

# ── Telugu script hard filter (U+0C00–U+0C7F) ────────────────────────────────
# Last-resort safety net: strips lines where ≥15% of alpha chars are Telugu.
# Applied post-extraction so it catches anything the AI prompt missed.
_TELUGU_UNICODE_RE = re.compile(r'[\u0C00-\u0C7F]')

def _strip_telugu(text: str) -> str:
    """Remove lines where ≥15% of alphabetic chars are Telugu Unicode (U+0C00–U+0C7F)."""
    if not text:
        return text
    lines = text.split('\n')
    clean: list[str] = []
    for line in lines:
        alpha = [c for c in line if c.isalpha()]
        if not alpha:
            clean.append(line)
            continue
        telugu = sum(1 for c in alpha if '\u0C00' <= c <= '\u0C7F')
        if telugu / len(alpha) >= 0.15:
            continue  # skip Telugu-dominant line
        clean.append(_TELUGU_UNICODE_RE.sub('', line))
    return '\n'.join(clean)


# ── Option normalisation map ──────────────────────────────────────────────────
_OPTION_MAP: dict[str, str] = {
    "1": "A", "2": "B", "3": "C", "4": "D",
    "A": "A", "B": "B", "C": "C", "D": "D",
    "a": "A", "b": "B", "c": "C", "d": "D",
}

# ── Question type → question_type field value ─────────────────────────────────
_TYPE_MAP: dict[str, str] = {
    "mcq":              "MCQ",
    "match":            "Match",
    "assertion_reason": "AssertionReason",
    "statement":        "Statement",
    "table":            "Table",
}

_VISUAL_DEPENDENCY_RE = re.compile(
    r'\b(?:bar\s+graph|bar\s+chart|pie\s+chart|line\s+graph|histogram|'
    r'table|chart|graph|diagram|figure|map|picture|image|data\s+interpretation|'
    r'caselet|passage|number\s+line|venn\s+diagram|cube|dice|net|geometry|'
    r'coordinate\s+plane|scatter\s+plot|the\s+following\s+figure|the\s+above\s+figure|'
    r'following\s+table|above\s+table|given\s+table|refer\s+to\s+the|study\s+the\s+following)\b',
    re.IGNORECASE,
)

_MATCH_PROMPT_RE = re.compile(r'\bmatch\s+the\s+following\b', re.IGNORECASE)
_MATCH_LEFT_RE = re.compile(r'^\s*([A-D])\.\s*(.+?)\s*$')
_MATCH_RIGHT_RE = re.compile(r'^\s*([1-9])\.\s*(.+?)\s*$')
_MATCH_INLINE_BOTH_RE = re.compile(
    r'^\s*([A-D])\.\s*(.+?)\s{2,}([1-9])\.\s*(.+?)\s*$'
)
_MATCH_END_RE = re.compile(
    r'^\s*(?:choose|select)\s+the\s+correct'
    r'|^\s*[A-D]\s*[\)\.]'
    r'|^\s*\([1-4]\)\s*[A-D]-',
    re.IGNORECASE,
)

# ══════════════════════════════════════════════════════════════════════════════
UNIVERSAL_PROMPT = """1. Extract EVERY exam question visible on the page.
2. Return a JSON list of objects.
3. If the paper is bilingual, extract the ENGLISH version ONLY.
4. If the same question appears in both English and Hindi/regional text, return ONLY the English version.
5. Ignore all instruction, cover, hall-ticket, and directions text.
6. Ignore any Hindi or regional language text during extraction.
7. Do NOT hallucinate questions that are not present.
8. If no questions are found, return [].

### 📖 EXTRACTION RULES:
- Preserve mathematical symbols and technical notation exactly as printed: %, +, -, ×, ÷, =, <, >, ≤, ≥, √, π, °;₹, ratios, fractions, exponents.
- Format multi-statement questions (1, 2, 3...) inside question_text.
- Format Match-the-following columns clearly inside question_text.

### 📚 PASSAGE / COMPREHENSION RULES (CRITICAL):
- If a page contains a passage followed by multiple questions (Q21-Q25 etc.), you MUST copy the FULL passage text into the "passage" field for EVERY one of those questions.
- A passage is typically a paragraph of text printed BEFORE a group of numbered questions.
- Do NOT leave "passage" as null if such a reading text exists on the page.
- Each question in the group should have the IDENTICAL passage text in its "passage" field.

### 📦 FORMAT:
Return ONLY a JSON list of objects:
[
  {
    "question_number": 1,
    "question_text": "...",
    "option_a": "...",
    "option_b": "...",
    "option_c": "...",
    "option_d": "...",
    "correct_answer": null,
    "passage": null,
    "has_image": false,
    "needs_review": false,
    "question_type": "mcq"
  }
]
"""
FORCED_EXTRACTION_PROMPT = (
    "CRITICAL OVERRIDE: This PDF page contains exam questions that MUST be extracted. "
    "A previous attempt returned no questions. Look carefully for numbered items "
    "(1., 2., Q1., etc.), option labels (A/B/C/D or 1/2/3/4), and surrounding text. "
    "Extract EVERYTHING you can find, even if partially visible. "
    "Set needs_review: true for any question you cannot fully read.\n\n"
    + UNIVERSAL_PROMPT
)


# ══════════════════════════════════════════════════════════════════════════════
# CACHE HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def _pdf_hash(pdf_path: str) -> str:
    return hashlib.sha256(Path(pdf_path).read_bytes()).hexdigest()


def _page_cache_path(pdf_hash: str, page_idx: int) -> Path:
    # Bump cache version whenever model routing or page transport changes so
    # stale [] caches from older broken runs are never silently reused.
    key = f"univ_v40_{pdf_hash[:16]}_p{page_idx:04d}.json"
    return CACHE_DIR / key


def _load_page_cache(pdf_hash: str, page_idx: int) -> Optional[list]:
    p = _page_cache_path(pdf_hash, page_idx)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def _save_page_cache(pdf_hash: str, page_idx: int, data: list) -> None:
    p = _page_cache_path(pdf_hash, page_idx)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ══════════════════════════════════════════════════════════════════════════════
# PAGE RENDERING
# ══════════════════════════════════════════════════════════════════════════════

def _render_page(page: fitz.Page, dpi: int = RENDER_DPI_BASE) -> bytes:
    """Render a single PDF page to PNG bytes at the given DPI."""
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
    return pix.tobytes("png")


# ══════════════════════════════════════════════════════════════════════════════
# SINGLE-PAGE EXTRACTION
# ══════════════════════════════════════════════════════════════════════════════

def _strip_fences(raw: Any) -> str:
    """Remove markdown code fences if Gemini wraps output in them."""
    if not raw or not isinstance(raw, str):
        return ""
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"\s*```\s*$", "", raw, flags=re.MULTILINE)
    return raw.strip()


def _recover_inline_match_payload(question_text: str) -> tuple[str, list[str], list[str]] | None:
    """Recover List I / List II columns from flattened match-the-following text.

    The model sometimes labels DAO-style match questions as plain MCQ and dumps
    both columns into question_text. This helper reconstructs the columns so the
    frontend can render them as a proper table.
    """
    if not question_text or "__MATCH__:" in question_text or not _MATCH_PROMPT_RE.search(question_text):
        return None

    left: list[tuple[str, str]] = []
    right: list[tuple[str, str]] = []
    intro_lines: list[str] = []

    lines = [ln.strip() for ln in question_text.replace("\t", "    ").splitlines() if ln.strip()]
    for line in lines:
        if _MATCH_END_RE.search(line):
            break

        both = _MATCH_INLINE_BOTH_RE.match(line)
        if both:
            left.append((both.group(1), both.group(2).strip()))
            right.append((both.group(3), both.group(4).strip()))
            continue

        left_m = _MATCH_LEFT_RE.match(line)
        if left_m:
            left.append((left_m.group(1), left_m.group(2).strip()))
            continue

        right_m = _MATCH_RIGHT_RE.match(line)
        if right_m:
            right.append((right_m.group(1), right_m.group(2).strip()))
            continue

        intro_lines.append(line)

    left_sorted = [text for _, text in sorted(left, key=lambda x: x[0])]
    right_sorted = [text for _, text in sorted(right, key=lambda x: int(x[0]))]
    if len(left_sorted) < 2 or len(right_sorted) < 2:
        return None

    intro = "\n".join(intro_lines).strip()
    if not intro:
        intro = "Match the following:"
    return intro, left_sorted, right_sorted


def _raw_page_looks_low_quality(questions: list[dict]) -> bool:
    """
    Cheap pre-normalisation quality gate for page-level model output.
    Rejects pages where Flash returned objects but most of them are clearly
    broken: missing stems, too few options, or no question numbers.
    """
    if not questions:
        return True

    broken = 0
    numbered = 0
    for q in questions:
        if not isinstance(q, dict):
            broken += 1
            continue

        q_num = q.get("question_number") or q.get("q_num")
        if q_num not in (None, ""):
            numbered += 1

        q_text = (
            q.get("question_text")
            or q.get("question")
            or ""
        ).strip()
        options = q.get("options") or {}
        if options:
            opt_count = sum(1 for v in options.values() if str(v).strip())
        else:
            opt_count = sum(
                1 for key in ("option_a", "option_b", "option_c", "option_d")
                if str(q.get(key, "")).strip()
            )

        q_type = str(q.get("question_type") or q.get("type") or "mcq").lower()
    # 3. Detect generic "Hallucination" patterns (Zero tolerance for Research/Teaching noise)
    # If the exam is NDA but Flash starts generating generic practice test questions.
    hallucination_score = 0
    FAKE_KEYWORDS = {
        "research design", "hypothesis", "qualitative research", "formative assessment", 
        "teaching method", "literature review", "sampling method", "research question",
        "classroom management", "educational psychology", "curriculum development"
    }
    for q in questions:
        text_lower = (q.get("question_text") or "").lower()
        if any(kw in text_lower for kw in FAKE_KEYWORDS):
            hallucination_score += 1

    return numbered == 0 or broken >= max(1, len(questions) // 2) or hallucination_score >= 1


def _extract_page(
    pdf_hash: str,
    page_idx: int,
    page: fitz.Page,
) -> list[dict]:
    """
    5-tier cost-optimised extraction per page.

    T2 CHEAP  — text-only  → gemini-2.0-flash-lite   (digital PDFs, cheapest)
    T3 MEDIUM — vision 150 → gemini-2.0-flash         (scanned / T2 failed)
    T4 COSTLY — vision 250 → gemini-2.5-flash         (only if T3 empty)
    T5 LAST   — vision 350 → gemini-2.5-flash+forced  (genuinely hard pages)

    Per-page cache means re-uploads of the same PDF cost ₹0 for cached pages.
    """
    lbl = f"p{page_idx + 1}"

    # ── T0 (free): Instruction page detection — runs BEFORE cache check ────────
    # Must be before cache so even cached pages can be overridden when re-uploaded.
    # Reads selectable text (free) to detect instruction page headers.
    # We ONLY skip automatically based on text headers for the first 3 pages.
    # Pages deeper in the PDF might have similar headers but be actual question pages.
    page_text_raw = page.get_text("text").strip()
    
    # ── T0.5: Scrambled Text detection — bypass T2 automatically ──────────────
    if _is_text_scrambled(page_text_raw):
        print(f"  [T0.5-scramble] {lbl} — scrambled text detected, forcing high-fidelity vision")
        # Go straight to T3
    else:
        # Carry on with normal triage
        # DISABLED: Triage skipping logic disabled to prevent false positives on bilingual papers.
        # if page_idx <= 2 and _PAGE_INSTR_HEADER_RE.search(page_text_raw[:1500]):
        #     _save_page_cache(pdf_hash, page_idx, [])  # overwrite any stale cache
        #     print(f"  [T0-skip] {lbl} — instruction page detected on first few pages, skipped")
        #     return []

        cached = _load_page_cache(pdf_hash, page_idx)
        if cached is not None:
            print(f"  [cache] p{page_idx + 1} — {len(cached)} q cached")
            return cached

    # EMERGENCY RESTORATION: Disable all skipping/triage that caused digital papers to fail.
    # We now force-process every page with high-fidelity vision fallback to ensure 100% coverage.
    text_is_rich = True  # Force AI call for all pages
    page_text = page_text_raw # Restore variable definition

    # ONLY attempt Text-Only path if it DOES NOT look like scrambled junk
    if not _is_text_scrambled(page_text_raw):
        try:
            text_prompt = (
                UNIVERSAL_PROMPT
                + "\n\nBelow is raw text extracted from this exam page. Parse it:\n\n"
                + page_text[:6000]
            )
            resp = _timed_generate(
                model=_TEXT_MODEL,
                contents=text_prompt,
                config=types.GenerateContentConfig(
                    temperature=0.0, max_output_tokens=8192,
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                    http_options=_HTTP_OPTS_CHEAP,
                ),
                timeout_secs=30, label=f"T2-text {lbl}",
            )
            _track_usage(f"Text {lbl}", resp, model=_TEXT_MODEL)
            raw = _strip_fences(resp.text or "")
            if raw and raw != "[]":
                questions = json.loads(raw)
                if isinstance(questions, list) and len(questions) >= 2:
                    if _raw_page_looks_low_quality(questions):
                        print(f"  [T2-text] {lbl} — low-quality parse, escalating to vision")
                    else:
                        _save_page_cache(pdf_hash, page_idx, questions)
                        print(f"  [T2-text] {lbl} — {len(questions)} q (cheapest path)")
                        return questions
            print(f"  [T2-text] {lbl} — insufficient, escalating to vision")
        except json.JSONDecodeError as e:
            print(f"  [T2-text] {lbl} JSON error: {e}, escalating")
        except Exception as e:
            print(f"  [T2-text] {lbl} error: {e}, escalating")

    # ── T3 (medium): cheap vision at 150 DPI ──────────────────────────────────
    # This is the LAST tier in the main extraction loop. T4/T5 only run in the
    # repair pass (triggered when expected_count is set and we are short).
    try:
        png_bytes = _render_page(page, dpi=RENDER_DPI_BASE)
        image_part = types.Part.from_bytes(data=png_bytes, mime_type="image/png")
        resp = _timed_generate(
            model=_VISION_CHEAP,
            contents=[UNIVERSAL_PROMPT, image_part],
            config=types.GenerateContentConfig(
                temperature=0.0, max_output_tokens=8192,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
                http_options=_HTTP_OPTS_CHEAP,
            ),
            timeout_secs=45, label=f"T3-vis {lbl}",
        )
        _track_usage(f"T3-vis {lbl}", resp, model=_VISION_CHEAP)
        raw = _strip_fences(resp.text or "")
        if raw and raw != "[]":
            questions = json.loads(raw)
            if isinstance(questions, list) and questions:
                if _raw_page_looks_low_quality(questions):
                    print(f"  [T3-vis] {lbl} — low-quality parse, defer to repair pass")
                else:
                    _save_page_cache(pdf_hash, page_idx, questions)
                    print(f"  [T3-vis] {lbl} — {len(questions)} q (cheap vision)")
                    return questions
        # T3 returned []. Don't cache [] because transient vision failures happen.
        # The repair pass at the end of the job will retry these missing pages with T4/T5.
        print(f"  [T3-vis] {lbl} — no questions found (will be retried in repair pass)")
    except json.JSONDecodeError as e:
        print(f"  [T3-vis] {lbl} JSON error: {e}")
    except Exception as e:
        if "503" in str(e) or "UNAVAILABLE" in str(e):
            time.sleep(30)
        print(f"  [T3-vis] {lbl} error: {e}")

    return []


def _extract_page_forced(
    pdf_hash: str,
    page_idx: int,
    page: fitz.Page,
    bypass_cache: bool = True,
) -> list[dict]:
    """
    Repair-pass extraction using T4+T5 (gemini-2.5-flash).
    Only called from repair pass when the main loop returned [] on a text-rich page.
    Never called in the main extraction loop — keeps main loop cost to T3 only.
    """
    cached = None if bypass_cache else _load_page_cache(pdf_hash, page_idx)
    if cached:  # non-empty cache from a previous repair run
        print(f"  [repair-cache] p{page_idx + 1} — {len(cached)} q cached")
        return cached

    lbl = f"p{page_idx + 1}"

    for dpi, prompt_content, tier in [
        (RENDER_DPI_RETRY, UNIVERSAL_PROMPT,         "T4-best"),
        (350,              FORCED_EXTRACTION_PROMPT, "T5-forced"),
    ]:
        try:
            png_bytes = _render_page(page, dpi=dpi)
            image_part = types.Part.from_bytes(data=png_bytes, mime_type="image/png")
            resp = _timed_generate(
                model=_VISION_BEST,
                contents=[prompt_content, image_part],
                config=types.GenerateContentConfig(
                    temperature=0.0, max_output_tokens=8192,
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                    http_options=_HTTP_OPTS_BEST,
                ),
                timeout_secs=60, label=f"{tier} {lbl}",
            )
            _track_usage(f"{tier} {lbl} dpi{dpi}", resp, model=_VISION_BEST)
            raw = _strip_fences(resp.text or "")
            if raw and raw != "[]":
                questions = json.loads(raw)
                if isinstance(questions, list) and questions:
                    _save_page_cache(pdf_hash, page_idx, questions)
                    print(f"  [{tier}] {lbl} — {len(questions)} q recovered (dpi={dpi})")
                    return questions
            print(f"  [{tier}] {lbl} — still empty at dpi={dpi}")
        except json.JSONDecodeError as e:
            print(f"  [{tier}] {lbl} JSON error: {e}")
            time.sleep(2)
        except Exception as e:
            if "503" in str(e) or "UNAVAILABLE" in str(e):
                time.sleep(30)
            print(f"  [{tier}] {lbl} error: {e}")
            time.sleep(2)

    _save_page_cache(pdf_hash, page_idx, [])  # confirmed unrecoverable — cache to skip next time
    print(f"  [repair-skip] {lbl} — unrecoverable, cached []")
    return []


def _question_regional_script_ratio(question: dict) -> float:
    parts = [
        (question.get("question_text") or "").strip(),
        (question.get("option_a") or "").strip(),
        (question.get("option_b") or "").strip(),
        (question.get("option_c") or "").strip(),
        (question.get("option_d") or "").strip(),
    ]
    combined = "\n".join(part for part in parts if part)
    alpha = [c for c in combined if c.isalpha()]
    if not alpha:
        return 0.0
    regional = sum(1 for c in alpha if "\u0C00" <= c <= "\u0C7F" or 0x0900 <= ord(c) <= 0x097F)
    return regional / len(alpha)


def _needs_bilingual_pair_recovery(question: dict) -> bool:
    if not question:
        return False
    if _question_regional_script_ratio(question) >= 0.12:
        return True
    text = (question.get("question_text") or "").strip()
    if len(text) < 30:
        return True
    filled_opts = sum(
        1 for key in ("option_a", "option_b", "option_c", "option_d")
        if (question.get(key) or "").strip()
    )
    return filled_opts < 2


def _render_page_part(page: fitz.Page, dpi: int = RENDER_DPI_RETRY) -> types.Part:
    return types.Part.from_bytes(data=_render_page(page, dpi=dpi), mime_type="image/png")


def _extract_page_pair_targeted(
    left_page: fitz.Page,
    right_page: fitz.Page,
    *,
    left_idx: int,
    target_numbers: list[int],
) -> list[dict]:
    if not target_numbers:
        return []

    prompt = (
        FORCED_EXTRACTION_PROMPT
        + "\n\nThese are TWO CONSECUTIVE pages from the SAME bilingual exam paper."
        + "\nA question may begin on the first page and continue on the second page."
        + "\nIf English and Telugu/Hindi versions both appear, keep ONLY the English version."
        + "\nMerge split question stems and split options across both pages into one final question."
        + f"\nExtract ONLY these question numbers if present: {target_numbers}."
        + "\nDo not invent questions. Do not return Telugu-only duplicates."
    )

    lbl = f"p{left_idx + 1}-{left_idx + 2}"
    try:
        resp = _timed_generate(
            model=_VISION_BEST,
            contents=[
                prompt,
                _render_page_part(left_page, dpi=RENDER_DPI_RETRY),
                _render_page_part(right_page, dpi=RENDER_DPI_RETRY),
            ],
            config=types.GenerateContentConfig(
                temperature=0.0,
                max_output_tokens=8192,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
                http_options=_HTTP_OPTS_BEST,
            ),
            timeout_secs=75,
            label=f"T-pair {lbl}",
        )
        _track_usage(f"T-pair {lbl}", resp, model=_VISION_BEST)
        raw = _strip_fences(resp.text or "")
        if not raw or raw == "[]":
            return []
        data = json.loads(raw)
        if isinstance(data, list):
            print(f"  [pair-repair] {lbl} — {len(data)} q recovered for targets {target_numbers}")
            return data
    except Exception as e:
        print(f"  [pair-repair] {lbl} error: {e}")
    return []

def _is_low_quality(q: dict) -> bool:
    """Detect if a question is mangled/incomplete and warrants a high-fidelity retry."""
    if not q:
        return True
    
    # 1. Standard MCQ with no options is the biggest "Flash" failure for multi-column
    opts = {k: v for k, v in q.items() if k in ("option_a", "option_b", "option_c", "option_d")}
    # Count non-empty options
    filled_opts = sum(1 for v in opts.values() if str(v).strip())
    
    q_type = q.get("question_type") or "mcq"
    q_text = q.get("question_text") or ""
    
    if q_type == "mcq" and filled_opts < 2 and not q.get("is_cancelled"):
        # Almost certainly a split question where options were lost in another block
        return True
        
    # 2. Fragmented question text
    # Exception: Image-only questions start with e.g. [BAR GRAPH] and might be short
    is_visual = q.get("has_image") or q_text.startswith("[")
    if not is_visual and len(q_text) < 40 and not q.get("is_cancelled"):
        # "Select the correct answer:" or "Options:" usually means the stem was missed
        return True

    # 3. Match questions with uneven columns
    if q_type == "match":
        # match columns are stored in question_text as __MATCH__:json
        if "__MATCH__:" not in q_text:
            return True
        try:
            match_data = json.loads(q_text.split("__MATCH__:")[1])
            if not match_data.get("col1") or not match_data.get("col2"):
                return True
        except:
            return True

    return False


# ══════════════════════════════════════════════════════════════════════════════
# QUESTION NORMALISATION  (raw AI output → pipeline schema)
# ══════════════════════════════════════════════════════════════════════════════
def _scrub_hindi(text: str) -> str:
    """Removes Devanagari (Hindi) characters while preserving English and symbols."""
    if not text:
        return ""
    return "".join([c for c in text if not (0x0900 <= ord(c) <= 0x097F)]).strip()


def _normalise_question(
    raw: dict,
    exam_name: str,
    year: int,
) -> Optional[dict]:
    """
    Convert a raw dict from the Gemini JSON response into the Supabase/pipeline schema.

    pipeline.py expects:
        question_text, option_a, option_b, option_c, option_d,
        correct_answer (A/B/C/D), question_number, subject, topic,
        subtopic, difficulty, question_type, has_image, needs_review
    """
    try:
        q_num = raw.get("q_num")
        q_type_raw = (raw.get("type") or "mcq").lower().strip()
        question_text = _strip_telugu((raw.get("question") or "").strip())

        # ── Reject orphan option-only fragments ──────────────────────────────
        # When a match-type question's OPTIONS get split off from their parent
        # question, they appear as a bare fragment like:
        #   question_text = "Select the correct answer:"
        #   options = {"A": "A-4; B-5; C-3; D-2", ...}
        # These are NOT real questions. Reject them.
        _ORPHAN_STEMS = re.compile(
            r'^(select\s+the\s+correct|choose\s+the\s+(correct|answer)|'
            r'which\s+of\s+the\s+(above|following)\s+is\s+correct|'
            r'mark\s+the\s+correct|the\s+correct\s+answer\s+is)[\.:\s]*$',
            re.IGNORECASE
        )
        if _ORPHAN_STEMS.match(question_text.strip()) and q_num is None:
            return None  # bare orphan fragment from a split match question

        # ── Strip option lines embedded in question text ──────────────────────
        # Some PDFs cause the model to include option lines like "(1) Salmonella typhi"
        # or "A. Option text" inside the question field. Remove them so options
        # don't appear twice (once in the stem, once as A/B/C/D choices).
        #
        # CRITICAL: Do NOT strip for statement/match/assertion_reason types.
        # These types LEGITIMATELY have numbered items (1. 2. 3.) or lettered
        # items (A. B. C.) inside the question field — those are statements/items,
        # NOT duplicated options. Only strip for plain MCQ/table types.
        _MCQ_LIKE = q_type_raw in ("mcq", "table", "")
        if _MCQ_LIKE:
            _OPT_LINE_RE = re.compile(
                # Matches option lines like: (A) text, A) text, (1) text, 1) text
                # Requires a closing bracket ) or ] — this EXCLUDES:
                #   - "A. text" (period, not bracket) which appears in statement items
                #   - Pure numbered lines like "1. text" which are statement items
                r'^\s*[\(\[]?\s*(?:[ABCD]|[1-4])\s*[\)\]]\s*.+',
                re.IGNORECASE
            )
            q_lines = question_text.split('\n')
            first_opt_idx = next(
                (i for i, ln in enumerate(q_lines) if _OPT_LINE_RE.match(ln)),
                None
            )
            if first_opt_idx is not None and first_opt_idx > 0:
                question_text = '\n'.join(q_lines[:first_opt_idx]).strip()

        if not question_text or len(question_text) < 5:
            return None

        # ── Image question text overflow guard ────────────────────────────────
        # When has_image=True, the T2 text-only path sometimes dumps the entire
        # page content into the question field (e.g., a full two-column page
        # worth of text). Detect this and cap at the first sentence-ending
        # punctuation before char 700 so the question stem is preserved but
        # the rest of the page content (subsequent questions) is dropped.
        has_image_raw = bool(raw.get("has_image"))
        if has_image_raw and len(question_text) > 700:
            _cap_match = re.search(r'[.?!](?=\s|$)', question_text[:700])
            if _cap_match:
                question_text = question_text[:_cap_match.end()].strip()
            else:
                question_text = question_text[:700].rsplit(' ', 1)[0].strip() + '...'

        # ── Embed match columns into question_text ────────────────────────────
        if q_type_raw == "match":
            match_col1 = raw.get("match_col1") or []
            match_col2 = raw.get("match_col2") or []
            if not match_col1 or not match_col2 or len(match_col1) != len(match_col2):
                # Incomplete match — flag for review but still store what we have
                raw["needs_review"] = True
            match_payload = json.dumps({"col1": match_col1, "col2": match_col2}, ensure_ascii=False)
            question_text = question_text + "\n\n__MATCH__:" + match_payload
        else:
            recovered_match = _recover_inline_match_payload(question_text)
            if recovered_match:
                intro, match_col1, match_col2 = recovered_match
                q_type_raw = "match"
                question_text = intro + "\n\n__MATCH__:" + json.dumps(
                    {"col1": match_col1, "col2": match_col2},
                    ensure_ascii=False,
                )


        # ── Normalise options → A/B/C/D ───────────────────────────────────────
        opts_raw = raw.get("options") or {}
        mapped: dict[str, str] = {}
        for k, v in opts_raw.items():
            norm_k = _OPTION_MAP.get(str(k).strip())
            if norm_k:
                val = _strip_telugu(str(v).strip())
                if val:  # Gap 6 fix: skip empty-string options
                    mapped[norm_k] = val

        # ── Detect visual-only options ────────────────────────────────────────
        # Model sometimes writes "Image of dice 1", "Figure option 2" etc.
        # Standardise ALL options to a single clear label and force has_image=True.
        _VISUAL_OPT_RE = re.compile(
            r'^(?:image|figure|diagram|option|net|cube|dice|graph|chart|visual)\b',
            re.IGNORECASE
        )
        has_image = bool(raw.get("has_image"))
        if _VISUAL_DEPENDENCY_RE.search(question_text):
            has_image = True
        if mapped and all(_VISUAL_OPT_RE.match(v) for v in mapped.values()):
            # All 4 options are visual placeholders — standardise
            has_image = True
            mapped = {
                "A": "Option A — see diagram",
                "B": "Option B — see diagram",
                "C": "Option C — see diagram",
                "D": "Option D — see diagram",
            }

        # Match-the-following options may be sparse if the model only gives combos.
        # For other types: if < 4 options found, flag for review — NEVER silently drop.
        # Image-only options: has_image=True + empty options is valid — mark needs_review.
        if q_type_raw != "match" and len(mapped) < 4:
            pass  # will be flagged needs_review below

        # ── Correct answer ────────────────────────────────────────────────────
        _CANCELLED_VALS = {"NULL", "NONE", "X", "NA", "—", "-", "", "DELETED",
                           "DROPPED", "OMITTED", "CANCELLED", "BONUS"}
        is_cancelled = bool(raw.get("is_cancelled"))
        is_multi_answer = bool(raw.get("is_multi_answer"))
        correct_raw = str(raw.get("correct") or "").strip()
        answer: Optional[str] = None

        if correct_raw and correct_raw.upper() not in _CANCELLED_VALS:
            cr_up = correct_raw.upper()
            # Try direct single-letter lookup first
            answer = _OPTION_MAP.get(cr_up)
            if answer is None:
                # Multi-answer: "AB", "A&B", "A,B", "A AND B", "A OR B", "1&2", etc.
                letters = re.findall(r'[A-D1-4]', cr_up)
                if len(letters) >= 2:
                    mapped_letters = [_OPTION_MAP.get(l) for l in letters if _OPTION_MAP.get(l)]
                    if mapped_letters:
                        answer = mapped_letters[0]  # first valid answer
                        is_multi_answer = True

        # ── question_type field ───────────────────────────────────────────────
        question_type = _TYPE_MAP.get(q_type_raw, "MCQ")

        # Image-only option questions (bar graphs as answer choices) are valid even with < 4 text options
        missing_options = q_type_raw != "match" and len(mapped) < 4
        # Multi-answer questions have a valid answer — don't penalise them as needs_review
        needs_review = bool(raw.get("needs_review")) or (answer is None and not is_cancelled) or missing_options

        cleaned = clean_extracted_question({
            # ── Supabase / pipeline column names ─────────────────────────────
            "question_text":  question_text,
            "option_a":       mapped.get("A", ""),
            "option_b":       mapped.get("B", ""),
            "option_c":       mapped.get("C", ""),
            "option_d":       mapped.get("D", ""),
            "correct_answer": answer or "",
            "question_number": q_num,
            "question_type":  question_type,
            "exam_name": exam_name,
            "exam_year": year,
            "passage": str(raw.get("passage") or "").strip() or None,
            # ── Default tags (filled by tag_questions) ────────────────────────
            "subject":    "Unclassified",
            "topic":      "Unclassified",
            "subtopic":   None,
            "difficulty": "Medium",
            # ── Metadata ─────────────────────────────────────────────────────
            "has_image":    has_image,
            "is_cancelled": is_cancelled,
            "needs_review": needs_review,
            # Source page index — used for image upload, stripped before DB insert
            "_page_idx":   raw.get("_page_idx"),
        })
        return cleaned

    except Exception as e:
        print(f"  [warn] normalise_question: {e} | raw={json.dumps(raw)[:200]}")
        return None


# ══════════════════════════════════════════════════════════════════════════════
# AI ANSWER GENERATION  (for X/NA/cancelled questions)
# ══════════════════════════════════════════════════════════════════════════════

def _ai_generate_answers(questions: list[dict]) -> list[dict]:
    """
    For questions with no correct_answer (cancelled / X / NA),
    use gemini-1.5-flash-8b to infer the most likely correct answer.
    Marks ai_generated_answer=True and keeps needs_review=True.
    """
    targets = [q for q in questions if not q.get("correct_answer")]
    if not targets:
        return questions

    print(f"  [ai-ans] Generating AI answers for {len(targets)} unanswered questions...")

    # Build a lookup by question_number
    q_num_index: dict = {q.get("question_number"): q for q in targets}

    BATCH = 15  # smaller batches prevent JSON truncation at 4096 tokens
    all_targets_list = list(targets)

    for batch_start in range(0, len(all_targets_list), BATCH):
        batch = all_targets_list[batch_start: batch_start + BATCH]
        batch_parts: list[str] = []
        for q in batch:
            batch_parts.append(
                f'Q{q.get("question_number", "?")}: {q["question_text"][:300]}\n'
                f'  A: {q.get("option_a","")}\n'
                f'  B: {q.get("option_b","")}\n'
                f'  C: {q.get("option_c","")}\n'
                f'  D: {q.get("option_d","")}'
            )
        batch_prompt = (
            'For each question, determine the most likely correct answer based on the '
            'question and options. Return ONLY a JSON array: '
            '[{"q_num": <number>, "answer": "B", "reasoning": "..."}]. '
            'Questions:\n' + "\n\n".join(batch_parts)
        )

        for attempt in range(3):
            try:
                resp = _timed_generate(
                    model=_AI_ANSWER_MODEL,
                    contents=batch_prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.0, max_output_tokens=4096,
                        thinking_config=types.ThinkingConfig(thinking_budget=0),
                        http_options=_HTTP_OPTS_CHEAP,
                    ),
                    timeout_secs=30, label=f"AIAnswer batch{batch_start // BATCH + 1}",
                )
                _track_usage(f"AIAnswer batch{batch_start // BATCH + 1}", resp, model=_AI_ANSWER_MODEL)
                raw = _strip_fences(resp.text or "")
                data = json.loads(raw)
                for item in data:
                    q_num = item.get("q_num")
                    answer = _OPTION_MAP.get(str(item.get("answer", "")).strip().upper())
                    if answer and q_num in q_num_index:
                        q_num_index[q_num]["correct_answer"] = answer
                        q_num_index[q_num]["ai_generated_answer"] = True
                        q_num_index[q_num]["needs_review"] = True  # always flag AI answers
                break
            except json.JSONDecodeError as e:
                print(f"  [ai-ans] JSON error (attempt {attempt + 1}): {e}")
                time.sleep(2 ** attempt)
            except Exception as e:
                print(f"  [ai-ans] Error (attempt {attempt + 1}): {e}")
                time.sleep(2 ** attempt)

    ai_answered = sum(1 for q in targets if q.get("ai_generated_answer"))
    print(f"  [ai-ans] AI answered {ai_answered}/{len(targets)} questions")
    return questions


# ══════════════════════════════════════════════════════════════════════════════
# MAIN EXTRACTION ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

def extract_universal(
    pdf_path: str,
    exam_name: str,
    year: int,
    answer_key_map: Optional[dict] = None,
    expected_count: int = 0,
    job_id: Optional[str] = None,
) -> list[dict]:
    """
    Extract all questions from a PDF using Gemini Vision (universal prompt).

    - Per-page cache keyed by pdf_hash + page_idx (re-runs cost ₹0).
    - 3x retry with DPI bump on failure.
    - Deduplicates by question number (keeps last occurrence).
    - Runs AI answer generation for any cancelled / unanswered questions.

    Returns list of question dicts ready for tag_questions() + store_questions().
    """
    pdf_path = str(Path(pdf_path).resolve())
    ph = _pdf_hash(pdf_path)

    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    print(f"\n[univ] {exam_name} {year} — {total_pages} pages | pdf_hash={ph[:16]}")
    print(f"[univ] T2={_TEXT_MODEL} | T3={_VISION_CHEAP} | T4/T5={_VISION_BEST} | DPI={RENDER_DPI_BASE}")

    all_raw: list[dict] = []
    zero_pages: list[int] = []  # track pages that returned 0 questions

    for page_idx in range(total_pages):
        page = doc[page_idx]
        raw_qs = _extract_page(ph, page_idx, page)
        if not raw_qs:
            zero_pages.append(page_idx)
        for rq in raw_qs:
            if isinstance(rq, dict) and rq.get("type") != "answer_key":
                rq["_page_idx"] = page_idx
        all_raw.extend(raw_qs)
        time.sleep(0.4)  # gentle rate limiting

    doc.close()

    # ── Separate answer-key-page items from question items ────────────────────
    # Answer key pages return [{"type": "answer_key", "map": {"1": "A", ...}}]
    page_answer_maps: dict[int, str] = {}
    question_raws: list[dict] = []
    for raw in all_raw:
        if isinstance(raw, dict) and raw.get("type") == "answer_key":
            for qnum_str, ans in (raw.get("map") or {}).items():
                try:
                    qnum = int(qnum_str)
                    letter = _OPTION_MAP.get(str(ans or "").strip().upper())
                    if letter:
                        page_answer_maps[qnum] = letter
                except (ValueError, TypeError):
                    pass
        else:
            question_raws.append(raw)
    if page_answer_maps:
        print(f"[univ] Collected answer key from dedicated pages: {len(page_answer_maps)} entries")

    # ── Normalise ─────────────────────────────────────────────────────────────
    normalised: list[dict] = []
    for raw in question_raws:
        q = _normalise_question(raw, exam_name, year)
        if q:
            normalised.append(q)

    deduped = clean_and_dedupe_questions(normalised)
    removed = len(normalised) - len(deduped)
    if removed:
        print(f"[univ] Cleanup removed {removed} noisy/instruction/regional rows")

    print(f"\n[univ] Extracted {len(deduped)} questions | Zero-result pages: {len(zero_pages)}")

    # ── Repair pass: re-run zero-result pages with T4+T5 ─────────────────────────
    # Always retry pages that returned 0 questions — they may have been missed by T3.
    # If expected_count is set, also retry when total is below 90% of expected.
    needs_repair = bool(zero_pages) and (
        expected_count == 0  # always repair zero pages when count unknown
        or len(deduped) < int(expected_count * 0.90)
    )
    if needs_repair:
        shortfall = expected_count - len(deduped)
        print(f"[univ] REPAIR PASS — {shortfall} questions short. Re-extracting {len(zero_pages)} pages with T4/T5...")
        doc2 = fitz.open(pdf_path)
        repair_raw: list[dict] = []
        for page_idx in zero_pages:
            page = doc2[page_idx]
            raw_qs = _extract_page_forced(ph, page_idx, page)
            if raw_qs:
                repair_raw.extend(raw_qs)
                print(f"  [repair] p{page_idx + 1} recovered {len(raw_qs)} questions")
        doc2.close()
        if repair_raw:
            for raw in repair_raw:
                q = _normalise_question(raw, exam_name, year)
                if q:
                    qn = q.get("question_number") or 0
                    seen[qn] = q
            deduped = sorted(seen.values(), key=lambda q: q.get("question_number") or 0)
            print(f"[univ] After repair: {len(deduped)} questions")

    # ── Apply answer key from dedicated answer-key pages ──────────────────────
    # Fills correct_answer for questions that had no inline answer detected.
    # Also back-fills questions that are cancelled in the key (null entries).
    if page_answer_maps:
        filled = 0
        for q in deduped:
            qn = q.get("question_number")
            if qn and qn in page_answer_maps and not q.get("correct_answer"):
                q["correct_answer"] = page_answer_maps[qn]
                q["needs_review"] = False
                filled += 1
        # Mark questions whose key entry was null as cancelled
        cancelled_qnums = set()
        for raw in all_raw:
            if isinstance(raw, dict) and raw.get("type") == "answer_key":
                for qnum_str, ans in (raw.get("map") or {}).items():
                    try:
                        qnum = int(qnum_str)
                        if ans is None:
                            cancelled_qnums.add(qnum)
                    except (ValueError, TypeError):
                        pass
        for q in deduped:
            qn = q.get("question_number")
            if qn and qn in cancelled_qnums and not q.get("correct_answer"):
                q["is_cancelled"] = True
                q["needs_review"] = False
        if filled or cancelled_qnums:
            print(f"[univ] Answer key applied: {filled} answers filled, {len(cancelled_qnums)} cancelled from key")

    no_answer = sum(1 for q in deduped if not q.get("correct_answer") and not q.get("is_cancelled"))
    print(f"[univ] Final count: {len(deduped)} questions | No answer: {no_answer}")

    # ── AI answer generation for cancelled / no-answer questions ─────────────
    if no_answer > 0:
        deduped = _ai_generate_answers(deduped)

    return deduped


_DI_PARENT_RE = re.compile(
    r'\[(BAR GRAPH|PIE CHART|LINE GRAPH|TABLE|DIAGRAM|FIGURE|HISTOGRAM)\]', re.I
)
_DI_REF_RE = re.compile(
    r'\b(the above|the following|given|based on|refer(?:ring)? to|according to|from the)\b'
    r'.{0,40}(chart|graph|table|diagram|data|figure|passage)',
    re.I,
)


def _propagate_di_images(questions: list[dict]) -> list[dict]:
    """
    Data Interpretation groups: when Q142 has a bar-chart image, Q143-146 say
    'Based on the above data...' — they need the same image_url so students
    always see the chart regardless of which sub-question they land on.

    Algorithm:
      For every question with has_image=True AND image_url set AND whose text
      starts with a [TAG] prefix (meaning it is a DI parent):
        Walk forward through consecutive question numbers (up to +10).
        If the next question's text contains a reference phrase ('based on the
        above chart', 'from the above data', etc.) copy has_image + image_url.
        Stop at the first gap in question numbers or another parent image.
    """
    by_num: dict[int, dict] = {
        q.get("question_number", 0): q
        for q in questions if q.get("question_number")
    }

    propagated = 0
    for q in questions:
        if not q.get("has_image") or not q.get("image_url"):
            continue
        text = q.get("question", "") or q.get("question_text", "") or ""
        if not _DI_PARENT_RE.search(text):
            continue
        q_num   = q.get("question_number", 0)
        img_url = q["image_url"]
        for offset in range(1, 11):
            nq = by_num.get(q_num + offset)
            if not nq:
                break
            if nq.get("has_image"):           # new DI set starts — stop
                break
            ntext = nq.get("question", "") or nq.get("question_text", "") or ""
            if _DI_REF_RE.search(ntext):
                nq["has_image"] = True
                nq["image_url"] = img_url
                propagated += 1
            # Don't break — a sub-question might not have the phrase but later
            # ones might (some papers alternate phrasing)

    if propagated:
        print(f"[DI-propagate] Spread image_url to {propagated} sub-questions")
    return questions


# ══════════════════════════════════════════════════════════════════════════════
# IMAGE UPLOAD — uploads page images for has_image questions to Supabase Storage
# ══════════════════════════════════════════════════════════════════════════════

def _find_figure_rect(page: fitz.Page) -> Optional[fitz.Rect]:
    """
    Detect the bounding box of the chart/graph/figure on a PDF page.

    Strategy 1 — raster images (fast, high precision):
      Most Indian exam charts are embedded PNG/JPEG raster images.
      Filters: area >= 20,000 pt², <= 85% of page, aspect ratio >= 0.4.

    Strategy 2 — vector drawing clusters (fallback for dice/geometry/spatial):
      Dice, cube nets, geometry figures are drawn as vector paths.
      Finds clusters of small shapes (200–15,000 pt²) that are narrower than
      60% of page width and taller than 30pt — avoids full-width text borders
      and thin horizontal rules that appear in bilingual papers.
      Requires >= 4 such shapes within a 250pt radius to qualify as a figure.

    Returns union rect padded 20pt, clipped to page.
    Returns None if nothing qualifies → caller falls back to full page.
    """
    pr        = page.rect
    page_area = pr.get_area()
    PAD       = 20

    def _union_rect(rects: list) -> fitz.Rect:
        x0 = min(r.x0 for r in rects); y0 = min(r.y0 for r in rects)
        x1 = max(r.x1 for r in rects); y1 = max(r.y1 for r in rects)
        return fitz.Rect(
            max(pr.x0, x0 - PAD), max(pr.y0, y0 - PAD),
            min(pr.x1, x1 + PAD), min(pr.y1, y1 + PAD),
        )

    # ── Strategy 1: raster images ─────────────────────────────────────────────
    MIN_RASTER_AREA = 20_000
    candidate: list[fitz.Rect] = []
    for img_info in page.get_images(full=True):
        xref = img_info[0]
        for rect in page.get_image_rects(xref):
            area = rect.get_area()
            if area < MIN_RASTER_AREA:
                continue
            if area > page_area * 0.85:
                continue
            if rect.height > 0 and (rect.width / rect.height) < 0.4:
                continue
            candidate.append(rect)

    if candidate:
        return _union_rect(candidate)

    # ── Strategy 2: vector drawing clusters (dice/geometry/spatial) ───────────
    # Collect small-to-medium shapes; exclude full-width borders and thin lines.
    max_shape_w = pr.width * 0.60   # nothing wider than 60% of page
    shapes: list[fitz.Rect] = []
    for d in page.get_drawings():
        r = fitz.Rect(d["rect"])
        if r.is_empty or r.is_infinite:
            continue
        area = r.get_area()
        if area < 200 or area > 15_000:      # skip tiny marks and large borders
            continue
        if r.width > max_shape_w:            # skip full-width rules / text-box borders
            continue
        if r.height < 30:                    # skip thin horizontal lines
            continue
        shapes.append(r)

    if len(shapes) < 4:
        return None

    # Find the densest cluster: for each shape, count neighbours within 250pt.
    CLUSTER_RADIUS = 250
    best_group: list[fitz.Rect] = []
    for i, anchor in enumerate(shapes):
        cx = (anchor.x0 + anchor.x1) / 2
        cy = (anchor.y0 + anchor.y1) / 2
        group = [
            s for s in shapes
            if abs((s.x0 + s.x1) / 2 - cx) <= CLUSTER_RADIUS
            and abs((s.y0 + s.y1) / 2 - cy) <= CLUSTER_RADIUS
        ]
        if len(group) > len(best_group):
            best_group = group

    if len(best_group) < 4:
        return None

    cluster_rect = _union_rect(best_group)
    # Sanity check: cluster must not cover more than 70% of the page
    if cluster_rect.get_area() > page_area * 0.70:
        return None

    return cluster_rect


def _upload_page_images(
    questions: list[dict],
    pdf_path: str,
    exam_name: str,
    exam_year: int,
    supabase_client: Any,
) -> list[dict]:
    """
    For every question with has_image=True, crop the source page to just the
    chart/graph/figure area and upload to Supabase Storage.

    Cropping strategy:
      • PyMuPDF detects embedded images + large vector drawings → crop to their
        bounding box (±20pt padding).
      • If nothing detected (rare) → full page at 150 DPI as fallback.

    Bucket must exist with public access. Path: {exam}/{year}/figure_p{n}.png
    """
    image_qs = [q for q in questions if q.get("has_image") and q.get("_page_idx") is not None]
    if not image_qs:
        return questions

    page_to_qs: dict[int, list[dict]] = {}
    for q in image_qs:
        page_to_qs.setdefault(int(q["_page_idx"]), []).append(q)

    print(f"[img-upload] {len(image_qs)} image questions across {len(page_to_qs)} pages — cropping & uploading...")
    safe_exam = re.sub(r'[^a-zA-Z0-9_-]', '_', exam_name.strip())
    bucket = "question-images"

    try:
        doc = fitz.open(pdf_path)
        for page_idx, qs in sorted(page_to_qs.items()):
            try:
                page = doc[page_idx]

                # Try to crop to just the figure
                fig_rect = _find_figure_rect(page)
                if fig_rect and fig_rect.get_area() > 5_000:
                    mat = fitz.Matrix(200 / 72, 200 / 72)
                    pix = page.get_pixmap(matrix=mat, clip=fig_rect)
                    suffix = f"figure_p{page_idx + 1}"
                    print(f"  [img-upload] p{page_idx + 1} cropped to {fig_rect.width:.0f}×{fig_rect.height:.0f}pt")
                else:
                    # Fallback: full page at lower DPI
                    mat = fitz.Matrix(150 / 72, 150 / 72)
                    pix = page.get_pixmap(matrix=mat)
                    suffix = f"page_{page_idx + 1}"
                    print(f"  [img-upload] p{page_idx + 1} no figure detected — full page fallback")

                png_bytes = pix.tobytes("png")
                path = f"{safe_exam}/{exam_year}/{suffix}.png"
                supabase_client.storage.from_(bucket).upload(
                    path=path,
                    file=png_bytes,
                    file_options={"content-type": "image/png", "upsert": "true"},
                )
                url = supabase_client.storage.from_(bucket).get_public_url(path)
                for q in qs:
                    q["image_url"] = url
                print(f"  [img-upload] p{page_idx + 1} → {url[:70]}...")
            except Exception as e:
                print(f"  [img-upload] p{page_idx + 1} failed: {e}")
        doc.close()
    except Exception as e:
        print(f"[img-upload] Could not open PDF for image rendering: {e}")

    return questions


# ══════════════════════════════════════════════════════════════════════════════
# BACKGROUND JOB ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

def process_universal_job_background(
    job_id: str,
    pdf_path: str,
    exam_name: str,
    exam_year: int,
    answer_key_map: Optional[dict] = None,
    expected_count: int = 0,
) -> None:
    """
    Drop-in replacement for pipeline.process_job_background.
    Uses the universal vision extractor instead of the regex pipeline.
    Updates the jobs table with progress/status as it runs.
    """
    # Make pipeline.py importable from this thread
    sys.path.insert(0, str(Path(__file__).parent.parent))

    try:
        from config import supabase  # type: ignore  # noqa: F401 — side-effects needed
        from papers import mark_paper_lifecycle, paper_id_for_job
        from pipeline import (  # type: ignore
            tag_questions,
            store_questions,
            generate_explanations_bulk,
            inject_answers,
            CostTracker,
        )
    except ImportError as e:
        print(f"[univ-job] Import error: {e}\n{traceback.format_exc()}")
        return

    # ── Job progress helper ───────────────────────────────────────────────────
    def _update_job(status: str, progress: int, error: str = "") -> None:
        payload: dict = {"status": status, "progress": progress}
        if error:
            payload["error_log"] = error
        try:
            supabase.table("jobs").update(payload).eq("id", job_id).execute()
        except Exception as ue:
            print(f"[univ-job] DB update error: {ue}")

    try:
        _init_job_tracking()
        _update_job("processing", 5)
        print(f"[univ-job] Starting job {job_id[:12]} — PDF: {pdf_path}")

        # ── Count pages for progress reporting ────────────────────────────────
        doc = fitz.open(pdf_path)
        total_pages = len(doc)
        scanned_hint = _looks_like_scanned_doc(doc)
        doc.close()
        print(f"[univ-job] PDF has {total_pages} pages")
        if scanned_hint:
            print("[univ-job] Scanned PDF detected — using scanned extractor path")

        # ── Extraction: 5% → 70% proportionally per page ─────────────────────
        _update_job("processing", 10)

        questions: list[dict] = []
        trailing_missing: list[int] = []

        if scanned_hint:
            from extractor.scanned_extractor import process_scanned_job

            scanned_tracker = CostTracker()
            questions = process_scanned_job(
                pdf_path,
                job_id,
                exam_name,
                exam_year,
                scanned_tracker,
                expected_count=expected_count,
            )
            for s in scanned_tracker.steps:
                if not hasattr(_tls, "steps"):
                    _tls.steps = []
                _tls.steps.append({
                    "step": f"Scanned {s['step']}",
                    "input_tokens": s["input_tokens"],
                    "output_tokens": s["output_tokens"],
                    "cost_usd": s["cost_usd"],
                    "cost_inr": s["cost_inr"],
                    "cached": s.get("cached", False),
                })
            trailing_missing = _trailing_missing_question_block(questions, expected_count)
        else:
            ph = _pdf_hash(pdf_path)
            doc = fitz.open(pdf_path)
            all_raw: list[dict] = []
            zero_pages: list[int] = []
            problematic_pages: list[int] = []
            page_question_numbers: list[set[int]] = []
            max_number_seen_so_far = 0

            for page_idx in range(total_pages):
                page = doc[page_idx]
                raw_qs = _extract_page(ph, page_idx, page)
                if not raw_qs:
                    zero_pages.append(page_idx)
                page_numbers: list[int] = []
                for rq in raw_qs:
                    if isinstance(rq, dict) and rq.get("type") != "answer_key":
                        rq["_page_idx"] = page_idx
                        temp_q = _normalise_question(rq, exam_name, exam_year)
                        if temp_q and _is_low_quality(temp_q) and page_idx not in problematic_pages:
                            problematic_pages.append(page_idx)
                        if temp_q and isinstance(temp_q.get("question_number"), int):
                            page_numbers.append(int(temp_q["question_number"]))

                if (
                    page_numbers
                    and page_idx >= max(10, int(total_pages * 0.6))
                    and max_number_seen_so_far >= 50
                    and max(page_numbers) <= 20
                    and len(page_numbers) >= 5
                ):
                    if page_idx not in problematic_pages:
                        problematic_pages.append(page_idx)
                    print(
                        f"[univ-job] Suspicious numbering reset on p{page_idx + 1}: "
                        f"got {page_numbers[:10]} after already reaching Q{max_number_seen_so_far}. "
                        "Scheduling forced re-extraction."
                    )

                if page_numbers:
                    max_number_seen_so_far = max(max_number_seen_so_far, max(page_numbers))
                page_question_numbers.append(set(page_numbers))
                all_raw.extend(raw_qs)

                pct = 10 + int(60 * ((page_idx + 1) / max(1, total_pages)))
                _update_job("processing", pct)
                time.sleep(0.4)

            doc.close()

            def _merge_to_seen(raw_list: list[dict], p_idx: int):
                for raw in raw_list:
                    if isinstance(raw, dict) and ("question_text" in raw or "option_a" in raw):
                        q = dict(raw)
                    else:
                        q = _normalise_question(raw, exam_name, exam_year)
                    if q:
                        if q.get("_page_idx") is None:
                            q["_page_idx"] = p_idx
                        qn = q.get("question_number")
                        if qn:
                            seen[f"p{p_idx}_q{qn}"] = q
                        else:
                            seen[f"p{p_idx}_auto_{len(seen)}"] = q

            def _drop_page_from_seen(p_idx: int):
                prefix = f"p{p_idx}_"
                for key in [k for k in seen.keys() if k.startswith(prefix)]:
                    del seen[key]

            def _get_sorted_questions():
                def _sort_key(q):
                    p_idx = q.get("_page_idx", 0)
                    qn = q.get("question_number")
                    if not qn:
                        return (p_idx, 99999, q.get("question", "")[:50])
                    try:
                        numeric_match = re.search(r'\d+', str(qn))
                        num = int(numeric_match.group()) if numeric_match else 99999
                        return (p_idx, num, str(qn))
                    except Exception:
                        return (p_idx, 99999, str(qn))
                return sorted(seen.values(), key=_sort_key)

            def _numbered_questions():
                return [q for q in _get_sorted_questions() if isinstance(q.get("question_number"), int)]

            seen: dict = {}
            for rq in all_raw:
                p_idx = rq.get("_page_idx", 0)
                _merge_to_seen([rq], p_idx)

            questions = _get_sorted_questions()

            repair_needed = bool(zero_pages or problematic_pages)
            if expected_count > 0 and len(questions) < int(expected_count * 0.95):
                repair_needed = True

            if repair_needed:
                to_repair = sorted(list(set(zero_pages + problematic_pages)))
                if to_repair:
                    target_display = expected_count if expected_count > 0 else "?"
                    print(f"[univ-job] REPAIR PASS — {len(questions)}/{target_display} q. Re-extracting {len(to_repair)} pages (zero={len(zero_pages)}, low_quality={len(problematic_pages)}) with T4/T5...")
                    _update_job("processing", 72)
                    doc2 = fitz.open(pdf_path)
                    for i, page_idx in enumerate(to_repair, start=1):
                        page = doc2[page_idx]
                        raw_qs = _extract_page_forced(ph, page_idx, page)
                        if raw_qs:
                            _drop_page_from_seen(page_idx)
                            _merge_to_seen(raw_qs, page_idx)
                            print(f"  [repair] p{page_idx + 1} recovered {len(raw_qs)} questions")
                        repair_progress = 72 + int(3 * (i / max(1, len(to_repair))))
                        _update_job("processing", repair_progress)
                    doc2.close()
                    questions = _get_sorted_questions()
                    print(f"[univ-job] After repair: {len(questions)} questions")

            trailing_missing = _trailing_missing_question_block(questions, expected_count)
            if trailing_missing and len(trailing_missing) >= max(10, int(expected_count * 0.15)):
                current_numbered = _numbered_questions()
                max_qn = max(q["question_number"] for q in current_numbered) if current_numbered else 0
                max_qn_page = max(
                    (q.get("_page_idx", 0) for q in current_numbered if q.get("question_number") == max_qn),
                    default=0,
                )
                tail_pages = list(range(max(0, max_qn_page), total_pages))
                print(
                    f"[univ-job] TRAILING-TAIL RECOVERY — extracted only up to Q{max_qn}; "
                    f"retrying pages {tail_pages[0] + 1}-{tail_pages[-1] + 1} for missing tail "
                    f"{trailing_missing[0]}-{trailing_missing[-1]}"
                )
                _update_job("processing", 74, f"Recovering missing tail questions {trailing_missing[0]}-{trailing_missing[-1]}...")
                doc_tail = fitz.open(pdf_path)
                for i, page_idx in enumerate(tail_pages, start=1):
                    page = doc_tail[page_idx]
                    raw_qs = _extract_page_forced(ph, page_idx, page)
                    if raw_qs:
                        _drop_page_from_seen(page_idx)
                        _merge_to_seen(raw_qs, page_idx)
                        print(f"  [tail-repair] p{page_idx + 1} recovered {len(raw_qs)} questions")
                    tail_progress = 74 + int(4 * (i / max(1, len(tail_pages))))
                    _update_job("processing", tail_progress)
                doc_tail.close()
                questions = _get_sorted_questions()
                trailing_missing = _trailing_missing_question_block(questions, expected_count)
                if trailing_missing:
                    print(
                        f"[univ-job] Tail recovery incomplete — still missing "
                        f"{trailing_missing[0]}-{trailing_missing[-1]}"
                    )

            # Bilingual split-page rescue:
            # TSPSC/State PSC papers often repeat the same question number across two
            # consecutive pages, with English on one side and regional text spilling
            # across the page break. Single-page retries still miss these cases.
            current_questions = _get_sorted_questions()
            current_numbered = {
                q["question_number"]: q
                for q in current_questions
                if isinstance(q.get("question_number"), int)
            }
            pair_target_numbers: set[int] = set()
            if expected_count > 0:
                pair_target_numbers.update(
                    n for n in range(1, expected_count + 1)
                    if n not in current_numbered
                )
            pair_target_numbers.update(
                qn for qn, q in current_numbered.items()
                if _needs_bilingual_pair_recovery(q)
            )

            if pair_target_numbers:
                pair_recovered_any = False
                pair_doc = fitz.open(pdf_path)
                for page_idx in range(max(0, total_pages - 1)):
                    left_numbers = page_question_numbers[page_idx] if page_idx < len(page_question_numbers) else set()
                    right_numbers = page_question_numbers[page_idx + 1] if (page_idx + 1) < len(page_question_numbers) else set()
                    candidate_targets = sorted(
                        qn for qn in pair_target_numbers
                        if (
                            any(n in left_numbers for n in (qn - 1, qn))
                            and any(n in right_numbers for n in (qn, qn + 1))
                        )
                    )
                    if not candidate_targets:
                        continue

                    raw_qs = _extract_page_pair_targeted(
                        pair_doc[page_idx],
                        pair_doc[page_idx + 1],
                        left_idx=page_idx,
                        target_numbers=candidate_targets,
                    )
                    if not raw_qs:
                        continue

                    recovered_qs: list[dict] = []
                    for rq in raw_qs:
                        q = _normalise_question(rq, exam_name, exam_year)
                        if q and isinstance(q.get("question_number"), int):
                            q["_page_idx"] = page_idx
                            recovered_qs.append(q)
                    for q in recovered_qs:
                        qn = q.get("question_number")
                        if not isinstance(qn, int):
                            continue
                        if qn not in pair_target_numbers:
                            continue
                        for key in [k for k, v in seen.items() if v.get("question_number") == qn]:
                            del seen[key]
                        seen[f"p{page_idx}_pair_q{qn}"] = q
                        pair_recovered_any = True
                pair_doc.close()
                if pair_recovered_any:
                    questions = _get_sorted_questions()
                    print(f"[univ-job] After bilingual pair recovery: {len(questions)} questions")

            if not questions:
                fallback_pages = zero_pages or list(range(total_pages))
                if set(fallback_pages).issubset(set(zero_pages + problematic_pages)):
                    print("[univ-job] Emergency recovery skipped — forced repair already covered all zero-result pages")
                else:
                    print(f"[univ-job] EMERGENCY RECOVERY — No questions found. Retrying {len(fallback_pages)} pages with forced vision...")
                    _update_job("processing", 78, "Performing emergency recovery pass...")
                    doc_em = fitz.open(pdf_path)
                    for i, page_idx in enumerate(fallback_pages, start=1):
                        page = doc_em[page_idx]
                        raw_qs = _extract_page_forced(ph, page_idx, page)
                        if raw_qs:
                            _drop_page_from_seen(page_idx)
                            _merge_to_seen(raw_qs, page_idx)
                        emergency_progress = 78 + int(2 * (i / max(1, len(fallback_pages))))
                        _update_job("processing", emergency_progress)
                    doc_em.close()
                    questions = _get_sorted_questions()
                    print(f"[univ-job] After emergency recovery: {len(questions)} questions")

        _update_job("processing", 75)
        print(f"[univ-job] Extraction done — {len(questions)} questions")

        if not questions:
            _update_job("failed", 0, "No questions extracted from PDF. Reason: Triage skipped all pages or AI returned empty.")
            print(f"[univ-job] FAILED — no questions found")
            return

        # ── Auto-detect answer key embedded in same PDF (zero cost) ─────────
        if not answer_key_map:
            try:
                from .answer_key_parser import parse_answer_key_multiset, detect_paper_set
                paper_set = detect_paper_set(pdf_path) or "A"
                expected = max(len(questions), 100)
                multi_key = parse_answer_key_multiset(pdf_path, expected_count=expected)
                if paper_set in multi_key:
                    candidate = multi_key[paper_set]
                    covered = sum(1 for q in questions if q.get("question_number") in candidate)
                    if covered > 10:
                        answer_key_map = candidate
                        print(f"[univ-job] Auto answer key: Set {paper_set}, {len(candidate)} answers, {covered} matched")
                    else:
                        print(f"[univ-job] Auto answer key low coverage ({covered} matched) — skipping")
            except Exception as e:
                print(f"[univ-job] Answer key auto-detect failed (non-fatal): {e}")

        # ── AI answer generation — only for small gaps after an answer key ──────
        # If NO answer key was provided, skip entirely: AI-guessed answers are
        # unreliable and all end up needs_review=True anyway. User should upload
        # the answer key separately to get accurate answers.
        no_answer = sum(1 for q in questions if not q.get("correct_answer"))
        small_gap = no_answer <= max(10, int(len(questions) * 0.15))
        if no_answer > 0 and answer_key_map and small_gap:
            print(f"[univ-job] Generating AI answers for {no_answer} gap questions...")
            questions = _ai_generate_answers(questions)
        elif no_answer > 0:
            print(f"[univ-job] {no_answer} unanswered questions — skipping AI inference "
                  f"(upload answer key to fill these)")

        # ── Inject external answer key (if provided) ─────────────────────────
        if answer_key_map:
            print(f"[univ-job] Injecting {len(answer_key_map)} answers from external key...")
            for q in questions:
                qn = q.get("question_number")
                if qn and qn in answer_key_map:
                    q["correct_answer"] = answer_key_map[qn]
                    q["needs_review"] = False
        _update_job("processing", 78)

        # ── Upload page images for image questions ────────────────────────────
        image_qs_count = sum(1 for q in questions if q.get("has_image"))
        if image_qs_count > 0:
            print(f"[univ-job] Uploading images for {image_qs_count} image questions...")
            questions = _upload_page_images(questions, pdf_path, exam_name, exam_year, supabase)
            # Propagate image_url to DI sub-questions after URLs are set
            questions = _propagate_di_images(questions)
        _update_job("processing", 80)

        # ── AI tagging (subject / topic / difficulty) ─────────────────────────
        print(f"[univ-job] Tagging {len(questions)} questions...")
        tag_tracker = CostTracker()
        questions = tag_questions(questions, exam_name, tracker=tag_tracker)
        # Transfer tagging costs into the thread-local cost tracker
        for s in tag_tracker.steps:
            cost_usd = s["cost_inr"] / _USD_TO_INR
            if not hasattr(_tls, "steps"):
                _tls.steps = []
            _tls.steps.append({
                "step": f"Tagging {s['step']}",
                "input_tokens": s["input_tokens"],
                "output_tokens": s["output_tokens"],
                "cost_usd": cost_usd,
                "cost_inr": s["cost_inr"],
                "cached": s.get("cached", False),
            })
        _update_job("processing", 85)

        # ── DB insert ─────────────────────────────────────────────────────────
        print(f"[univ-job] Storing {len(questions)} questions...")
        result = store_questions(questions, pdf_path, exam_name, exam_year, job_id=job_id)
        inserted = result.get("inserted", 0)
        skipped = result.get("skipped", 0)
        blocked = result.get("blocked", 0)
        print(f"[univ-job] Stored — inserted: {inserted}, skipped: {skipped}")
        _update_job("processing", 90)

        # ── Post-store: inject answers into DB by question_number ─────────────
        if answer_key_map:
            try:
                inject_answers(answer_key_map, exam_name, exam_year)
            except Exception as e:
                print(f"[univ-job] inject_answers error (non-fatal): {e}")
        _update_job("processing", 95)

        # Explanations are generated lazily on first user access — skip bulk generation
        # during upload to save API cost (explanations = ~50% of upload cost).

        _flush_cost_log(exam_name, inserted)
        
        # Calculate missing questions for admin display
        missing_log = ""
        extracted_qns = [q.get("question_number") for q in questions if isinstance(q.get("question_number"), int)]
        if extracted_qns:
            max_qn = max(expected_count, max(extracted_qns)) if extracted_qns else expected_count
            if max_qn > 0:
                missing_nums = [str(i) for i in range(1, max_qn + 1) if i not in extracted_qns]
                if missing_nums:
                    missing_log = f"Missing questions ({len(missing_nums)}): {', '.join(missing_nums)}"
                    print(f"[univ-job] {missing_log}")
        trailing_missing = _trailing_missing_question_block(questions, expected_count)
        blocked_qnums = result.get("blocked_qnums") or []
        if blocked_qnums:
            blocked_log = f"Blocked from publish ({blocked}): {', '.join(blocked_qnums[:20])}"
            missing_log = f"{missing_log} | {blocked_log}" if missing_log else blocked_log
            print(f"[univ-job] {blocked_log}")

        if trailing_missing and len(trailing_missing) >= max(10, int(expected_count * 0.15)):
            fail_msg = (
                f"Incomplete extraction: trailing questions {trailing_missing[0]}-{trailing_missing[-1]} "
                f"could not be recovered automatically."
            )
            fail_msg = f"{fail_msg} | {missing_log}" if missing_log else fail_msg
            _update_job("failed", 0, fail_msg)
            print(f"[univ-job] FAILED — {fail_msg}")
            return

        _update_job("completed", 100, missing_log)
        
        # 🔗 Auto-Publish Intelligence: Move high-quality extractions straight to published
        target_publish_status = "draft"
        if inserted >= 100:
             print(f"[univ-job] High confidence ({inserted} q) detected. Auto-publishing paper!")
             target_publish_status = "published"

        mark_paper_lifecycle(
            paper_id_for_job(job_id, sb=supabase),
            "ingested",
            publish_status=target_publish_status,
            last_job_id=job_id,
            sb=supabase,
        )
        print(f"[univ-job] Job {job_id[:12]} COMPLETED — {inserted} questions stored ({target_publish_status})")

    except Exception as e:
        tb = traceback.format_exc()
        print(f"[univ-job] Job {job_id[:12]} CRASHED:\n{tb}")
        _update_job("failed", 0, f"{type(e).__name__}: {str(e)[:200]}")
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
        if os.path.exists(pdf_path):
            try:
                os.unlink(pdf_path)
            except Exception as e:
                print(f"[univ-job] Could not delete tmp file {pdf_path}: {e}")


# ══════════════════════════════════════════════════════════════════════════════
# CLI entry point
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Universal vision extractor for Indian exam PDFs")
    parser.add_argument("pdf", help="Path to PDF")
    parser.add_argument("exam_name", help='Exam name e.g. "APPSC Group II Mains Paper I"')
    parser.add_argument("year", type=int, help="Exam year e.g. 2025")
    parser.add_argument("--dry-run", action="store_true", help="Extract but don't insert to DB")
    args = parser.parse_args()

    questions = extract_universal(args.pdf, args.exam_name, args.year)
    print(f"\nExtracted {len(questions)} questions")

    if not args.dry_run:
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from pipeline import tag_questions, store_questions, generate_explanations_bulk  # type: ignore
        questions = tag_questions(questions, args.exam_name)
        result = store_questions(questions, args.pdf, args.exam_name, args.year)
        print(f"Stored: {result}")
        generate_explanations_bulk(args.exam_name, args.year)
    else:
        for q in questions[:5]:
            print(json.dumps(q, indent=2, ensure_ascii=False))
