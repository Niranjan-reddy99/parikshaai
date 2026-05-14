from __future__ import annotations

import hashlib
import json
import os
import re
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image
from dotenv import load_dotenv
from google import genai
from google.genai import types

from .pattern_book_classifier import classify_pattern_book_pdf, _render_page_png_bytes

load_dotenv()

_VISION_MODEL = os.getenv("PATTERN_BOOK_GEMINI_STAGE12_MODEL", "publishers/google/models/gemini-2.5-flash")


@lru_cache(maxsize=1)
def _get_client():
    return genai.Client(
        vertexai=True,
        project=os.getenv("GOOGLE_CLOUD_PROJECT"),
        location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
    )

_STAGE12_PROMPT = """You are extracting multiple-choice questions from a scanned SSC pattern-book page image.

Return ONLY a JSON array. No markdown. No prose. No explanation.

For each readable MCQ visible on this page, return exactly:
{{
  "question_number": 123,
  "pattern_tag": "Type 1: Percentage increase and decrease",
  "question_text": "exact question text from the page",
  "option_a": "exact option A text",
  "option_b": "exact option B text",
  "option_c": "exact option C text",
  "option_d": "exact option D text"
}}

Rules:
- Extract only MCQs from this page.
- This page may contain both questions and solutions. Ignore solutions and extract only question MCQs.
- Capture the active pattern heading for each question as `pattern_tag`.
- Pattern headings may look like: "Type 1", "Pattern 2", "Questions based on successive discount", "Percentage increase/decrease".
- If this page does not introduce a new pattern heading, carry forward the current active pattern heading provided below.
- Preserve wording, statements, symbols, blanks, and numeric values as closely as possible.
- Do not paraphrase.
- Do not guess missing text.
- Do not invent unreadable options.
- Omit unreadable questions rather than guessing.
- Do not include answers.
- Do not include solution steps.
- Ignore watermark, Telegram, promo, and footer noise.
- Output must be a single valid JSON array only.

Page type from classifier: {page_type}
Detected heading: {heading}
Current active pattern heading fallback: {current_pattern}
"""


def pattern_book_gemini_stage12_report_path(pdf_path: str) -> Path:
    pdf_file = Path(pdf_path)
    digest = hashlib.sha256(str(pdf_file.resolve()).encode("utf-8")).hexdigest()[:16]
    reports_dir = Path(__file__).resolve().parent.parent / "cache" / "pattern_book_gemini_stage12"
    reports_dir.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", pdf_file.stem)[:80]
    return reports_dir / f"{safe_name}_{digest}.json"


