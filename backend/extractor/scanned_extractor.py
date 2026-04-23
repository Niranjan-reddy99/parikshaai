import json
import time
import io
import os
import re
import concurrent.futures as _cf
from typing import Optional, Any

import fitz

from ai_models import EXTRACTION_MODEL, get_genai_client
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

# Assuming these existing configs
from extraction_cleanup import clean_and_dedupe_questions
from pipeline import CostTracker, get_supabase, _is_instruction_page, filter_instruction_like_questions
from extractor.universal_extractor import _strip_fences
_CLIENT = get_genai_client()

_VISION_MODEL = EXTRACTION_MODEL

_EXECUTOR = _cf.ThreadPoolExecutor(max_workers=4, thread_name_prefix="scanned-genai")

def _timed_generate(model: str, contents: Any, config: types.GenerateContentConfig,
                    timeout_secs: int, label: str) -> Any:
    """Call generate_content() with a guaranteed Python-level timeout."""
    fut = _EXECUTOR.submit(_CLIENT.models.generate_content,
                           model=model, contents=contents, config=config)
    try:
        return fut.result(timeout=timeout_secs)
    except _cf.TimeoutError:
        raise TimeoutError(f"[{label}] Gemini API timed out after {timeout_secs}s")

_SCANNED_PROMPT = """You are an expert AI extractor for Indian competitive exams (UPSC, state PSC, etc.).
This is a scanned, handwritten, or Xeroxed page of an exam paper. 

Your tasks:
1. Extract ALL questions visible on this page. Do not miss any question.
2. The options are generally A, B, C, D or 1, 2, 3, 4. You must extract them exactly as printed.
3. If this is a bilingual paper (e.g. English and Hindi/Telugu printed side-by-side), extract the ENGLISH version ONLY. Ignore the regional language translation.
3a. If the same question appears in English and Hindi/regional text, return ONLY the English version.
4. If a student has circled, ticked, or otherwise marked an option as their answer on this scanned copy, you must detect it and include it as "student_answer". If no option is clearly marked by the student, set it to null.
5. "correct_answer" must be null because this is just a question paper.
6. Look out for "Match the following" or "Assertion/Reasoning" formats and keep their text intact.
7. Preserve mathematical notation and symbols exactly where possible: %, +, -, ×, ÷, =, <, >, ≤, ≥, √, π, °, ₹, fractions, ratios, exponents, coordinates.
8. If a question depends on a table, graph, chart, map, diagram, geometry figure, number line, dice/cube/net, or data-interpretation visual, set "has_image": true.
9. Ignore cover pages, hall-ticket instructions, general directions, and non-question admin text.
10. Return ONLY a JSON array, no markdown fences, no conversational text.

Schema:
[
  {
    "question_number": <int>,
    "question_text": "<text>",
    "option_a": "<text>",
    "option_b": "<text>",
    "option_c": "<text>",
    "option_d": "<text>",
    "correct_answer": null,
    "student_answer": "<A/B/C/D> or null",
    "has_image": false,
    "needs_review": true
  }
]
"""

_QUESTION_START_RE = re.compile(r'^\s*(\d{1,3})\s*[\.\)]')


def _render_clip_png(page: fitz.Page, clip: Optional[fitz.Rect] = None, dpi: int = 300) -> bytes:
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, clip=clip, colorspace=fitz.csRGB, alpha=False)
    return pix.tobytes("png")


def _column_clips(page: fitz.Page) -> list[fitz.Rect]:
    rect = page.rect
    gutter = rect.width * 0.02
    overlap = rect.width * 0.015
    split_x = rect.width * 0.5
    left = fitz.Rect(rect.x0, rect.y0, split_x - gutter + overlap, rect.y1)
    right = fitz.Rect(split_x - overlap + gutter, rect.y0, rect.x1, rect.y1)
    return [left, right]


