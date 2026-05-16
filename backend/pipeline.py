"""
Admin PDF Pipeline: PDF → Extract (local) → Filter English → Tag (cheap AI) → Supabase

Cost comparison:
  Old approach: gemini-2.5-flash, raw pages sent to AI → ~₹175/paper
  New approach: local regex extraction + gemini-1.5-flash-8b tagging only → ~₹0.12/paper

Why so much cheaper:
  1. gemini-1.5-flash-8b has no thinking tokens — 93x cheaper than 2.5-flash
  2. We extract questions locally with regex (FREE) — AI only does subject/topic tagging
  3. We send only clean question text (~50 tokens), not raw pages (~2000 tokens)
  4. Local file cache — re-runs cost ₹0

Usage (CLI):
    python pipeline.py exam.pdf "UPSC Prelims" 2024
"""
from __future__ import annotations

import os
import re
import sys
import json
import time
import hashlib
import io as _io
import datetime
import concurrent.futures as _cf
from pathlib import Path
from typing import Optional, Any, cast, List, Dict, Union
from langdetect import detect

_TAG_EXECUTOR = _cf.ThreadPoolExecutor(max_workers=4, thread_name_prefix="tagger")

import traceback
import fitz  # PyMuPDF
from PIL import Image as PILImage
import pytesseract
from ai_models import (
    ANSWER_MODEL,
    EXPLANATION_MODEL,
    EXTRACTION_MODEL,
    EXTRACTION_REPAIR_MODEL,
    TAGGING_MODEL,
    get_genai_client,
    short_model_name,
)
from canonical_taxonomy import derive_canonical_taxonomy
from config import supabase
from extraction_cleanup import clean_and_dedupe_questions
from papers import resolve_paper_id, sync_paper_question_counts, source_filename_from_path
from question_repairs import record_ai_repair_proposals
from row_quality import derive_quality_fields, merge_quality_fields
from dotenv import load_dotenv
from google.genai import types

load_dotenv()

_CLIENT = get_genai_client()

# ══════════════════════════════════════════════════════════════════════════════
# COST TRACKER — accumulates real token counts from API responses
# gemini-2.5-flash-lite pricing (as of 2025):
#   Text input:  $0.10 / 1M tokens  → ₹0.0084 / 1K tokens
#   Text output: $0.40 / 1M tokens  → ₹0.0336 / 1K tokens
#   Image input: $0.10 / 1M tokens  (images counted as tokens, ~258 tokens/image at 150dpi)
# ══════════════════════════════════════════════════════════════════════════════

USD_TO_INR = 84
_INPUT_PRICE_PER_1M  = 0.10   # USD
_OUTPUT_PRICE_PER_1M = 0.40   # USD


class CostTracker:
    def __init__(self):
        self.steps: list[dict] = []

    def record(self, step: str, input_tokens: int, output_tokens: int, cached: bool = False):
        _SAFETY_MARGIN = 1.20  # 20% overhead to match Google AI Studio billing
        cost_usd = (
            input_tokens  / 1_000_000 * _INPUT_PRICE_PER_1M +
            output_tokens / 1_000_000 * _OUTPUT_PRICE_PER_1M
        ) * _SAFETY_MARGIN
        self.steps.append({
            "step": step,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": cost_usd,
            "cost_inr": cost_usd * USD_TO_INR,
            "cached": cached,
        })

    def record_from_response(self, step: str, resp) -> None:
        """Extract real token counts from a Gemini API response object."""
        try:
            meta = resp.usage_metadata
            self.record(step, meta.prompt_token_count or 0, meta.candidates_token_count or 0)
        except Exception:
            pass  # non-fatal — estimate will still show at end

    def total_inr(self) -> float:
        return round(sum(s["cost_inr"] for s in self.steps if not s["cached"]), 4)

    def print_summary(self):
        print("\n" + "─" * 60)
        print("💰 COST BREAKDOWN (real token counts from Gemini API)")
        print("─" * 60)
        print(f"  {'Step':<28} {'In tok':>7} {'Out tok':>8} {'₹ Cost':>8}  {'Cached?'}")
        print(f"  {'─'*28} {'─'*7} {'─'*8} {'─'*8}  {'─'*7}")
        for s in self.steps:
            cached_str = "✅ ₹0" if s["cached"] else ""
            cost_str   = "₹0 (cached)" if s["cached"] else f"₹{s['cost_inr']:.4f}"
            print(f"  {s['step']:<28} {s['input_tokens']:>7,} {s['output_tokens']:>8,} {cost_str:>12}  {cached_str}")
        print(f"  {'─'*28} {'─'*7} {'─'*8} {'─'*8}")
        print(f"  {'TOTAL THIS RUN':<28} {'':>7} {'':>8} {'₹' + str(self.total_inr()):>8}")
        print("─" * 60)

    def save_log(self, exam_name: str, exam_year: int, num_questions: int):
        log_path = CACHE_DIR / "cost_log.json"
        try:
            existing = json.loads(log_path.read_text()) if log_path.exists() else []
        except Exception:
            existing = []
        entry = {
            "timestamp": datetime.datetime.now().isoformat(timespec="seconds"),
            "exam": f"{exam_name} {exam_year}",
            "questions": num_questions,
            "total_inr": self.total_inr(),
            "steps": self.steps,
        }
        existing.append(entry)
        log_path.write_text(json.dumps(existing, indent=2, ensure_ascii=False))
        print(f"  📋 Cost log saved → cache/cost_log.json")

TAGGER_MODEL       = TAGGING_MODEL
BEST_MODEL         = EXPLANATION_MODEL

# ── Local cache to avoid re-paying for same batches ────────────────────────
CACHE_DIR = Path("./cache")
CACHE_DIR.mkdir(exist_ok=True)

# ── Batch size: 30 question TEXTS (not 5 raw pages) ────────────────────────
# Sending only question text = ~50 tokens/question vs ~500 tokens/raw page
TAG_BATCH_SIZE = 20
TAG_PROMPT_VERSION = "v9"  # bust stale tagging cache


# ── Lazy Supabase ───────────────────────────────────────────────────────────

_supabase = None
def get_supabase():
    global _supabase
    if _supabase is None:
        try:
            from config import supabase as sb
            _supabase = sb
        except ImportError:
            # Fallback for when running in subdirectories
            sys.path.append(os.path.dirname(os.path.abspath(__file__)))
            from config import supabase as sb
            _supabase = sb
    return _supabase


_question_supported_columns_cache: set[str] | None = None


def _question_supported_columns(sb=None) -> set[str]:
    """
    Live DBs can lag behind local code. Filter writes to only the columns that
    actually exist so uploads keep working before every migration is applied.
    """
    global _question_supported_columns_cache
    if _question_supported_columns_cache is not None:
        return _question_supported_columns_cache

    sb = sb or get_supabase()
    fallback = {
        "question_text", "option_a", "option_b", "option_c", "option_d",
        "correct_answer", "subject", "topic", "subtopic", "difficulty",
        "canonical_subject", "canonical_topic_family", "canonical_subtopic_family",
        "question_type", "concept", "exam_name", "exam_year", "source_pdf",
        "paper_id", "question_hash", "question_number", "is_active",
        "needs_review", "has_image", "image_url", "shift_label",
        "test_date", "test_time", "exam_section", "passage",
        "student_answer", "structural_status", "answer_status",
        "explanation_status", "tagging_status", "review_required",
        "confidence_score", "public_visibility", "primary_issue_code",
        "issue_codes",
    }
    try:
        data = sb.table("questions").select("*").limit(1).execute().data or []
        if data:
            _question_supported_columns_cache = set(data[0].keys())
        else:
            _question_supported_columns_cache = fallback
    except Exception:
        _question_supported_columns_cache = fallback
    return _question_supported_columns_cache


def _merge_canonical_taxonomy(row: dict[str, Any], supported_cols: set[str] | None = None) -> dict[str, Any]:
    updated = dict(row)
    canonical = derive_canonical_taxonomy(
        updated.get("subject"),
        updated.get("topic"),
        updated.get("subtopic"),
    )
    updated["subject"] = canonical["canonical_subject"]
    updated["topic"] = canonical["canonical_topic_family"]
    updated["subtopic"] = canonical["canonical_subtopic_family"]
    if supported_cols is None or "canonical_subject" in supported_cols:
        updated["canonical_subject"] = canonical["canonical_subject"]
    if supported_cols is None or "canonical_topic_family" in supported_cols:
        updated["canonical_topic_family"] = canonical["canonical_topic_family"]
    if supported_cols is None or "canonical_subtopic_family" in supported_cols:
        updated["canonical_subtopic_family"] = canonical["canonical_subtopic_family"]
    return updated


_QUALITY_KEYS = {
    "structural_status", "answer_status", "explanation_status",
    "tagging_status", "review_required", "confidence_score",
    "public_visibility", "primary_issue_code", "issue_codes",
}

def _quality_update_payload(row: dict[str, Any], merged_quality: dict[str, Any], supported_cols: set[str]) -> dict[str, Any]:
    # Strip quality keys from the initial row if the column doesn't exist in the DB
    payload = {k: v for k, v in row.items() if k not in _QUALITY_KEYS or k in supported_cols}
    for key in _QUALITY_KEYS:
        if key in supported_cols and key in merged_quality:
            payload[key] = merged_quality[key]
    return payload


_DEVANAGARI = re.compile(r'[\u0900-\u097F]')
_TELUGU_UNICODE = re.compile(r'[\u0C00-\u0C7F]')

def _strip_telugu_unicode(text: str) -> str:
    """Hard Unicode filter: remove lines where ≥15% of alpha chars are Telugu script."""
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
            continue
        clean.append(_TELUGU_UNICODE.sub('', line))
    return '\n'.join(clean)

def _strip_bilingual_noise(text: str) -> str:
    """Remove Hindi (Devanagari) and Telugu text from bilingual papers.
    Used as a late-stage cleanup, not during initial extraction to avoid data loss.
    """
    if not text:
        return ""
    lines = text.split('\n')
    cleaned_lines = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        # Remove lines >40% Hindi (Devanagari)
        hindi_chars = len(_DEVANAGARI.findall(stripped))
        if len(stripped) > 0 and (hindi_chars / len(stripped)) > 0.4:
            continue
        # Remove lines ≥15% Telugu Unicode (U+0C00–U+0C7F)
        alpha = [c for c in stripped if c.isalpha()]
        if alpha:
            telugu = sum(1 for c in alpha if '\u0C00' <= c <= '\u0C7F')
            if telugu / len(alpha) >= 0.15:
                continue
        # Strip remaining Hindi + Telugu chars inline
        cleaned_line = _DEVANAGARI.sub('', line)
        cleaned_line = _TELUGU_UNICODE.sub('', cleaned_line).strip()
        if cleaned_line:
            cleaned_lines.append(cleaned_line)
    return '\n'.join(cleaned_lines)


def _regional_script_ratio(text: str) -> float:
    alpha = [c for c in (text or "") if c.isalpha()]
    if not alpha:
        return 0.0
    regional = sum(1 for c in alpha if '\u0C00' <= c <= '\u0C7F' or '\u0900' <= c <= '\u097F')
    return regional / len(alpha)


def _extract_match_payload(text: str) -> dict[str, Any]:
    if "__MATCH__:" not in text:
        raise ValueError("missing __MATCH__ payload")
    payload_text = text.split("__MATCH__:", 1)[1].strip()
    return json.loads(payload_text)


def is_row_usable_for_recovery(row: dict[str, Any]) -> bool:
    """
    Shared extractor-agnostic contract for "this row is actually recovered".
    Applies to all routes, not only CBT.
    """
    text = str(row.get("question_text") or "").strip()
    options = [str(row.get(k) or "").strip() for k in ("option_a", "option_b", "option_c", "option_d")]
    q_type = str(row.get("question_type") or "").strip().lower()

    if not text or len(text) < 15:
        return False
    if _regional_script_ratio(" ".join([text] + options)) >= 0.12:
        return False

    is_match_like = (
        q_type == "match"
        or "match the following" in text.lower()
        or "__MATCH__:" in text
    )
    if is_match_like:
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
        return all(options)

    return all(options)


def seed_unresolved_manual_repair_drafts(
    exam_name: str,
    exam_year: int,
    question_numbers: list[int],
    *,
    sb=None,
) -> int:
    """
    Shared permanent fallback for every extractor:
    if targeted recovery still cannot produce a usable row, create an inactive
    manual-repair draft so Content Audit always has something actionable.
    """
    if not question_numbers:
        return 0

    sb = sb or get_supabase()
    supported_cols = _question_supported_columns(sb)

    existing = (
        sb.table("questions")
        .select("question_number")
        .eq("exam_name", exam_name)
        .eq("exam_year", exam_year)
        .in_("question_number", question_numbers)
        .execute()
    )
    existing_qnums = {
        int(row["question_number"])
        for row in (existing.data or [])
        if isinstance(row.get("question_number"), int)
    }
    missing_qnums = [n for n in question_numbers if n not in existing_qnums]
    if not missing_qnums:
        return 0

    paper_id = resolve_paper_id(exam_name=exam_name, exam_year=exam_year, sb=sb)
    rows: list[dict[str, Any]] = []
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
        row = _quality_update_payload(row, merged_quality, supported_cols)
        rows.append({k: v for k, v in row.items() if k in supported_cols})

    if rows:
        sb.table("questions").upsert(rows, on_conflict="question_hash").execute()
        if paper_id:
            sync_paper_question_counts(paper_id, sb=sb)
    return len(rows)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — LOCAL TEXT EXTRACTION  (no API cost)
# ══════════════════════════════════════════════════════════════════════════════

def _normalize_block_text(text: str) -> str:
    """Collapse single-word fragment lines within one PDF text block.

    Some PDFs store each word as a separate textline inside one block, producing
    text like '6.\\nThe\\nsecond\\nmeeting\\n...'.  Join consecutive short lines
    (≤ 15 chars) that are not structural markers (option labels, numbered opts,
    question numbers) onto the previous line.

    EXCEPTION: Never merge lines that look like standalone numeric answers
    (e.g. "24", "1/3", "₹240", "12.5%") — these are aptitude question options.
    """
    result: list[str] = []
    for sub in text.split('\n'):
        s = sub.strip()
        if not s:
            continue
        is_structural = (
            bool(re.match(r'^[(\[]?[A-Da-d][)\].]', s)) or   # A. / (A) option
            bool(re.match(r'^\([1-4]\)', s)) or               # (1) numbered opt
            bool(re.match(r'^(?:Q\.?\s*)?\d{1,3}[.)]', s))   # question number
        )
        # Numeric/symbol-only short lines are standalone option VALUES, not word
        # fragments — e.g. "24", "1/3", "₹240", "12.5%", "−18", "√2".
        # Merging them onto the previous line destroys aptitude question options.
        is_numeric_answer = bool(re.match(
            r'^[₹\-\+\√]?[\d][\d,./:%²³⁴\s]*[%]?$|^[\d]+/[\d]+$', s
        ))
        if result and len(s) <= 15 and not is_structural and not is_numeric_answer:
            result[-1] = result[-1] + ' ' + s
        else:
            result.append(sub.rstrip())
    return '\n'.join(result)


def _blocks_to_lines(blocks: list) -> str:
    """Convert PDF text blocks into readable text by grouping same-row blocks.

    Blocks at the same y-coordinate are joined with spaces (same line).
    Blocks at different y-coordinates become separate lines.
    Block text is normalised first to collapse single-word-per-line splitting.
    """
    if not blocks:
        return ""
    sorted_b: list = sorted(blocks, key=lambda b: (b[1], b[0]))  # sort by y then x
    lines: list[str] = []
    row: list = [sorted_b[0]]
    row_y: float = sorted_b[0][1]

    def _row_text(r: list) -> str:
        parts = [_normalize_block_text(rb[4]).strip()
                 for rb in sorted(r, key=lambda rb: rb[0]) if rb[4].strip()]
        return "\n".join(p for p in parts if p)

    for b in sorted_b[1:]:
        # Use a fixed 6px tolerance — small enough that blocks on different
        # lines (typically 12px apart) are never merged, but large enough to
        # group genuinely same-line blocks whose y0 values differ slightly.
        if abs(b[1] - row_y) < 6:
            row.append(b)           # same line
        else:
            t = _row_text(row)
            if t:
                lines.append(t)
            row = [b]
            row_y = b[1]

    t = _row_text(row)
    if t:
        lines.append(t)
    return "\n".join(lines)


