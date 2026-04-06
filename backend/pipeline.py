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
from pathlib import Path
from typing import Optional

import datetime
import fitz  # PyMuPDF
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError("GEMINI_API_KEY required in .env")

genai.configure(api_key=GEMINI_API_KEY)


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
        cost_usd = (
            input_tokens  / 1_000_000 * _INPUT_PRICE_PER_1M +
            output_tokens / 1_000_000 * _OUTPUT_PRICE_PER_1M
        )
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

# ── Model: gemini-2.5-flash-lite ───────────────────────────────────────────
# Used for tagging + explanations — same model as vision to keep it simple
TAGGER_MODEL = genai.GenerativeModel("gemini-2.5-flash-lite")

# ── Local cache to avoid re-paying for same batches ────────────────────────
CACHE_DIR = Path("./cache")
CACHE_DIR.mkdir(exist_ok=True)

# ── Batch size: 30 question TEXTS (not 5 raw pages) ────────────────────────
# Sending only question text = ~50 tokens/question vs ~500 tokens/raw page
TAG_BATCH_SIZE = 30


# ── Lazy Supabase ───────────────────────────────────────────────────────────

_supabase = None
def get_supabase():
    global _supabase
    if _supabase is None:
        from config import supabase
        _supabase = supabase
    return _supabase


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — LOCAL TEXT EXTRACTION  (no API cost)
# ══════════════════════════════════════════════════════════════════════════════