def _extract_json_array(raw_text: str) -> list[dict[str, Any]]:
    raw = (raw_text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
    start = raw.find("[")
    end = raw.rfind("]")
    if start == -1 or end == -1 or end < start:
        raise ValueError("Gemini response did not contain a JSON array")
    parsed = json.loads(raw[start : end + 1])
    if not isinstance(parsed, list):
        raise ValueError("Gemini response root was not a JSON array")
    return parsed


def _normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def _looks_like_bad_pattern_tag(value: str) -> bool:
    text = _normalize_text(value)
    if not text:
        return True
    if len(text) > 120:
        return True
    if re.match(r"^\d{2,4}\.", text):
        return True
    if "ssc chsl" in text.lower() and len(text.split()) > 8:
        return True
    if len(re.findall(r"\d", text)) >= 10 and len(re.findall(r"[A-Za-z]", text)) < 20:
        return True
    return False


def _normalize_pattern_tag(value: Any, *, fallback: str) -> str:
    text = _normalize_text(value)
    text = re.sub(r"^[=—\-:;| ]+|[=—\-:;| ]+$", "", text).strip()
    text = re.sub(r"\s+\d{1,3}$", "", text).strip()
    if _looks_like_bad_pattern_tag(text):
        return fallback
    # Chapter headings are useful as a last resort, but if we've already carried
    # forward a more specific live pattern heading from earlier in the book,
    # prefer that over collapsing back to the chapter title.
    if (
        text.lower().startswith("chapter")
        and fallback
        and fallback != "General Pattern"
        and not fallback.lower().startswith("chapter")
    ):
        return fallback
    return text


def validate_stage12_question(item: dict[str, Any], *, pattern_fallback: str) -> tuple[bool, list[str], dict[str, Any]]:
    reasons: list[str] = []
    normalized = {
        "question_number": item.get("question_number"),
        "pattern_tag": _normalize_pattern_tag(item.get("pattern_tag"), fallback=pattern_fallback),
        "question_text": _normalize_text(item.get("question_text")),
        "option_a": _normalize_text(item.get("option_a")),
        "option_b": _normalize_text(item.get("option_b")),
        "option_c": _normalize_text(item.get("option_c")),
        "option_d": _normalize_text(item.get("option_d")),
    }

    qn = normalized["question_number"]
    if not isinstance(qn, int):
        if isinstance(qn, str) and qn.strip().isdigit():
            normalized["question_number"] = int(qn.strip())
        else:
            reasons.append("missing_or_invalid_question_number")

    if not normalized["question_text"]:
        reasons.append("empty_question_text")

    options = [normalized["option_a"], normalized["option_b"], normalized["option_c"], normalized["option_d"]]
    for idx, value in enumerate(options, start=1):
        if not value:
            reasons.append(f"missing_option_{idx}")

    cleaned = [re.sub(r"[^A-Za-z0-9%./+-]+", "", opt).lower() for opt in options if opt]
    if len(cleaned) >= 2 and len(set(cleaned)) < len(cleaned):
        reasons.append("duplicate_options")

    noise_like = 0
    for opt in options:
        alnum_count = len(re.findall(r"[A-Za-z0-9]", opt))
        if opt and alnum_count == 0:
            noise_like += 1
    if noise_like:
        reasons.append("option_noise")

    return len(reasons) == 0, reasons, normalized


def _call_gemini_stage12(
    page_image: Image.Image,
    *,
    heading: str | None,
    page_type: str,
    current_pattern: str | None,
) -> list[dict[str, Any]]:
    prompt = _STAGE12_PROMPT.format(
        page_type=page_type,
        heading=heading or "Unknown",
        current_pattern=current_pattern or heading or "Unknown",
    )
    resp = _get_client().models.generate_content(
        model=_VISION_MODEL,
        contents=[prompt, page_image],
        config=types.GenerateContentConfig(
            temperature=0.0,
            max_output_tokens=8192,
            response_mime_type="application/json",
        ),
    )
    return _extract_json_array(resp.text or "")


def run_pattern_book_gemini_stage12(
    pdf_path: str,
    *,
    write_report: bool = True,
    classification_report: dict[str, Any] | None = None,
    gemini_caller: Any | None = None,
) -> dict[str, Any]:
    try:
        import fitz  # type: ignore
    except ImportError as exc:
        raise RuntimeError("PyMuPDF (fitz) is required for Gemini Stage 1/2 extraction") from exc

    if classification_report is None:
        classification_report = classify_pattern_book_pdf(pdf_path, write_report=True)
    caller = gemini_caller or _call_gemini_stage12

    doc = fitz.open(pdf_path)
    try:
        pages_processed: list[dict[str, Any]] = []
        extracted_questions: list[dict[str, Any]] = []
        valid_questions: list[dict[str, Any]] = []
        review_bucket: list[dict[str, Any]] = []
        current_pattern_heading = "General Pattern"

        for page_row in classification_report["pages"]:
            if page_row["page_type"] not in {"question_page", "mixed_special_page"}:
                continue

            classifier_heading = _normalize_pattern_tag(
                page_row.get("detected_pattern_heading"),
                fallback=current_pattern_heading,
            )
            if classifier_heading and not _looks_like_bad_pattern_tag(classifier_heading):
                current_pattern_heading = classifier_heading

            page_number = int(page_row["page_number"])
            page = doc[page_number - 1]
            png_bytes = _render_page_png_bytes(page, dpi=220)
            page_image = Image.open(BytesIO(png_bytes))
            raw_items = caller(
                page_image,
                heading=classifier_heading,
                page_type=page_row["page_type"],
                current_pattern=current_pattern_heading,
            )

            page_valid = 0
            page_invalid = 0
            page_patterns: set[str] = set()
            for idx, item in enumerate(raw_items):
                if not isinstance(item, dict):
                    page_invalid += 1
                    review_bucket.append(
                        {
                            "page_number": page_number,
                            "page_type": page_row["page_type"],
                            "object_index": idx,
                            "reasons": ["non_object_json_item"],
                            "raw_item": item,
                        }
                    )
                    continue

                extracted_questions.append(
                    {
                        **item,
                        "source_page_number": page_number,
                        "source_page_type": page_row["page_type"],
                        "detected_pattern_heading": classifier_heading,
                    }
                )
                ok, reasons, normalized = validate_stage12_question(
                    item,
                    pattern_fallback=current_pattern_heading,
                )
                if ok:
                    page_valid += 1
                    page_patterns.add(normalized.get("pattern_tag") or current_pattern_heading)
                    valid_questions.append(
                        {
                            **normalized,
                            "source_page_number": page_number,
                            "source_page_type": page_row["page_type"],
                            "detected_pattern_heading": classifier_heading,
                            "classification_source": page_row.get("classification_source"),
                            "classification_confidence": page_row.get("classification_confidence"),
                        }
                    )
                else:
                    page_invalid += 1
                    review_bucket.append(
                        {
                            "page_number": page_number,
                            "page_type": page_row["page_type"],
                            "object_index": idx,
                            "reasons": reasons,
                            "raw_item": item,
                        }
                    )

            if page_patterns:
                # Preserve the most recently seen real pattern heading so pages
                # that continue the same section without repeating the title
                # still inherit the right grouping.
                current_pattern_heading = sorted(page_patterns, key=lambda value: (len(value), value))[-1]

            pages_processed.append(
                {
                    "page_number": page_number,
                    "page_type": page_row["page_type"],
                    "detected_pattern_heading": classifier_heading,
                    "resolved_pattern_tags": sorted(page_patterns),
                    "classification_source": page_row.get("classification_source"),
                    "classification_confidence": page_row.get("classification_confidence"),
                    "questions_extracted": page_valid,
                    "invalid_question_objects": page_invalid,
                }
            )

        report = {
            "pdf_path": str(Path(pdf_path).resolve()),
            "page_count": classification_report["page_count"],
            "classification_counts": classification_report["counts"],
            "summary": {
                "pages_processed": len(pages_processed),
                "total_questions_extracted": len(extracted_questions),
                "valid_extracted_questions": len(valid_questions),
                "review_bucket_count": len(review_bucket),
            },
            "pages_processed": pages_processed,
            "extracted_questions": extracted_questions,
            "valid_questions": valid_questions,
            "review_bucket": review_bucket,
            "sample_extracted_mcqs": valid_questions[:8],
            "source_classification_report_path": classification_report.get("report_path"),
        }
        if write_report:
            report_path = pattern_book_gemini_stage12_report_path(pdf_path)
            report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
            report["report_path"] = str(report_path)
        return report
    finally:
        doc.close()
