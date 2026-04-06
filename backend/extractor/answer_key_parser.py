"""
answer_key_parser.py — Parse standalone answer key PDFs
========================================================
Handles all common formats found in Indian competitive exam answer keys:

  1. Inline pairs:  "1-A  2-B  3.C"  /  "1(A) 2(C)"  /  "1. C  2. D"
  2. Tabular rows:  "1  A\n2  B" or multi-column grids
  3. Verbose:       "Q.1 Answer: (B)" / "Question No.1 - Option (A)"
  4. Numeric codes: "1-3  2-1" → 1→A, 2→B, 3→C, 4→D
  5. Vision fallback: Gemini 1.5-flash for scanned/image-based keys

Returns: dict[int, str] mapping question_num → "A"/"B"/"C"/"D"
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF
from dotenv import load_dotenv

load_dotenv()

_NUM_TO_LETTER: dict[str, str] = {"1": "A", "2": "B", "3": "C", "4": "D"}


def _to_letter(s: str) -> Optional[str]:
    s = s.strip()
    u = s.upper()
    if u in "ABCD":
        return u
    return _NUM_TO_LETTER.get(s)


def _extract_pdf_text(pdf_path: str) -> str:
    doc = fitz.open(pdf_path)
    parts = [page.get_text("text") for page in doc]
    doc.close()
    return "\n".join(parts)


def _score_coverage(result: dict[int, str], expected: int) -> float:
    if not result or not expected:
        return 0.0
    covered = sum(1 for n in range(1, expected + 1) if n in result)
    return covered / expected


# ── Strategy 1: inline pairs ─────────────────────────────────────────────────

def _try_inline(text: str) -> dict[int, str]:
    """Handles: 1.A  1-A  1)A  1:A  1(A)  (1)A — with optional Q. prefix."""
    PAT = re.compile(
        r'(?<!\d)'              # no digit directly before
        r'(?:Q\.?\s*)?'         # optional Q. prefix
        r'(\d{1,3})'            # question number 1-300
        r'\s*[-.):,/]\s*'       # separator
        r'\(?([A-Da-d1-4])\)?', # answer letter or numeric code
        re.IGNORECASE,
    )
    result: dict[int, str] = {}
    for m in PAT.finditer(text):
        num = int(m.group(1))
        letter = _to_letter(m.group(2))
        if letter and 1 <= num <= 300 and num not in result:
            result[num] = letter
    return result


# ── Strategy 2: tabular (number whitespace letter) ───────────────────────────

def _try_tabular(text: str) -> dict[int, str]:
    """Handles single or multi-column tables: '1  A\n2  B' or '1 A 51 C'."""
    PAT = re.compile(r'(?<!\d)(\d{1,3})\s+([A-Da-d1-4])(?=\s|$)', re.MULTILINE)
    result: dict[int, str] = {}
    for m in PAT.finditer(text):
        num = int(m.group(1))
        letter = _to_letter(m.group(2))
        if letter and 1 <= num <= 300 and num not in result:
            result[num] = letter
    return result


# ── Strategy 3: verbose labels ───────────────────────────────────────────────

def _try_verbose(text: str) -> dict[int, str]:
    """Handles: 'Q.No.1 Ans A' / 'Question 1 Answer: (B)' / 'Ans to Q1: C'."""
    PAT = re.compile(
        r'(?:Q(?:uestion)?\.?\s*(?:No\.?)?\s*|Ans(?:wer)?\s+(?:to|for)?\s*[Qq]\.?\s*)'
        r'(\d{1,3})'
        r'\s*[-:.)]?\s*'
        r'(?:Ans(?:wer)?s?\.?\s*[-:.]?\s*)?'
        r'\(?([A-Da-d1-4])\)?',
        re.IGNORECASE,
    )
    result: dict[int, str] = {}
    for m in PAT.finditer(text):
        num = int(m.group(1))
        letter = _to_letter(m.group(2))
        if letter and 1 <= num <= 300 and num not in result:
            result[num] = letter
    return result


# ── Gemini Vision fallback ────────────────────────────────────────────────────

def _vision_answer_key(pdf_path: str, expected_count: int) -> dict[int, str]:
    """Gemini 1.5-flash fallback for scanned/image-based answer keys."""
    try:
        import google.generativeai as genai
        import PIL.Image as PILImage
        import io as _io
    except ImportError:
        print("  ❌ Gemini/PIL not available for vision answer key parsing")
        return {}

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {}

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-1.5-flash")
    gen_cfg = {"temperature": 0.0, "max_output_tokens": 2048,
               "thinking_config": {"thinking_budget": 0}}

    prompt = (
        f"This is an answer key for a {expected_count}-question multiple choice exam.\n"
        "Extract every question number and its correct answer letter.\n"
        "Return ONLY a JSON array: [{\"num\": 1, \"ans\": \"A\"}, {\"num\": 2, \"ans\": \"C\"}, ...]\n"
        "Rules:\n"
        "- Map numeric codes to letters: 1→A, 2→B, 3→C, 4→D\n"
        "- Lowercase answers (a,b,c,d) → uppercase\n"
        "- Include ALL visible question numbers, even if no answer is circled (skip those)\n"
        "- No explanation, no markdown — ONLY the JSON array."
    )

    doc = fitz.open(pdf_path)
    all_answers: dict[int, str] = {}

    for page_idx, page in enumerate(doc):
        pix = page.get_pixmap(dpi=200)
        img_bytes = pix.tobytes("png")
        try:
            img = PILImage.open(_io.BytesIO(img_bytes))
            resp = model.generate_content([prompt, img], generation_config=gen_cfg)
            raw = (resp.text or "").strip()
            if raw.startswith("```"):
                raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
            data = json.loads(raw)
            for item in data:
                num = int(item.get("num", 0))
                letter = _to_letter(str(item.get("ans", "")))
                if letter and 1 <= num <= 300:
                    all_answers.setdefault(num, letter)
        except Exception as e:
            print(f"  ⚠️  Vision answer key p{page_idx + 1}: {e}")

    doc.close()
    print(f"  🔍 Vision extracted {len(all_answers)} answers from answer key PDF")
    return all_answers


# ── Main entry point ─────────────────────────────────────────────────────────

def parse_answer_key(pdf_path: str, expected_count: int = 150) -> dict[int, str]:
    """
    Parse a standalone answer key PDF.

    Tries text-based strategies first (free), falls back to Gemini Vision
    only when text coverage is < 40% (scanned/image-based PDF).

    Args:
        pdf_path:       Path to the answer key PDF file.
        expected_count: Expected number of questions (for coverage scoring).

    Returns:
        dict mapping question_number (int) → correct_answer (str "A"/"B"/"C"/"D").
    """
    text = _extract_pdf_text(pdf_path)

    candidates = [
        ("verbose", _try_verbose(text)),
        ("inline",  _try_inline(text)),
        ("tabular", _try_tabular(text)),
    ]
    best_name, best = max(candidates, key=lambda x: _score_coverage(x[1], expected_count))
    score = _score_coverage(best, expected_count)

    print(f"  📋 Answer key ({best_name}): {len(best)} answers, {score:.0%} coverage")

    if score < 0.40:
        print(f"  ⚠️  Low text coverage — trying Gemini Vision on answer key...")
        vision_result = _vision_answer_key(pdf_path, expected_count)
        vision_score = _score_coverage(vision_result, expected_count)
        if vision_score > score:
            best = vision_result
            score = vision_score
            print(f"  ✅ Vision improved answer key coverage to {score:.0%}")

    if score < 0.10:
        print(f"  ❌ Answer key extraction failed ({score:.0%} coverage). Check PDF format.")

    return best