def _normalize_block_text(text: str) -> str:
    """Collapse single-word fragment lines within one PDF text block.

    Some PDFs store each word as a separate textline inside one block, producing
    text like '6.\\nThe\\nsecond\\nmeeting\\n...'.  Join consecutive short lines
    (≤ 15 chars) that are not structural markers (option labels, numbered opts,
    question numbers) onto the previous line.
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
        if result and len(s) <= 15 and not is_structural:
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


def extract_text(pdf_path: str, tracker: "CostTracker | None" = None, skip_bilingual: bool = False) -> list[str]:
    """Extract text page-by-page using PyMuPDF.

    skip_bilingual=True: disables the Telugu/Hindi line filter — use for UPSC PDFs
    where the bilingual filter incorrectly strips English content.

    Handles bilingual two-column PDFs (e.g. TSPSC Group 1): pages alternate
    between Telugu-only and English-only. English pages have two columns
    (Q1-3 left, Q4-6 right). Blocks are grouped by row to avoid the
    'one word per line' problem.  Falls back to OCR for scanned pages.

    Results are cached by PDF content hash — re-uploading the same PDF costs ₹0.
    """
    # ── Page-extraction cache (avoids re-paying Gemini Vision) ───────────────
    pdf_bytes = Path(pdf_path).read_bytes()
    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()[:16]
    _page_cache_path = CACHE_DIR / f"pages_{pdf_hash}.json"
    if _page_cache_path.exists():
        with open(_page_cache_path) as _f:
            cached_pages = json.load(_f)
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

    for i, page in enumerate(doc):
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
            page_has_telugu = (not skip_bilingual) and (all_non_ascii / all_alpha) > 0.15

            if page_has_telugu:
                if not bilingual_announced:
                    print(f"  🌐 Bilingual PDF detected (page {i+1}) — filtering Telugu lines per-block")
                    bilingual_announced = True
                is_bilingual = True
                # Clean each block to extract its English lines only
                cleaned_blocks = []
                for b in text_blocks:
                    cleaned_text = _extract_english_from_block(b[4])
                    if cleaned_text.strip():
                        cleaned_blocks.append(b[:4] + (cleaned_text,) + b[5:])
                if not cleaned_blocks:
                    text = ""
                else:
                    # Two-column layout: left col (<50% width) and right col (≥50%)
                    mid = page_width * 0.50
                    left_col  = [b for b in cleaned_blocks if b[0] < mid]
                    right_col = [b for b in cleaned_blocks if b[0] >= mid]
                    left_chars  = sum(len(b[4]) for b in left_col)
                    right_chars = sum(len(b[4]) for b in right_col)
                    if left_chars > 50 and right_chars > 50:
                        text = (_blocks_to_lines(left_col) + "\n" + _blocks_to_lines(right_col)).strip()
                    else:
                        text = _blocks_to_lines(cleaned_blocks)
            else:
                # Pure English page — two columns (Q1-3 left, Q4-6 right)
                mid = page_width * 0.50
                left_col  = [b for b in text_blocks if b[0] < mid]
                right_col = [b for b in text_blocks if b[0] >= mid]
                left_chars  = sum(len(b[4]) for b in left_col)
                right_chars = sum(len(b[4]) for b in right_col)
                if left_chars > 50 and right_chars > 50:
                    text = (_blocks_to_lines(left_col) + "\n" + _blocks_to_lines(right_col)).strip()
                else:
                    text = _blocks_to_lines(text_blocks)
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
                from PIL import Image as PILImage
                import io as _io
                pix = page.get_pixmap(dpi=150)
                img_bytes = pix.tobytes("png")

                # ── Gemini Vision: best for bilingual scanned PDFs ────────────
                # gemini-2.0-flash-lite: ~₹0.89 for a 50-page paper (under ₹1).
                # Understands both English and Telugu — extracts English-only.
                try:
                    import PIL.Image
                    _img = PIL.Image.open(_io.BytesIO(img_bytes))
                    _vision_model = genai.GenerativeModel("gemini-2.5-flash-lite")
                    _prompt = (
                        "This is a scanned page from an Indian competitive exam (TSPSC/UPSC). "
                        "Each question appears TWICE on the page — once in English and once in Telugu. "
                        "Extract ONLY the English version of each question, exactly ONCE. "
                        "Preserve the original question number (e.g. '8. Match the following...'). "
                        "Format: [number]. [question text]\n(1) [option] (2) [option] (3) [option] (4) [option]\n"
                        "For match-the-following, keep A/B/C/D and I/II/III/IV labels. "
                        "Do NOT output any Telugu or Hindi characters. "
                        "Do NOT duplicate questions. Do NOT add explanations — raw exam text only. "
                        "IGNORE any watermark text such as 'MASTER COPY' or 'M A S T E R C O P Y'. "
                        "IGNORE page number codes like 'ET 22 X' or 'ET X 22'. "
                        "IGNORE 'P.T.O.' markers. Output question text only."
                    )
                    _resp = _vision_model.generate_content([_prompt, _img])
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
                    import pytesseract
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
        pages.append(text)

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

# Matches lines like: "1." "Q1." "Q.1" "1)" but NOT answer choices like "1) A and B only"
# Requires the line content to look like actual question text (>= 5 chars after the number)
# and that the number is followed by the number of a proper question (not a sub-item 1-4)
_Q_START = re.compile(r'^(?:Q\.?\s*)?(\d{1,3})[.)]\s+(.{5,})', re.MULTILINE)

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
    questions = []
    prev_q_num = 0   # for sequential-number validation

    for idx, match in enumerate(splits):
        q_num = int(match.group(1))

        # Skip if question number is out of sequence (e.g. "240" inside Q143 text).
        # A real question number must be greater than the previous AND within 20.
        # Gap of 20 handles: section headers, OCR drops, multi-column layout glitches.
        if q_num <= prev_q_num or q_num > prev_q_num + 20:
            # OCR recovery: Gemini Vision sometimes drops a leading digit, e.g.
            # "42." → "2." because "4" was missed.  If the parsed number is a
            # suffix of (prev_q_num + 1) AND has fewer digits, recover it.
            expected = prev_q_num + 1
            expected_str = str(expected)
            q_str = str(q_num)
            if (len(q_str) < len(expected_str)
                    and expected_str.endswith(q_str)):
                q_num = expected  # treat as the expected next question
            else:
                continue
        prev_q_num = q_num

        start = match.start()
        # Find the end: next VALID split (skip out-of-sequence false positives)
        end = len(full_text)
        j = idx + 1
        while j < len(splits):
            future_match = splits[j]
            fn = int(future_match.group(1))
            if fn > q_num and fn <= q_num + 20:
                end = future_match.start()
                break
            j += 1
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

        use_numeric_opts: bool = False
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
        else:
            q_text = block
            opts_block = ""

        q_text = re.sub(r'^(?:Q\.?\s*)?\d{1,3}[.)]\s+', '', q_text).strip()

        # ── Parse answer options ──────────────────────────────────────────────
        opts: dict[str, Optional[str]] = {"A": None, "B": None, "C": None, "D": None}

        def _clean_opt(text: str) -> str:
            """Strip trailing directive lines / watermarks / non-ASCII that bleed into option text."""
            # Strip trailing sub-statement labels A./B./C./D. that bleed in from bilingual format
            # e.g. "Neither A nor B\nA.\nB." → "Neither A nor B"
            text = re.sub(r'(?:\s+[A-D]\.\s*)+$', '', text).strip()
            # Strip "(1) A only (2) ..." suffix — answer choices embedded in option D
            text = re.sub(r'\s*[\(\[]1[\)\]]\s*.+$', '', text, flags=re.DOTALL).strip()
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

    # Deduplicate by question_number — keep the one with the longest question_text
    # Phantom questions (from numbered sub-items) tend to have shorter, fragment-like text
    seen: dict[int, dict] = {}
    for q in questions:
        n = q["question_number"]
        if n not in seen or len(q["question_text"]) > len(seen[n]["question_text"]):
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
    try:
        import PIL.Image as PILImage
        import io as _io
    except ImportError:
        print("  ❌ PIL not available — cannot use Vision extraction")
        return []

    pdf_bytes = Path(pdf_path).read_bytes()
    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()[:16]
    _vis_cache = CACHE_DIR / f"vision_qs_{pdf_hash}.json"

    if _vis_cache.exists():
        cached = json.loads(_vis_cache.read_text(encoding="utf-8"))
        print(f"  📦 Vision Q-extract: cache hit ({len(cached)} questions, ₹0)")
        if tracker:
            tracker.record("Vision Q-extract (all pages)", 0, 0, cached=True)
        return cached

    _vision_model = genai.GenerativeModel("gemini-2.5-flash-lite")
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
                resp = _vision_model.generate_content(
                    [_VISION_STRUCT_PROMPT] + imgs,
                    generation_config=genai.GenerationConfig(temperature=0.1, max_output_tokens=16384),
                    request_options={"timeout": 120},
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
    """Returns True if text is English (or detection is uncertain — keep by default)."""
    if _is_garbled(text):
        return False  # Mojibake from Telugu/regional font PDFs — reject
    try:
        from langdetect import detect, LangDetectException
        lang = detect(text)
        return lang not in ("te", "hi", "ta", "kn", "ml", "mr", "bn", "gu")
    except Exception:
        return True  # uncertain → keep


def filter_english(questions: list[dict]) -> list[dict]:
    """Remove Telugu/Hindi/other non-English questions and mojibake garbage."""
    before = len(questions)
    english_qs = [q for q in questions if _is_english(q["question_text"])]
    removed = before - len(english_qs)
    if removed:
        print(f"  🔤 Filtered {removed} non-English/garbled questions → {len(english_qs)} remain")
    return english_qs


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — CHEAP AI TAGGING ONLY  (gemini-1.5-flash-8b)
# We send only question text (~50 tokens), NOT raw pages (~2000 tokens)
# We ask only for subject/topic/difficulty, NOT extraction (already done locally)
# ══════════════════════════════════════════════════════════════════════════════

TAXONOMY_SUBJECTS = (
    "Polity | History | Geography | Economy | Environment | "
    "Science & Tech | Current Affairs | Reasoning & Aptitude | "
    "English | General Knowledge | Social Issues"
)

TAG_PROMPT_TEMPLATE = """Classify these {exam_name} exam questions. Return ONLY a JSON array, no markdown.

