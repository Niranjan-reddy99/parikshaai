from __future__ import annotations

import hashlib
from io import BytesIO
import json
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from PIL import Image
from dotenv import load_dotenv
from google import genai
from google.genai import types

from .pattern_book_classifier import classify_pattern_book_pdf, _render_page_png_bytes

load_dotenv()

_VISION_MODEL = os.getenv("PATTERN_BOOK_GEMINI_VISION_MODEL", "publishers/google/models/gemini-2.5-flash")


@lru_cache(maxsize=1)
def _get_client():
    return genai.Client(
        vertexai=True,
        project=os.getenv("GOOGLE_CLOUD_PROJECT"),
        location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
    )

_PROMPT_TEMPLATE = """You are extracting multiple-choice questions from a scanned SSC pattern-book question page.

Return ONLY a JSON array. No markdown. No explanation. No prose.

For each valid MCQ on the page, return exactly:
{{
  "question_number": 123,
  "question_text": "exact question text from the page",
  "option_a": "exact option A text",
  "option_b": "exact option B text",
  "option_c": "exact option C text",
  "option_d": "exact option D text"
}}

Rules:
- Extract ONLY question-page MCQs visible on this page.
- Preserve wording, numeric values, symbols, blanks, and statement structure as closely as possible.
- Do NOT paraphrase.
- Do NOT invent missing text.
- Do NOT include answers.
- Do NOT include solutions.
- Ignore watermark/Telegram/promo text.
- Ignore page headers/footers unless they are part of the question.
- If a question is badly unreadable, omit it rather than guessing.
- If the page heading is visible, use it only to understand the page, not as part of the question text.
- Output must be a single valid JSON array.

Detected heading on page: {heading}
"""


def pattern_book_gemini_report_path(pdf_path: str) -> Path:
    pdf_file = Path(pdf_path)
    digest = hashlib.sha256(str(pdf_file.resolve()).encode("utf-8")).hexdigest()[:16]
    reports_dir = Path(__file__).resolve().parent.parent / "cache" / "pattern_book_gemini_pilot"
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
        raise ValueError("Gemini response JSON root was not a list")
    return parsed


def validate_gemini_mcq_object(item: dict[str, Any]) -> tuple[bool, list[str], dict[str, Any]]:
    reasons: list[str] = []
    normalized = {
        "question_number": item.get("question_number"),
        "question_text": (item.get("question_text") or "").strip(),
        "option_a": (item.get("option_a") or "").strip(),
        "option_b": (item.get("option_b") or "").strip(),
        "option_c": (item.get("option_c") or "").strip(),
        "option_d": (item.get("option_d") or "").strip(),
    }

    qn = normalized["question_number"]
    if not isinstance(qn, int):
        if isinstance(qn, str) and qn.strip().isdigit():
            normalized["question_number"] = int(qn.strip())
        else:
            reasons.append("missing_or_invalid_question_number")

    if not normalized["question_text"]:
        reasons.append("empty_question_text")

    for label in ("option_a", "option_b", "option_c", "option_d"):
        if not normalized[label]:
            reasons.append(f"missing_{label}")

    return len(reasons) == 0, reasons, normalized


def _call_gemini_for_question_page(page_image: Image.Image, *, heading: str | None) -> list[dict[str, Any]]:
    prompt = _PROMPT_TEMPLATE.format(heading=heading or "Unknown")
    resp = _get_client().models.generate_content(
        model=_VISION_MODEL,
        contents=[prompt, page_image],
        config=types.GenerateContentConfig(
            temperature=0.0,
            max_output_tokens=8192,
            response_mime_type="application/json",
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    return _extract_json_array(resp.text or "")


def extract_pattern_book_question_pages_with_gemini(
    pdf_path: str,
    *,
    write_report: bool = True,
    classification_report: dict[str, Any] | None = None,
    gemini_caller: Any | None = None,
) -> dict[str, Any]:
    try:
        import fitz  # type: ignore
    except ImportError as exc:
        raise RuntimeError("PyMuPDF (fitz) is required for Gemini pilot extraction") from exc

    if classification_report is None:
        classification_report = classify_pattern_book_pdf(pdf_path, write_report=True)
    caller = gemini_caller or _call_gemini_for_question_page

    doc = fitz.open(pdf_path)
    try:
        pages_processed: list[dict[str, Any]] = []
        extracted_questions: list[dict[str, Any]] = []
        invalid_question_objects: list[dict[str, Any]] = []

        for page_row in classification_report["pages"]:
            if page_row["page_type"] != "question_page":
                continue
            page_number = int(page_row["page_number"])
            page = doc[page_number - 1]
            png_bytes = _render_page_png_bytes(page, dpi=220)
            page_image = Image.open(BytesIO(png_bytes))

            raw_items = caller(page_image, heading=page_row.get("detected_pattern_heading"))
            valid_count = 0
            invalid_count = 0
            for idx, item in enumerate(raw_items):
                if not isinstance(item, dict):
                    invalid_count += 1
                    invalid_question_objects.append(
                        {
                            "page_number": page_number,
                            "object_index": idx,
                            "reasons": ["non_object_json_item"],
                            "raw_item": item,
                        }
                    )
                    continue
                ok, reasons, normalized = validate_gemini_mcq_object(item)
                if ok:
                    valid_count += 1
                    extracted_questions.append(
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
                    invalid_count += 1
                    invalid_question_objects.append(
                        {
                            "page_number": page_number,
                            "object_index": idx,
                            "reasons": reasons,
                            "raw_item": item,
                        }
                    )

            pages_processed.append(
                {
                    "page_number": page_number,
                    "detected_pattern_heading": page_row.get("detected_pattern_heading"),
                    "classification_source": page_row.get("classification_source"),
                    "classification_confidence": page_row.get("classification_confidence"),
                    "questions_extracted": valid_count,
                    "invalid_question_objects": invalid_count,
                }
            )

        report = {
            "pdf_path": str(Path(pdf_path).resolve()),
            "page_count": classification_report["page_count"],
            "classification_counts": classification_report["counts"],
            "summary": {
                "question_pages_processed": len(pages_processed),
                "questions_extracted": len(extracted_questions),
                "invalid_question_objects": len(invalid_question_objects),
            },
            "pages_processed": pages_processed,
            "extracted_questions": extracted_questions,
            "invalid_question_objects": invalid_question_objects,
            "sample_extracted_mcqs": extracted_questions[:8],
            "source_classification_report_path": classification_report.get("report_path"),
        }
        if write_report:
            report_path = pattern_book_gemini_report_path(pdf_path)
            report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
            report["report_path"] = str(report_path)
        return report
    finally:
        doc.close()