def _bottom_band_clips(page: fitz.Page) -> list[tuple[fitz.Rect, str]]:
    rect = page.rect
    band_top = rect.y0 + rect.height * 0.68
    return [
        (fitz.Rect(*_column_clips(page)[0][:2], _column_clips(page)[0].x1, rect.y1), "[bottom-left]"),
        (fitz.Rect(_column_clips(page)[1].x0, band_top, _column_clips(page)[1].x1, rect.y1), "[bottom-right]"),
    ]


def _dedupe_questions(questions: list[dict]) -> list[dict]:
    return clean_and_dedupe_questions(questions)


def _looks_like_question_batch(questions: list[dict]) -> bool:
    if not questions:
        return False
    numbered = sum(1 for q in questions if isinstance(q.get("question_number"), int))
    with_text = sum(1 for q in questions if len((q.get("question_text") or "").strip()) >= 20)
    return numbered >= max(1, len(questions) // 2) and with_text >= max(1, len(questions) // 2)


def _option_count(q: dict) -> int:
    return sum(
        1 for key in ("option_a", "option_b", "option_c", "option_d")
        if (q.get(key) or "").strip()
    )


def _extract_scanned_part(
    pdf_path: str,
    page_idx: int,
    page: fitz.Page,
    tracker: CostTracker,
    clip: Optional[fitz.Rect] = None,
    label: str = "",
    target_numbers: Optional[list[int]] = None,
    retries: int = 3,
) -> list[dict]:
    png_bytes = _render_clip_png(page, clip=clip, dpi=300)
    image_part = types.Part.from_bytes(data=png_bytes, mime_type="image/png")
    prompt = _SCANNED_PROMPT
    if target_numbers:
        prompt += (
            f"\nIMPORTANT: Extract ONLY these question numbers if present in this image: {target_numbers}. "
            "Do not invent questions. Do not include any other question numbers."
        )

    last_err = None
    for attempt in range(retries):
        try:
            resp = _timed_generate(
                model=_VISION_MODEL,
                contents=[prompt, image_part],
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    max_output_tokens=8192,
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                    http_options=types.HttpOptions(timeout=45000)
                ),
                timeout_secs=60,
                label=f"scanned{label}"
            )
            if tracker:
                try:
                    _m = resp.usage_metadata
                    tracker.record("Scanned Vision", _m.prompt_token_count, _m.candidates_token_count)
                except Exception:
                    pass

            raw = _strip_fences(resp.text or "")
            if not raw or raw == "[]":
                return []
                
            questions = json.loads(raw)
            if isinstance(questions, list):
                tag = f" p{page_idx+1}{label}" if label else f" p{page_idx+1}"
                print(f"  [scanned-ocr]{tag}: {len(questions)} questions extracted")
                return questions
                
        except json.JSONDecodeError as e:
            last_err = e
            time.sleep(2 ** attempt)
        except Exception as e:
            last_err = e
            err_str = str(e)
            if "429" in err_str or "quota" in err_str.lower():
                wait = 60 * (attempt + 1)
                time.sleep(wait)
            else:
                time.sleep(2 ** attempt)

    tag = f" p{page_idx+1}{label}" if label else f" p{page_idx+1}"
    print(f"  [error] scanned{tag} failed: {last_err}")
    return []


def _extract_scanned_pair(
    left_page: fitz.Page,
    right_page: fitz.Page,
    *,
    left_idx: int,
    tracker: CostTracker,
    target_numbers: list[int],
) -> list[dict]:
    if not target_numbers:
        return []

    prompt = (
        _SCANNED_PROMPT
        + "\nIMPORTANT: These are TWO CONSECUTIVE pages from the same bilingual paper."
        + "\nA question may start on the first page and continue on the second page."
        + "\nExtract ONLY the ENGLISH version and merge split stems/options across both pages."
        + f"\nExtract ONLY these question numbers if present: {target_numbers}."
        + "\nDo not return Telugu-only duplicates."
    )
    try:
        parts = [
            prompt,
            types.Part.from_bytes(data=_render_clip_png(left_page, clip=None, dpi=300), mime_type="image/png"),
            types.Part.from_bytes(data=_render_clip_png(right_page, clip=None, dpi=300), mime_type="image/png"),
        ]
        resp = _timed_generate(
            model=_VISION_MODEL,
            contents=parts,
            config=types.GenerateContentConfig(
                temperature=0.0,
                max_output_tokens=8192,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
                http_options=types.HttpOptions(timeout=60000),
            ),
            timeout_secs=75,
            label=f"scanned-pair p{left_idx+1}-{left_idx+2}",
        )
        if tracker:
            try:
                _m = resp.usage_metadata
                tracker.record("Scanned Pair Recovery", _m.prompt_token_count, _m.candidates_token_count)
            except Exception:
                pass

        raw = _strip_fences(resp.text or "")
        if not raw or raw == "[]":
            return []
        questions = json.loads(raw)
        if isinstance(questions, list):
            print(f"  [scanned-pair] p{left_idx+1}-{left_idx+2}: {len(questions)} questions recovered")
            return questions
    except Exception as e:
        print(f"  [scanned-pair] p{left_idx+1}-{left_idx+2} failed: {e}")
    return []