For each question return exactly: {{"id": N, "subject": "...", "topic": "...", "difficulty": "Easy|Medium|Hard"}}

Subjects (pick ONLY from this list): {subjects}

Questions:
{questions_text}
"""


def _batch_cache_key(questions: list[dict], exam_name: str) -> str:
    combined = exam_name + "||" + "||".join(q["question_text"][:60] for q in questions)
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
    """Send ONLY question texts (not options, not raw pages) for subject/topic tagging."""
    qs_text = "\n".join(
        f"{i+1}. {q['question_text'][:200]}"  # cap at 200 chars to limit tokens
        for i, q in enumerate(questions)
    )
    prompt = TAG_PROMPT_TEMPLATE.format(
        exam_name=exam_name,
        subjects=TAXONOMY_SUBJECTS,
        questions_text=qs_text,
    )

    for attempt in range(3):
        try:
            resp = TAGGER_MODEL.generate_content(
                prompt,
                generation_config=genai.GenerationConfig(
                    temperature=0.1,
                    max_output_tokens=2048,
                ),
                request_options={"timeout": 60},
            )
            raw = (resp.text or "").strip()
            # Strip markdown fences if present
            if raw.startswith("```"):
                raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
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

    # Return empty tags on total failure — questions still saved, just untagged
    return [{"id": i+1, "subject": "General Knowledge", "topic": "General", "difficulty": "Medium"}
            for i in range(len(questions))]


def tag_questions(questions: list[dict], exam_name: str, job_id: str = None, tracker: "CostTracker | None" = None) -> list[dict]:
    """
    Batch tag questions using gemini-1.5-flash-8b.
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
            _save_cache(cache_key, tags)
            total_api_calls += 1
            if batch_num < total_batches:
                time.sleep(1)  # gentle rate limiting

        # Merge tags back into questions
        tag_map = {t.get("id", i+1): t for i, t in enumerate(tags)}
        for i, q in enumerate(batch):
            tag = tag_map.get(i+1, {})
            q["subject"] = tag.get("subject") or "General Knowledge"
            q["topic"] = tag.get("topic") or "General"
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