def _clean_ocr_page(text: str) -> str:
    """Strip watermark / page-marker noise from OCR-extracted page text.

    Handles:
      - "M A S T E R  C O P Y" watermark (spaced letters printed diagonally)
      - TSPSC page-code headers like "ET 22 X" / "ET X 22"
      - "P.T.O." turn-over markers
    """
    # Spaced MASTER COPY watermark (any spacing between letters)
    text = re.sub(r'\bM\s*A\s*S\s*T\s*E\s*R\s*C\s*O\s*P\s*Y\b', '', text, flags=re.IGNORECASE)
    # TSPSC exam-code page markers: "ET 22 X" / "ET X 22" / "ET22X" etc.
    text = re.sub(r'\bET\s*(?:X\s*)?\d+(?:\s*[A-Z])?\b', '', text)
    # P.T.O. turn-over marker
    text = re.sub(r'\bP\.T\.O\.\s*', '', text)
    # Clean up whitespace left by the removals
    text = re.sub(r'[ \t]{3,}', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


_INSTRUCTION_PHRASES = [
    'hall ticket',
    'invigilator',
    'answer sheet',
    'question paper booklet',
    'do not open',
    'candidates are',
    'rough work',
    'register number',
    'write your',
    'time allowed',
    'maximum marks',
    'general instructions',
    'read the following instructions',
    'do not write',
    'do not fold',
    'seal of the',
    'total marks',
    'read carefully',
    'candidate should',
    'do not start',
    'before you start',
    'admit card',
    'roll number',
    'signature of',
    'name of the candidate',
]

def _is_instruction_page(text: str) -> bool:
    """Return True if this page is an exam instructions/directions page (not real questions).

    Instruction pages contain numbered rules (1. The candidate should read...) that
    look like Q1–Q14 to the regex parser. Detect them by 3+ instruction phrases.
    With 25 phrases (vs original 8), even minimal instruction pages are caught.
    """
    text_lower = text.lower()
    matches = sum(1 for p in _INSTRUCTION_PHRASES if p in text_lower)
    return matches >= 3


_PRESTORE_INSTRUCTION_RE = re.compile(
    r'\b(?:hall\s+ticket|omr\s+answer\s+sheet|darkening\s+(?:appropriate\s+)?circles?|'
    r'invigilator|rough\s+work\s+(?:should\s+be\s+done|only\s+in)|'
    r'question\s+booklet\s+(?:number|no\.?)|answer\s+sheet\s+is\s+invalidated|'
    r'no\s+correspondence\s+will\s+be\s+entertained|'
    r'discrepancy\s+between\s+english\s+(?:&|and)\s+(?:telugu|hindi|urdu)|'
    r'(?:use\s+of\s+)?calculators?,?\s+mathematical\s+tables?|'
    r'electronic\s+gadgets?\s+is\s+strictly\s+prohibited|'
    r'sign(?:ature)?\s+(?:in\s+the\s+space\s+provided|of\s+the\s+invigilator)|'
    r'do\s+not\s+(?:mark|write|fold)\s+(?:answer\s+choices?|on\s+the\s+question)|'
    r'bio[-\s]?data\s+printed\s+against|nominal\s+rolls?\b|'
    r'candidates?\s+(?:are\s+)?(?:instructed|advised|required|should\s+not|must\s+not|will\s+not)|'
    r'do\s+not\s+(?:open|write\s+on|start\s+writing|fold|tear|damage)|'
    r'write\s+your\s+(?:name|roll\s+number|registration\s+number|admit\s+card)|'
    r'(?:fill|mark|darken|shade)\s+(?:in\s+)?(?:the\s+)?(?:appropriate|correct|relevant)\s+(?:circle|oval|bubble|box)|'
    r'use\s+(?:only\s+)?(?:blue|black)\s+(?:ink\s+)?(?:ball\s+point\s+)?pen|'
    r'mobile\s+phones?\s+(?:are\s+)?(?:not\s+allowed|prohibited|strictly)|'
    r'negative\s+marking|wrong\s+answer\s+(?:will\s+)?(?:carry|result\s+in|attract)|'
    r'(?:answer|attempt)\s+all\s+(?:the\s+)?questions?|'
    r'this\s+(?:paper|booklet|examination)\s+(?:has|contains?|consists?\s+of)\s+\d|'
    r'(?:maximum\s+)?(?:total\s+)?marks?\s+(?:for\s+(?:this\s+)?(?:paper|exam|test)\s+)?(?:is|are|:)\s*\d|'
    r'(?:total\s+)?(?:time|duration)\s+(?:of\s+(?:the\s+)?(?:exam|test|paper)\s+)?(?:is|allowed)\s*[:,]?\s*\d'
    r')\b',
    re.IGNORECASE
)


def filter_instruction_like_questions(questions: list[dict]) -> list[dict]:
    """Drop extracted rows that are clearly exam instructions, not questions."""
    if not questions:
        return questions
    filtered = [
        q for q in questions
        if not _PRESTORE_INSTRUCTION_RE.search((q.get("question_text") or "").strip())
    ]
    removed = len(questions) - len(filtered)
    if removed:
        print(f"  🗑️  Removed {removed} instruction-page items (hall ticket, OMR, etc.)")
    return filtered


def extract_text(pdf_path: str, tracker: "CostTracker | None" = None, skip_bilingual: bool = False, job_id: Optional[str] = None) -> list[tuple[int, str]]:
    """Extract text page-by-page. Returns list of (physical_page_index, text).

    skip_bilingual=True: disables the aggressive bilingual line filter — CRITICAL
    for UPSC PDFs where English and Hindi appear in the same block.
    """
    # ── Page-extraction cache (avoids re-paying Gemini Vision) ───────────────
    pdf_bytes = Path(pdf_path).read_bytes()
    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()[:16]
    _page_cache_path = CACHE_DIR / f"pages_v2_{pdf_hash}.json"
    if _page_cache_path.exists():
        with open(_page_cache_path) as _f:
            cached_data = json.load(_f)
        # Handle migration from list[str] to list[tuple[int, str]]
        if cached_data and isinstance(cached_data[0], str):
            cached_pages = [(idx, txt) for idx, txt in enumerate(cached_data)]
        else:
            cached_pages = [(item[0], item[1]) for item in cached_data]
            
        print(f"  📦 Page extraction: cache hit ({len(cached_pages)} pages, ₹0)")
        if tracker:
            tracker.record("Vision OCR (all pages)", 0, 0, cached=True)
        return cached_pages
    def _extract_english_from_block(block_text: str) -> str:
        """Extract only English lines from a potentially mixed bilingual block.

        Problem: PDF blocks sometimes contain English option text followed by
        Telugu translation in the same block, e.g.:
          '(3)\\nEnvironment-friendly lifestyles\\n(4)\\nWoman-friendly lifestyles\\nuÛ≤s¡'·...'
        The old approach dropped the ENTIRE block if it had any Telugu, losing
        English options (3) and (4).  This function extracts line-by-line.

        An option label like '(3)' is kept only if the next content line is English.
        A Telugu line is silently dropped.
        """
        lines = block_text.split('\n')
        # Classify each line using three complementary checks
        statuses: list[str] = []
        for line in lines:
            s = line.strip()
            if not s:
                statuses.append('empty')
                continue
            alpha = sum(1 for c in s if c.isalpha())
            if alpha == 0:
                statuses.append('label')   # (1), (3), numbers, punctuation
                continue

            # Check 1: Extended Latin-1 chars (\x80-\xFF) = custom-font mojibake
            # e.g. "eT]j·TT" or "A eT]j·TT B" — looks ASCII but · is U+00B7
            printable = [c for c in s if not c.isspace() and c.isprintable()]
            if len(printable) >= 4:
                extended = sum(1 for c in printable if '\x80' <= c <= '\xff')
                if (extended / len(printable)) > 0.08:
                    statuses.append('telugu')
                    continue

            # Check 2: First alpha character is non-ASCII
            # e.g. "|üsYbò˛¢s√ø±s¡"Hé‡ (Perfluorocarbons)" — starts with Telugu,
            # but English word in parens lowers overall ratio, fooling check 3 alone.
            first_alpha = next((c for c in s if c.isalpha()), None)
            if first_alpha and ord(first_alpha) > 127:
                statuses.append('telugu')
                continue

            # Check 3: Overall non-ASCII alpha ratio
            non_ascii = sum(1 for c in s if ord(c) > 127)
            statuses.append('english' if (non_ascii / alpha) < 0.3 else 'telugu')

        has_english = any(s == 'english' for s in statuses)
        has_telugu  = any(s == 'telugu'  for s in statuses)
        first_telugu = next((i for i, s in enumerate(statuses) if s == 'telugu'), len(statuses))
        result: list[str] = []
        for idx, (line, status) in enumerate(zip(lines, statuses)):
            if status == 'english':
                result.append(line)
            elif status == 'label':
                if not has_telugu:
                    # Pure non-alpha block (numeric options, percentages) — always keep.
                    result.append(line)
                elif has_english and idx < first_telugu:
                    # Mixed English+Telugu block; this label is in the English section
                    # (e.g. series numbers, numeric option values) — keep it.
                    result.append(line)
                else:
                    # Pure-Telugu block or label appears after Telugu starts —
                    # keep only if the very next non-label line is English.
                    next_status = next(
                        (statuses[j] for j in range(idx + 1, min(idx + 3, len(statuses)))
                         if statuses[j] not in ('empty', 'label')),
                        None
                    )
                    if next_status == 'english':
                        result.append(line)
            # else: telugu or empty — skip
        return '\n'.join(result)

    doc = fitz.open(pdf_path)
    pages = []
    bilingual_announced = False
    _total_pages = doc.page_count
    _sb_for_progress = get_supabase() if job_id else None

    for i, page in enumerate(doc):
        # ── Per-page progress: 5% → 12% during extraction ─────────────────────
        if job_id and _sb_for_progress and (i % 8 == 0):
            _prog = 5 + int(7 * i / max(1, _total_pages))
            try:
                _sb_for_progress.table("jobs").update({"progress": _prog}).eq("id", job_id).execute()
            except Exception:
                pass
        page_width = page.rect.width
        blocks = page.get_text("blocks")           # (x0,y0,x1,y1,text,block_no,type)
        text_blocks = [b for b in blocks if b[6] == 0 and b[4].strip()]  # type-0 = text

        text = ""
        is_bilingual = False
        # Early skip: check raw page text for rough work pages BEFORE bilingual filter.
        # "Space for Rough Work" may be joined with Telugu translation in one line, which
        # the bilingual filter drops entirely — leaving text="" and accidentally triggering
        # Vision OCR on blank pages.
        # Only apply to short pages (< 300 raw chars) so exam instructions that
        # *mention* "rough work" are not false-positively skipped.
        _raw_page_text = " ".join(b[4] for b in text_blocks)
        if len(_raw_page_text) < 300 and re.search(r'\brough\s+work\b', _raw_page_text, re.IGNORECASE):
            print(f"  🚫 Page {i+1}: skipped (rough work page)")
            continue
        if text_blocks:
            # ── Line-level bilingual filtering ───────────────────────────────
            # Works for BOTH:
            #   Group 1 style: alternate Telugu-only / English-only pages
            #   Group 2 style: English + Telugu mixed on the same page
            #
            # Key fix: TSPSC bilingual PDFs pack English option text AND the
            # start of the Telugu translation into the SAME PDF block.
            # Old block-level filter dropped the entire block (losing English
            # options 3 & 4).  New approach: clean each block line-by-line.
            all_text_sample = " ".join(b[4] for b in text_blocks)
            all_alpha = max(1, sum(1 for c in all_text_sample if c.isalpha()))
            all_non_ascii = sum(1 for c in all_text_sample if ord(c) > 127)
            # Telugu/mojibake: activated by skip_bilingual=False flag
            page_has_telugu = (not skip_bilingual) and (all_non_ascii / all_alpha) > 0.15
            # Hindi (Devanagari U+0900–U+097F): always filter regardless of skip_bilingual.
            # UPSC CISF papers are English+Hindi — skip_bilingual skips Telugu filter but
            # Hindi Devanagari must still be stripped to prevent parser confusion.
            _deva_count = sum(1 for c in all_text_sample if '\u0900' <= c <= '\u097F')
            page_has_hindi = (_deva_count / all_alpha) > 0.10

            def _two_col_layout(blocks):
                mid = page_width * 0.50
                left_col  = [b for b in blocks if b[0] < mid]
                right_col = [b for b in blocks if b[0] >= mid]
                lc = sum(len(b[4]) for b in left_col)
                rc = sum(len(b[4]) for b in right_col)
                if lc > 50 and rc > 50:
                    return (_blocks_to_lines(left_col) + "\n" + _blocks_to_lines(right_col)).strip()
                return _blocks_to_lines(blocks)

            if (page_has_telugu or page_has_hindi) and not skip_bilingual:
                lang_label = "Hindi" if page_has_hindi and not page_has_telugu else "Telugu/bilingual"
                if not bilingual_announced:
                    print(f"  🌐 {lang_label} bilingual detected (page {i+1}) — filtering non-English lines")
                    bilingual_announced = True
                is_bilingual = True
                cleaned_blocks = []
                for b in text_blocks:
                    cleaned_text = _extract_english_from_block(b[4])
                    if cleaned_text.strip():
                        cleaned_blocks.append(b[:4] + (cleaned_text,) + b[5:])
                text = _two_col_layout(cleaned_blocks) if cleaned_blocks else ""
            else:
                # UPSC style: Keep everything, handle Hindi stripping later to avoid dropping English.
                text = _two_col_layout(text_blocks)
        else:
            text = page.get_text("text").strip()

        # ── OCR fallback for scanned / image-only pages ───────────────────────
        # Skip Vision OCR if the page had substantial raw text that was all-Telugu:
        # bilingual filter reduced it to nothing — this is a Telugu-only page, not
        # a scanned image. Calling Vision on it causes hallucinated English questions.
        _raw_block_len = sum(len(b[4]) for b in text_blocks)
        if len(text) < 50 and _raw_block_len > 200:
            continue  # Telugu-only text page — skip silently
        if len(text) < 50:
            try:
                pix = page.get_pixmap(dpi=150)
                img_bytes = pix.tobytes("png")

                # ── Gemini Vision: best for bilingual scanned PDFs ────────────
                # gemini-1.5-flash: ~₹0.89 for a 50-page paper (under ₹1).
                # Understands both English and Telugu — extracts English-only.
                try:
                    _img = PIL.Image.open(_io.BytesIO(img_bytes))
                    _vision_model = EXTRACTION_MODEL
                    _bilingual_note = (
                        "Each question appears TWICE on the page — once in English and once in Telugu. "
                        "Extract ONLY the English version of each question, exactly ONCE. "
                        "Do NOT output any Telugu or Hindi characters. "
                    ) if not skip_bilingual else (
                        "This is an English-medium exam. Questions may appear alongside Hindi (Devanagari) text. "
                        "Extract ONLY the English text. Completely ignore all Devanagari/Hindi script. "
                        "Extract every question exactly ONCE. "
                    )
                    _prompt = (
                        "This is a scanned page from an Indian competitive exam. "
                        + _bilingual_note +
                        "Preserve the original question number (e.g. '8. Match the following...'). "
                        "Format: [number]. [question text]\n(a) [option] (b) [option] (c) [option] (d) [option]\n"
                        "Options may also be labeled (A)/(B)/(C)/(D) or (1)/(2)/(3)/(4) — preserve as-is. "
                        "For match-the-following, keep A/B/C/D and I/II/III/IV labels. "
                        "Do NOT duplicate questions. Do NOT add explanations — raw exam text only. "
                        "IGNORE any watermark text such as 'MASTER COPY' or 'M A S T E R C O P Y'. "
                        "IGNORE page number codes like 'ET 22 X' or 'ET X 22'. "
                        "IGNORE 'P.T.O.' markers. Output question text only."
                    )
                    _resp = _CLIENT.models.generate_content(
                        model=_vision_model,
                        contents=[_prompt, _img],
                        config=types.GenerateContentConfig(
                            temperature=0.0,
                            max_output_tokens=4096,
                            thinking_config=types.ThinkingConfig(thinking_budget=0),
                        ),
                    )
                    text = _clean_ocr_page(_resp.text.strip())
                    print(f"  🤖 Page {i+1}: Gemini Vision ({len(text)} chars)")
                    if tracker:
                        try:
                            _m = _resp.usage_metadata
                            tracker.record("Vision OCR", _m.prompt_token_count or 0, _m.candidates_token_count or 0)
                        except Exception:
                            pass
                except Exception as _ve:
                    # Fallback to Tesseract if Gemini Vision fails
                    pytesseract.pytesseract.tesseract_cmd = '/opt/homebrew/bin/tesseract'
                    _img2 = PILImage.open(_io.BytesIO(img_bytes))
                    text = pytesseract.image_to_string(_img2, lang="eng+tel+hin")
                    print(f"  📷 Page {i+1}: OCR fallback ({len(text)} chars) [Gemini err: {_ve}]")
                    # Strip Telugu lines from Tesseract output
                    clean_lines = []
                    for line in text.splitlines():
                        alpha = sum(1 for c in line if c.isalpha())
                        if alpha == 0:
                            clean_lines.append(line)
                            continue
                        non_ascii = sum(1 for c in line if ord(c) > 127)
                        if (non_ascii / alpha) < 0.3:
                            clean_lines.append(line)
                    text = _clean_ocr_page("\n".join(clean_lines))

            except Exception as e:
                print(f"  ⚠️  Page {i+1}: extraction failed ({e}), skipped")
                continue

        text = text.strip()
        if not text:
            continue
        if _is_instruction_page(text):
            print(f"  🚫 Page {i+1}: skipped (instruction/directions page)")
            continue
        # Skip rough-work / scratch pages.
        # Only skip if the page is DOMINATED by rough work (short text), not just mentions it.
        # Content pages often say "Space for rough work" at the bottom — don't skip those.
        if len(text) < 400 and re.search(r'\brough\s+work\b', text, re.IGNORECASE):
            print(f"  🚫 Page {i+1}: skipped (rough work page)")
            continue
        # Skip OMR / answer-bubble sheets — lines of bare "(1) (2) (3) (4)" bubbles
        # (Vision hallucinates full question text on these pages, overwriting real answers)
        _bubble_lines = len(re.findall(
            r'(?:^|\n)\s*\([1-4]\)\s+\([1-4]\)\s+\([1-4]\)\s+\([1-4]\)\s*(?=\n|$)',
            text
        ))
        if _bubble_lines >= 3:
            print(f"  🚫 Page {i+1}: skipped (OMR answer-bubble sheet)")
            continue
        # Skip answer-key table pages — rows like "1. C  2. A  3. B  4. D  5. C ..."
        # A real answer key line has 3+ "number. letter" pairs on ONE line.
        # This pattern is distinctive and won't match normal question text.
        _key_lines = len(re.findall(
            r'(?:^|\n)[^\n]*(?:\d{1,3}\s*[.)]\s*[A-Da-d]\b[^\n]*){3,}',
            text
        ))
        if _key_lines >= 3:
            print(f"  🚫 Page {i+1}: skipped (answer key table)")
            continue
        pages.append((i, text))

    doc.close()
    print(f"  ✅ Extracted {len(pages)} pages")
    # Save to cache so re-uploads of the same PDF cost ₹0
    with open(_page_cache_path, "w", encoding="utf-8") as _f:
        json.dump(pages, _f, ensure_ascii=False)
    return pages


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — LOCAL QUESTION PARSING  (no API cost)
# Handles: "1." "Q1." "Q.1" "1)" "(1)" prefixes
# Handles: "Consider the following", "Match the following", statement-based Qs
# ══════════════════════════════════════════════════════════════════════════════

# Matches: "1." "Q1." "Q.1" "1)" (requires separator)
# OR Matches: "Question Number : 1" (separator optional)
# Requires at least 8 chars of text to follow.
_Q_START = re.compile(
    r'^\s*(?:'
    r'(?:Q\.?\s*)?(\d{1,3})[.)]|'                  # Standard case: 1. or 1)
    r'Question\s+Number\s*[:.-]\s*(\d{1,3})[.)]?' # Explicit prefix case
    r')\s*(.*)',
    re.MULTILINE | re.IGNORECASE
)

# Matches option lines: "(A)" "A." "A)" "(a)" "a."
_OPT = re.compile(
    r'(?:^|\n)\s*[(\[]?([AaBbCcDd])[)\].]\s+(.+?)(?=\n\s*[(\[]?[AaBbCcDd][)\].]'
    r'|\n\s*(?:Q\.?\s*)?\d{1,3}[.)]\s|$)',
    re.DOTALL
)

# Answer key: "Ans: B" "Answer: (C)" "ANS - A"
# Use [ \t]* (not \s*) to prevent matching across newlines — avoids false-positive where
# "Choose the correct answer :\n(1) ..." treats option (1) as answer key.
# Also require [:\-] (mandatory separator) to avoid matching bare "answer" in question text.
_ANS = re.compile(r'(?:Ans(?:wer)?\.?|ANS)[ \t]*[:\-][ \t]*[(\[]?([AaBbCcDd])[)\]]?', re.IGNORECASE)

# TSPSC-style numbered options: (1) text  (2) text  (3) text  (4) text
_OPT_NUM = re.compile(
    r'(?:^|\n)\s*\(([1-4])\)\s+(.+?)(?=\n\s*\([1-4]\)\s|\n\s*(?:Q\.?\s*)?\d{1,3}[.)]\s|$)',
    re.DOTALL
)

# Answer key numeric: "Ans: 2" "Answer: (3)"
_ANS_NUM = re.compile(r'(?:Ans(?:wer)?\.?|ANS)[ \t]*[:\-][ \t]*[(\[]?([1-4])[)\]]?', re.IGNORECASE)

_NUM_TO_LETTER = {"1": "A", "2": "B", "3": "C", "4": "D"}

_QNO_INLINE = re.compile(r'Question\s+Number\s*[:.-]\s*\d+\b', re.IGNORECASE)
_TCS_META_LINE = re.compile(
    r'^(?:Options\s*:|Question\s+Id\s*:|Option\s+Shuffling\s*:|Is\s+Question\s+Mandatory\s*:|'
    r'Calculator\s*:|Response\s+Time\s*:|Think\s+Time\s*:|Minimum\s+Instruction\s+Time\s*:|'
    r'Correct\s+Marks\s*:|Wrong\s+Marks\s*:|https?://|[0-9]{1,2}/[0-9]{1,2}/[0-9]{4},)',
    re.IGNORECASE,
)


def parse_questions_local(pages: list[str]) -> list[dict]:
    """
    Parse page text into structured MCQ dicts using regex.
    This is FREE — no API call needed.
    """
    full_text = "\n\n".join(pages)

    # ── Split same-line numbered options onto separate lines ─────────────────
    # Gemini Vision sometimes outputs: "(1) text (2) text (3) text (4) text"
    # on a single line. Split every (N) that is not already at the start of a line.
    # Using lookahead preserves (N) in output; non-overlapping so all 4 are split.
    full_text = re.sub(r'(?<!\n) +(?=\([1-4]\) )', r'\n', full_text)
    # Same for letter options — UPSC/CISF prints "(a) text  (b) text  (c) text  (d) text"
    # all on one line. Without this split the entire line gets jammed into option_a.
    full_text = re.sub(r'(?<!\n) {2,}(?=\([ABCDabcd]\) )', r'\n', full_text)

    # Clean common PDF noise
    full_text = re.sub(r'Page\s+\d+\s+of\s+\d+', '', full_text, flags=re.IGNORECASE)
    # P.T.O. turn-over markers (appear in regular text, not just OCR pages)
    full_text = re.sub(r'\bP\.T\.O\.?\s*', '', full_text)
    # MASTER COPY watermark anywhere in the text stream
    full_text = re.sub(r'\bM\s*A\s*S\s*T\s*E\s*R\s*C\s*O\s*P\s*Y\b', '', full_text, flags=re.IGNORECASE)
    # TSPSC exam-code page markers: "ET 22 X" / "ET X 22"
    full_text = re.sub(r'\bET\s*(?:X\s*)?\d+(?:\s*[A-Z])?\b', '', full_text)
    # Section/Part headings that look like questions ("PART A", "Section I", "SECTION - I")
    full_text = re.sub(r'\n(?:PART|SECTION|Section|Part)\s*[-–—]?\s*[A-Fa-f0-9IVXivx]+\s*(?:\n|$)', '\n', full_text)
    # "Space for rough work" lines at the bottom of content pages — strip the line, not the page
    full_text = re.sub(r'(?:\n|^)[ \t]*Space\s+for\s+Rough\s+Work[^\n]*', '', full_text, flags=re.IGNORECASE)
    # Remove TSPSC exam-code page footers: "1G-0422-T\n( 29 )"
    full_text = re.sub(r'\n[\w][\w\-]+\s*\n\s*\(\s*\d{2,3}\s*\)\s*(?=\n)', '\n', full_text)
    full_text = re.sub(r'\n{3,}', '\n\n', full_text)
    full_text = re.sub(r'[ \t]{2,}', ' ', full_text)
    # Join bare question-number lines with following text:
    # "6.\n  The second..." → "6. The second..."
    # Lookahead: any non-whitespace (handles lowercase, digits like "3/4 of...", quoted starts, etc.)
    full_text = re.sub(r'(\n(?:Q\.?\s*)?\d{1,3}[.)])\s*\n\s+(?=\S)', r'\1 ', full_text)

    # Remove inline TSPSC page footers that survived (e.g. "1G-0422-T ( 45 )")
    # Use [ \t]* (not \s*) so newlines are NOT matched — prevents eating option labels like "\ncore\n(2)"
    # Lookahead (?=[ \t]*(?:\n|$)) ensures (n) is at end of line, not start of an option
    full_text = re.sub(r'\n[\w][\w\-]+[ \t]*\(\s*\d{2,3}\s*\)(?=[ \t]*(?:\n|$))', '', full_text)

    splits = list(_Q_START.finditer(full_text))

    # Compiled once for performance — detects statement/list context in preceding text
    _STMT_CTX_RE = re.compile(
        r'(?:consider|following\s+(?:statement|list|fact|pair|column)|'
        r'given\s+below|select\s+the|arrange|match|assert|reason|'
        r'list\s+[I-V]|column\s+[A-D]|which\s+of\s+the|'
        r'statements?\b|pairing|combination|'
        r'correct\s+(?:statement|answer|code)|incorrect\s+statement|true\s+statement)',
        re.IGNORECASE
    )

    # ── PASS 1: identify REAL question starts only ────────────────────────────
    # Collects (q_num, start_pos, match) for every confirmed real question.
    # Statement list items (1., 2., 3. inside a "which of the following" block)
    # are filtered out here so they NEVER pollute block boundaries in Pass 2.
    real_questions: list[tuple[int, int, re.Match]] = []
    prev_q_num = 0

    for match in splits:
        match_pos = match.start()
        preceding = full_text[max(0, match_pos - 250):match_pos]
        # _Q_START uses ^\s* (MULTILINE) so the match may START on a '\n'.
        # A blank line (\n\n) is then split: preceding ends with '\n', match starts with '\n'.
        # Extend the window to include the first few chars of the match itself.
        match_prefix = full_text[match_pos:match_pos + 6]
        
        # Librarian / TCS iON papers often skip blank lines between questions.
        # If it says "Question Number", it's a guaranteed question start.
        is_explicit_q = bool(match.group(2))
        preceded_by_blank = '\n\n' in (preceding[-30:] + match_prefix) or match_pos < 50 or is_explicit_q

        q_num = int(match.group(1) or match.group(2))

        if q_num <= prev_q_num or q_num > prev_q_num + 20:
            # OCR recovery: Gemini Vision sometimes drops a leading digit, e.g.
            # "42." → "2." because "4" was missed.
            expected = prev_q_num + 1
            expected_str = str(expected)
            q_str = str(q_num)
            inside_statement_list = bool(_STMT_CTX_RE.search(preceding))
            ends_with_list_intro = re.search(r'[:;,]\s*$', preceding.strip())

            if (len(q_str) < len(expected_str)
                    and expected_str.endswith(q_str)
                    and preceded_by_blank
                    and not (inside_statement_list or ends_with_list_intro)):
                q_num = expected
            else:
                continue

        # Statement-list guard for in-sequence candidates:
        # "3. Item C" inside Q2 has q_num=3 > prev=2 so passes the check above,
        # but it's not a real question — it lacks a blank-line before it.
        if not preceded_by_blank:
            preceding_close = preceding[-120:]
            prev_line_is_numbered = bool(
                re.search(r'\n\s*\d+[.)]\s+\S[^\n]{2,}', preceding_close)
            )
            if prev_line_is_numbered or bool(_STMT_CTX_RE.search(preceding)):
                continue

        prev_q_num = q_num
        real_questions.append((q_num, match.start(), match))

    # ── PASS 2: extract blocks using ONLY real question boundaries ────────────
    # This is the critical fix: block end = next REAL question start, not any
    # regex split. Statement numbers (3., 4.) inside Q2 never truncate Q2's block.
    def _extract_unlabeled_options(opts_block: str) -> list[str]:
        """Parse TCS iON-style unlabeled options under an 'Options :' header."""
        if not opts_block:
            return []
        lines = [ln.strip() for ln in opts_block.splitlines()]
        cleaned: list[str] = []
        for ln in lines:
            if not ln:
                continue
            if _QNO_INLINE.search(ln) or _TCS_META_LINE.match(ln):
                continue
            if re.fullmatch(r'[1-4][.)]?', ln):
                continue
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

    questions = []
    for i, (q_num, start, match) in enumerate(real_questions):
        end = real_questions[i + 1][1] if i + 1 < len(real_questions) else len(full_text)
        block = full_text[start:end].strip()

        # ── Detect question structure ─────────────────────────────────────────
        #
        # TSPSC has THREE formats:
        #
        # Format 1 — Standard MCQ (A/B/C/D are the answer choices):
        #   Question text
        #   (A) option1   (B) option2   (C) option3   (D) option4
        #
        # Format 2 — "Consider / Match" (A/B/C/D are labelled STATEMENTS;
        #             actual answer choices are (1)(2)(3)(4) combinations):
        #   Question text
        #   A. Statement 1     ← labels, NOT answer options
        #   B. Statement 2
        #   C. Statement 3
        #   D. Statement 4
        #   Which of the above are correct?
        #   (1) A only         ← REAL answer choices
        #   (2) A and B only
        #   (3) B and C only
        #   (4) All of the above
        #
        # Format 3 — Pure numeric options without any A/B/C/D statements:
        #   Question text
        #   (1) choice1   (2) choice2   (3) choice3   (4) choice4
        #
        # Key: Format 2 is detected by A/B/C/D labels appearing BEFORE (1)(2)(3)(4).
        #      In that case, the A/B/C/D labels are part of q_text, and (1)(2)(3)(4)
        #      are used as options A→1, B→2, C→3, D→4.

        first_alpha = re.search(r'\n\s*[(\[]?[AaBbCcDd][)\].]\s+', block)
        first_num   = re.search(r'\n\s*\([1-4]\)\s+', block)
        options_hdr = re.search(r'\bOptions\s*:\s*', block, re.IGNORECASE)

        use_numeric_opts: bool = False
        use_unlabeled_opts: bool = False
        q_text: str = ""
        opts_block: str = ""

        if first_alpha and first_num and first_alpha.start() < first_num.start():
            # Format 2: statements (A/B/C/D) come before numbered answer choices
            # Include everything up to (1) in q_text; use (1)(2)(3)(4) as options
            q_text = block[:first_num.start()].strip()
            opts_block = block[first_num.start():]
            use_numeric_opts = True
        elif first_num and (not first_alpha or first_num.start() <= first_alpha.start()):
            # Format 3: numbered options only (or numbered comes before any alpha label)
            q_text = block[:first_num.start()].strip()
            opts_block = block[first_num.start():]
            use_numeric_opts = True
        elif first_alpha:
            # Format 1: standard A/B/C/D MCQ
            q_text = block[:first_alpha.start()].strip()
            opts_block = block[first_alpha.start():]
        elif options_hdr:
            # Format 4: TCS iON-style unlabeled options under "Options :"
            q_text = block[:options_hdr.start()].strip()
            opts_block = block[options_hdr.end():]
            use_unlabeled_opts = True
        else:
            q_text = block
            opts_block = ""

        q_text = re.sub(r'^(?:Q\.?\s*)?\d{1,3}[.)]\s+', '', q_text).strip()
        q_text = re.sub(
            r'Question\s+Number\s*:\s*\d+\s+Question\s+Id\s*:.*?Correct\s+Marks\s*:\s*\d+\s*',
            '',
            q_text,
            flags=re.IGNORECASE | re.DOTALL,
        ).strip()
        q_text = re.sub(r'\s+', ' ', q_text).strip()

        # ── Parse answer options ──────────────────────────────────────────────
        opts: dict[str, Optional[str]] = {"A": None, "B": None, "C": None, "D": None}

        def _clean_opt(text: str) -> str:
            """Strip trailing directive lines / watermarks / non-ASCII that bleed into option text."""
            # Strip trailing sub-statement labels A./B./C./D. that bleed in from bilingual format
            # e.g. "Neither A nor B\nA.\nB." → "Neither A nor B"
            text = re.sub(r'(?:\s+[A-D]\.\s*)+$', '', text).strip()
            # Strip "(1) A only (2) ..." suffix — answer choices that bled into option text.
            # IMPORTANT: Only strip when the (1) suffix looks like a SHORT combo-answer
            # (e.g. "A only", "A and B only", "All of the above") — NOT long statement content.
            # The DOTALL flag was previously used here but caused entire statement blocks inside
            # DAO-style questions to be erased. Now we require the match to be ≤120 chars.
            _suffix_m = re.search(
                r'\s*[\(\[]1[\)\]]\s*(?:[A-D](?:\s+(?:and|only|,)\s*[A-D]?)?|All\s+of|None\s+of|Both\s+[A-D]).{0,80}$',
                text, flags=re.IGNORECASE
            )
            if _suffix_m:
                text = text[:_suffix_m.start()].strip()
            # Strip "Which of the above..." / "Choose the correct answer" trailing directive
            text = re.sub(
                r'\s+(?:Which\s+of\s+the\s+above|Choose\s+the\s+correct|'
                r'Select\s+the\s+correct|The\s+correct\s+(?:answer|option|code)|'
                r'Which\s+of\s+the\s+following\s+(?:combination|code|pair|option))\b.*$',
                '', text, flags=re.IGNORECASE | re.DOTALL
            ).strip()
            # Strip inline watermarks like "ET 22 X M A S T E R C O P Y"
            text = re.sub(r'\bM\s*A\s*S\s*T\s*E\s*R\s*C\s*O\s*P\s*Y\b.*$', '', text, flags=re.IGNORECASE | re.DOTALL).strip()
            text = re.sub(r'\bET\s*(?:X\s*)?\d+\b.*$', '', text).strip()
            # Second pass: strip trailing A./B./C./D. labels that were exposed after footer removal
            # e.g. "Neither A nor B\nA.\nB." (was hidden behind ET 3 P.T.O. MASTER COPY)
            text = re.sub(r'(?:\s+[A-D]\.\s*)+$', '', text).strip()
            # Strip trailing non-ASCII characters (Telugu text that bled in from bilingual PDFs)
            # Split at the first whitespace+non-ASCII boundary and keep only the English part
            _parts = re.split(r'\s+[^\x00-\x7F]', text, maxsplit=1)
            if len(_parts) > 1:
                text = _parts[0].strip()
            return text

        if use_numeric_opts:
            # Parse (1)(2)(3)(4) → A/B/C/D
            # First-occurrence wins: bilingual PDFs have Telugu (1)(2)(3)(4) after English,
            # so the first match is the English option — don't overwrite with Telugu.
            for m in _OPT_NUM.finditer("\n" + opts_block):
                letter = _NUM_TO_LETTER.get(m.group(1))
                if letter and not opts[letter]:
                    opts[letter] = _clean_opt(m.group(2).strip())
        elif use_unlabeled_opts:
            unlabeled = _extract_unlabeled_options(opts_block)
            for idx, value in enumerate(unlabeled[:4]):
                opts[("A", "B", "C", "D")[idx]] = _clean_opt(value)
        else:
            # Parse A/B/C/D options (first-occurrence wins same reasoning)
            for m in _OPT.finditer("\n" + opts_block):
                letter = m.group(1).upper()
                if letter in opts and not opts[letter]:
                    opts[letter] = _clean_opt(m.group(2).strip())

        # ── Answer key ────────────────────────────────────────────────────────
        if use_numeric_opts:
            ans_m_num = _ANS_NUM.search(block)
            correct: Optional[str] = _NUM_TO_LETTER.get(ans_m_num.group(1)) if ans_m_num else None
            if not correct:
                ans_m = _ANS.search(block)
                correct = ans_m.group(1).upper() if ans_m else None
        else:
            ans_m = _ANS.search(block)
            correct = ans_m.group(1).upper() if ans_m else None

        # Keep questions with actual text and at least 1 option found.
        # Missing options → needs_review=True (never silently discard).
        opt_count = sum(1 for v in opts.values() if v)
        if q_text and len(q_text) > 10 and opt_count >= 1:
            questions.append({
                "question_number": q_num,
                "question_text": q_text,
                "option_a": opts["A"] or "",
                "option_b": opts["B"] or "",
                "option_c": opts["C"] or "",
                "option_d": opts["D"] or "",
                "correct_answer": correct,
                "needs_review": opt_count < 4,
            })

    # ── Filter out instruction-page items BEFORE dedup ────────────────────────
    # Must happen FIRST — instruction items are often long (detailed rules), so they
    # would win the "keep longest text" dedup if filtered after. Numbered exam instructions
    # ("7. Mark your Hall Ticket...") get parsed as Q7 and corrupt the real Q7.
    questions = filter_instruction_like_questions(questions)

    # ── Deduplicate by question_number — quality score wins, not raw length ───
    # Score = (options_present * 10) + text_length_bonus
    # This ensures a real MCQ with 4 options beats an instruction item that has
    # no options but very long text (e.g., "7. Mark your Hall Ticket...").
    def _q_score(q: dict) -> int:
        opts = sum(1 for k in ("option_a", "option_b", "option_c", "option_d")
                   if (q.get(k) or "").strip())
        txt_len = len((q.get("question_text") or "").strip())
        return opts * 200 + txt_len  # 4 real options = +800, beats any plain text

    seen: dict[int, dict] = {}
    for q in questions:
        n = q["question_number"]
        if n not in seen or _q_score(q) > _q_score(seen[n]):
            seen[n] = q
    questions = list(seen.values())

    # Filter out phantom questions whose text looks like an answer-choice fragment
    # e.g. "A, B and C only" / "All of the above" / "Only 1 and 2" parsed from sub-items
    _ANSWER_FRAG = re.compile(
        r'^(?:[A-D](?:\s*[,&]\s*[A-D])*(?:\s+(?:and|only|are correct|both|all))?'
        r'|All\s+of\s+the\s+above|None\s+of\s+the\s+above'
        r'|(?:Only\s+)?[1-4](?:\s+and\s+[1-4])?'
        r'|Both\s+[A-D]\s+and\s+[A-D])\s*$',
        re.IGNORECASE
    )
    questions = [q for q in questions if not _ANSWER_FRAG.match(q["question_text"].strip())]

    # ── Image/chart/graph question detection ─────────────────────────────
    # Questions referencing bar graphs, pie charts, tables etc. can't be
    # answered without the visual. Flag them needs_review=True so admin knows.
    _IMAGE_RE = re.compile(
        r'\b(?:bar\s+graph|pie\s+chart|bar\s+chart|line\s+graph|histogram|'
        r'(?:the\s+)?(?:graph|chart|figure|diagram|picture|map)\s+(?:below|above|given|shown|following)|'
        r'(?:following|given|below)\s+(?:graph|chart|figure|diagram|table|map)|'
        r'refer\s+to\s+the|data\s+given\s+(?:below|above)|study\s+the\s+(?:following\s+)?'
        r'(?:graph|chart|figure|table|diagram)|from\s+the\s+(?:graph|chart|figure|table))\b',
        re.IGNORECASE
    )
    image_flagged = 0
    for q in questions:
        if _IMAGE_RE.search(q.get("question_text", "")):
            q["needs_review"] = True
            image_flagged += 1
    if image_flagged:
        print(f"  🖼️  Flagged {image_flagged} image/chart questions as needs_review")

    print(f"  ✅ Parsed {len(questions)} questions locally (₹0 cost)")
    return questions


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2B — VISION STRUCTURED EXTRACTION  (fallback for custom-font PDFs)
# Used when local parsing quality is poor (garbled options, missing C/D, etc.)
# Sends each page image to Gemini and asks for structured JSON directly.
# Cost: ~₹1.5-2 for a 50-page bilingual paper (cached after first run).
# ══════════════════════════════════════════════════════════════════════════════

_VISION_STRUCT_PROMPT = (
    "This is a page from an Indian competitive exam paper (may be bilingual: English + Telugu or English + Hindi).\n\n"
    "Extract ALL multiple choice questions from the ENGLISH text only.\n"
    "Return ONLY a JSON array — no markdown, no explanation.\n\n"
    "Each question must follow this exact format:\n"
    '[{"number": 15, "text": "Full question text. Include any A. B. C. D. statement labels.", '
    '"options": {"A": "option text", "B": "option text", "C": "option text", "D": "option text"}, '
    '"answer": "B"}]\n\n'
    "RULES:\n"
    "- ONLY English text. Completely ignore all Telugu, Hindi, and other regional language text.\n"
    "- Options labeled (1)(2)(3)(4) → map to A/B/C/D respectively.\n"
    "- For 'Consider the following' / 'Match the following' questions: include the A./B./C./D. "
    "statement labels inside the 'text' field; use (1)(2)(3)(4) as the answer options.\n"
    "- IGNORE 'MASTER COPY' watermarks, page codes like 'ET 22 X', 'P.T.O.' markers.\n"
    "- IGNORE instruction/direction pages ('The candidate should read...').\n"
    "- If an answer key is visible (Ans: 3), set answer to the mapped letter (3 → 'C').\n"
    "- Return [] if no questions are on this page."
)


def _parse_vision_json(raw: str) -> list[dict]:
    """Parse JSON array from Gemini Vision response into question dicts."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    questions = []
    for item in data:
        try:
            q_num = int(item.get("number", 0))
            q_text = str(item.get("text", "")).strip()
            opts = item.get("options") or {}
            answer = item.get("answer")
            if not q_num or len(q_text) < 10:
                continue
            def _cv(v: str) -> str:
                """Clean Vision option: strip trailing non-ASCII/garbled chars."""
                v = str(v or "").strip()
                _p = re.split(r'\s+[^\x00-\x7F]', v, maxsplit=1)
                return _p[0].strip() if len(_p) > 1 else v

            questions.append({
                "question_number": q_num,
                "question_text": q_text,
                "option_a": _cv(opts.get("A", "")),
                "option_b": _cv(opts.get("B", "")),
                "option_c": _cv(opts.get("C", "")),
                "option_d": _cv(opts.get("D", "")),
                "correct_answer": str(answer).upper() if answer else None,
            })
        except Exception:
            continue
    return questions


def extract_questions_via_vision(
    pdf_path: str, tracker: "CostTracker | None" = None
) -> list[dict]:
    """Extract MCQs from PDF using Gemini Vision with structured JSON output.

    Falls back to this when local regex parsing produces poor quality results:
    e.g. bilingual PDFs with custom Telugu font encoding that appears as garbled ASCII.
    Results are cached by PDF hash — re-upload of same PDF costs ₹0.
    """
    pdf_bytes = Path(pdf_path).read_bytes()
    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()[:16]
    _vis_cache = CACHE_DIR / f"vision_qs_{pdf_hash}.json"

    if _vis_cache.exists():
        cached = json.loads(_vis_cache.read_text(encoding="utf-8"))
        print(f"  📦 Vision Q-extract: cache hit ({len(cached)} questions, ₹0)")
        if tracker:
            tracker.record("Vision Q-extract (all pages)", 0, 0, cached=True)
        return cached

    _vision_model = EXTRACTION_MODEL
    doc = fitz.open(pdf_path)
    all_questions: list[dict] = []
    skipped = 0

    # Process pages in PAIRS — handles questions that span page boundaries
    # (e.g. statement body on page N, answer options (1)(2)(3)(4) on page N+1)
    pages_list = list(doc)
    i = 0
    while i < len(pages_list):
        page_a = pages_list[i]
        page_b = pages_list[i + 1] if i + 1 < len(pages_list) else None

        pages_for_call = [page_a]
        if page_b is not None:
            pages_for_call.append(page_b)
        imgs = []
        for pg in pages_for_call:
            pix = pg.get_pixmap(dpi=150)
            imgs.append(PILImage.open(_io.BytesIO(pix.tobytes("png"))))

        label = f"p{i+1}-{i+2}" if page_b else f"p{i+1}"

        for attempt in range(2):
            try:
                resp = _CLIENT.models.generate_content(
                    model=_vision_model,
                    contents=[_VISION_STRUCT_PROMPT] + imgs,
                    config=types.GenerateContentConfig(
                        temperature=0.1,
                        max_output_tokens=16384,
                        thinking_config=types.ThinkingConfig(thinking_budget=0),
                    ),
                )
                if tracker:
                    try:
                        _m = resp.usage_metadata
                        tracker.record(
                            f"Vision Q-extract {label}",
                            _m.prompt_token_count or 0,
                            _m.candidates_token_count or 0,
                        )
                    except Exception:
                        pass
                qs = _parse_vision_json(resp.text or "")
                if qs:
                    print(f"  🤖 Pages {label}: {len(qs)} questions extracted")
                    all_questions.extend(qs)
                else:
                    print(f"  ⬜ Pages {label}: no questions")
                    skipped += 1
                break
            except Exception as e:
                if attempt == 0:
                    time.sleep(2)
                else:
                    print(f"  ⚠️  Pages {label}: Vision failed ({e})")
        time.sleep(0.4)  # rate limit
        i += 2  # advance by 2 pages

    doc.close()

    # Deduplicate by question_number — keep longest question_text
    seen: dict[int, dict] = {}
    for q in all_questions:
        n = q["question_number"]
        if n not in seen or len(q["question_text"]) > len(seen[n]["question_text"]):
            seen[n] = q
    questions = sorted(seen.values(), key=lambda q: q["question_number"])

    print(f"  ✅ Vision extracted {len(questions)} questions ({skipped} pages skipped)")
    _vis_cache.write_text(json.dumps(questions, ensure_ascii=False, indent=2), encoding="utf-8")
    return questions


def _parse_quality(questions: list[dict]) -> float:
    """Return fraction of questions that have all 4 non-empty, non-garbled options.
    Used to decide if Vision fallback is needed."""
    if not questions:
        return 0.0
    good = 0
    for q in questions:
        c = q.get("option_c", "")
        d = q.get("option_d", "")
        if c and d and len(c) > 2 and len(d) > 2:
            # Also check that options don't contain obvious garbled text
            combined = (q.get("option_a","") + q.get("option_b","") +
                        q.get("option_c","") + q.get("option_d",""))
            if not _is_garbled(combined):
                good += 1
    return good / len(questions)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — ENGLISH-ONLY FILTER  (no API cost)
# ══════════════════════════════════════════════════════════════════════════════

def _is_garbled(text: str) -> bool:
    """Detect mojibake — Telugu/other custom-font PDFs extract as Latin Extended garbage chars.
    These slip past langdetect because they look like random Latin-1 characters, not Telugu Unicode.

    Two patterns:
    1. Alpha chars in extended Latin range (\\x80-\\xFF) — classic mojibake
    2. Punctuation/symbols in extended range like · (U+00B7 middle dot from Telugu 'and') —
       appears as 'A eT]j·TT B' instead of 'A and B'. Must check ALL printable chars, not just alpha.
    """
    if not text:
        return False
    printable = [c for c in text if not c.isspace() and c.isprintable()]
    if len(printable) < 8:
        return False
    extended = sum(1 for c in printable if '\x80' <= c <= '\xff')
    return (extended / len(printable)) > 0.08


def _is_english(text: str) -> bool:
    """Returns True if text is primarily English. Lenient for bilingual papers."""
    if not text or _is_garbled(text):
        return False
    
    # Quick ASCII check: if >30% is English, keep it. 
    # (Bilingual UPSC papers often have 50/50 English/Hindi)
    printable = [c for c in text if not c.isspace() and c.isprintable()]
    if not printable: return False
    ascii_count = sum(1 for c in printable if ord(c) < 128)
    if (ascii_count / len(printable)) > 0.30:
        return True

    try:
        lang = detect(text)
        return lang not in ("te", "hi", "ta", "kn", "ml", "mr", "bn", "gu")
    except Exception:
        return True  # uncertain → keep

def filter_english(questions: list[dict], exam_name: str = "") -> list[dict]:
    """Remove regional-only questions. Lenient if UPSC/CISF is detected."""
    before = len(questions)
    is_upsc = any(k in exam_name.lower() for k in ("upsc", "cisf", "nda", "cds"))
    
    if is_upsc:
        # For UPSC, we trust the extractors more than the filter.
        # Only remove if it's CLEARLY garbled or empty.
        english_qs = [q for q in questions if q.get("question_text") and not _is_garbled(q["question_text"])]
    else:
        english_qs = [q for q in questions if _is_english(q["question_text"])]
        
    removed = before - len(english_qs)
    if removed:
        print(f"  🔤 Filtered {removed} non-English/garbled questions → {len(english_qs)} remain")
    return english_qs


_MATCH_CODE_OPT_RE = re.compile(
    r'^\s*(?:'
    r'(?:\d+\s*[-–]\s*[A-D](?:\s*,\s*\d+\s*[-–]\s*[A-D]){1,7})'
    r'|'
    r'(?:[A-D]\s*[-–]\s*\d+(?:\s*,\s*[A-D]\s*[-–]\s*\d+){1,7})'
    r')\s*$',
    re.IGNORECASE,
)

_MATCH_PROMPT_RE = re.compile(
    r'\b(?:match\s+the\s+following|match\s+list\s+i\s+with\s+list\s+ii|list\s*i\b.*\blist\s*ii\b)\b',
    re.IGNORECASE,
)
_MATCH_LEFT_RE = re.compile(r'^\s*([A-D])\.\s*(.+?)\s*$', re.IGNORECASE)
_MATCH_RIGHT_RE = re.compile(r'^\s*((?:\d+|[IVXLCDM]+))\.\s*(.+?)\s*$', re.IGNORECASE)
_MATCH_INLINE_BOTH_RE = re.compile(
    r'^\s*([A-D])\.\s*(.+?)\s{2,}((?:\d+|[IVXLCDM]+))\.\s*(.+?)\s*$',
    re.IGNORECASE,
)
_MATCH_END_RE = re.compile(
    r'^\s*(?:choose|select)\s+the\s+correct'
    r'|^\s*[A-D]\s*[-:]\s*[IVX\d]'
    r'|^\s*\([1-4]\)\s*[A-D]-',
    re.IGNORECASE,
)


def _regional_script_ratio(text: str) -> float:
    if not text:
        return 0.0
    alpha = [c for c in text if c.isalpha()]
    if not alpha:
        return 0.0
    regional = sum(1 for c in alpha if _DEVANAGARI.match(c) or _TELUGU_UNICODE.match(c))
    return regional / len(alpha)


def _is_publish_blocked(question: dict, exam_name: str) -> tuple[bool, str]:
    """Block obviously broken questions from public publication.

    The goal is not to be clever; it is to be safe. If a row is clearly
    malformed for aspirants, store it as inactive so it can be audited instead
    of silently reaching the public practice flow.
    """
    text = (question.get("question_text") or "").strip()
    opts = [
        (question.get("option_a") or "").strip(),
        (question.get("option_b") or "").strip(),
        (question.get("option_c") or "").strip(),
        (question.get("option_d") or "").strip(),
    ]
    filled_opts = [o for o in opts if o]
    publishable_image_fallback = bool(
        question.get("has_image") and question.get("image_url") and len(filled_opts) == 4
    )
    exam_lc = exam_name.lower()
    is_upsc_like = any(k in exam_lc for k in ("upsc", "cisf", "nda", "cds"))
    qn = question.get("question_number")

    if not isinstance(qn, int) or qn <= 0:
        return True, "unnumbered-questions"

    if not is_upsc_like:
        combined = " ".join([text] + filled_opts)
        if _regional_script_ratio(combined) >= 0.12:
            if publishable_image_fallback:
                return False, ""
            return True, "regional-script"

    is_match_like = (
        question.get("question_type") == "match"
        or "match the following" in text.lower()
        or (question.get("topic") or "").strip().lower() == "matching"
    )
    if is_match_like:
        if "__MATCH__:" in text:
            try:
                match_data = _extract_match_payload(text)
                col1 = match_data.get("col1") or []
                col2 = match_data.get("col2") or []
                if not col1 or not col2:
                    if publishable_image_fallback:
                        return False, ""
                    return True, "incomplete-match-columns"
            except Exception:
                if publishable_image_fallback:
                    return False, ""
                return True, "invalid-match-payload"
        else:
            intro = re.sub(r'(?i)^match\s+the\s+following[:\s-]*', '', text).strip()
            intro_alnum = len(re.sub(r'[^A-Za-z0-9]+', '', intro))
            all_code_opts = len(filled_opts) == 4 and all(_MATCH_CODE_OPT_RE.match(o) for o in filled_opts)
            has_match_structure = bool(re.search(
                r'\b(?:column|list\s+i|list\s+ii|a\.|b\.|c\.|d\.|1\.|2\.|3\.|4\.)',
                text,
                re.IGNORECASE,
            ))
            if all_code_opts and (intro_alnum < 24 or not has_match_structure):
                if publishable_image_fallback:
                    return False, ""
                return True, "incomplete-match-stem"

    if len(text) < 20 and len(filled_opts) == 4 and all(_MATCH_CODE_OPT_RE.match(o) for o in filled_opts):
        if publishable_image_fallback:
            return False, ""
        return True, "option-combo-fragment"

    return False, ""


def _find_question_fallback_rect(page: fitz.Page, question_number: int | None) -> fitz.Rect | None:
    if not isinstance(question_number, int) or question_number <= 0:
        return None
    try:
        blocks = sorted(page.get_text("blocks"), key=lambda b: (b[1], b[0]))
    except Exception:
        return None
    if not blocks:
        return None

    current_re = re.compile(
        rf'(?i)(?:Question\s+Number\s*:\s*{question_number}\b|^\s*Q\.?\s*{question_number}\b|^\s*{question_number}[\.\)])',
        re.MULTILINE,
    )
    any_q_re = re.compile(
        r'(?i)(?:Question\s+Number\s*:\s*\d+\b|^\s*Q\.?\s*\d+\b|^\s*\d+[\.\)])',
        re.MULTILINE,
    )
    anchor_idx: int | None = None
    for idx, block in enumerate(blocks):
        text = str(block[4] or "").strip()
        if text and current_re.search(text):
            anchor_idx = idx
            break
    if anchor_idx is None:
        return None

    anchor = blocks[anchor_idx]
    y0 = max(0, float(anchor[1]) - 18)
    y1 = min(page.rect.y1, y0 + max(260, page.rect.height * 0.58))
    for next_idx in range(anchor_idx + 1, len(blocks)):
        nxt_text = str(blocks[next_idx][4] or "").strip()
        if nxt_text and any_q_re.search(nxt_text):
            y1 = min(page.rect.y1, max(float(blocks[next_idx][1]) - 10, y0 + 120))
            break
    if (y1 - y0) < 80:
        return None
    return fitz.Rect(0, y0, page.rect.x1, y1)


def _apply_image_fallback_hint(question: dict) -> None:
    hint = "Refer to the attached image for the exact question/table."
    text = str(question.get("question_text") or "").strip()
    combined = " ".join(
        str(question.get(k) or "")
        for k in ("question_text", "option_a", "option_b", "option_c", "option_d")
    )
    is_match_like = (
        str(question.get("question_type") or "").strip().lower() == "match"
        or "match the following" in text.lower()
    )
    if not text:
        question["question_text"] = hint
        return
    if is_match_like and "__MATCH__:" not in text and hint.lower() not in text.lower():
        question["question_text"] = text + "\n\n" + hint
        return
    if _regional_script_ratio(combined) >= 0.12 and hint.lower() not in text.lower():
        question["question_text"] = text + "\n\n" + hint


def _needs_image_fallback(question: dict) -> bool:
    qtype = str(question.get("question_type") or "").strip().lower()
    text = str(question.get("question_text") or "").strip().lower()
    combined = " ".join(
        str(question.get(k) or "")
        for k in ("question_text", "option_a", "option_b", "option_c", "option_d")
    ).lower()
    if question.get("has_image"):
        return True
    if qtype in {"match", "diagram", "table"}:
        return True
    hard_markers = (
        "match the following",
        "__match__:",
        "list - i",
        "list - ii",
        "following table",
        "the table below",
        "diagram",
        "figure",
        "graph",
        "chart",
        "map",
        "code:",
        "assertion",
        "reason",
    )
    return any(marker in combined or marker in text for marker in hard_markers)


def _attach_image_fallbacks_for_unusable_rows(
    questions: list[dict],
    pdf_path: str,
    exam_name: str,
    exam_year: int,
    supabase_client: Any,
) -> list[dict]:
    candidates = [
        q for q in questions
        if q.get("_page_idx") is not None
        and not q.get("image_url")
        and _needs_image_fallback(q)
        and not is_row_usable_for_recovery({
            "question_text": q.get("question_text"),
            "option_a": q.get("option_a"),
            "option_b": q.get("option_b"),
            "option_c": q.get("option_c"),
            "option_d": q.get("option_d"),
            "question_type": q.get("question_type"),
            "question_number": q.get("question_number"),
            "correct_answer": q.get("correct_answer"),
            "has_image": q.get("has_image"),
            "image_url": q.get("image_url"),
        })
    ]
    if not candidates:
        return questions

    print(f"[img-fallback] Attaching fallback images for {len(candidates)} hard rows...")
    safe_exam = re.sub(r"[^a-zA-Z0-9_-]", "_", exam_name.strip())
    bucket = "question-images"
    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:
        print(f"[img-fallback] Could not open PDF: {exc}")
        return questions

    uploaded_by_key: dict[tuple[int, int | None], str] = {}
    try:
        for q in candidates:
            page_idx = int(q.get("_page_idx"))
            qn = q.get("question_number") if isinstance(q.get("question_number"), int) else None
            cache_key = (page_idx, qn)
            if cache_key in uploaded_by_key:
                q["has_image"] = True
                q["image_url"] = uploaded_by_key[cache_key]
                q["needs_review"] = True
                _apply_image_fallback_hint(q)
                continue

            page = doc[page_idx]
            clip = _find_question_fallback_rect(page, qn)
            mat = fitz.Matrix(180 / 72, 180 / 72)
            pix = page.get_pixmap(matrix=mat, clip=clip) if clip else page.get_pixmap(matrix=mat)
            path = f"{safe_exam}/{exam_year}/fallback_q{qn or 'x'}_p{page_idx + 1}.png"
            supabase_client.storage.from_(bucket).upload(
                path=path,
                file=pix.tobytes("png"),
                file_options={"content-type": "image/png", "upsert": "true"},
            )
            url = supabase_client.storage.from_(bucket).get_public_url(path)
            uploaded_by_key[cache_key] = url
            q["has_image"] = True
            q["image_url"] = url
            q["needs_review"] = True
            _apply_image_fallback_hint(q)
    except Exception as exc:
        print(f"[img-fallback] Upload failed: {exc}")
    finally:
        doc.close()
    return questions


def _recover_inline_match_payload(question_text: str) -> tuple[str, list[str], list[str]] | None:
    """Recover List I / List II columns from flattened match-the-following text."""
    if not question_text or "__MATCH__:" in question_text:
        return None

    left: list[tuple[str, str]] = []
    right: list[tuple[str, str]] = []
    intro_lines: list[str] = []
    pending_left_label: str | None = None
    pending_right_label: str | None = None

    lines = [ln.strip() for ln in question_text.replace("\t", "    ").splitlines() if ln.strip()]
    for line in lines:
        if _MATCH_END_RE.search(line):
            break

        if pending_left_label:
            continuation = re.match(r'^\s*(.+?)\s+((?:\d+|[IVXLCDM]+))\.\s*(.+?)\s*$', line, re.IGNORECASE)
            if continuation:
                left.append((pending_left_label, continuation.group(1).strip()))
                right.append((continuation.group(2), continuation.group(3).strip()))
                pending_left_label = None
                continue
            right_m = _MATCH_RIGHT_RE.match(line)
            if right_m:
                left.append((pending_left_label, ""))
                right.append((right_m.group(1), right_m.group(2).strip()))
                pending_left_label = None
                continue
            left.append((pending_left_label, line.strip()))
            pending_left_label = None
            continue

        if pending_right_label:
            right_m = _MATCH_RIGHT_RE.match(line)
            if right_m:
                right.append((right_m.group(1), right_m.group(2).strip()))
            else:
                right.append((pending_right_label, line.strip()))
            pending_right_label = None
            continue

        both = _MATCH_INLINE_BOTH_RE.match(line)
        if both:
            left.append((both.group(1).upper(), both.group(2).strip()))
            right.append((both.group(3), both.group(4).strip()))
            continue

        left_with_right_only = re.match(
            r'^\s*([A-D])\.\s*(.+?)\s+((?:\d+|[IVXLCDM]+))\.\s*$',
            line,
            re.IGNORECASE,
        )
        if left_with_right_only:
            left.append((left_with_right_only.group(1).upper(), left_with_right_only.group(2).strip()))
            pending_right_label = left_with_right_only.group(3)
            continue

        left_m = _MATCH_LEFT_RE.match(line)
        if left_m:
            label = left_m.group(1).upper()
            value = left_m.group(2).strip()
            if value:
                continuation = re.match(
                    r'^\s*(.+?)\s+((?:\d+|[IVXLCDM]+))\.\s*(.+?)\s*$',
                    value,
                    re.IGNORECASE,
                )
                if continuation:
                    left.append((label, continuation.group(1).strip()))
                    right.append((continuation.group(2), continuation.group(3).strip()))
                else:
                    trailing_right = re.match(r'^(.*?)\s+((?:\d+|[IVXLCDM]+))\.\s*$', value, re.IGNORECASE)
                    if trailing_right:
                        left.append((label, trailing_right.group(1).strip()))
                        pending_right_label = trailing_right.group(2)
                    else:
                        left.append((label, value))
            else:
                pending_left_label = label
            continue

        right_m = _MATCH_RIGHT_RE.match(line)
        if right_m:
            right.append((right_m.group(1), right_m.group(2).strip()))
            continue

        intro_lines.append(line)

    def _right_sort_value(label: str) -> int:
        if label.isdigit():
            return int(label)
        roman_map = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
        total = 0
        prev = 0
        for ch in reversed(label.upper()):
            value = roman_map.get(ch, 0)
            total += -value if value < prev else value
            prev = value
        return total

    col1 = [text for _, text in sorted(left, key=lambda x: x[0])]
    col2 = [text for _, text in sorted(right, key=lambda x: _right_sort_value(x[0]))]
    if len(col1) < 2 or len(col2) < 2:
        return None
    if not _MATCH_PROMPT_RE.search(question_text) and not re.search(r'list\s*i\b|word\b|book\b|writer\b|meaning\b', question_text, re.IGNORECASE):
        return None

    intro = "\n".join(intro_lines).strip() or "Match the following:"
    return intro, col1, col2


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — CHEAP AI TAGGING ONLY  (gemini-1.5-flash-8b)
# We send only question text (~50 tokens), NOT raw pages (~2000 tokens)
# We ask only for subject/topic/difficulty, NOT extraction (already done locally)
# ══════════════════════════════════════════════════════════════════════════════

TAXONOMY_SUBJECTS = (
    "History | Geography | Polity | Economy | Environment & Ecology | "
    "Science & Technology | Current Affairs | "
    "Mathematics | Quantitative Aptitude | Logical Reasoning | "
    "English Language | Computer Knowledge | "
    "General Knowledge | Social Issues"
)

# Canonical topic buckets per subject — AI must pick from these or the closest match.
# This prevents fragmentation (e.g. "Space Missions" / "Space Science" / "ISRO" all becoming separate topics).
TAXONOMY_TOPICS: dict[str, list[str]] = {
    "History": [
        "Ancient History", "Medieval History", "Modern History",
        "Indian National Movement", "Art & Culture", "World History",
        "Post-Independence India",
    ],
    "Geography": [
        "Physical Geography", "Indian Geography", "World Geography",
        "Climate & Monsoon", "Rivers & Water Bodies", "Natural Resources",
        "Agriculture & Soils", "Population & Urbanization", "Mapping",
    ],
    "Polity": [
        "Constitutional Framework", "Fundamental Rights & DPSP",
        "Parliament & Legislation", "President & Executive", "Judiciary",
        "Local Government", "Elections & Political Parties",
        "Emergency Provisions", "Constitutional Bodies & Commissions",
        "Legal System & Criminal Laws",
    ],
    "Economy": [
        "National Income & GDP", "Banking & Finance", "Fiscal Policy",
        "Monetary Policy", "Agriculture & Food Economy", "Trade & Commerce",
        "Planning & Development", "Poverty & Unemployment",
        "Infrastructure & Industry", "International Economics",
    ],
    "Environment & Ecology": [
        "Ecosystems & Biodiversity", "Climate Change", "Environmental Laws & Policies",
        "National Parks & Wildlife Sanctuaries", "Pollution & Waste Management",
        "Conservation & Sustainable Development", "International Environmental Conventions",
    ],
    "Science & Technology": [
        "Physics", "Chemistry", "Biology", "Space Technology",
        "Defence Technology", "Information Technology", "Biotechnology",
        "Nuclear Technology", "Medical Science", "Inventions & Discoveries",
    ],
    "Current Affairs": [
        "International Relations", "Domestic Affairs", "Government Schemes & Policies",
        "Sports", "Awards & Honours", "Summits & Conferences", "Defence & Security",
    ],
    "Mathematics": [
        "Number System", "Arithmetic", "Algebra & Equations",
        "Geometry & Mensuration", "Data Interpretation", "Statistics & Probability",
    ],
    "Quantitative Aptitude": [
        "Percentage & Ratio", "Profit & Loss", "Time Speed & Distance",
        "Time & Work", "Simple & Compound Interest", "Averages & Mixtures",
        "Data Interpretation", "Number System",
    ],
    "Logical Reasoning": [
        "Number & Letter Series", "Analogies", "Coding-Decoding",
        "Seating Arrangement", "Blood Relations", "Syllogisms",
        "Direction & Distance", "Puzzles & Ranking", "Input-Output",
        "Statement & Conclusion", "Venn Diagrams",
    ],
    "English Language": [
        "Grammar & Usage", "Vocabulary", "Reading Comprehension",
        "Sentence Correction", "Idioms & Phrases", "Fill in the Blanks",
        "One-Word Substitution", "Para Jumbles",
    ],
    "Computer Knowledge": [
        "Computer Fundamentals", "MS Office", "Internet & Networking",
        "Programming Basics", "Database Management", "Operating Systems",
    ],
    "Social Issues": [
        "Education Policy", "Women & Child Welfare", "Health & Nutrition",
        "Rural Development", "SC/ST & Social Justice",
        "Minority Affairs", "Labour & Employment",
    ],
    "General Knowledge": [
        "Awards & Records", "Famous Personalities", "Indian Heritage",
        "Sports Trivia", "Miscellaneous",
    ],
}

_TOPIC_LINES = "\n".join(
    f"  {subj}: {' | '.join(topics)}"
    for subj, topics in TAXONOMY_TOPICS.items()
)

TAG_PROMPT_TEMPLATE = """You are a subject-matter expert for Indian competitive exams (UPSC, SSC, CISF, State PSC, High Court, etc.).

Classify each question below. Return ONLY a valid JSON array — no markdown, no explanation, just raw JSON.

For each question return: {{"id": N, "subject": "...", "topic": "...", "subtopic": "...", "difficulty": "Easy|Medium|Hard"}}

Subject list (pick EXACTLY one):
  {subjects}

Canonical topic buckets per subject — you MUST pick the closest matching topic from this list.
Do NOT invent new topic names; if a question fits a bucket, use that bucket's exact name:
{topic_lines}

Classification rules:
- subject: EXACTLY one from the subject list above
- topic: EXACTLY one from the canonical bucket for that subject (verbatim, no paraphrasing)
- subtopic: a reusable PYQ classification label — NOT a person name, place name, or one-off keyword from the question
- difficulty: Easy (factual recall) | Medium (applied / inferential) | Hard (multi-step or obscure)
- "Science & Technology" replaces both "General Science" and "Science & Technology" — use it for ALL science questions
- "Environment & Ecology" replaces "Environment" — use it for biodiversity, pollution, climate, wildlife
- NEVER use "General Knowledge" when a better subject exists
- For calculation questions → "Quantitative Aptitude" or "Mathematics"
- For puzzles, series, analogies, coding → "Logical Reasoning"
- Questions about Bharatiya Nyaya Sanhita, Bharatiya Nagarik Suraksha Sanhita, Bharatiya Sakshya Adhiniyam, criminal law, evidence law, or legal definitions belong under "Polity" → "Legal System & Criminal Laws"
- Questions about Acts, Government Orders (G.O.s), reorganisation laws, Union/State/Concurrent Lists, ordinances, landmark judgments, social legislation, rights-based laws, or committees/commissions must NOT go under "Science & Technology" or "Mechanics"; classify them under "Polity" or "Current Affairs" as appropriate
- Do NOT use vague labels: "General", "Basics", "Mixed", "Miscellaneous" (unless unavoidable under General Knowledge)
- If subtopic cannot be a stable, reusable bucket → return null for subtopic and make topic strong

Exam: {exam_name}

Questions:
{questions_text}"""


def _clean_for_tagging(text: Any) -> str:
    """Strip match JSON payload and truncate question text for tagging."""
    if not text or not isinstance(text, str):
        return ""
    idx = text.find('\n\n__MATCH__:')
    if idx != -1:
        text = text[:idx]
    return text[:320].strip()


def _tagging_context(q: dict, idx: int) -> str:
    stem = _clean_for_tagging(q.get("question_text"))
    opts = []
    for label, key in (("A", "option_a"), ("B", "option_b"), ("C", "option_c"), ("D", "option_d")):
        val = str(q.get(key) or "").strip()
        if val:
            opts.append(f"{label}. {val[:120]}")
    q_type = str(q.get("question_type") or "MCQ").strip()
    lines = [f"{idx}. [type: {q_type}] {stem}"]
    if opts:
        lines.append("Options: " + " | ".join(opts))
    return "\n".join(lines)


def _batch_cache_key(questions: list[dict], exam_name: str) -> str:
    # Include TAG_PROMPT_VERSION so taxonomy/prompt changes bust stale caches
    combined = TAG_PROMPT_VERSION + "||" + exam_name + "||" + "||".join(
        (
            _clean_for_tagging(q["question_text"])[:60]
            + "||"
            + str(q.get("option_a") or "")[:24]
            + "||"
            + str(q.get("option_b") or "")[:24]
        )
        for q in questions
    )
    return hashlib.md5(combined.encode()).hexdigest()


def _load_cache(key: str) -> list[dict] | None:
    path = CACHE_DIR / f"{key}.json"
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return None


def _save_cache(key: str, data: list[dict]):
    path = CACHE_DIR / f"{key}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _call_tagger(questions: list[dict], exam_name: str, tracker: "CostTracker | None" = None) -> list[dict]:
    """Send question stem plus key options for stronger subject/topic/subtopic tagging."""
    qs_text = "\n".join(
        _tagging_context(q, i + 1)
        for i, q in enumerate(questions)
    )
    prompt = TAG_PROMPT_TEMPLATE.format(
        exam_name=exam_name,
        subjects=TAXONOMY_SUBJECTS,
        topic_lines=_TOPIC_LINES,
        questions_text=qs_text,
    )

    for attempt in range(3):
        try:
            fut = _TAG_EXECUTOR.submit(
                _CLIENT.models.generate_content,
                model=TAGGER_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    max_output_tokens=4096,
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )
            try:
                resp = fut.result(timeout=60)
            except _cf.TimeoutError:
                print(f"    ⚠️  Tagger timed out after 60s on attempt {attempt+1}")
                time.sleep(5)
                continue
            raw = (resp.text or "").strip()
            # Strip markdown fences
            if raw.startswith("```"):
                raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
            
            if not raw:
                return []

            # Robustly extract JSON array — ignore any text before/after the array
            start = raw.find('[')
            end = raw.rfind(']') + 1
            if start != -1 and end > start:
                raw = raw[start:end]
            else:
                return []

            tags = json.loads(raw)
            if isinstance(tags, list):
                if tracker:
                    try:
                        _m = resp.usage_metadata
                        tracker.record("Tagging", _m.prompt_token_count or 0, _m.candidates_token_count or 0)
                    except Exception:
                        pass
                return tags
        except json.JSONDecodeError:
            print(f"    ⚠️  JSON parse error on attempt {attempt+1}, retrying...")
            time.sleep(2)
        except Exception as e:
            if "429" in str(e) or "quota" in str(e).lower():
                wait = 60 * (attempt + 1)
                print(f"    ⏳ Rate limited. Waiting {wait}s...")
                time.sleep(wait)
            elif "504" in str(e) or "timeout" in str(e).lower():
                print(f"    ⏳ Timeout. Waiting 15s...")
                time.sleep(15)
            else:
                print(f"    ❌ API error: {e}")
                break

    # All retries failed — return unclassified (never silently discard questions)
    print(f"    ❌ Tagging failed for batch of {len(questions)} — storing as Unclassified")
    return [{"id": i+1, "subject": "Unclassified", "topic": "Unclassified", "difficulty": "Medium"}
            for i in range(len(questions))]


# Keyword → canonical topic overrides per subject.
# Handles AI hallucinations that word-overlap alone can't resolve
# (e.g. "ISRO Programs" has no word overlap with "Space Technology").
TOPIC_KEYWORD_OVERRIDES: dict[str, dict[str, str]] = {
    "Science & Technology": {
        "space": "Space Technology", "isro": "Space Technology",
        "satellite": "Space Technology", "rocket": "Space Technology",
        "chandrayaan": "Space Technology", "mangalyaan": "Space Technology",
        "launch vehicle": "Space Technology", "orbit": "Space Technology",
        "nuclear": "Nuclear Technology", "atomic": "Nuclear Technology",
        "reactor": "Nuclear Technology", "radioactive": "Nuclear Technology",
        "computer": "Information Technology", "software": "Information Technology",
        "internet": "Information Technology", "cyber": "Information Technology",
        "artificial intelligence": "Information Technology", "ai ": "Information Technology",
        "biotech": "Biotechnology", "genetic": "Biotechnology",
        "gene": "Biotechnology", "dna": "Biotechnology", "clone": "Biotechnology",
        "disease": "Medical Science", "vaccine": "Medical Science",
        "virus": "Medical Science", "bacteria": "Medical Science",
        "medicine": "Medical Science", "health": "Medical Science",
        "defence": "Defence Technology", "weapon": "Defence Technology",
        "missile": "Defence Technology", "radar": "Defence Technology",
        "drone": "Defence Technology",
        "invention": "Inventions & Discoveries", "discovery": "Inventions & Discoveries",
        "scientist": "Inventions & Discoveries",
    },
    "Geography": {
        "river": "Rivers & Water Bodies", "lake": "Rivers & Water Bodies",
        "dam": "Rivers & Water Bodies", "ocean": "Rivers & Water Bodies",
        "sea": "Rivers & Water Bodies", "waterfall": "Rivers & Water Bodies",
        "estuary": "Rivers & Water Bodies", "delta": "Rivers & Water Bodies",
        "mountain": "Physical Geography", "plateau": "Physical Geography",
        "plain": "Physical Geography", "peninsula": "Physical Geography",
        "island": "Physical Geography", "earthquake": "Physical Geography",
        "volcano": "Physical Geography", "tectonic": "Physical Geography",
        "continent": "World Geography", "country": "World Geography",
        "capital": "World Geography", "border": "World Geography",
        "monsoon": "Climate & Monsoon", "rainfall": "Climate & Monsoon",
        "climate": "Climate & Monsoon", "temperature": "Climate & Monsoon",
        "cyclone": "Climate & Monsoon", "drought": "Climate & Monsoon",
        "soil": "Agriculture & Soils", "crop": "Agriculture & Soils",
        "agriculture": "Agriculture & Soils", "irrigation": "Agriculture & Soils",
        "population": "Population & Urbanization", "city": "Population & Urbanization",
        "urban": "Population & Urbanization", "census": "Population & Urbanization",
        "mineral": "Natural Resources", "forest": "Natural Resources",
        "coal": "Natural Resources", "petroleum": "Natural Resources",
        "map": "Mapping", "projection": "Mapping", "latitude": "Mapping",
        "longitude": "Mapping",
    },
    "History": {
        "mughal": "Medieval History", "sultanate": "Medieval History",
        "medieval": "Medieval History", "lodi": "Medieval History",
        "vedic": "Ancient History", "indus": "Ancient History",
        "harappan": "Ancient History", "maurya": "Ancient History",
        "gupta": "Ancient History", "ashoka": "Ancient History",
        "buddhism": "Ancient History", "jainism": "Ancient History",
        "gandhi": "Indian National Movement", "freedom": "Indian National Movement",
        "independence": "Indian National Movement", "congress": "Indian National Movement",
        "satyagraha": "Indian National Movement", "revolt": "Indian National Movement",
        "mutiny": "Indian National Movement",
        "british": "Modern History", "colonial": "Modern History",
        "partition": "Modern History", "reform": "Modern History",
        "viceroy": "Modern History", "governor": "Modern History",
        "painting": "Art & Culture", "architecture": "Art & Culture",
        "dance": "Art & Culture", "music": "Art & Culture",
        "temple": "Art & Culture", "sculpture": "Art & Culture",
        "festival": "Art & Culture", "literature": "Art & Culture",
        "world war": "World History", "revolution": "World History",
        "renaissance": "World History", "imperialism": "World History",
        "post-independence": "Post-Independence India",
        "five year plan": "Post-Independence India",
    },
    "Polity": {
        "fundamental right": "Fundamental Rights & DPSP",
        "directive principle": "Fundamental Rights & DPSP",
        "dpsp": "Fundamental Rights & DPSP",
        "parliament": "Parliament & Legislation",
        "lok sabha": "Parliament & Legislation",
        "rajya sabha": "Parliament & Legislation",
        "bill": "Parliament & Legislation", "legislation": "Parliament & Legislation",
        "president": "President & Executive",
        "prime minister": "President & Executive",
        "cabinet": "President & Executive", "council of minister": "President & Executive",
        "supreme court": "Judiciary", "high court": "Judiciary",
        "judiciary": "Judiciary", "judge": "Judiciary", "writ": "Judiciary",
        "panchayat": "Local Government", "municipality": "Local Government",
        "gram sabha": "Local Government",
        "election": "Elections & Political Parties",
        "political party": "Elections & Political Parties",
        "emergency": "Emergency Provisions",
        "constitutional bod": "Constitutional Bodies & Commissions",
        "commission": "Constitutional Bodies & Commissions",
        "upsc commission": "Constitutional Bodies & Commissions",
        "amendment": "Constitutional Framework",
        "preamble": "Constitutional Framework",
        "schedule": "Constitutional Framework",
    },
    "Economy": {
        "gdp": "National Income & GDP", "gnp": "National Income & GDP",
        "national income": "National Income & GDP",
        "bank": "Banking & Finance", "rbi": "Banking & Finance",
        "nbfc": "Banking & Finance", "credit": "Banking & Finance",
        "fiscal": "Fiscal Policy", "budget": "Fiscal Policy",
        "tax": "Fiscal Policy", "gst": "Fiscal Policy", "deficit": "Fiscal Policy",
        "monetary": "Monetary Policy", "repo": "Monetary Policy",
        "inflation": "Monetary Policy", "crr": "Monetary Policy",
        "slr": "Monetary Policy",
        "trade": "Trade & Commerce", "export": "Trade & Commerce",
        "import": "Trade & Commerce", "wto": "Trade & Commerce",
        "poverty": "Poverty & Unemployment", "unemployment": "Poverty & Unemployment",
        "bpl": "Poverty & Unemployment",
        "infrastructure": "Infrastructure & Industry",
        "industry": "Infrastructure & Industry", "msme": "Infrastructure & Industry",
        "planning": "Planning & Development",
        "five year": "Planning & Development", "niti aayog": "Planning & Development",
        "international": "International Economics", "imf": "International Economics",
        "world bank": "International Economics",
    },
    "Environment & Ecology": {
        "biodiversity": "Ecosystems & Biodiversity",
        "ecosystem": "Ecosystems & Biodiversity",
        "species": "Ecosystems & Biodiversity", "habitat": "Ecosystems & Biodiversity",
        "climate change": "Climate Change", "global warming": "Climate Change",
        "greenhouse": "Climate Change", "carbon": "Climate Change",
        "pollution": "Pollution & Waste Management",
        "waste": "Pollution & Waste Management",
        "national park": "National Parks & Wildlife Sanctuaries",
        "sanctuary": "National Parks & Wildlife Sanctuaries",
        "wildlife": "National Parks & Wildlife Sanctuaries",
        "tiger": "National Parks & Wildlife Sanctuaries",
        "convention": "International Environmental Conventions",
        "protocol": "International Environmental Conventions",
        "unfccc": "International Environmental Conventions",
        "cop": "International Environmental Conventions",
        "conservation": "Conservation & Sustainable Development",
        "sustainable": "Conservation & Sustainable Development",
        "law": "Environmental Laws & Policies",
        "act": "Environmental Laws & Policies",
        "policy": "Environmental Laws & Policies",
    },
}


def _normalize_topic(subject: str, raw_topic: str) -> str:
    """
    Map an AI-returned topic string to the nearest canonical bucket for that subject.
    Guarantees the feed never shows fragmented topics like 'Space Missions' vs 'Space Technology'.
    Priority: exact → case-insensitive → substring → keyword override → word overlap → original.
    """
    canonical = TAXONOMY_TOPICS.get(subject, [])
    if not canonical or not raw_topic:
        return raw_topic

    # 1. Exact match
    if raw_topic in canonical:
        return raw_topic

    t = raw_topic.lower().strip()

    # 2. Case-insensitive exact
    for c in canonical:
        if c.lower() == t:
            return c

    # 3. Substring containment
    for c in canonical:
        cl = c.lower()
        if cl in t or t in cl:
            return c

    # 4. Keyword override — check if any subject-specific keyword appears in the AI topic
    overrides = TOPIC_KEYWORD_OVERRIDES.get(subject, {})
    for kw, mapped in overrides.items():
        if kw in t:
            return mapped

    # 5. Word overlap — pick canonical bucket with most content words in common
    _STOP = {"&", "of", "the", "and", "in", "at", "to", "a", "an"}
    t_words = {w for w in t.split() if w not in _STOP and len(w) > 2}
    best_canon, best_score = canonical[0], 0
    for c in canonical:
        c_words = {w for w in c.lower().split() if w not in _STOP and len(w) > 2}
        score = len(t_words & c_words)
        if score > best_score:
            best_canon, best_score = c, score

    if best_score > 0:
        return best_canon

    # 6. No match — keep original
    return raw_topic


def tag_questions(questions: list[dict], exam_name: str, job_id: str = None, tracker: "CostTracker | None" = None) -> list[dict]:
    """
    Batch tag questions using gemini-2.5-flash.
    Uses local file cache — re-runs cost ₹0.
    """
    sb = get_supabase() if job_id else None
    batches = [questions[i:i+TAG_BATCH_SIZE] for i in range(0, len(questions), TAG_BATCH_SIZE)]
    total_batches = len(batches)
    total_api_calls: int = 0

    for batch_num, batch in enumerate(batches, 1):
        cache_key = _batch_cache_key(batch, exam_name)
        tags = _load_cache(cache_key)

        if tags:
            print(f"  📦 Batch {batch_num}/{total_batches}: cache hit (₹0)")
            if tracker:
                tracker.record(f"Tagging batch {batch_num}", 0, 0, cached=True)
        else:
            print(f"  🧠 Batch {batch_num}/{total_batches}: calling API...")
            tags = _call_tagger(batch, exam_name, tracker)
            # Only cache if we got real tags (not the "Unclassified" default list)
            if tags and not all(t.get("subject") == "Unclassified" for t in tags):
                _save_cache(cache_key, tags)
            total_api_calls += 1
            if batch_num < total_batches:
                time.sleep(1)  # gentle rate limiting

        # Merge tags back into questions — positional only (AI-returned IDs may be strings/wrong)
        for i, q in enumerate(batch):
            tag = tags[i] if i < len(tags) else {}
            subj = tag.get("subject") or "General Knowledge"
            raw_topic = tag.get("topic") or "General"
            q["subject"] = subj
            q["topic"] = _normalize_topic(subj, raw_topic)
            q["subtopic"] = tag.get("subtopic")
            q["difficulty"] = tag.get("difficulty") or "Medium"

        if job_id and sb:
            progress = 30 + int(60 * (batch_num / total_batches))
            try:
                sb.table("jobs").update({"progress": progress}).eq("id", job_id).execute()
            except Exception:
                pass

    cached_batches = total_batches - total_api_calls
    print(f"  ✅ Tagged {len(questions)} questions | "
          f"API calls: {total_api_calls} | From cache: {cached_batches}")
    return questions


# ══════════════════════════════════════════════════════════════════════════════
# STEP 5a — INJECT ANSWERS from separate answer key
# ══════════════════════════════════════════════════════════════════════════════

def inject_answers(answer_map: dict, exam_name: str, exam_year: int) -> dict:
    """
    Bulk-update correct_answer in the questions table for an exam, matching by
    question_number. Call this after store_questions() when a separate answer
    key PDF was provided.

    Also deletes stale cached explanations for updated questions so they
    regenerate correctly against the new verified correct answer.

    Persists the answer_map in the answer_keys table for future replay
    (e.g., if questions are re-extracted, the key can be re-injected automatically).
    """
    sb = get_supabase()
    exam_name = exam_name.strip()
    updated = 0
    updated_ids: list[str] = []

    # Normalize keys to int — answer_map may have string keys from JSON parsing.
    # Preserve special sentinels (DELETED, "B|C") without truncating them.
    from extractor.answer_key_parser import DELETED_SENTINEL, MULTIPLE_SEP
    norm_map: dict[int, str] = {}
    for k, v in answer_map.items():
        try:
            raw = str(v).strip().upper()
            # Preserve sentinels as-is
            if raw == DELETED_SENTINEL or MULTIPLE_SEP in raw:
                norm_map[int(k)] = raw
            else:
                # Take first char for plain answers (handles stray whitespace)
                norm_map[int(k)] = raw[:1]
        except (ValueError, TypeError):
            pass
    answer_map = norm_map

    # Persist the answer key so it can be re-applied without re-uploading
    try:
        sb.table("answer_keys").upsert({
            "exam_name": exam_name,
            "exam_year": exam_year,
            "answer_map": {str(k): v for k, v in answer_map.items()},
            "source": "user_upload",
        }, on_conflict="exam_name,exam_year").execute()
        print(f"  💾 Answer key saved ({len(answer_map)} entries)")
    except Exception as e:
        print(f"  ⚠️  Could not persist answer key (table may not exist yet): {e}")

    _supported = _question_supported_columns(sb)

    # ── Handle deleted questions (answer key shows "X") ───────────────────────
    deleted_nums = [num for num, ans in answer_map.items() if ans == DELETED_SENTINEL]
    if deleted_nums:
        try:
            id_res = sb.table("questions").select("id").eq("exam_name", exam_name).eq(
                "exam_year", exam_year
            ).in_("question_number", deleted_nums).execute()
            del_ids = [r["id"] for r in (id_res.data or [])]
            updated_ids.extend(del_ids)
            del_payload: dict = {"correct_answer": "", "needs_review": False}
            if "answer_status" in _supported:
                del_payload["answer_status"] = "deleted"
            if "correct_answers" in _supported:
                del_payload["correct_answers"] = []
            sb.table("questions").update(del_payload).eq("exam_name", exam_name).eq(
                "exam_year", exam_year
            ).in_("question_number", deleted_nums).execute()
            updated += len(deleted_nums)
            print(f"  🗑️  Marked {len(deleted_nums)} question(s) as deleted (answer key shows X): {deleted_nums}")
        except Exception as e:
            print(f"  ⚠️  inject_answers deleted: {e}")

    # ── Handle multiple-accepted answers (answer key shows "B or C") ──────────
    multi_entries = {num: ans for num, ans in answer_map.items() if MULTIPLE_SEP in ans}
    for num, combined in multi_entries.items():
        letters = [c for c in combined.split(MULTIPLE_SEP) if c in "ABCD"]
        if len(letters) < 2:
            continue
        try:
            id_res = sb.table("questions").select("id").eq("exam_name", exam_name).eq(
                "exam_year", exam_year
            ).eq("question_number", num).execute()
            multi_ids = [r["id"] for r in (id_res.data or [])]
            updated_ids.extend(multi_ids)
            multi_payload: dict = {"correct_answer": letters[0], "needs_review": False}
            if "answer_status" in _supported:
                multi_payload["answer_status"] = "multiple"
            if "correct_answers" in _supported:
                multi_payload["correct_answers"] = letters
            sb.table("questions").update(multi_payload).eq("exam_name", exam_name).eq(
                "exam_year", exam_year
            ).eq("question_number", num).execute()
            updated += 1
            print(f"  🔀 Q{num}: marked multiple-accepted answers {letters}")
        except Exception as e:
            print(f"  ⚠️  inject_answers multiple Q{num}: {e}")

    # ── Handle normal single answers A/B/C/D ─────────────────────────────────
    for letter in "ABCD":
        nums = [num for num, ans in answer_map.items() if ans == letter]
        if not nums:
            continue
        try:
            # Fetch IDs of questions whose answer will change
            id_res = sb.table("questions").select("id, correct_answer").eq(
                "exam_name", exam_name
            ).eq("exam_year", exam_year).in_("question_number", nums).execute()
            changing_ids = [
                r["id"] for r in (id_res.data or [])
                if r.get("correct_answer", "").upper() != letter
            ]
            updated_ids.extend(changing_ids)

            # Only write answer-specific fields — do NOT touch structural quality
            # fields (issue_codes, structural_status, public_visibility) which depend
            # on the actual question text/options and must be read from the real row.
            payload: dict = {"correct_answer": letter, "needs_review": False}
            if "answer_status" in _supported:
                payload["answer_status"] = "verified"
            sb.table("questions").update(payload).eq("exam_name", exam_name).eq("exam_year", exam_year).in_(
                "question_number", nums
            ).execute()
            updated += len(nums)
        except Exception as e:
            print(f"  ⚠️  inject_answers letter={letter}: {e}")

    # Delete stale explanations for questions whose answer changed
    if updated_ids:
        try:
            for i in range(0, len(updated_ids), 50):
                chunk = updated_ids[i:i+50]
                sb.table("explanations").delete().in_("question_id", chunk).execute()
                if "explanation_status" in _supported:
                    sb.table("questions").update({"explanation_status": "missing"}).in_("id", chunk).execute()
            print(f"  🧹 Deleted {len(updated_ids)} stale explanations (answer changed)")
        except Exception as e:
            print(f"  ⚠️  Could not delete stale explanations: {e}")

    print(f"  💉 Injected answers: ~{updated} questions updated in DB")
    return {"updated": updated}


# ══════════════════════════════════════════════════════════════════════════════
# STEP 5 — STORE IN SUPABASE  (unchanged)
# ══════════════════════════════════════════════════════════════════════════════

def _ai_fill_missing_answers(questions: list[dict]) -> list[dict]:
    """
    For any question missing a valid correct_answer (A/B/C/D), use Gemini to
    infer the correct answer BEFORE storing. This prevents the 'default A' bug.
    Questions answered by AI are marked needs_review=True.
    """
    VALID = {"A", "B", "C", "D"}
    missing = [q for q in questions if (q.get("correct_answer") or "").upper()[:1] not in VALID]
    if not missing:
        return questions

    print(f"  [ai-fill] {len(missing)} questions need AI answers — calling Gemini...")
    BATCH = 15  # small batches to prevent JSON truncation
    q_idx = {id(q): q for q in missing}  # identify by object identity

    for start in range(0, len(missing), BATCH):
        batch = missing[start:start + BATCH]
        parts = []
        for idx, q in enumerate(batch):
            parts.append(
                f'Q{idx+1}: {(q.get("question_text") or "")[:250]}\n'
                f'  A) {q.get("option_a","")}  B) {q.get("option_b","")}'
                f'  C) {q.get("option_c","")}  D) {q.get("option_d","")}'
            )
        prompt = (
            'You are an expert exam analyst. For each question select the correct answer. '
            'Output ONLY a JSON array: [{"q": 1, "ans": "B"}, ...]. Never output null.\n\n'
            + "\n\n".join(parts)
        )
        for attempt in range(3):
            try:
                resp = _CLIENT.models.generate_content(
                    model=BEST_MODEL,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.0,
                        max_output_tokens=1024,
                        thinking_config=types.ThinkingConfig(thinking_budget=0),
                    ),
                )
                raw = (resp.text or "").strip()
                if "```" in raw:
                    raw = raw.split("```json")[-1].split("```")[0].strip()
                data = json.loads(raw)
                for item in data:
                    idx = int(item.get("q", 0)) - 1
                    ans = str(item.get("ans") or "").strip().upper()[:1]
                    if 0 <= idx < len(batch) and ans in VALID:
                        batch[idx]["correct_answer"] = ans
                        batch[idx]["needs_review"] = True  # AI-inferred — flag for review
                break
            except Exception as e:
                print(f"  [ai-fill] Attempt {attempt+1}/3 failed: {e}")
                time.sleep(2 ** attempt)

    filled = sum(1 for q in missing if (q.get("correct_answer") or "").upper()[:1] in VALID)
    still_missing = len(missing) - filled
    print(f"  [ai-fill] Filled {filled}/{len(missing)} answers. Still missing: {still_missing}")
    return questions


def store_questions(
    questions: list[dict],
    source_pdf: str,
    exam_name: str,
    exam_year: int,
    *,
    paper_id: Optional[str] = None,
    job_id: Optional[str] = None,
    force_replace: bool = False,
) -> dict:
    """Batch upsert with SHA-256 deduplication."""
    exam_name = exam_name.strip()  # prevent trailing-space duplicate exams
    sb = get_supabase()
    resolved_paper_id = resolve_paper_id(
        paper_id=paper_id,
        job_id=job_id,
        exam_name=exam_name,
        exam_year=exam_year,
        sb=sb,
    )
    inserted = 0
    skipped = 0
    blocked = 0
    blocked_qnums: list[str] = []
    errors = []
    supported_cols = _question_supported_columns(sb)

    # ── AI-fill any questions that have no valid answer BEFORE storing ─────────
    # This eliminates the old 'default A' placeholder bug permanently.
    questions = _ai_fill_missing_answers(questions)

    # If this looks like a standard numbered paper, never persist stray
    # unnumbered rows. In practice these are almost always OCR/LLM fragments
    # or duplicate paraphrases of already-numbered questions, and they inflate
    # the final count (for example: 150-question papers ending up with 161 rows).
    numbered_count = sum(
        1 for q in questions
        if isinstance(q.get("question_number"), int) and q.get("question_number") > 0
    )
    max_question_number = max(
        (int(q.get("question_number")) for q in questions if isinstance(q.get("question_number"), int) and q.get("question_number") > 0),
        default=0,
    )
    looks_like_standard_numbered_paper = (
        questions
        and numbered_count >= 50
        and max_question_number >= 50
        and (numbered_count / len(questions)) >= 0.50
    )
    if questions and ((numbered_count / len(questions)) >= 0.80 or looks_like_standard_numbered_paper):
        before = len(questions)
        questions = [
            q for q in questions
            if isinstance(q.get("question_number"), int) and q.get("question_number") > 0
        ]
        dropped = before - len(questions)
        if dropped:
            print(
                f"  🧹 Dropped {dropped} unnumbered fragment(s) "
                f"from mostly-numbered paper '{exam_name} {exam_year}'"
            )

    questions = _attach_image_fallbacks_for_unusable_rows(
        questions,
        source_pdf,
        exam_name,
        exam_year,
        sb,
    )

    for i in range(0, len(questions), 50):
        batch = questions[i:i+50]
        rows = []
        explanations_pending = []

        for q in batch:
            q_text = (q.get("question_text") or "").strip()
            q_type = str(q.get("question_type") or "").strip().lower()
            if q_text and "__MATCH__:" not in q_text:
                recovered_match = _recover_inline_match_payload(q_text)
                if recovered_match:
                    intro, col1, col2 = recovered_match
                    q["question_text"] = intro + "\n\n__MATCH__:" + json.dumps(
                        {"col1": col1, "col2": col2},
                        ensure_ascii=False,
                    )
                    if q_type != "match":
                        q["question_type"] = "Match"

            q_num = q.get("question_number")
            if q_num is not None:
                # Anchor identity to exam+Q# — re-uploads always upsert the same row
                # regardless of minor text variation between extraction runs.
                hash_input = f"{exam_name.strip().lower()}|{int(exam_year)}|q{q_num}"
            else:
                # Fallback: content-based hash for questions without a number
                hash_input = (
                    f"{exam_name.strip().lower()}|{int(exam_year)}|"
                    f"{(q.get('question_text') or '').strip().lower()}"
                    f"|{q.get('option_a','')}"
                    f"|{q.get('option_b','')}"
                    f"|{q.get('option_c','')}"
                    f"|{q.get('option_d','')}"
                )
            qhash = hashlib.sha256(hash_input.encode()).hexdigest()

            row = {
                "question_text": (q.get("question_text") or "").strip(),
                "option_a": (q.get("option_a") or "").strip(),
                "option_b": (q.get("option_b") or "").strip(),
                "option_c": (q.get("option_c") or "").strip(),
                "option_d": (q.get("option_d") or "").strip(),
                "correct_answer": (q.get("correct_answer") or "").upper()[:1],
                "subject": q.get("subject") or "General Knowledge",
                "topic": q.get("topic") or "General",
                "subtopic": q.get("subtopic"),
                "difficulty": q.get("difficulty") or "Medium",
                "question_type": q.get("question_type") or "MCQ",
                "concept": None,
                "exam_name": exam_name,
                "exam_year": exam_year,
                "source_pdf": source_pdf,
                "paper_id": resolved_paper_id,
                "question_hash": qhash,
                "question_number": q.get("question_number"),
                "is_active": True,
                "needs_review": q.get("needs_review", False) or not q.get("correct_answer"),
            }
            row = _merge_canonical_taxonomy(row, supported_cols)

            # Image question columns
            if q.get("has_image"):
                row["has_image"] = True
            if q.get("image_url"):
                row["image_url"] = q["image_url"]

            # CBT / shift-specific optional columns — only set if present in question dict
            for _col in ("shift_label", "test_date", "test_time",
                         "exam_section", "passage"):
                if _col in q and q[_col] is not None:
                    row[_col] = q[_col]

            if not row["question_text"] or len(row["question_text"]) < 5:
                skipped += 1
                continue
            if len(row["question_text"]) < 15:
                row["needs_review"] = True  # Short text — flag instead of silently dropping
            if row["correct_answer"] not in ("A", "B", "C", "D"):
                row["needs_review"] = True
                row["correct_answer"] = "A"  # Last-resort safety: AI fill above should have caught this
            if row["difficulty"] not in ("Easy", "Medium", "Hard"):
                row["difficulty"] = "Medium"
            if not is_row_usable_for_recovery(row):
                row["needs_review"] = True

            blocked_publicly, reason = _is_publish_blocked(row, exam_name)
            if blocked_publicly:
                row["is_active"] = False
                row["needs_review"] = True
                blocked += 1
                qnum = row.get("question_number")
                blocked_qnums.append(f"{qnum if qnum is not None else '?'}:{reason}")

            row.update(derive_quality_fields(row))

            rows.append({k: v for k, v in row.items() if k in supported_cols})

        # Deduplicate within this batch by question_hash — Postgres upsert crashes if
        # two rows in the same batch share the same conflict key.
        seen_hashes: dict[str, dict] = {}
        for r in rows:
            seen_hashes[r["question_hash"]] = r
        rows = list(seen_hashes.values())

        if rows:
            # MANUAL LOCK — Prevent overwriting human-reviewed questions.
            # If needs_review is already False in the DB, we skip the upsert for that row.
            hashes = [r["question_hash"] for r in rows]
            try:
                existing = sb.table("questions").select("question_hash, needs_review, is_active, exam_name, exam_year").in_("question_hash", hashes).execute()
                existing_rows = existing.data or []
                # Protect ACTIVE + reviewed questions from the SAME exam only.
                # force_replace bypasses this: user explicitly chose to overwrite the exam.
                same_exam_protected = set() if force_replace else {
                    row["question_hash"] for row in existing_rows
                    if row.get("needs_review") is False and row.get("is_active") is True
                    and row.get("exam_name", "").strip() == exam_name
                    and int(row.get("exam_year") or 0) == int(exam_year)
                }
                # Any hash collision with a DIFFERENT exam — regardless of review status —
                # must be re-hashed. Without this, upsert would overwrite the other exam's
                # row and change its exam_name/exam_year to ours (cross-exam contamination).
                cross_exam_blocked = {
                    row["question_hash"] for row in existing_rows
                    if row.get("exam_name", "").strip() != exam_name
                    or int(row.get("exam_year") or 0) != int(exam_year)
                }

                if same_exam_protected:
                    _count_before = len(rows)
                    rows = [r for r in rows if r["question_hash"] not in same_exam_protected]
                    _locked = _count_before - len(rows)
                    if _locked > 0:
                        print(f"  🔒 Manual Lock: Preserved {_locked} already-reviewed questions from overwrite.")

                # Re-hash cross-exam blocked questions so they are stored as independent
                # rows under the current exam without touching the other exam's row.
                if cross_exam_blocked:
                    remapped = 0
                    for r in rows:
                        if r["question_hash"] in cross_exam_blocked:
                            scoped_input = (
                                f"{exam_name.strip().lower()}"
                                f"|{int(exam_year)}"
                                f"|{r['question_text'].strip().lower()}"
                                f"|{r.get('option_a','')}"
                                f"|{r.get('option_b','')}"
                                f"|{r.get('option_c','')}"
                                f"|{r.get('option_d','')}"
                            )
                            r["question_hash"] = hashlib.sha256(scoped_input.encode()).hexdigest()
                            remapped += 1
                    if remapped:
                        print(f"  🔄 Re-hashed {remapped} questions shared with another exam (cross-exam insert).")

                if rows:
                    # Hard guard: every row must land in the intended exam.
                    # If anything upstream corrupted exam_name/exam_year, catch it here.
                    bad = [
                        r for r in rows
                        if r.get("exam_name", "").strip() != exam_name
                        or int(r.get("exam_year") or 0) != int(exam_year)
                    ]
                    if bad:
                        raise RuntimeError(
                            f"Exam isolation violated: {len(bad)} row(s) have wrong "
                            f"exam_name/exam_year before insert "
                            f"(expected '{exam_name}' {exam_year}, "
                            f"got {[(b.get('exam_name'), b.get('exam_year')) for b in bad[:3]]})"
                        )
                    result = sb.table("questions").upsert(rows, on_conflict="question_hash").execute()
                    inserted += len(result.data) if result.data else len(rows)
            except Exception as e:
                errors.append(f"Batch {i//50+1}: {e}")
                skipped += len(rows)

    if blocked:
        preview = ", ".join(blocked_qnums[:12])
        suffix = "..." if len(blocked_qnums) > 12 else ""
        print(f"  🚫 Blocked {blocked} question(s) from public publish: {preview}{suffix}")

    # ── Post-store activation pass ─────────────────────────────────────────────
    # Catch any question that has valid content but is stuck as is_active=False
    # due to manual-lock races or upsert edge cases.
    # Only activates questions from the CURRENT pipeline run (structural_status
    # is not None, meaning derive_quality_fields ran on them). Old stale rows
    # from pre-quality-fields pipeline (structural_status=None) are skipped so
    # a force_replace upload can't accidentally resurface old wrong-answer data.
    if inserted > 0:
        try:
            inactive_res = sb.table("questions").select(
                "id, question_text, option_a, option_b, option_c, option_d, "
                "correct_answer, question_number, question_type, has_image, image_url, "
                "topic, needs_review, exam_name, structural_status"
            ).eq("exam_name", exam_name).eq("exam_year", exam_year).eq("is_active", False).execute()
            inactive_qs = inactive_res.data or []
            activated = 0
            for iq in inactive_qs:
                if iq.get("needs_review"):
                    continue
                # Skip old pre-quality-fields rows — they may have wrong answers
                if iq.get("structural_status") is None:
                    continue
                text = (iq.get("question_text") or "").strip()
                if not text or len(text) < 15:
                    continue
                opts = [iq.get("option_a",""), iq.get("option_b",""), iq.get("option_c",""), iq.get("option_d","")]
                if sum(1 for o in opts if o and str(o).strip()) < 4:
                    continue
                if (iq.get("correct_answer") or "").strip().upper() not in ("A","B","C","D"):
                    continue
                is_blocked, _ = _is_publish_blocked(iq, exam_name)
                if not is_blocked:
                    try:
                        sb.table("questions").update({"is_active": True}).eq("id", iq["id"]).execute()
                        activated += 1
                    except Exception:
                        pass
            if activated:
                print(f"  ✅ Post-store activation: activated {activated} question(s) with valid content")
        except Exception as _act_err:
            print(f"  ⚠️ Post-store activation failed (non-fatal): {_act_err}")

    if resolved_paper_id:
        sync_paper_question_counts(resolved_paper_id, sb=sb)

    return {
        "inserted": inserted,
        "skipped": skipped,
        "blocked": blocked,
        "blocked_qnums": blocked_qnums,
        "errors": errors,
        "paper_id": resolved_paper_id,
        "source_filename": source_filename_from_path(source_pdf),
    }


# ══════════════════════════════════════════════════════════════════════════════
# STEP 5 — BULK EXPLANATION GENERATION  (one-time, ~₹0.22 per 150 questions)
# Batches 30 questions per call. Skips any question that already has one.
# After this runs once, every user gets explanations for free from the DB.
# ══════════════════════════════════════════════════════════════════════════════

EXPL_BATCH_SIZE = 5

EXPL_PROMPT_TEMPLATE = """You are an expert tutor and subject matter authority for Indian government exams (UPSC, CDS, SSC, etc.).

For each question below:
1. "logic_steps": Internal reasoning in 2-4 brief steps to derive the true answer.
2. "detected_answer": Your independently calculated correct option (A/B/C/D). Validate the provided 'Correct Answer' — if wrong or missing, put the correct letter here.
3. "explanation": A clear 2-3 sentence explanation written for the student.
   CRITICAL RULE: The explanation MUST be consistent with the 'Correct Answer' printed in the question.
   Start with: "The correct answer is [Correct Answer letter]: [option text]."
   Explain WHY that option is correct using facts or reasoning.
   If you believe the stored answer is wrong, still explain it from the stored answer's perspective,
   then append exactly: [FLAG: verify answer] at the very end of the explanation field.
4. "cleaned_question": If the question text or options have OCR/formatting errors, provide a corrected version. Otherwise copy the original.

Format strictly as a JSON array:
[{{
  "id": 1,
  "logic_steps": "Step 1... Step 2... Conclusion",
  "detected_answer": "A",
  "explanation": "The correct answer is A: [option text]. This is because...",
  "cleaned_question": "..."
}}]

Return ONLY a JSON array, no markdown fences.
Keep each field concise so the full response remains valid JSON.

Questions:
{questions_text}
"""

VERIFIED_EXPL_PROMPT_TEMPLATE = """You are an expert tutor and subject matter authority for Indian government exams (UPSC, CDS, SSC, etc.).

Each question below already has a VERIFIED correct answer from the database.
Do NOT independently change, challenge, or recompute the answer letter.
Your job is only to explain why the STORED correct answer is right.

For each question below:
1. "logic_steps": 2-4 brief steps that justify why the stored correct option is right.
2. "detected_answer": Copy the provided 'Correct Answer' exactly.
3. "explanation": A clear 2-3 sentence explanation written for the student.
   CRITICAL RULES:
   - Start with: "The correct answer is [Correct Answer letter]: [option text]."
   - The explanation MUST support that exact stored option.
   - Do NOT mention another option as correct.
   - Do NOT append "[FLAG: verify answer]".
4. "cleaned_question": If the question text or options have OCR/formatting errors, provide a corrected version. Otherwise copy the original.

Format strictly as a JSON array:
[{{
  "id": 1,
  "logic_steps": "Step 1... Step 2... Conclusion",
  "detected_answer": "A",
  "explanation": "The correct answer is A: [option text]. This is because...",
  "cleaned_question": "..."
}}]

Return ONLY a JSON array, no markdown fences.
Keep each field concise so the full response remains valid JSON.

Questions:
{questions_text}
"""


def _explanation_contradicts_answer(explanation: str, correct_answer: str) -> bool:
    """
    Return True if the explanation text asserts a DIFFERENT option than correct_answer.
    Catches patterns like "Option B is correct" when correct_answer is "A".
    """
    if not explanation or not correct_answer:
        return False
    stored = correct_answer.strip().upper()
    wrong = [opt for opt in ("A", "B", "C", "D") if opt != stored]
    for w in wrong:
        if re.search(
            rf'\b(?:option\s+)?{w}\s+is\s+(?:the\s+)?(?:correct|right|answer)\b'
            rf'|\bcorrect\s+answer\s+is\s+{w}\b'
            rf'|\banswer\s+is\s+{w}\b',
            explanation,
            re.IGNORECASE,
        ):
            return True
    return False


def _explanation_is_flagged_unreliable(explanation: str) -> bool:
    text = (explanation or "").strip()
    if not text:
        return False
    return "[FLAG: verify answer]" in text


def retag_exam(exam_name: str, exam_year: int) -> dict:
    """
    Re-run subject/topic tagging for all questions in an exam+year and update the DB.
    Use when questions were stored with wrong/default tags (e.g. all 'General Knowledge').
    Cost: ~₹0.20 per 150 questions (cached after first run).
    """
    sb = get_supabase()
    exam_name = exam_name.strip()

    print(f"\n🏷️  Retagging {exam_name} ({exam_year})...")
    qs_res = sb.table("questions").select(
        "id, question_text, option_a, option_b, option_c, option_d, question_type, subject"
    ).eq("exam_name", exam_name).eq("exam_year", exam_year).eq("is_active", True).execute()
    all_qs = qs_res.data or []

    if not all_qs:
        print("  ❌ No questions found.")
        return {"updated": 0}

    print(f"  Found {len(all_qs)} questions — running tagging...")

    tracker = CostTracker()

    # Build minimal question dicts that tag_questions expects
    tag_input = [{
        "question_text": q["question_text"],
        "option_a": q.get("option_a"),
        "option_b": q.get("option_b"),
        "option_c": q.get("option_c"),
        "option_d": q.get("option_d"),
        "question_type": q.get("question_type"),
        "id_db": q["id"],
    } for q in all_qs]
    tagged = tag_questions(tag_input, exam_name, tracker=tracker)

    # Update DB in batches of 50
    updated = 0
    failed_ids: list[str] = []
    for i in range(0, len(tagged), 50):
        batch = tagged[i:i+50]
        for q in batch:
            try:
                current_res = sb.table("questions").select("*").eq("id", q["id_db"]).single().execute()
                current = current_res.data or {"id": q["id_db"], "is_active": True}
                subj = q.get("subject") or "General Knowledge"
                raw_topic = q.get("topic") or "General"
                patch = {
                    "subject": subj,
                    "topic": _normalize_topic(subj, raw_topic),
                    "subtopic": q.get("subtopic"),
                    "difficulty": q.get("difficulty") or "Medium",
                }
                patch = _merge_canonical_taxonomy(patch, _question_supported_columns(sb))
                merged = merge_quality_fields(
                    current,
                    patch,
                    explanation_present=current.get("explanation_status") == "generated",
                    explanation_contradiction=current.get("explanation_status") == "contradiction",
                )
                payload = _quality_update_payload(patch, merged, _question_supported_columns(sb))
                sb.table("questions").update(payload).eq("id", q["id_db"]).execute()
                updated += 1
            except Exception as e:
                print(f"    ⚠️  Failed to update {q['id_db']}: {e}")
                failed_ids.append(q["id_db"])

    tracker.print_summary()
    tracker.save_log(f"{exam_name} (retag)", exam_year, len(all_qs))

    print(f"  ✅ Updated tags for {updated}/{len(all_qs)} questions"
          + (f" | ❌ {len(failed_ids)} failed" if failed_ids else ""))
    return {"updated": updated, "total": len(all_qs), "failed_ids": failed_ids}


def retag_all_exams() -> dict:
    """
    Re-run subject/topic tagging for every active (exam_name, exam_year) pair in the DB.
    Expensive on first run; subsequent runs are free (cache hits).
    """
    sb = get_supabase()
    res = sb.table("questions").select("exam_name, exam_year").eq("is_active", True).execute()
    pairs: set[tuple[str, int]] = {
        (row["exam_name"], row["exam_year"])
        for row in (res.data or [])
        if row.get("exam_name") and row.get("exam_year")
    }
    print(f"\n🏷️  Retagging {len(pairs)} distinct exam+year pairs...")
    results: list[dict] = []
    for exam_name, exam_year in sorted(pairs):
        try:
            r = retag_exam(exam_name, exam_year)
            results.append({"exam": exam_name, "year": exam_year, **r})
        except Exception as e:
            print(f"  ⚠️  {exam_name} {exam_year}: {e}")
            results.append({"exam": exam_name, "year": exam_year, "error": str(e)})
    total = sum(r.get("updated", 0) for r in results)
    print(f"\n✅ Retag-all complete — {total} questions updated across {len(pairs)} exams")
    return {"exams_processed": len(pairs), "total_updated": total, "details": results}


def normalize_subject_taxonomy() -> dict:
    """
    One-shot migration: rename legacy subject/topic values in the DB to match
    the v7 taxonomy (e.g. 'General Science' → 'Science & Technology').
    Safe to run multiple times (idempotent).
    """
    sb = get_supabase()
    SUBJECT_REMAP: dict[str, str] = {
        "General Science":   "Science & Technology",
        "Environment":       "Environment & Ecology",
        "Mental Ability":    "Logical Reasoning",
    }
    total_updated = 0
    for old_subj, new_subj in SUBJECT_REMAP.items():
        try:
            res = sb.table("questions").update({"subject": new_subj}).eq("subject", old_subj).eq("is_active", True).execute()
            count = len(res.data) if res.data else 0
            if count:
                print(f"  ✅ Renamed '{old_subj}' → '{new_subj}' for {count} questions")
            total_updated += count
        except Exception as e:
            print(f"  ⚠️  Failed remapping '{old_subj}': {e}")
    print(f"  Taxonomy normalization complete — {total_updated} rows updated")
    return {"updated": total_updated}


# ══════════════════════════════════════════════════════════════════════════════
# ANSWER VALIDATION  (best model, no answer key required)
# ══════════════════════════════════════════════════════════════════════════════

_ANSWER_VALIDATION_PROMPT = """You are an expert in Indian government competitive exams (UPSC, SSC, CAPF, State PSC).

For each question below, determine the CORRECT answer (A, B, C, or D) using your factual knowledge.
Think carefully. Use elimination when unsure.

Return ONLY a JSON array — no markdown, no commentary.
Schema: [{{"q_num": 1, "answer": "B", "confidence": "high|medium|low"}}]

Questions:
{questions_text}"""


def validate_answers_bulk(exam_name: str, exam_year: int) -> dict:
    """
    Use gemini-2.5-flash (best model) to determine the correct answer for every question
    that has needs_review=True (AI-guessed or missing answers).

    - Questions with needs_review=False (came from a real answer key) are NOT touched.
    - Uses BEST_MODEL for high accuracy — costs more but runs once.
    - Batch size 20; retries up to 5 times with backoff on rate limits.

    Returns: {"validated": N, "skipped": N, "errors": N}
    """
    sb = get_supabase()
    exam_name = exam_name.strip()

    qs_res = sb.table("questions").select(
        "id, question_number, question_text, option_a, option_b, option_c, option_d, correct_answer, needs_review"
    ).eq("exam_name", exam_name).eq("exam_year", exam_year).eq("is_active", True).execute()
    all_qs = qs_res.data or []

    # Only validate questions where we don't trust the answer
    pending = [q for q in all_qs if q.get("needs_review") is True]

    if not pending:
        print(f"  ✅ All {len(all_qs)} answers already verified — nothing to validate")
        return {"validated": 0, "skipped": len(all_qs), "errors": 0}

    print(f"\n🔍 Validating answers for {len(pending)} questions in {exam_name} {exam_year} "
          f"(using {BEST_MODEL})...")

    BATCH = 20
    batches = [pending[i:i+BATCH] for i in range(0, len(pending), BATCH)]
    validated = 0
    errors = 0

    for batch_num, batch in enumerate(batches, 1):
        print(f"  🧠 Batch {batch_num}/{len(batches)}: validating {len(batch)} answers...")

        qs_text = "\n\n".join(
            f"Q{i+1} (DB Q#{q.get('question_number', '?')}):\n"
            f"{q['question_text'][:400]}\n"
            f"A) {q.get('option_a','')[:120]}\n"
            f"B) {q.get('option_b','')[:120]}\n"
            f"C) {q.get('option_c','')[:120]}\n"
            f"D) {q.get('option_d','')[:120]}"
            for i, q in enumerate(batch)
        )
        prompt = _ANSWER_VALIDATION_PROMPT.format(questions_text=qs_text)

        result = None
        for attempt in range(5):
            try:
                resp = _CLIENT.models.generate_content(
                    model=BEST_MODEL,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.1,
                        max_output_tokens=2048,
                        thinking_config=types.ThinkingConfig(thinking_budget=0),
                    ),
                )
                raw = (resp.text or "").strip()
                if raw.startswith("```"):
                    raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
                result = json.loads(raw)
                if isinstance(result, list):
                    break
                result = None
            except json.JSONDecodeError:
                print(f"    ⚠️  JSON error attempt {attempt+1}, retrying...")
                time.sleep(3)
            except Exception as e:
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    wait = 60 * (attempt + 1)
                    print(f"    ⏳ Rate limited, waiting {wait}s...")
                    time.sleep(wait)
                else:
                    print(f"    ❌ API error: {e}")
                    break

        if not result:
            errors += len(batch)
            continue

        # Map by position (id = 1-indexed position in batch)
        answer_map = {item.get("q_num", i+1): item for i, item in enumerate(result)}

        batch_validated = 0
        for i, q in enumerate(batch):
            item = answer_map.get(i + 1, {})
            new_answer = str(item.get("answer") or "").strip().upper()[:1]
            confidence = str(item.get("confidence") or "low").lower()

            if new_answer not in ("A", "B", "C", "D"):
                continue

            # Only mark needs_review=False for high/medium confidence
            still_needs_review = confidence == "low"

            try:
                patch = {
                    "correct_answer": new_answer,
                    "needs_review": still_needs_review,
                    "explanation_status": "stale" if q.get("correct_answer", "").upper() != new_answer else q.get("explanation_status", "missing"),
                }
                quality_updates = merge_quality_fields(
                    q,
                    patch,
                    explanation_present=patch["explanation_status"] == "generated",
                    explanation_contradiction=False,
                )
                payload = _quality_update_payload(patch, quality_updates, _question_supported_columns(sb))
                sb.table("questions").update(payload).eq("id", q["id"]).execute()
                batch_validated += 1
                old = q.get("correct_answer", "?")
                changed = "✓" if old != new_answer else "="
                print(f"    Q{q.get('question_number','?')}: {old}→{new_answer} [{confidence}] {changed}")
            except Exception as e:
                print(f"    ❌ DB update failed for Q{q.get('question_number','?')}: {e}")

        validated += batch_validated
        print(f"    ✅ Batch {batch_num}: validated {batch_validated}/{len(batch)}")

        if batch_num < len(batches):
            time.sleep(2)

    print(f"\n✅ Answer validation done: {validated} updated, {errors} failed, "
          f"{len(all_qs) - len(pending)} already trusted")
    return {"validated": validated, "skipped": len(all_qs) - len(pending), "errors": errors}


def _record_ai_repair_proposals(question_id: str, current_q: dict, ai_item: dict, sb=None) -> int:
    """
    Phase 3 behavior: explanation generation is read-only by default.
    Any AI-detected correction is stored as an auditable proposal instead of
    rewriting canonical question data.
    """
    if not sb:
        sb = get_supabase()
    return record_ai_repair_proposals(question_id, current_q, ai_item, sb=sb)


def generate_explanations_bulk(exam_name: str, exam_year: int, job_id: Optional[str] = None, tracker: "CostTracker | None" = None) -> dict:
    """
    Generate explanations for all questions in this exam+year that don't have one yet.
    Called once after store_questions. All future users read from DB at ₹0.

    Cost: ~₹0.22 per 150 questions (batched, flash-8b, one-time only).
    """
    sb = get_supabase()

    # Fetch questions that have no explanation yet
    try:
        qs_res = sb.table("questions").select(
            "id, question_text, option_a, option_b, option_c, option_d, correct_answer, needs_review"
        ).eq("exam_name", exam_name).eq("exam_year", exam_year).eq("is_active", True).execute()
        all_qs = qs_res.data or []
    except Exception as e:
        print(f"  ❌ Could not fetch questions: {e}")
        return {"generated": 0, "skipped": 0}

    if not all_qs:
        print("  ℹ️  No questions found for this exam+year")
        return {"generated": 0, "skipped": 0}

    # Find which ones already have explanations
    try:
        ids = [q["id"] for q in all_qs]
        # Supabase IN filter — fetch existing explanation question_ids
        existing_res = sb.table("explanations").select("question_id").in_("question_id", ids).execute()
        existing_ids = {row["question_id"] for row in (existing_res.data or [])}
    except Exception:
        existing_ids = set()

    valid_answer = {"A", "B", "C", "D"}
    eligible = [
        q for q in all_qs
        if str(q.get("correct_answer") or "").strip().upper() in valid_answer
        and not bool(q.get("needs_review"))
    ]
    pending = [q for q in eligible if q["id"] not in existing_ids]
    skipped_unverified = len(all_qs) - len(eligible)

    if not pending:
        if skipped_unverified:
            print(
                f"  ℹ️  No explanation generation performed — "
                f"{skipped_unverified} question(s) are still unverified or missing valid answers"
            )
        else:
            print(f"  ✅ All {len(all_qs)} eligible questions already have explanations")
        return {"generated": 0, "skipped": len(existing_ids), "skipped_unverified": skipped_unverified}

    print(f"  📝 Generating explanations for {len(pending)} questions "
          f"({len(existing_ids)} already exist, {skipped_unverified} skipped as unverified)...")

    batches = [pending[i:i+EXPL_BATCH_SIZE] for i in range(0, len(pending), EXPL_BATCH_SIZE)]
    generated: int = 0
    errors: int = 0

    for batch_num, batch in enumerate(batches, 1):
        # Build question text: include question + correct answer so AI knows what to explain
        qs_text = "\n\n".join(
            f"{i+1}. {q['question_text'][:300]}\n"
            f"   A) {q.get('option_a','')[:100]}  B) {q.get('option_b','')[:100]}\n"
            f"   C) {q.get('option_c','')[:100]}  D) {q.get('option_d','')[:100]}\n"
            f"   Correct Answer: {q.get('correct_answer','A')}"
            for i, q in enumerate(batch)
        )
        prompt = VERIFIED_EXPL_PROMPT_TEMPLATE.format(questions_text=qs_text)

        # Cache key so re-runs don't re-spend
        cache_key = "expl_" + hashlib.md5(qs_text[:300].encode()).hexdigest()
        explanations = _load_cache(cache_key)

        if explanations:
            print(f"  📦 Batch {batch_num}/{len(batches)}: cache hit (₹0)")
        else:
            print(f"  🧠 Batch {batch_num}/{len(batches)}: generating...")
            explanations = _call_explanation_api(prompt, len(batch), tracker)
            if explanations:
                _save_cache(cache_key, explanations)
            if batch_num < len(batches):
                time.sleep(1)

        if not explanations:
            # Batch failed — fall back to one question at a time
            print(f"    ↩️  Batch {batch_num} failed, retrying {len(batch)} questions individually...")
            explanations = []
            for qi, single_q in enumerate(batch):
                item = _call_explanation_api_single(single_q, tracker)
                if item:
                    item["id"] = qi + 1
                    explanations.append(item)
                    print(f"      ✅ Q{qi+1} recovered individually")
                else:
                    errors += 1
                    print(f"      ❌ Q{qi+1} failed even individually")
                time.sleep(1)

        if not explanations:
            continue

        items_any: Any = explanations
        rows = []
        proposal_qids: set[str] = set()

        for i, q_any in enumerate(batch):
            q: Any = q_any
            # Find the corresponding item in the explanations response
            item: Any = next((it for it in items_any if it.get("id") == i + 1), {})
            
            text = str(item.get("explanation") or "").strip()
            if text and len(text) > 10:
                # Flag if the explanation text contradicts the stored correct answer
                stored_ans = q.get("correct_answer") or ""
                if stored_ans and _explanation_contradicts_answer(text, stored_ans):
                    print(f"    ⚠️  Explanation for Q{q['id'][:8]} contradicts stored answer "
                          f"({stored_ans}) — flagging for review")
                    proposal_qids.add(q["id"])
                rows.append({
                    "question_id": q["id"],
                    "explanation": text,
                    "source": f"{short_model_name(BEST_MODEL)}-cot",
                })

            # Phase 3: record repair proposals instead of mutating questions
            proposal_count = _record_ai_repair_proposals(q["id"], q, item, sb)
            if proposal_count:
                proposal_qids.add(q["id"])

        if rows:
            try:
                sb.table("explanations").upsert(rows, on_conflict="question_id").execute()
                question_ids = [row["question_id"] for row in rows]
                clean_ids = [qid for qid in question_ids if qid not in proposal_qids]
                if clean_ids:
                    for qid in clean_ids:
                        qr = sb.table("questions").select("*").eq("id", qid).single().execute()
                        current = qr.data or {"id": qid, "is_active": True}
                        merged = merge_quality_fields(current, {"explanation_status": "generated"}, explanation_present=True)
                        payload = _quality_update_payload({"explanation_status": "generated"}, merged, _question_supported_columns(sb))
                        sb.table("questions").update(payload).eq("id", qid).execute()
                if proposal_qids:
                    for qid in proposal_qids:
                        qr = sb.table("questions").select("*").eq("id", qid).single().execute()
                        current = qr.data or {"id": qid, "is_active": True}
                        merged = merge_quality_fields(
                            current,
                            {"explanation_status": "stale"},
                            explanation_present=True,
                            explanation_contradiction=True,
                        )
                        payload = _quality_update_payload({"explanation_status": "stale"}, merged, _question_supported_columns(sb))
                        sb.table("questions").update(payload).eq("id", qid).execute()
                generated += len(rows)
            except Exception as e:
                print(f"    ❌ DB error on explanation batch {batch_num}: {e}")
                errors += len(rows)

        if job_id:
            progress = 92 + int(7 * (batch_num / len(batches)))
            try:
                sb.table("jobs").update({"progress": progress}).eq("id", job_id).execute()
            except Exception:
                pass

    print(f"  ✅ Explanations done: {generated} generated, {errors} failed, "
          f"{len(existing_ids)} already existed")
    return {
        "generated": generated,
        "skipped": len(existing_ids),
        "errors": errors,
        "skipped_unverified": skipped_unverified,
    }


def run_scanned_post_processing(
    exam_name: str,
    exam_year: int,
    job_id: Optional[str] = None,
    tracker: "CostTracker | None" = None,
) -> dict:
    """
    Post-upload repair pass for scanned papers.

    Scanned uploads are the least reliable path, so we immediately follow storage with:
    1. Retagging to replace fallback General/General Knowledge labels
    2. Answer validation for AI-only papers with no official key
    3. Explanation generation for admin review
    """
    sb = get_supabase() if job_id else None

    def _update_job(progress: Optional[int] = None, status: Optional[str] = None):
        if not sb or not job_id:
            return
        data: dict[str, Any] = {}
        if progress is not None:
            data["progress"] = progress
        if status:
            data["status"] = status
        if data:
            try:
                sb.table("jobs").update(data).eq("id", job_id).execute()
            except Exception:
                pass

    print("\nSTEP 4/6 — Retagging scanned-paper questions...")
    _update_job(progress=72, status="processing")
    retag = retag_exam(exam_name, exam_year)

    print("\nSTEP 5/6 — Validating answers for scanned-paper questions...")
    _update_job(progress=82, status="processing")
    validated = validate_answers_bulk(exam_name, exam_year)

    print("\nSTEP 6/6 — Generating explanations for scanned-paper questions...")
    _update_job(progress=92, status="processing")
    explanations = generate_explanations_bulk(exam_name, exam_year, job_id=job_id, tracker=tracker)

    return {
        "retag": retag,
        "validated_answers": validated,
        "explanations": explanations,
    }


def _extract_json_list(raw: Any) -> list | None:
    """Robustly extract a JSON array from a model response that may have surrounding text."""
    if not raw or not isinstance(raw, str):
        return None
    raw = raw.strip()
    # Strip markdown code fences
    if "```" in raw:
        raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
    # Try direct parse first
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            # Model wrapped the array: {"questions": [...]} or {"data": [...]}
            for v in data.values():
                if isinstance(v, list):
                    return v
    except json.JSONDecodeError:
        pass
    # Find the first '[' and last ']' and parse just that slice
    start = raw.find("[")
    end = raw.rfind("]")
    if start != -1 and end != -1 and end > start:
        try:
            data = json.loads(raw[start:end+1])
            if isinstance(data, list):
                return data
        except json.JSONDecodeError:
            pass
    return None


def _call_explanation_api(prompt: str, expected: int, tracker: "CostTracker | None" = None) -> list[dict]:
    """Call best model to generate explanations. Returns list or empty on failure.
    Uses BEST_MODEL (gemini-2.5-flash) for higher accuracy. Retries up to 5 times."""
    for attempt in range(5):
        try:
            resp = _CLIENT.models.generate_content(
                model=BEST_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.2,
                    max_output_tokens=16384,  # larger budget prevents JSON truncation
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )
            raw = (resp.text or "").strip()
            data = _extract_json_list(raw)
            if data is not None:
                if tracker:
                    try:
                        _m = resp.usage_metadata
                        tracker.record("Explanations", _m.prompt_token_count or 0, _m.candidates_token_count or 0)
                    except Exception:
                        pass
                return data
            print(f"    ⚠️  JSON error attempt {attempt+1}, retrying...")
            time.sleep(3)
        except Exception as e:
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e) or "quota" in str(e).lower():
                wait = 60 * (attempt + 1)
                print(f"    ⏳ Rate limited, waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"    ❌ API error: {e}")
                break
    return []


def _call_explanation_api_single(q: dict, tracker: "CostTracker | None" = None) -> dict | None:
    """Fallback: generate explanation for a single question. Used when batch JSON fails."""
    qs_text = (
        f"1. {q['question_text'][:500]}\n"
        f"   A) {q.get('option_a','')[:150]}  B) {q.get('option_b','')[:150]}\n"
        f"   C) {q.get('option_c','')[:150]}  D) {q.get('option_d','')[:150]}\n"
        f"   Correct Answer: {q.get('correct_answer','A')}"
    )
    prompt_template = (
        VERIFIED_EXPL_PROMPT_TEMPLATE
        if not bool(q.get("needs_review", False))
        else EXPL_PROMPT_TEMPLATE
    )
    prompt = prompt_template.format(questions_text=qs_text)
    result = _call_explanation_api(prompt, 1, tracker)
    return result[0] if result else None


def generate_single_explanation(question_id: str) -> dict | None:
    """
    Public entry point for lazy-loading a single explanation.
    Explanation generation is read-only with respect to canonical question truth:
    AI-detected corrections are recorded as repair proposals, not auto-applied.
    """
    sb = get_supabase()
    
    # 1. Fetch question details first
    try:
        qr = sb.table("questions").select("*").eq("id", question_id).single().execute()
        if not qr.data:
            return None
        q = qr.data
    except Exception:
        return None

    # 2. Check if explanation exists
    expl_data = None
    text_contradicts = False
    text_flagged = False
    try:
        r = sb.table("explanations").select("*").eq("question_id", question_id).limit(1).execute()
        if r.data:
            expl_data = r.data[0]
    except Exception:
        pass

    # If an old cached explanation is clearly stale, discard it and regenerate.
    if expl_data:
        existing_text = str(expl_data.get("explanation") or "").strip()
        existing_source = str(expl_data.get("source") or "")
        answer_now_verified = not bool(q.get("needs_review", False))
        stale_unverified = answer_now_verified and "unverified-answer" in existing_source
        stale_contradiction = bool(
            q.get("correct_answer") and _explanation_contradicts_answer(existing_text, q.get("correct_answer"))
        )
        stale_flagged = _explanation_is_flagged_unreliable(existing_text)
        if stale_unverified or stale_contradiction or stale_flagged:
            try:
                sb.table("explanations").delete().eq("question_id", question_id).execute()
                sb.table("questions").update({"explanation_status": "missing"}).eq("id", question_id).execute()
            except Exception:
                pass
            expl_data = None

    # 3. If missing, generate it using high-accuracy CoT
    if not expl_data:
        item = _call_explanation_api_single(q)
        if not item:
            return None

        proposal_count = _record_ai_repair_proposals(question_id, q, item, sb)

        expl_text = item.get("explanation", "")
        stored_ans = q.get("correct_answer") or ""
        text_contradicts = bool(
            stored_ans and _explanation_contradicts_answer(expl_text, stored_ans)
        )
        text_flagged = _explanation_is_flagged_unreliable(expl_text)
        if text_contradicts:
            print(f"      ⚠️  Single explanation for Q_{question_id[:8]} contradicts "
                  f"stored answer ({stored_ans}) — flagging as contradiction")
        if text_flagged:
            print(f"      ⚠️  Single explanation for Q_{question_id[:8]} contains verify-answer flag — hiding it")

        # Store explanation in DB
        source_label = f"{short_model_name(BEST_MODEL)}-cot"
        if q.get("needs_review", False):
            source_label = f"{source_label}-unverified-answer"

        expl_data = {
            "question_id": question_id,
            "explanation": expl_text,
            "source": source_label,
        }
        try:
            sb.table("explanations").upsert(expl_data, on_conflict="question_id").execute()
            merged_quality = merge_quality_fields(
                q,
                {"needs_review": q.get("needs_review", False)},
                explanation_present=True,
                explanation_contradiction=(proposal_count > 0) or text_contradicts or text_flagged,
            )
            payload = _quality_update_payload({}, merged_quality, _question_supported_columns(sb))
            sb.table("questions").update(payload).eq("id", question_id).execute()
        except Exception:
            pass
        
    # 4. Return combined truth (Explanation + potentially fixed metadata)
    source_value = expl_data.get("source", "")
    if q.get("needs_review", False) and source_value and "unverified-answer" not in source_value:
        source_value = f"{source_value}-unverified-answer"
    if text_contradicts or text_flagged:
        return {
            "question_id": question_id,
            "explanation": "",
            "source": "hidden-contradiction",
            "verified_answer": q.get("correct_answer"),
            "needs_review": q.get("needs_review")
        }
    return {
        "question_id": question_id,
        "explanation": expl_data.get("explanation", ""),
        "source": source_value,
        "verified_answer": q.get("correct_answer"),
        "needs_review": q.get("needs_review")
    }


# ══════════════════════════════════════════════════════════════════════════════
# COST ESTIMATOR — print before running
# ══════════════════════════════════════════════════════════════════════════════

def estimate_cost(num_questions: int) -> dict:
    """
    gemini-2.5-flash-lite pricing:
      Input:  $0.10 / 1M tokens
      Output: $0.40 / 1M tokens

    Tagging: ~60 tokens input (question text) + ~20 tokens output (tags)
    Explanations: ~200 tokens input + ~80 tokens output per question
    """
    batches = (num_questions + TAG_BATCH_SIZE - 1) // TAG_BATCH_SIZE
    # Tagging
    tag_in  = batches * 300 + num_questions * 60
    tag_out = num_questions * 20
    # Explanations
    expl_in  = num_questions * 200
    expl_out = num_questions * 80

    input_tokens  = tag_in  + expl_in
    output_tokens = tag_out + expl_out

    cost_usd = (input_tokens  / 1_000_000 * _INPUT_PRICE_PER_1M +
                output_tokens / 1_000_000 * _OUTPUT_PRICE_PER_1M)
    cost_inr = cost_usd * USD_TO_INR

    return {
        "questions": num_questions,
        "api_batches": batches,
        "estimated_input_tokens": input_tokens,
        "estimated_output_tokens": output_tokens,
        "estimated_cost_usd": cost_usd,
        "estimated_cost_inr": cost_inr,
        "model": "gemini-2.0-flash-lite",
        "note": "Re-runs of same PDF cost ₹0 (fully cached)"
    }


def _targeted_vision_recovery(
    pdf_path: str,
    missing: list[int],
    pages_meta: list[tuple[int, str]],
    tracker: "CostTracker | None" = None,
    page_nums: Optional[list[set[int]]] = None,
) -> list[dict]:
    """Call Vision only on pages that contain missing question numbers.

    Strategy:
      1. Scan each extracted page text for question numbers it contains.
      2. For each missing question number, find the page whose question range
         brackets it (prev_found ≤ missing ≤ next_found).
      3. Deduplicate pages, send each to Vision, parse results.

    Cost: typically 2–10 pages = ~₹0.05–0.20 vs ₹3–6 for full Vision.
    """
    # Build page → set-of-question-numbers mapping from extracted text
    if page_nums is None:
        _qn_pat = re.compile(r'(?:^|\n)\s*(?:Q\.?\s*)?(\d{1,3})[.)]\s+\S', re.MULTILINE)
        page_nums = []
        for _, page_text in pages_meta:
            nums = {int(m.group(1)) for m in _qn_pat.finditer(page_text)}
            page_nums.append(nums)

    # For each missing question number, identify the PDF page index to scan.
    target_page_indices: set[int] = set()
    for mq in missing:
        for pi, (pdf_idx, _) in enumerate(pages_meta):
            nums = page_nums[pi] if page_nums and pi < len(page_nums) else set()
            if not nums: continue
            lo, hi = min(nums), max(nums)
            if lo <= mq <= hi:
                target_page_indices.add(pi)
                break
            # Close match (within 2) — question might span page boundary
            if abs(mq - lo) <= 2 or abs(mq - hi) <= 2:
                target_page_indices.add(pi)

    # Scanned-PDF fallback: text extraction returns nothing so page_nums are all
    # empty sets — the loop above finds zero target pages and recovery silently
    # does nothing. Use proportional estimation instead: question N is
    # approximately at page round((N-1) / max_q * n_pages).
    if not target_page_indices and missing:
        n_pages = len(pages_meta)
        max_q = max(missing)
        for mq in missing:
            est = round((mq - 1) / max(max_q, 1) * max(n_pages - 1, 1))
            for p in range(max(0, est - 1), min(n_pages, est + 3)):
                target_page_indices.add(p)
        print(f"    ⚠️  Scanned PDF — no text page map. Using proportional page estimates for {len(missing)} questions across {n_pages} pages.")

    if not target_page_indices:
        return []

    print(f"    🎯 Targeting {len(target_page_indices)} page(s) for Vision recovery")
    _vision_model = EXTRACTION_REPAIR_MODEL or EXTRACTION_MODEL
    doc = fitz.open(pdf_path)
    all_pages = list(doc)
    recovered: list[dict] = []
    missing_set = set(missing)

    # Map extracted-text page index → PDF page index.
    total_pdf_pages = len(all_pages)
    total_ext_pages = max(len(pages_meta), 1)

    missing_set = set(missing)

    for meta_idx in sorted(target_page_indices):
        pdf_idx, _ = pages_meta[meta_idx]
        pg_a = all_pages[pdf_idx]
        pg_b = all_pages[pdf_idx + 1] if pdf_idx + 1 < len(all_pages) else None
        imgs = [PILImage.open(_io.BytesIO(pg_a.get_pixmap(dpi=200).tobytes("png")))]
        if pg_b:
            imgs.append(PILImage.open(_io.BytesIO(pg_b.get_pixmap(dpi=200).tobytes("png"))))

        # Identify which missing Q numbers are expected on this page
        page_missing = sorted(
            mq for mq in missing_set
            if page_nums and meta_idx < len(page_nums) and page_nums[meta_idx] and 
            (min(page_nums[meta_idx]) - 3) <= mq <= (max(page_nums[meta_idx]) + 3)
        )
        if not page_missing: continue

        # Split into chunks of 5 to avoid 16384-token truncation on dense pages
        chunks = [page_missing[i:i+5] for i in range(0, max(len(page_missing), 1), 5)] if page_missing else [[]]

        page_qs: list[dict] = []
        page_safety_blocked = False

        for chunk in chunks:
            if page_safety_blocked:
                break  # skip remaining chunks — whole page is blocked

            # Use a targeted prompt listing specific Q numbers — produces shorter output, avoids truncation
            if chunk:
                targeted_prompt = (
                    _VISION_STRUCT_PROMPT
                    + f"\n\nIMPORTANT: Extract ONLY these question numbers: {chunk}. "
                    "Do NOT include any other questions. Output a JSON array with only these questions. "
                    "If any target is a 'Match the following' question, return the FULL question stem and the left/right column statements, "
                    "not just the answer-code combinations. "
                    "If the page is bilingual or regional-language, extract ONLY the English version of the target question. "
                    "If the target question spills onto the next page, combine both pages and return one complete question object."
                )
            else:
                targeted_prompt = _VISION_STRUCT_PROMPT

            vision_ok = False
            for attempt in range(2):
                try:
                    resp = _CLIENT.models.generate_content(
                        model=_vision_model,
                        contents=[targeted_prompt] + imgs,
                        config=types.GenerateContentConfig(
                            temperature=0.1,
                            max_output_tokens=8192,
                            thinking_config=types.ThinkingConfig(thinking_budget=0),
                            safety_settings=[
                                types.SafetySetting(category="HARM_CATEGORY_HARASSMENT",        threshold="BLOCK_NONE"),
                                types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH",       threshold="BLOCK_NONE"),
                                types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
                                types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
                            ],
                        ),
                    )
                    if tracker:
                        try:
                            _m = resp.usage_metadata
                            tracker.record(
                                f"Targeted Vision p{pdf_idx+1}",
                                _m.prompt_token_count or 0,
                                _m.candidates_token_count or 0,
                            )
                        except Exception:
                            pass
                    chunk_qs = _parse_vision_json(resp.text or "")
                    page_qs.extend(chunk_qs)
                    vision_ok = True
                    break
                except Exception as e:
                    err_str = str(e)
                    is_safety_block = "no valid `Part`" in err_str or "safety_ratings" in err_str or "SAFETY" in err_str
                    if is_safety_block:
                        # Whole page is safety-blocked — no point retrying any chunk
                        print(f"    🚫 Page {pdf_idx+1} safety-blocked — falling back to OCR")
                        page_safety_blocked = True
                        break
                    if attempt == 0:
                        time.sleep(2)
                    else:
                        print(f"    ⚠️  Vision failed for page {pdf_idx+1}: {e}")

        # OCR fallback for safety-blocked pages
        if page_safety_blocked:
            try:
                ocr_qs: list[dict] = []
                # Re-render at 400 DPI for better OCR than the default 200 DPI used above
                hd_pix = all_pages[pdf_idx].get_pixmap(dpi=400)
                hd_img = PILImage.open(_io.BytesIO(hd_pix.tobytes("png")))
                raw = pytesseract.image_to_string(hd_img, lang='eng', config='--psm 6')
                # parse_questions_local is defined in this same file
                parsed = parse_questions_local([raw])
                for q in parsed:
                    if q.get("question_number") in missing_set and len((q.get("question_text") or "").strip()) >= 10:
                        ocr_qs.append(q)
                if ocr_qs:
                    page_qs.extend(ocr_qs)
                    print(f"    📄 PDF page {pdf_idx+1} (OCR fallback): {len(ocr_qs)} recovered")
                else:
                    print(f"    📄 PDF page {pdf_idx+1}: 0 recovered (safety-blocked, OCR empty)")
            except Exception as ocr_err:
                print(f"    📄 PDF page {pdf_idx+1}: 0 recovered (safety-blocked, OCR error: {ocr_err})")

        found_targeted = sum(1 for q in page_qs if q["question_number"] in missing_set)
        for q in page_qs:
            if q["question_number"] in missing_set:
                recovered.append(q)
        print(f"    📄 PDF page {pdf_idx+1}: {len(page_qs)} found, {found_targeted} targeted")
        time.sleep(0.3)

    doc.close()

    # Deduplicate recovered by question_number — keep most complete
    seen: dict[int, dict] = {}
    for q in recovered:
        n = q["question_number"]
        if n not in seen:
            seen[n] = q
        else:
            old_opts = sum(1 for k in ("option_a","option_b","option_c","option_d") if seen[n].get(k))
            new_opts = sum(1 for k in ("option_a","option_b","option_c","option_d") if q.get(k))
            if new_opts > old_opts:
                seen[n] = q

    print(f"    ✅ Recovered {len(seen)} previously missing questions via targeted Vision")
    return list(seen.values())


def repair_structurally_broken_rows(
    pdf_path: str,
    exam_name: str,
    exam_year: int,
    *,
    paper_id: str | None = None,
    job_id: str | None = None,
    tracker: "CostTracker | None" = None,
    vision_page_nums: list[set[int]] | None = None,
) -> dict[str, Any]:
    """
    Post-store repair pass for rows that have a valid question number but were still
    stored as structurally broken / image-dependent after extraction.

    vision_page_nums: optional page→question-number map already built by the
    vision extractor. When provided it is passed directly to _targeted_vision_recovery
    so the scanned-PDF proportional-estimate fallback works off this map instead of
    re-deriving it from (empty) text extraction.
    """
    sb = get_supabase()
    current_paper_id = paper_id
    if job_id:
        try:
            from papers import paper_id_for_job
            current_paper_id = paper_id_for_job(job_id, sb=sb)
        except Exception:
            current_paper_id = None
    if not current_paper_id:
        current_paper_id = resolve_paper_id(exam_name=exam_name, exam_year=exam_year, sb=sb)

    if not current_paper_id or not pdf_path or not os.path.exists(pdf_path):
        return {"targeted": 0, "recovered": 0, "unresolved": []}

    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            sb.table("questions")
            .select(
                "id, paper_id, question_number, question_text, option_a, option_b, option_c, option_d, "
                "correct_answer, question_type, has_image, image_url, structural_status, public_visibility, needs_review, is_active"
            )
            .eq("paper_id", current_paper_id)
            .range(offset, offset + 999)
            .execute()
            .data
            or []
        )
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    target_numbers = sorted({
        int(row["question_number"])
        for row in rows
        if isinstance(row.get("question_number"), int)
        and (
            str(row.get("structural_status") or "") == "broken"
            or str(row.get("public_visibility") or "") == "hidden_structural"
            or row.get("is_active") is False
        )
    })
    if not target_numbers:
        return {"targeted": 0, "recovered": 0, "unresolved": []}

    is_upsc = "upsc" in exam_name.lower()
    pages = extract_text(pdf_path, tracker, skip_bilingual=is_upsc, job_id=job_id)
    if not pages:
        return {"targeted": len(target_numbers), "recovered": 0, "unresolved": target_numbers}

    # Prefer the vision-derived page map (already available for scanned jobs) over
    # re-deriving from text extraction which returns empty sets for image-only PDFs.
    if vision_page_nums and any(nums for nums in vision_page_nums):
        usable_page_map = vision_page_nums
    else:
        raw_pages = [p[1] for p in pages]
        page_map = detect_questions_llm(raw_pages, exam_name, tracker)
        usable_page_map = page_map if page_map and any(nums for nums in page_map) else None
    recovered = _targeted_vision_recovery(pdf_path, target_numbers, pages, tracker, page_nums=usable_page_map)
    if not recovered:
        return {"targeted": len(target_numbers), "recovered": 0, "unresolved": target_numbers}

    cleaned = clean_and_dedupe_questions(recovered)
    usable = filter_english(cleaned, exam_name=exam_name)
    usable = [q for q in usable if is_row_usable_for_recovery(q)]
    if not usable:
        return {"targeted": len(target_numbers), "recovered": 0, "unresolved": target_numbers}

    tagged = tag_questions(usable, exam_name, job_id, tracker)
    store_questions(
        tagged,
        pdf_path,
        exam_name,
        exam_year,
        job_id=job_id,
        force_replace=True,
    )

    refreshed_rows = (
        sb.table("questions")
        .select(
            "question_number, question_text, option_a, option_b, option_c, option_d, "
            "correct_answer, question_type, has_image, image_url, paper_id"
        )
        .eq("paper_id", current_paper_id)
        .in_("question_number", target_numbers)
        .execute()
        .data
        or []
    )
    recovered_qnums = sorted({
        int(row["question_number"])
        for row in refreshed_rows
        if isinstance(row.get("question_number"), int) and is_row_usable_for_recovery(row)
    })
    unresolved = [n for n in target_numbers if n not in set(recovered_qnums)]
    return {
        "targeted": len(target_numbers),
        "recovered": len(recovered_qnums),
        "recovered_numbers": recovered_qnums,
        "unresolved": unresolved,
    }


def detect_questions_llm(pages: list[str], exam_name: str, tracker: Optional[CostTracker] = None) -> list[set[int]]:
    """Scan all pages with a cheap LLM to build a map of [page_index] -> {question_numbers}.
    This handles messy/bilingual text where regex fails to see the 'Q. 24' mark.
    Returns a list of sets, one for each page index.
    """
    _llm = TAGGING_MODEL or EXTRACTION_MODEL
    all_page_nums: list[set[int]] = [set() for _ in range(len(pages))]
    
    # Process in batches of 10 pages for speed/cost efficiency
    for i in range(0, len(pages), 10):
        chunk = pages[i : i + 10]
        combined_text = ""
        for idx, text in enumerate(chunk):
            # Strip some noise to save tokens
            clean = text[:2000] if len(text) > 2000 else text
            combined_text += f"\n--- PAGE INDEX {i + idx} ---\n{clean}\n"

        prompt = f"""Extract question NUMBERS present on each page of this {exam_name} paper.
        Return a JSON object: {{"page_index": [list of numbers]}}.
        Only include numbers that START a new question (e.g. 1, 2, 3...).
        
        {combined_text}
        """
        
        try:
            resp = _CLIENT.models.generate_content(
                model=_llm,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )
            if tracker:
                try:
                    m = resp.usage_metadata
                    tracker.record(f"LLM Q-Map (pp{i+1}-{i+len(chunk)})", m.prompt_token_count, m.candidates_token_count)
                except Exception: pass
            
            mapping = json.loads(resp.text or "{}")
            if isinstance(mapping, dict):
                for idx_str, nums in mapping.items():
                    try:
                        idx = int(idx_str)
                        if 0 <= idx < len(all_page_nums) and isinstance(nums, list):
                            all_page_nums[idx].update(int(n) for n in nums if str(n).isdigit())
                    except (ValueError, TypeError):
                        pass
        except Exception as e:
            print(f"    ⚠️ LLM Q-Map failed for batch {i//10 + 1}: {e}")
            
    return all_page_nums


# ══════════════════════════════════════════════════════════════════════════════
# MAIN PIPELINE
# ══════════════════════════════════════════════════════════════════════════════

def run_pipeline(pdf_path: str, exam_name: str, exam_year: int, job_id: str = None, answer_key_map: Optional[dict] = None, expected_count: int = 150) -> dict:
    """
    Full pipeline:
      1. Extract text locally (free)
      2. Parse questions locally with regex (free)
      3. Filter English-only (free)
      4. Tag subject/topic with Flash-8b (cheap, cached)
      5. Store in Supabase

    Cost: ~₹0.12 per 150-question paper (vs ₹175 before)
    """
    sb = get_supabase()
    print(f"\n{'='*60}")
    print(f"📄 {Path(pdf_path).name}  |  {exam_name} ({exam_year})")
    print(f"{'='*60}\n")

    def _update_job(progress: int = None, status: str = None, error: str = None):
        if not job_id:
            return
        data: dict[str, object] = {}
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

    exam_name = exam_name.strip()  # guard against trailing spaces creating duplicate exams
    tracker = CostTracker()

    # ── Zero-Waste Cache Check ───────────────────────────────────────────
    file_hash = hashlib.sha256(open(pdf_path, 'rb').read()).hexdigest()
    _results_cache = CACHE_DIR / "processed" / f"{file_hash}.json"
    (CACHE_DIR / "processed").mkdir(exist_ok=True)

    if _results_cache.exists():
        print(f"  ♻️  Found pre-processed result in cache (₹0 cost). Restoring...")
        try:
            cached_qs = json.loads(_results_cache.read_text())
            _update_job(progress=90, status="processing")
            result = store_questions(
                cached_qs,
                Path(pdf_path).name,
                exam_name,
                exam_year,
                job_id=job_id,
            )
            _update_job(progress=100, status="completed")
            print(f"  ✅ Instant Restore complete!")
            return result
        except Exception as e:
            print(f"  ⚠️  Failed to load cache: {e}. Falling back to full pipeline.")

    # ── Step 1: Extract ───────────────────────────────────────────────────
    print("STEP 1/4 — Extracting text (local, free)...")
    _update_job(progress=5, status="processing")

    # UPSC Prelims/CISF: skip_bilingual skips TSPSC-style Telugu filter.
    # Hindi Devanagari is still filtered separately inside extract_text().
    is_upsc = "upsc" in exam_name.lower()
    pages = extract_text(pdf_path, tracker, skip_bilingual=is_upsc, job_id=job_id)
    if not pages:
        _update_job(status="failed", error="No text extracted from PDF")
        return None

    # Bridge: Create raw text list for legacy functions
    raw_pages = [p[1] for p in pages]

    # ── Step 2: Parse ─────────────────────────────────────────────────────
    print("\nSTEP 2/4 — Parsing questions (local regex, free)...")
    questions = parse_questions_local(raw_pages)

    if not questions:
        _update_job(status="failed", error="No questions parsed. Check PDF format.")
        return None

    # ── UPSC sanitization: strip Hindi/regional chars that leaked in ──────
    # skip_bilingual=True lets regex find all 100 questions per year, but
    # Hindi text bleeds into question_text/options.  Strip it so langdetect
    # doesn't reject the question as "hi" in filter_english.
    if is_upsc:
        _nonascii = re.compile(r'[^\x00-\x7F]+')
        _multispace = re.compile(r'  +')
        for q in questions:
            for field in ("question_text", "option_a", "option_b", "option_c", "option_d"):
                if q.get(field):
                    q[field] = _multispace.sub(' ', _nonascii.sub(' ', q[field])).strip()

    cleaned_questions = clean_and_dedupe_questions(questions)
    if len(cleaned_questions) != len(questions):
        print(f"  🧹 Cleanup removed {len(questions) - len(cleaned_questions)} noisy/duplicate rows")
    questions = cleaned_questions

    # ── Quality gate: fall back to Vision structured extraction ───────────
    # Custom-font bilingual PDFs (e.g. TSPSC Group 3) produce garbled option
    # text or miss C/D options entirely. Detect this and switch to Vision.
    quality = _parse_quality(questions)
    print(f"  ✅ Parse quality {quality:.0%} — {len(questions)} questions from regex (₹0)")

    # ── targeted Vision: recover only MISSING question numbers ───────────────
    # Strategy: use known exam question count for range, then call Vision only
    # on the exact pages where missing questions should be — costs ~5% of full Vision.
    if questions or expected_count > 0:
        # 1. Identify which questions we definitely found with valid text
        found_nums = {q["question_number"] for q in questions 
                      if (q.get("question_text") or "").strip() and len((q.get("question_text") or "").strip()) >= 10}
        
        # 2. Define the search space
        min_q = 1
        max_q = expected_count if expected_count > 0 else (max(found_nums) if found_nums else 1)
        missing = [n for n in range(min_q, max_q + 1) if n not in found_nums]
        
        # 3. Use LLM to map questions to pages for precision
        final_page_nums = None
        if len(missing) > 0:
            print(f"  🔍 Gaps found ({len(missing)} questions). Running LLM Q-Map for precision...")
            _update_job(progress=11)
            final_page_nums = detect_questions_llm(raw_pages, exam_name, tracker)
            
            # Recalculate 'missing' based on what LLM actually saw
            # (prevents trying to recover ghost questions that aren't in the PDF at all)
            if final_page_nums:
                all_seen_by_llm = set().union(*final_page_nums)
                # Keep 'missing' as all numbers up to expected_count, but use final_page_nums to find them
                print(f"  ✅ LLM detected {len(all_seen_by_llm)} questions in PDF structure.")

        # 4. Run recovery
        if missing:
            print(f"\n  🔍 {len(missing)} questions missing. Running targeted Vision recovery...")
            _update_job(progress=13)
            recovered = _targeted_vision_recovery(pdf_path, missing, pages, tracker, page_nums=final_page_nums)
            if recovered:
                regex_map = {q["question_number"]: q for q in questions}
                for vq in recovered:
                    n = vq["question_number"]
                    r = regex_map.get(n)
                    if r:
                        # Replace regex result if Vision one is 'better' (more options found)
                        r_opts = sum(1 for k in ("option_a","option_b","option_c","option_d") if r.get(k))
                        v_opts = sum(1 for k in ("option_a","option_b","option_c","option_d") if vq.get(k))
                        if v_opts >= r_opts:
                            regex_map[n] = vq
                    else:
                        regex_map[n] = vq
                questions = sorted(regex_map.values(), key=lambda q: q["question_number"])
                print(f"  ✅ After targeted recovery: {len(questions)} questions total")

    _update_job(progress=15)

    # ── Step 3: English filter ────────────────────────────────────────────
    print("\nSTEP 3/4 — Filtering English questions...")
    questions = filter_english(questions, exam_name=exam_name)
    if not questions:
        _update_job(status="failed", error="No English questions found after filtering.")
        return None

    # Show cost estimate before spending any money
    cost = estimate_cost(len(questions))
    print(f"\n💰 Cost estimate: ₹{cost['estimated_cost_inr']} "
          f"({len(questions)} questions × {cost['api_batches']} API batches) "
          f"[model: {cost['model']}]")
    _update_job(progress=20)

    # ── Step 4: Tag ───────────────────────────────────────────────────────
    print(f"\nSTEP 4/4 — Tagging with {cost['model']} (cached)...")
    questions = tag_questions(questions, exam_name, job_id, tracker)

    # ── Step 5: Store ─────────────────────────────────────────────────────
    print("\nSTEP 5/6 — Storing in Supabase...")
    _update_job(progress=90)
    result = store_questions(
        questions,
        Path(pdf_path).name,
        exam_name,
        exam_year,
        job_id=job_id,
    )

    repair_result = repair_structurally_broken_rows(
        pdf_path,
        exam_name,
        exam_year,
        job_id=job_id,
        tracker=tracker,
    )
    if repair_result.get("targeted"):
        print(
            f"  🩹 Broken-row repair: recovered {repair_result.get('recovered', 0)}/"
            f"{repair_result.get('targeted', 0)} rows"
        )

    # ── Step 5b: Inject answers from separate answer key ──────────────────
    if answer_key_map:
        print(f"\n  💉 Injecting {len(answer_key_map)} answers from separate answer key...")
        inj = inject_answers(answer_key_map, exam_name, exam_year)
        result["injected_answers"] = inj["updated"]

    # ── Step 6: Bulk explanations (one-time, ~₹0.22 for 150 Qs) ──────────
    print("\nSTEP 6/6 — Generating explanations (one-time for all users)...")
    expl_result = generate_explanations_bulk(exam_name, exam_year, job_id, tracker)

    _update_job(progress=100, status="completed")
    try:
        from papers import mark_paper_lifecycle, paper_id_for_job
        mark_paper_lifecycle(
            paper_id_for_job(job_id, sb=get_supabase()),
            "ingested",
            last_job_id=job_id,
            sb=get_supabase(),
        )
    except Exception:
        pass

    tracker.print_summary()
    tracker.save_log(exam_name, exam_year, len(questions))

    # ── Save to Zero-Waste Cache ──────────────────────────────────────────
    try:
        _results_cache.write_text(json.dumps(questions, indent=2, ensure_ascii=False))
        print(f"  💾 Processed results saved to cache → processed/{file_hash}.json")
    except Exception as e:
        print(f"  ⚠️  Failed to save result cache: {e}")

    print(f"\n{'='*60}")
    print(f"✅ Done!")
    print(f"   Questions    — Inserted: {result['inserted']}, Skipped: {result['skipped']}")
    print(f"   Explanations — Generated: {expl_result['generated']}, Already existed: {expl_result['skipped']}")
    print(f"💰 Cost for every future upload of same paper: ₹0 (fully cached)")
    if result["errors"]:
        print(f"⚠️  Errors: {result['errors']}")
    print(f"{'='*60}\n")

    return result


def recover_missing_questions_only(
    pdf_path: str,
    exam_name: str,
    exam_year: int,
    *,
    missing_numbers: list[int],
    job_id: str | None = None,
    answer_key_map: Optional[dict] = None,
) -> dict:
    """
    Targeted recovery path for re-uploads of an existing exam.
    Only the explicitly missing question numbers are extracted, tagged, and stored.
    """
    sb = get_supabase()
    tracker = CostTracker()
    exam_name = exam_name.strip()
    missing_numbers = sorted({int(n) for n in missing_numbers if int(n) > 0})

    def _update_job(progress: int | None = None, status: str | None = None, error: str | None = None):
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

    if not missing_numbers:
        _update_job(progress=100, status="completed", error="No missing question numbers detected.")
        return {"recovered": 0, "inserted": 0, "missing_numbers": []}

    print(f"\n{'='*60}")
    print(f"🩹 Missing-question recovery | {exam_name} ({exam_year})")
    print(f"🎯 Target numbers: {missing_numbers[:20]}{'...' if len(missing_numbers) > 20 else ''}")
    print(f"{'='*60}\n")

    _update_job(progress=5, status="processing", error=f"Recovering only missing question numbers: {missing_numbers[:20]}")

    is_upsc = "upsc" in exam_name.lower()
    pages = extract_text(pdf_path, tracker, skip_bilingual=is_upsc, job_id=job_id)
    if not pages:
        _update_job(status="failed", error="No text extracted from PDF during missing-question recovery.")
        return {"recovered": 0, "inserted": 0, "missing_numbers": missing_numbers}

    raw_pages = [p[1] for p in pages]
    _update_job(progress=20)
    page_map = detect_questions_llm(raw_pages, exam_name, tracker)

    _update_job(progress=35, error=f"Running targeted recovery for missing numbers: {missing_numbers[:20]}")
    recovered = _targeted_vision_recovery(pdf_path, missing_numbers, pages, tracker, page_nums=page_map)
    if not recovered:
        _update_job(progress=100, status="completed", error="Missing-question recovery finished, but no target questions were recovered.")
        tracker.print_summary()
        tracker.save_log(exam_name, exam_year, 0)
        return {"recovered": 0, "inserted": 0, "missing_numbers": missing_numbers}

    cleaned_questions = clean_and_dedupe_questions(recovered)
    questions = filter_english(cleaned_questions, exam_name=exam_name)
    questions = [q for q in questions if is_row_usable_for_recovery(q)]

    if answer_key_map:
        for q in questions:
            qn = q.get("question_number")
            if isinstance(qn, int) and qn in answer_key_map:
                q["correct_answer"] = str(answer_key_map[qn]).strip().upper()[:1]

    visual_hint_count = 0
    for q in questions:
        if not q.get("has_image") and _needs_image_fallback(q):
            q["has_image"] = True
            visual_hint_count += 1
    if visual_hint_count:
        print(f"🖼️ Auto-marked {visual_hint_count} recovered questions as visual before image upload")

    # Missing-question repair should preserve the same image experience as the
    # main universal extractor, including figure cropping and DI propagation.
    image_qs_count = sum(1 for q in questions if q.get("has_image"))
    if image_qs_count > 0:
        try:
            from extractor.universal_extractor import _propagate_di_images, _upload_page_images

            print(f"🖼️ Uploading images for {image_qs_count} recovered missing questions...")
            questions = _upload_page_images(questions, pdf_path, exam_name, exam_year, sb)
            questions = _propagate_di_images(questions)
        except Exception as image_err:
            print(f"⚠️ Missing-question image upload failed (non-fatal): {image_err}")

    _update_job(progress=60)
    questions = tag_questions(questions, exam_name, job_id, tracker)

    _update_job(progress=85)
    result = store_questions(
        questions,
        Path(pdf_path).name,
        exam_name,
        exam_year,
        job_id=job_id,
    )

    expl_result = generate_explanations_bulk(exam_name, exam_year, job_id, tracker)
    recovered_qnums = {
        int(q.get("question_number") or 0)
        for q in questions
        if int(q.get("question_number") or 0) > 0
    }
    unresolved_targets = sorted(
        int(n) for n in missing_numbers
        if int(n) > 0 and int(n) not in recovered_qnums
    )
    seeded_manual_drafts = seed_unresolved_manual_repair_drafts(
        exam_name,
        exam_year,
        unresolved_targets,
        sb=sb,
    )
    _update_job(
        progress=100,
        status="completed",
        error=(
            f"Recovered {len(questions)} missing questions"
            + (f"; unresolved: {unresolved_targets}" if unresolved_targets else "")
            + (f"; manual drafts seeded: {seeded_manual_drafts}" if seeded_manual_drafts else "")
        ),
    )

    tracker.print_summary()
    tracker.save_log(exam_name, exam_year, len(questions))

    result.update({
        "recovered": len(questions),
        "missing_numbers": missing_numbers,
        "unresolved_targets": unresolved_targets,
        "manual_drafts_seeded": seeded_manual_drafts,
        "generated_explanations": expl_result.get("generated", 0),
    })
    return result


def process_missing_questions_job_background(
    job_id: str,
    pdf_path: str,
    exam_name: str,
    exam_year: int,
    missing_numbers: list[int],
    answer_key_map: Optional[dict] = None,
):
    """Background worker for re-upload repairs that should only fill numbering gaps."""
    try:
        recover_missing_questions_only(
            pdf_path,
            exam_name,
            exam_year,
            missing_numbers=missing_numbers,
            job_id=job_id,
            answer_key_map=answer_key_map,
        )
    except Exception as e:
        print(f"Missing-question job {job_id} failed: {e}")
        try:
            from papers import mark_paper_lifecycle, paper_id_for_job
            get_supabase().table("jobs").update({
                "status": "failed", "error_log": str(e)
            }).eq("id", job_id).execute()
            mark_paper_lifecycle(
                paper_id_for_job(job_id, sb=get_supabase()),
                "failed",
                last_job_id=job_id,
                sb=get_supabase(),
            )
        except Exception:
            pass
    finally:
        if os.path.exists(pdf_path):
            os.unlink(pdf_path)


def process_job_background(job_id: str, pdf_path: str, exam_name: str, exam_year: int, answer_key_map: Optional[dict] = None, expected_count: int = 150):
    """Background worker entry point."""
    try:
        run_pipeline(pdf_path, exam_name, exam_year, job_id, answer_key_map=answer_key_map, expected_count=expected_count)
    except Exception as e:
        print(f"Job {job_id} failed: {e}")
        try:
            from papers import mark_paper_lifecycle, paper_id_for_job
            get_supabase().table("jobs").update({
                "status": "failed", "error_log": str(e)
            }).eq("id", job_id).execute()
            mark_paper_lifecycle(
                paper_id_for_job(job_id, sb=get_supabase()),
                "failed",
                last_job_id=job_id,
                sb=get_supabase(),
            )
        except Exception:
            pass
    finally:
        if os.path.exists(pdf_path):
            os.unlink(pdf_path)


# ══════════════════════════════════════════════════════════════════════════════
# MULTI-YEAR PIPELINE — auto-detects year boundaries from watermarks
# ══════════════════════════════════════════════════════════════════════════════

def detect_year_boundaries(pdf_path: str) -> dict[int, list[int]]:
    """
    Scan bottom 15% of each page with Tesseract to find 4-digit year watermarks.
    Returns {year: [page_indices]} — entirely free (no AI calls).

    Works for scanned PDFs where each year's paper has a watermark like
    "2024", "2023 Series", "UPSC 2019" at the bottom of every page.
    """
    doc = fitz.open(pdf_path)
    total = len(doc)
    year_map: dict[int, Optional[int]] = {}  # page_idx → year (None = not yet detected)

    print(f"\n🔍 Year-boundary detection ({total} pages, Tesseract — free)...")

    for i, page in enumerate(doc):
        rect = page.rect
        # Crop bottom 15% where watermark lives
        crop = fitz.Rect(rect.x0, rect.y1 * 0.85, rect.x1, rect.y1)
        pix = page.get_pixmap(clip=crop, dpi=200)
        img = PILImage.open(_io.BytesIO(pix.tobytes("png")))

        # Tesseract with digits-only config for speed
        raw = pytesseract.image_to_string(
            img,
            config="--psm 6 -c tessedit_char_whitelist=0123456789 "
        )
        match = re.search(r"20(1[1-9]|2[0-5])", raw)
        if match:
            year_map[i] = int(match.group())
        else:
            year_map[i] = None

        if (i + 1) % 50 == 0:
            print(f"  Scanned {i+1}/{total} pages...")

    # Propagate: if a page has no watermark, inherit the previous page's year
    last_year = None
    for i in range(total):
        if year_map[i] is not None:
            last_year = year_map[i]
        elif last_year is not None:
            year_map[i] = last_year

    # Group pages by year
    groups: dict[int, list[int]] = {}
    for pg, yr in year_map.items():
        if yr is None:
            continue
        groups.setdefault(yr, []).append(pg)

    detected = sorted(groups.keys())
    print(f"  ✅ Detected years: {detected}")
    for yr in detected:
        print(f"     {yr}: {len(groups[yr])} pages (pages {groups[yr][0]+1}–{groups[yr][-1]+1})")

    return groups


def run_pipeline_multi_year(pdf_path: str, exam_name: str) -> dict:
    """
    Process a multi-year combined PDF (e.g. UPSC 2011–2025 in one 650-page file).
    Auto-detects year boundaries from watermarks, splits into per-year temp PDFs,
    runs the full pipeline for each year. Each year is cached separately.

    Cost: ~₹0.89/50 pages for Vision OCR + ~₹0.10/100 questions for tagging.
    For 650 pages / 1500 questions total: ~₹13 first run, ₹0 on re-runs.

    Usage:
        python pipeline.py multi <pdf_path> "UPSC Prelims"
    """

    src = Path(pdf_path)
    if not src.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    groups = detect_year_boundaries(pdf_path)
    if not groups:
        raise RuntimeError(
            "No year watermarks detected. "
            "Ensure the PDF has 4-digit year stamps (2011–2025) at the bottom of pages."
        )

    results = {}
    src_doc = fitz.open(pdf_path)

    for year in sorted(groups.keys()):
        page_indices = groups[year]
        print(f"\n{'='*60}")
        print(f"📅  Processing year {year}  ({len(page_indices)} pages)")
        print(f"{'='*60}")

        # Write year's pages to a temp PDF
        tmp = tempfile.NamedTemporaryFile(
            suffix=f"_{exam_name.replace(' ','_')}_{year}.pdf",
            delete=False
        )
        tmp.close()

        year_doc = fitz.open()
        year_doc.insert_pdf(src_doc, from_page=page_indices[0], to_page=page_indices[-1])
        year_doc.save(tmp.name)
        year_doc.close()

        try:
            result = run_pipeline(tmp.name, exam_name, year)
            results[year] = result
        finally:
            if os.path.exists(tmp.name):
                os.unlink(tmp.name)

    src_doc.close()

    total_inserted = sum(r["inserted"] for r in results.values() if r)
    total_skipped  = sum(r["skipped"]  for r in results.values() if r)

    print(f"\n{'='*60}")
    print(f"✅  Multi-year pipeline complete!")
    print(f"   Years processed : {sorted(results.keys())}")
    print(f"   Total inserted  : {total_inserted}")
    print(f"   Total skipped   : {total_skipped}")
    print(f"{'='*60}\n")
    return results


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "multi":
        # Multi-year mode: python pipeline.py multi <pdf> <exam_name>
        if len(sys.argv) < 4:
            print("Usage: python pipeline.py multi <pdf> <exam_name>")
            print("  Ex:  python pipeline.py multi UPSC_2011_2025.pdf 'UPSC Prelims'")
            sys.exit(1)
        run_pipeline_multi_year(sys.argv[2], sys.argv[3])
    else:
        # Single-year mode (unchanged)
        if len(sys.argv) < 4:
            print("Usage: python pipeline.py <pdf> <exam_name> <year>")
            print("  Ex:  python pipeline.py UPSC_2024.pdf 'UPSC Prelims' 2024")
            print()
            print("Multi-year mode (auto year-detect from watermarks):")
            print("  python pipeline.py multi UPSC_2011_2025.pdf 'UPSC Prelims'")
            sys.exit(1)
        run_pipeline(sys.argv[1], sys.argv[2], int(sys.argv[3]))
