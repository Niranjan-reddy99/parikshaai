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
  "question_text": "exact question text from the page",
  "option_a": "exact option A text",
  "option_b": "exact option B text",
  "option_c": "exact option C text",
  "option_d": "exact option D text"
}}

Rules:
- Extract only MCQs from this page.
- This page may contain both questions and solutions. Ignore solutions and extract only question MCQs.
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


def validate_stage12_question(item: dict[str, Any]) -> tuple[bool, list[str], dict[str, Any]]:
    reasons: list[str] = []
    normalized = {
        "question_number": item.get("question_number"),
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


def _call_gemini_stage12(page_image: Image.Image, *, heading: str | None, page_type: str) -> list[dict[str, Any]]:
    prompt = _STAGE12_PROMPT.format(page_type=page_type, heading=heading or "Unknown")
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

        for page_row in classification_report["pages"]:
            if page_row["page_type"] not in {"question_page", "mixed_special_page"}:
                continue

            page_number = int(page_row["page_number"])
            page = doc[page_number - 1]
            png_bytes = _render_page_png_bytes(page, dpi=220)
            page_image = Image.open(BytesIO(png_bytes))
            raw_items = caller(
                page_image,
                heading=page_row.get("detected_pattern_heading"),
                page_type=page_row["page_type"],
            )

            page_valid = 0
            page_invalid = 0
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
                        "detected_pattern_heading": page_row.get("detected_pattern_heading"),
                    }
                )
                ok, reasons, normalized = validate_stage12_question(item)
                if ok:
                    page_valid += 1
                    valid_questions.append(
                        {
                            **normalized,
                            "source_page_number": page_number,
                            "source_page_type": page_row["page_type"],
                            "detected_pattern_heading": page_row.get("detected_pattern_heading"),
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

            pages_processed.append(
                {
                    "page_number": page_number,
                    "page_type": page_row["page_type"],
                    "detected_pattern_heading": page_row.get("detected_pattern_heading"),
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