def inject_answers(answer_map: dict[int, str], exam_name: str, exam_year: int) -> dict:
    """
    Bulk-update correct_answer in the questions table for an exam, matching by
    question_number. Call this after store_questions() when a separate answer
    key PDF was provided.

    Groups updates by answer letter for efficiency (4 DB calls max).
    """
    sb = get_supabase()
    exam_name = exam_name.strip()
    updated = 0

    for letter in "ABCD":
        nums = [num for num, ans in answer_map.items() if ans == letter]
        if not nums:
            continue
        try:
            sb.table("questions").update(
                {"correct_answer": letter}
            ).eq("exam_name", exam_name).eq("exam_year", exam_year).in_(
                "question_number", nums
            ).execute()
            updated += len(nums)
        except Exception as e:
            print(f"  ⚠️  inject_answers letter={letter}: {e}")

    print(f"  💉 Injected answers: ~{updated} questions updated in DB")
    return {"updated": updated}


# ══════════════════════════════════════════════════════════════════════════════
# STEP 5 — STORE IN SUPABASE  (unchanged)
# ══════════════════════════════════════════════════════════════════════════════

def store_questions(questions: list[dict], source_pdf: str, exam_name: str, exam_year: int) -> dict:
    """Batch upsert with SHA-256 deduplication."""
    exam_name = exam_name.strip()  # prevent trailing-space duplicate exams
    sb = get_supabase()
    inserted = 0
    skipped = 0
    errors = []

    for i in range(0, len(questions), 50):
        batch = questions[i:i+50]
        rows = []
        explanations_pending = []

        for q in batch:
            hash_input = (
                f"{(q.get('question_text') or '').strip().lower()}"
                f"|{q.get('option_a','')}"
                f"|{q.get('option_b','')}"
            )
            qhash = hashlib.sha256(hash_input.encode()).hexdigest()

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
                "exam_name": exam_name,
                "exam_year": exam_year,
                "source_pdf": source_pdf,
                "question_hash": qhash,
                "question_number": q.get("question_number"),
                "is_active": True,
            }

            # CBT / shift-specific optional columns — only set if present in question dict
            for _col in ("shift_label", "test_date", "test_time",
                         "exam_section", "needs_review", "passage"):
                if _col in q and q[_col] is not None:
                    row[_col] = q[_col]

            if not row["question_text"] or len(row["question_text"]) < 10:
                skipped += 1
                continue
            if row["correct_answer"] not in "ABCD":
                row["correct_answer"] = "A"
            if row["difficulty"] not in ("Easy", "Medium", "Hard"):
                row["difficulty"] = "Medium"

            rows.append(row)

        # Deduplicate within this batch by question_hash — Postgres upsert crashes if
        # two rows in the same batch share the same conflict key.
        seen_hashes: dict[str, dict] = {}
        for r in rows:
            seen_hashes[r["question_hash"]] = r
        rows = list(seen_hashes.values())

        if rows:
            try:
                result = sb.table("questions").upsert(rows, on_conflict="question_hash").execute()
                inserted += len(result.data) if result.data else len(rows)
            except Exception as e:
                errors.append(f"Batch {i//50+1}: {e}")
                skipped += len(rows)

    return {"inserted": inserted, "skipped": skipped, "errors": errors}