def extract_scanned_page(
    pdf_path: str,
    page_idx: int,
    page: fitz.Page,
    tracker: CostTracker,
    retries: int = 3,
) -> list[dict]:
    raw_text = (page.get_text("text") or "").strip()
    if page_idx <= 2 and raw_text and _is_instruction_page(raw_text[:2500]):
        print(f"  [scanned-skip] p{page_idx+1} — instruction page detected from raw text")
        return []

    # For faint 2-column papers, OCRing each column separately is far more stable
    # than asking the model to infer reading order from the whole page image.
    column_questions: list[dict] = []
    for idx, clip in enumerate(_column_clips(page), start=1):
        qs = _extract_scanned_part(
            pdf_path,
            page_idx,
            page,
            tracker,
            clip=clip,
            label=f"[col{idx}]",
            retries=retries,
        )
        column_questions.extend(qs)

    column_questions = filter_instruction_like_questions(_dedupe_questions(column_questions))
    if _looks_like_question_batch(column_questions):
        if page_idx <= 2:
            rich_rows = sum(1 for q in column_questions if _option_count(q) >= 2)
            if len(column_questions) >= 4 and rich_rows <= 1:
                print(f"  [scanned-skip] p{page_idx+1} — probable instruction page (low option density)")
                return []
        return column_questions

    # Fallback: whole-page OCR can still help on single-column or unusual layouts.
    full_page_questions = _extract_scanned_part(
        pdf_path,
        page_idx,
        page,
        tracker,
        clip=None,
        label="[full]",
        retries=retries,
    )

    merged = filter_instruction_like_questions(_dedupe_questions(column_questions + full_page_questions))
    if page_idx <= 2:
        rich_rows = sum(1 for q in merged if _option_count(q) >= 2)
        if len(merged) >= 4 and rich_rows <= 1:
            print(f"  [scanned-skip] p{page_idx+1} — probable instruction page after fallback")
            return []

    numbered = sorted(q.get("question_number") for q in merged if isinstance(q.get("question_number"), int))
    if numbered:
        last_num = numbered[-1]
        bottom_band_questions: list[dict] = []
        for clip, label in _bottom_band_clips(page):
            qs = _extract_scanned_part(
                pdf_path,
                page_idx,
                page,
                tracker,
                clip=clip,
                label=label,
                retries=max(1, retries - 1),
            )
            bottom_band_questions.extend(qs)
        if bottom_band_questions:
            merged = filter_instruction_like_questions(_dedupe_questions(merged + bottom_band_questions))
            new_numbered = sorted(q.get("question_number") for q in merged if isinstance(q.get("question_number"), int))
            if new_numbered and new_numbered[-1] > last_num:
                print(f"  [scanned-recover] p{page_idx+1} — recovered tail question(s) up to Q{new_numbered[-1]}")
    return merged

