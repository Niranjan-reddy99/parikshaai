"""
answer_key_parser.py — Parse standalone answer key PDFs
========================================================
Handles all common formats found in Indian competitive exam answer keys:

  1. Inline pairs:  "1-A  2-B  3.C"  /  "1(A) 2(C)"  /  "1. C  2. D"
  2. Tabular rows:  "1  A\n2  B" or multi-column grids
  3. Verbose:       "Q.1 Answer: (B)" / "Question No.1 - Option (A)"
  4. Numeric codes: "1-3  2-1" → 1→A, 2→B, 3→C, 4→D
  5. Vision fallback: Gemini 2.0-flash for scanned/image-based keys

Returns: dict[int, str] mapping question_num → "A"/"B"/"C"/"D"
"""
from __future__ import annotations

import concurrent.futures as _cf
import json
import os
import re
from pathlib import Path
from typing import Optional

_EXECUTOR = _cf.ThreadPoolExecutor(max_workers=2, thread_name_prefix="akparser")

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
    """Gemini vision fallback for scanned/image-based answer keys."""
    try:
        from google import genai as _genai
        from google.genai import types as _gtypes
        import io as _io
    except ImportError:
        print("  ❌ google-genai not available for vision answer key parsing")
        return {}

    client = _genai.Client(
        vertexai=True,
        project=os.getenv("GOOGLE_CLOUD_PROJECT"),
        location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
    )

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
            img_part = _gtypes.Part.from_bytes(data=img_bytes, mime_type="image/png")
            fut = _EXECUTOR.submit(
                client.models.generate_content,
                model="publishers/google/models/gemini-2.5-flash",
                contents=[prompt, img_part],
                config=_gtypes.GenerateContentConfig(temperature=0.0, max_output_tokens=2048),
            )
            try:
                resp = fut.result(timeout=45)
            except _cf.TimeoutError:
                print(f"  ⚠️  Vision answer key p{page_idx + 1}: Gemini timed out after 45s — skipping page")
                continue
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

    # Only attempt vision fallback on small PDFs (≤ 8 pages). Large PDFs are
    # almost always question papers, not standalone answer keys, and sending
    # the whole document through vision can stall uploads for no real gain.
    # We still require at least a trace of answer-like text (> 2%) so scanned
    # answer keys can recover, but that signal alone must never override the
    # page-count guard.
    doc_page_count = len(fitz.open(pdf_path))
    if score < 0.40 and doc_page_count <= 8 and score > 0.02:
        print(f"  ⚠️  Low text coverage ({score:.0%}) — trying Gemini Vision on answer key "
              f"(PDF has {doc_page_count} pages)...")
        vision_result = _vision_answer_key(pdf_path, expected_count)
        vision_score = _score_coverage(vision_result, expected_count)
        if vision_score > score:
            best = vision_result
            score = vision_score
            print(f"  ✅ Vision improved answer key coverage to {score:.0%}")
    elif score < 0.40:
        print(f"  ℹ️  Skipping vision fallback: {doc_page_count}-page PDF with {score:.0%} "
              f"text coverage — likely no embedded answer key.")

    if score < 0.10:
        print(f"  ❌ Answer key extraction failed ({score:.0%} coverage). Check PDF format.")

    return best


def detect_paper_set(pdf_path: str) -> Optional[str]:
    """
    Detect the set/series label of a question paper (A/B/C/D).
    Scans first 3 pages for patterns like "SET A", "SERIES B", "BOOKLET C".
    Returns 'A', 'B', 'C', 'D', or None if not found.
    """
    doc = fitz.open(pdf_path)
    for page_idx in range(min(3, len(doc))):
        text = doc[page_idx].get_text("text")
        # Look for set label in common formats
        m = re.search(
            r'(?:SET|SERIES|BOOKLET|PAPER|CODE|VERSION)\s*[-:.]?\s*([A-D])\b',
            text, re.IGNORECASE
        )
        if m:
            doc.close()
            return m.group(1).upper()
        # Also check for just "BOOKLET No. A" or standalone "Series : A"
        m2 = re.search(r'\bSeries\s*[:\-]?\s*([A-D])\b', text, re.IGNORECASE)
        if m2:
            doc.close()
            return m2.group(1).upper()
    doc.close()
    return None


def parse_answer_key_multiset(pdf_path: str, expected_count: int = 150) -> dict[str, dict[int, str]]:
    """
    Parse an answer key PDF that contains multiple sets (A/B/C/D) in one PDF.

    Common formats:
      - Columns: "Q.No | SET A | SET B | SET C | SET D"
      - Sections: "SET A: 1-C 2-B ..." followed by "SET B: 1-A 2-D ..."
      - Table: rows of Q# with columns for each set

    Returns dict: {"A": {1: "A", 2: "C", ...}, "B": {...}, ...}
    Falls back to vision extraction if text parsing fails.
    """
    text = _extract_pdf_text(pdf_path)
    result: dict[str, dict[int, str]] = {}

    # Strategy 1: Find set-specific sections like "SET A" or "SERIES A" headers
    # then collect answers under each section until the next section
    SET_HEADER = re.compile(
        r'(?:SET|SERIES|BOOKLET|PAPER)\s*[-:]?\s*([A-D])\b',
        re.IGNORECASE
    )
    splits: list[tuple[str, int]] = []
    for m in SET_HEADER.finditer(text):
        splits.append((m.group(1).upper(), m.start()))

    if len(splits) >= 2:
        for idx in range(len(splits)):
            set_label: str = splits[idx][0]
            start_pos: int = splits[idx][1]
            next_start: int = splits[idx + 1][1] if idx + 1 < len(splits) else len(text)
            chunk = text[start_pos:next_start]
            # Try all parsing strategies on this chunk
            candidates = [
                _try_verbose(chunk),
                _try_inline(chunk),
                _try_tabular(chunk),
            ]
            best = max(candidates, key=lambda x: _score_coverage(x, expected_count))
            if best:
                result[set_label] = best

    # Strategy 2: Tabular format with set headers as columns
    # Look for patterns like "1 C A B D" where 4 answers follow each question number
    if len(result) < 2:
        # Try to find a table where rows are Q# and columns are sets A B C D
        TABLE_ROW = re.compile(
            r'(?<!\d)(\d{1,3})\s+([A-Da-d1-4])\s+([A-Da-d1-4])\s+([A-Da-d1-4])\s+([A-Da-d1-4])(?=\s|$)',
            re.MULTILINE
        )
        set_labels = ['A', 'B', 'C', 'D']
        temp: dict[str, dict[int, str]] = {s: {} for s in set_labels}
        for m in TABLE_ROW.finditer(text):
            q_num = int(m.group(1))
            if 1 <= q_num <= 300:
                for col_idx, set_label in enumerate(set_labels):
                    letter = _to_letter(m.group(col_idx + 2))
                    if letter:
                        temp[set_label][q_num] = letter
        # Only keep sets with reasonable coverage
        for s, answers in temp.items():
            if _score_coverage(answers, expected_count) > 0.30:
                result[s] = answers

    # If we found multi-set data, return it
    if len(result) >= 2:
        for s, answers in result.items():
            print(f"  📋 Multi-set key: Set {s} — {len(answers)} answers ({_score_coverage(answers, expected_count):.0%})")
        return result

    # Fallback: treat the whole PDF as a single-set key and return under all labels
    print(f"  ⚠️  Multi-set parse failed, treating as single set.")
    single = parse_answer_key(pdf_path, expected_count)
    return {"A": single, "B": single, "C": single, "D": single}
