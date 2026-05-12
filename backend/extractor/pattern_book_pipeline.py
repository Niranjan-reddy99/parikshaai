from __future__ import annotations

import traceback
from typing import Any

from config import supabase

from .pattern_book_classifier import classify_pattern_book_pdf
from .pattern_book_gemini_stage12 import run_pattern_book_gemini_stage12


def _update_job(job_id: str, **fields: Any) -> None:
    try:
        supabase.table("jobs").update(fields).eq("id", job_id).execute()
    except Exception as exc:
        print(f"[pattern-book {job_id[:8]}] job update failed: {exc}")


def _normalize_pattern_rows(valid_questions: list[dict[str, Any]], *, book_id: str, chapter: str) -> list[dict[str, Any]]:
    normalized_rows: list[dict[str, Any]] = []
    seen_numbers: set[int] = set()

    for item in valid_questions:
        qn = item.get("question_number")
        if not isinstance(qn, int):
            continue
        if qn in seen_numbers:
            continue
        seen_numbers.add(qn)

        pattern_tag = str(item.get("detected_pattern_heading") or chapter or "").strip() or chapter
        pattern_tag = str(item.get("pattern_tag") or pattern_tag).strip() or chapter
        normalized_rows.append(
            {
                "book_id": book_id,
                "question_number": qn,
                "question_text": str(item.get("question_text") or "").strip(),
                "option_a": str(item.get("option_a") or "").strip(),
                "option_b": str(item.get("option_b") or "").strip(),
                "option_c": str(item.get("option_c") or "").strip(),
                "option_d": str(item.get("option_d") or "").strip(),
                "correct_answer": None,
                "difficulty": "Medium",
                "pattern_tag": pattern_tag,
                "source_page": item.get("source_page_number"),
                "explanation": None,
            }
        )

    # Preserve the chapter's natural flow. Pattern Practice should follow the
    # book order first, with question number as the tiebreaker.
    normalized_rows.sort(
        key=lambda row: (
            int(row.get("source_page") or 10**9),
            int(row.get("question_number") or 10**9),
            str(row.get("question_text") or ""),
        )
    )
    return normalized_rows


def process_pattern_book_job_background(
    job_id: str,
    pdf_path: str,
    title: str,
    exam_year: int,
    chapter: str,
    exam_target: str,
    source_file: str,
) -> dict[str, Any]:
    """
    Extract SSC-style content/pattern-book PDFs and ingest them into
    pattern_books + pattern_questions for Pattern Practice.
    """
    try:
        _update_job(
            job_id,
            status="processing",
            progress=5,
            error_log="Classifying pages in the SSC content PDF...",
        )
        classification_report = classify_pattern_book_pdf(pdf_path, write_report=True)

        page_count = int(classification_report.get("page_count") or 0)
        question_pages = int((classification_report.get("counts") or {}).get("question_page", 0))
        mixed_pages = int((classification_report.get("counts") or {}).get("mixed_special_page", 0))
        _update_job(
            job_id,
            progress=28,
            error_log=(
                f"Pattern-book classification complete: {question_pages} question pages, "
                f"{mixed_pages} mixed pages across {page_count} pages."
            ),
        )

        stage12_report = run_pattern_book_gemini_stage12(
            pdf_path,
            write_report=True,
            classification_report=classification_report,
        )
        valid_questions = stage12_report.get("valid_questions") or []
        if not valid_questions:
            raise RuntimeError("No valid questions were extracted from the SSC content PDF.")

        _update_job(
            job_id,
            progress=72,
            error_log=f"Extracted {len(valid_questions)} valid SSC content questions. Ingesting them into Pattern Practice...",
        )

        book_payload = {
            "title": title,
            "chapter": chapter,
            "exam_target": exam_target,
            "source_file": source_file,
            "question_count": len(valid_questions),
        }
        book_res = supabase.table("pattern_books").upsert(book_payload, on_conflict="title").execute()
        book_rows = book_res.data or []
        if not book_rows:
            raise RuntimeError("Pattern book upsert returned no book id.")
        book_id = str(book_rows[0]["id"])

        supabase.table("pattern_questions").delete().eq("book_id", book_id).execute()
        rows = _normalize_pattern_rows(valid_questions, book_id=book_id, chapter=chapter)
        if not rows:
            raise RuntimeError("No usable normalized questions remained after validation.")

        for idx in range(0, len(rows), 50):
            supabase.table("pattern_questions").insert(rows[idx : idx + 50]).execute()

        supabase.table("pattern_books").update({"question_count": len(rows)}).eq("id", book_id).execute()

        _update_job(
            job_id,
            status="completed",
            progress=100,
            error_log=(
                f"Imported {len(rows)} SSC content questions into Pattern Practice."
                f" Book: {title}"
            ),
        )
        return {
            "status": "completed",
            "book_id": book_id,
            "question_count": len(rows),
            "title": title,
            "exam_year": exam_year,
        }
    except Exception as exc:
        print(f"[pattern-book {job_id[:8]}] failed: {exc}")
        print(traceback.format_exc())
        _update_job(job_id, status="failed", progress=100, error_log=f"Pattern-book extraction failed: {exc}")
        raise