def process_scanned_job(
    pdf_path: str,
    job_id: str,
    exam_name: str,
    exam_year: int,
    tracker: CostTracker,
    expected_count: int = 0,
) -> list[dict]:
    doc = fitz.open(pdf_path)
    all_questions = []
    page_question_numbers: list[set[int]] = []
    sb = get_supabase()

    for idx, page in enumerate(doc):
        # Update progress
        progress = int(10 + 60 * (idx / len(doc)))
        if sb:
            try:
                sb.table("jobs").update({"progress": progress, "status": "processing"}).eq("id", job_id).execute()
            except Exception:
                pass
                
        qs = extract_scanned_page(pdf_path, idx, page, tracker)
        page_question_numbers.append({
            q.get("question_number") for q in qs if isinstance(q.get("question_number"), int)
        })
        for q in qs:
            q.setdefault("exam_section", "General Studies")
            q.setdefault("passage", "")
            all_questions.append(q)

    deduped = sorted(_dedupe_questions(all_questions), key=lambda x: x.get("question_number", 0) or 0)

    found_nums = {q.get("question_number") for q in deduped if isinstance(q.get("question_number"), int)}
    if expected_count > 0 and found_nums:
        missing = [n for n in range(1, expected_count + 1) if n not in found_nums]
        if missing:
            print(f"  [scanned-gap] Detected {len(missing)} missing question number(s): {missing[:12]}")
            recovered: list[dict] = []
            for idx, page in enumerate(doc):
                present = sorted(page_question_numbers[idx]) if idx < len(page_question_numbers) else []
                if not present:
                    continue
                candidate_missing = [
                    n for n in missing
                    if (min(present) - 2) <= n <= (max(present) + 2)
                ]
                if not candidate_missing:
                    continue
                print(f"  [scanned-gap] p{idx+1} retry for missing {candidate_missing}")
                targeted_questions: list[dict] = []
                targeted_questions.extend(_extract_scanned_part(
                    pdf_path, idx, page, tracker, clip=None, label="[target-full]",
                    target_numbers=candidate_missing, retries=2
                ))
                for clip, label in _bottom_band_clips(page):
                    targeted_questions.extend(_extract_scanned_part(
                        pdf_path, idx, page, tracker, clip=clip, label=label + "[target]",
                        target_numbers=candidate_missing, retries=2
                    ))
                if targeted_questions:
                    recovered.extend(targeted_questions)
            if recovered:
                deduped = sorted(
                    _dedupe_questions(deduped + filter_instruction_like_questions(recovered)),
                    key=lambda x: x.get("question_number", 0) or 0,
                )
                final_nums = {q.get("question_number") for q in deduped if isinstance(q.get("question_number"), int)}
                still_missing = [n for n in range(1, expected_count + 1) if n not in final_nums]
                print(f"  [scanned-gap] Recovery complete. Remaining missing: {still_missing[:12]}")
                missing = still_missing

            if missing:
                pair_recovered: list[dict] = []
                for idx in range(max(0, len(page_question_numbers) - 1)):
                    left_present = sorted(page_question_numbers[idx]) if idx < len(page_question_numbers) else []
                    right_present = sorted(page_question_numbers[idx + 1]) if (idx + 1) < len(page_question_numbers) else []
                    if not left_present or not right_present:
                        continue
                    candidate_missing = [
                        n for n in missing
                        if any(x in left_present for x in (n - 1, n))
                        and any(x in right_present for x in (n, n + 1))
                    ]
                    if not candidate_missing:
                        continue
                    pair_recovered.extend(
                        _extract_scanned_pair(
                            doc[idx],
                            doc[idx + 1],
                            left_idx=idx,
                            tracker=tracker,
                            target_numbers=candidate_missing,
                        )
                    )
                if pair_recovered:
                    deduped = sorted(
                        _dedupe_questions(deduped + filter_instruction_like_questions(pair_recovered)),
                        key=lambda x: x.get("question_number", 0) or 0,
                    )
                    final_nums = {q.get("question_number") for q in deduped if isinstance(q.get("question_number"), int)}
                    still_missing = [n for n in range(1, expected_count + 1) if n not in final_nums]
                    print(f"  [scanned-gap] Pair recovery complete. Remaining missing: {still_missing[:12]}")

    doc.close()
    return deduped