# ══════════════════════════════════════════════════════════════════════════════
# STEP 5 — BULK EXPLANATION GENERATION  (one-time, ~₹0.22 per 150 questions)
# Batches 30 questions per call. Skips any question that already has one.
# After this runs once, every user gets explanations for free from the DB.
# ══════════════════════════════════════════════════════════════════════════════

EXPL_BATCH_SIZE = 15

EXPL_PROMPT_TEMPLATE = """You are an expert tutor for Indian government exams (UPSC, TSPSC, SSC, etc.).

For each question below, write a clear 2-3 sentence explanation of WHY the correct answer is right.
Be factual and educational. Return ONLY a JSON array, no markdown.

Format: [{{"id": 1, "explanation": "..."}} , ...]

Questions:
{questions_text}
"""


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
        "id, question_text, subject"
    ).eq("exam_name", exam_name).eq("exam_year", exam_year).eq("is_active", True).execute()
    all_qs = qs_res.data or []

    if not all_qs:
        print("  ❌ No questions found.")
        return {"updated": 0}

    print(f"  Found {len(all_qs)} questions — running tagging...")

    tracker = CostTracker()

    # Build minimal question dicts that tag_questions expects
    tag_input = [{"question_text": q["question_text"], "id_db": q["id"]} for q in all_qs]
    tagged = tag_questions(tag_input, exam_name, tracker=tracker)

    # Update DB in batches of 50
    updated = 0
    for i in range(0, len(tagged), 50):
        batch = tagged[i:i+50]
        for q in batch:
            try:
                sb.table("questions").update({
                    "subject":   q.get("subject")   or "General Knowledge",
                    "topic":     q.get("topic")     or "General",
                    "subtopic":  q.get("subtopic"),
                    "difficulty": q.get("difficulty") or "Medium",
                }).eq("id", q["id_db"]).execute()
                updated += 1
            except Exception as e:
                print(f"    ⚠️  Failed to update {q['id_db']}: {e}")

    tracker.print_summary()
    tracker.save_log(f"{exam_name} (retag)", exam_year, len(all_qs))

    print(f"  ✅ Updated tags for {updated}/{len(all_qs)} questions")
    return {"updated": updated, "total": len(all_qs)}


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
            "id, question_text, option_a, option_b, option_c, option_d, correct_answer"
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

    pending = [q for q in all_qs if q["id"] not in existing_ids]

    if not pending:
        print(f"  ✅ All {len(all_qs)} questions already have explanations")
        return {"generated": 0, "skipped": len(all_qs)}

    print(f"  📝 Generating explanations for {len(pending)} questions "
          f"({len(existing_ids)} already exist)...")

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
        prompt = EXPL_PROMPT_TEMPLATE.format(questions_text=qs_text)

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
            errors += len(batch)
            continue

        # Map by position (id field in response) back to question id
        id_map = {e.get("id", i+1): e.get("explanation", "") for i, e in enumerate(explanations)}

        rows = []
        for i, q in enumerate(batch):
            text = id_map.get(i+1, "").strip()
            if text and len(text) > 10:
                rows.append({"question_id": q["id"], "explanation": text, "source": "gemini-1.5-flash-8b"})

        if rows:
            try:
                sb.table("explanations").upsert(rows, on_conflict="question_id").execute()
                generated += len(rows)
            except Exception as e:
                print(f"    ❌ DB error on batch {batch_num}: {e}")
                errors += len(rows)

        if job_id:
            progress = 92 + int(7 * (batch_num / len(batches)))
            try:
                sb.table("jobs").update({"progress": progress}).eq("id", job_id).execute()
            except Exception:
                pass

    print(f"  ✅ Explanations done: {generated} generated, {errors} failed, "
          f"{len(existing_ids)} already existed")
    return {"generated": generated, "skipped": len(existing_ids), "errors": errors}


def _call_explanation_api(prompt: str, expected: int, tracker: "CostTracker | None" = None) -> list[dict]:
    """Call flash-8b to generate explanations. Returns list or empty on failure."""
    for attempt in range(3):
        try:
            resp = TAGGER_MODEL.generate_content(
                prompt,
                generation_config=genai.GenerationConfig(
                    temperature=0.2,
                    max_output_tokens=8192,
                ),
                request_options={"timeout": 90},
            )
            raw = (resp.text or "").strip()
            if raw.startswith("```"):
                raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
            data = json.loads(raw)
            if isinstance(data, list):
                if tracker:
                    try:
                        _m = resp.usage_metadata
                        tracker.record("Explanations", _m.prompt_token_count or 0, _m.candidates_token_count or 0)
                    except Exception:
                        pass
                return data
        except json.JSONDecodeError:
            print(f"    ⚠️  JSON error attempt {attempt+1}, retrying...")
            time.sleep(2)
        except Exception as e:
            if "429" in str(e) or "quota" in str(e).lower():
                wait = 60 * (attempt + 1)
                print(f"    ⏳ Rate limited, waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"    ❌ API error: {e}")
                break
    return []


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
        "model": "gemini-2.5-flash-lite",
        "note": "Re-runs of same PDF cost ₹0 (fully cached)"
    }


def _targeted_vision_recovery(
    pdf_path: str,
    missing: list[int],
    pages: list[str],
    tracker: "CostTracker | None" = None,
) -> list[dict]:
    """Call Vision only on pages that contain missing question numbers.

    Strategy:
      1. Scan each extracted page text for question numbers it contains.
      2. For each missing question number, find the page whose question range
         brackets it (prev_found ≤ missing ≤ next_found).
      3. Deduplicate pages, send each to Vision, parse results.

    Cost: typically 2–10 pages = ~₹0.05–0.20 vs ₹3–6 for full Vision.
    """
    try:
        import PIL.Image as PILImage
        import io as _io
    except ImportError:
        return []

    # Build page → set-of-question-numbers mapping from extracted text
    _qn_pat = re.compile(r'(?:^|\n)\s*(?:Q\.?\s*)?(\d{1,3})[.)]\s+\S', re.MULTILINE)
    page_nums: list[set[int]] = []
    for page_text in pages:
        nums = {int(m.group(1)) for m in _qn_pat.finditer(page_text)}
        page_nums.append(nums)

    # For each missing question number, identify the PDF page index to scan.
    # Use the page whose known question numbers straddle the missing one.
    target_page_indices: set[int] = set()
    for mq in missing:
        best_idx: int | None = None
        best_dist: int = 999999
        for pi, nums in enumerate(page_nums):
            if not nums:
                continue
            # Distance from this page's question range to the missing number
            lo, hi = min(nums), max(nums)
            if lo <= mq <= hi:
                target_page_indices.add(pi)
                best_idx = None
                break
            dist = min(abs(mq - lo), abs(mq - hi))
            if dist < best_dist:
                best_dist = dist
                best_idx = pi
        if best_idx is not None:
            # Include the neighbouring page too (question may span a page boundary)
            target_page_indices.add(best_idx)
            if best_idx + 1 < len(pages):
                target_page_indices.add(best_idx + 1)

    if not target_page_indices:
        return []

    print(f"    🎯 Targeting {len(target_page_indices)} page(s) for Vision recovery")
    _vision_model = genai.GenerativeModel("gemini-2.5-flash-lite")
    doc = fitz.open(pdf_path)
    all_pages = list(doc)
    recovered: list[dict] = []

    # Safety settings: BLOCK_NONE for all categories to prevent safety-filter page drops
    _safety_off = [
        {"category": "HARM_CATEGORY_HARASSMENT",        "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_HATE_SPEECH",       "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
        {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
    ]

    # Map extracted-text page index → PDF page index.
    # extract_text() skips some pages (rough-work, instruction, Telugu-only).
    # Approximate: use the PDF page at the same relative position.
    total_pdf_pages = len(all_pages)
    total_ext_pages = max(len(pages), 1)

    missing_set = set(missing)

    for ext_idx in sorted(target_page_indices):
        pdf_idx = min(round(ext_idx * total_pdf_pages / total_ext_pages), total_pdf_pages - 1)
        pg_a = all_pages[pdf_idx]
        pg_b = all_pages[pdf_idx + 1] if pdf_idx + 1 < total_pdf_pages else None
        imgs = [PILImage.open(_io.BytesIO(pg_a.get_pixmap(dpi=200).tobytes("png")))]
        if pg_b:
            imgs.append(PILImage.open(_io.BytesIO(pg_b.get_pixmap(dpi=200).tobytes("png"))))

        # Identify which missing Q numbers are expected on this page
        page_missing = sorted(
            mq for mq in missing_set
            if page_nums[ext_idx] and (min(page_nums[ext_idx]) - 5) <= mq <= (max(page_nums[ext_idx]) + 5)
        ) if ext_idx < len(page_nums) and page_nums[ext_idx] else list(missing_set)

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
                    "Do NOT include any other questions. Output a JSON array with only these questions."
                )
            else:
                targeted_prompt = _VISION_STRUCT_PROMPT

            vision_ok = False
            for attempt in range(2):
                try:
                    resp = _vision_model.generate_content(
                        [targeted_prompt] + imgs,
                        generation_config=genai.GenerationConfig(temperature=0.1, max_output_tokens=8192),
                        safety_settings=_safety_off,
                        request_options={"timeout": 120},
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
                import pytesseract
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


# ══════════════════════════════════════════════════════════════════════════════
# MAIN PIPELINE
# ══════════════════════════════════════════════════════════════════════════════

def run_pipeline(pdf_path: str, exam_name: str, exam_year: int, job_id: str = None, answer_key_map: Optional[dict] = None) -> dict:
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

    # ── Step 1: Extract ───────────────────────────────────────────────────
    print("STEP 1/4 — Extracting text (local, free)...")
    _update_job(progress=5, status="processing")

    # UPSC Prelims: skip bilingual filter (it strips valid English content from Hindi pages)
    is_upsc = "upsc" in exam_name.lower()
    pages = extract_text(pdf_path, tracker, skip_bilingual=is_upsc)
    if not pages:
        _update_job(status="failed", error="No text extracted from PDF")
        return None

    # ── Step 2: Parse ─────────────────────────────────────────────────────
    print("\nSTEP 2/4 — Parsing questions (local regex, free)...")
    questions = parse_questions_local(pages)

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

    # ── Quality gate: fall back to Vision structured extraction ───────────
    # Custom-font bilingual PDFs (e.g. TSPSC Group 3) produce garbled option
    # text or miss C/D options entirely. Detect this and switch to Vision.
    quality = _parse_quality(questions)
    print(f"  ✅ Parse quality {quality:.0%} — {len(questions)} questions from regex (₹0)")

    # ── Targeted Vision: recover only MISSING question numbers ───────────────
    # Strategy: use known exam question count for range, then call Vision only
    # on the exact pages where missing questions should be — costs ~5% of full Vision.
    if questions:
        # Only count questions with valid text as "found" — short-text false detections
        # must NOT block Vision recovery for those question numbers.
        found_nums = {q["question_number"] for q in questions
                      if (q.get("question_text") or "").strip() and len((q.get("question_text") or "").strip()) >= 10}
        # Use exam-aware expected range so Q1/Q100 at boundaries aren't silently skipped
        expected_count = 100 if is_upsc else 150
        min_q = 1
        max_q = expected_count
        missing = [n for n in range(min_q, max_q + 1) if n not in found_nums]
        missing_pct = len(missing) / expected_count

        if missing and missing_pct > 0.00:  # Any missing question → run targeted recovery
            print(f"\n  🔍 {len(missing)} question numbers missing ({missing_pct:.0%}): "
                  f"{missing[:10]}{'...' if len(missing) > 10 else ''}")
            print("  🎯 Running targeted Vision only on pages containing missing questions...")
            recovered = _targeted_vision_recovery(pdf_path, missing, pages, tracker)
            if recovered:
                # Merge: keep whichever source has more complete options per question
                regex_map = {q["question_number"]: q for q in questions}
                for vq in recovered:
                    n = vq["question_number"]
                    r = regex_map.get(n)
                    if r:
                        r_opts = sum(1 for k in ("option_a","option_b","option_c","option_d") if r.get(k))
                        v_opts = sum(1 for k in ("option_a","option_b","option_c","option_d") if vq.get(k))
                        if v_opts > r_opts:
                            regex_map[n] = vq
                    else:
                        regex_map[n] = vq
                questions = sorted(regex_map.values(), key=lambda q: q["question_number"])
                print(f"  ✅ After targeted recovery: {len(questions)} questions total")

    _update_job(progress=15)

    # ── Step 3: English filter ────────────────────────────────────────────
    print("\nSTEP 3/4 — Filtering English questions...")
    questions = filter_english(questions)
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
    result = store_questions(questions, Path(pdf_path).name, exam_name, exam_year)

    # ── Step 5b: Inject answers from separate answer key ──────────────────
    if answer_key_map:
        print(f"\n  💉 Injecting {len(answer_key_map)} answers from separate answer key...")
        inj = inject_answers(answer_key_map, exam_name, exam_year)
        result["injected_answers"] = inj["updated"]

    # ── Step 6: Bulk explanations (one-time, ~₹0.22 for 150 Qs) ──────────
    print("\nSTEP 6/6 — Generating explanations (one-time for all users)...")
    expl_result = generate_explanations_bulk(exam_name, exam_year, job_id, tracker)

    _update_job(progress=100, status="completed")

    tracker.print_summary()
    tracker.save_log(exam_name, exam_year, len(questions))

    print(f"\n{'='*60}")
    print(f"✅ Done!")
    print(f"   Questions    — Inserted: {result['inserted']}, Skipped: {result['skipped']}")
    print(f"   Explanations — Generated: {expl_result['generated']}, Already existed: {expl_result['skipped']}")
    print(f"💰 Cost for every future upload of same paper: ₹0 (fully cached)")
    if result["errors"]:
        print(f"⚠️  Errors: {result['errors']}")
    print(f"{'='*60}\n")

    return result


def process_job_background(job_id: str, pdf_path: str, exam_name: str, exam_year: int, answer_key_map: Optional[dict] = None):
    """Background worker entry point."""
    try:
        run_pipeline(pdf_path, exam_name, exam_year, job_id, answer_key_map=answer_key_map)
    except Exception as e:
        print(f"Job {job_id} failed: {e}")
        try:
            get_supabase().table("jobs").update({
                "status": "failed", "error_log": str(e)
            }).eq("id", job_id).execute()
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
    try:
        from PIL import Image as PILImage
        import pytesseract
        import io as _io
    except ImportError:
        raise RuntimeError("Pillow and pytesseract are required: pip install pillow pytesseract")

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
    import tempfile

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
