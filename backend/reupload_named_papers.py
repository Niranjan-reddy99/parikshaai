from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from config import supabase
from extractor.answer_key_parser import detect_paper_set, parse_answer_key, parse_answer_key_multiset
from extractor.router import detect_format, ExamFormat
from extractor.universal_extractor import process_universal_job_background
from extractor.vision_extractor import extract_with_vision, _VisionCostTracker
from pipeline import (
    CACHE_DIR,
    _ai_fill_missing_answers,
    _recover_inline_match_payload,
)


PAPERS = [
    {
        "exam_name": "TSPSC GROUP 2 PAPER 4",
        "exam_year": 2024,
        "pdf_path": Path("/Users/niranjan/Downloads/TSPSC_GROUP_2_PAPER_4_2024.pdf"),
        "key_path": Path("/Users/niranjan/Downloads/TSPSC_GROUP_2_PAPER_4_2024_key.pdf"),
        "expected_count": 150,
    },
    {
        "exam_name": "APSLPRB SI MAINS",
        "exam_year": 2023,
        "pdf_path": Path("/Users/niranjan/Downloads/APSLPRB_SI_MAINS_2023.pdf"),
        "key_path": Path("/Users/niranjan/Downloads/APSLPRB_SI_MAINS_2023_key.pdf"),
        "expected_count": 200,
    },
    {
        "exam_name": "TSPSC GROUP 1 PRELIMS",
        "exam_year": 2022,
        "pdf_path": Path("/Users/niranjan/Downloads/TSPSC_GROUP_1_PRELIMS_2022.pdf"),
        "key_path": None,
        "expected_count": 150,
    },
    {
        "exam_name": "APPSC Group II Mains Paper I",
        "exam_year": 2025,
        "pdf_path": Path("/Users/niranjan/Downloads/APPSC_GROUP_2_MAINS_PAPER_1_2025.pdf"),
        "key_path": None,
        "expected_count": 150,
    },
    {
        "exam_name": "APPSC EO GRADE 3 PAPER 1",
        "exam_year": 2025,
        "pdf_path": Path("/Users/niranjan/Downloads/APPSC_EO_GRADE_3_PAPER_1_2025.pdf"),
        "key_path": None,
        "expected_count": 150,
        "force_route": "vision",
    },
]


QUESTION_COLUMNS = {
    "question_text",
    "option_a",
    "option_b",
    "option_c",
    "option_d",
    "correct_answer",
    "subject",
    "topic",
    "subtopic",
    "difficulty",
    "question_type",
    "concept",
    "exam_name",
    "exam_year",
    "source_pdf",
    "question_hash",
    "question_number",
    "is_active",
    "needs_review",
    "has_image",
    "image_url",
    "shift_label",
    "test_date",
    "test_time",
    "exam_section",
    "passage",
    "correct_answers",
    "question_type_v2",
}


def _clear_cache(file_hash: str) -> int:
    patterns = [
        f"univ_{file_hash[:16]}_p*.json",
        f"univ_v*_{file_hash[:16]}_p*.json",
        f"vision_*_{file_hash[:16]}_p*.json",
        f"processed/{file_hash}.json",
    ]
    cleared = 0
    for pattern in patterns:
        for cache_file in CACHE_DIR.glob(pattern):
            cache_file.unlink()
            cleared += 1
    return cleared


def _clear_duplicate_jobs(file_hash: str) -> None:
    jobs = supabase.table("jobs").select("id").eq("file_hash", file_hash).execute().data or []
    for job in jobs:
        supabase.table("jobs").delete().eq("id", job["id"]).execute()


def _archive_existing_exam(exam_name: str, exam_year: int) -> None:
    qids = supabase.table("questions").select("id").eq("exam_name", exam_name).eq("exam_year", exam_year).execute().data or []
    if qids:
        ids = [row["id"] for row in qids]
        for i in range(0, len(ids), 100):
            chunk = ids[i:i+100]
            supabase.table("explanations").delete().in_("question_id", chunk).execute()
    supabase.table("questions").update({"is_active": False}).eq("exam_name", exam_name).eq("exam_year", exam_year).execute()


def _create_job(exam_name: str, exam_year: int, pdf_path: Path, file_hash: str) -> str:
    job_res = supabase.table("jobs").insert({
        "filename": pdf_path.name,
        "file_hash": file_hash,
        "exam_name": exam_name,
        "exam_year": exam_year,
        "status": "pending",
        "progress": 0,
        "pdf_path": str(pdf_path),
    }).execute()
    return job_res.data[0]["id"]


def _update_job(job_id: str, *, progress: int | None = None, status: str | None = None, error: str | None = None) -> None:
    data: dict[str, Any] = {}
    if progress is not None:
        data["progress"] = progress
    if status is not None:
        data["status"] = status
    if error is not None:
        data["error_log"] = error
    if data:
        supabase.table("jobs").update(data).eq("id", job_id).execute()


def _load_answer_key_map(key_path: Path | None, question_pdf: Path, expected_count: int) -> dict[int, str] | None:
    if not key_path or not key_path.exists():
        return None
    paper_set = detect_paper_set(str(question_pdf))
    multi = parse_answer_key_multiset(str(key_path), expected_count=expected_count)
    if paper_set and multi.get(paper_set):
        print(f"  🔐 Using key set {paper_set} from {key_path.name}")
        return multi[paper_set]
    if len(multi) == 1:
        only = next(iter(multi.values()))
        print(f"  🔐 Using single detected key set from {key_path.name}")
        return only
    single = parse_answer_key(str(key_path), expected_count=expected_count)
    if single:
        print(f"  🔐 Using single-set key parse from {key_path.name}")
        return single
    return None


def _compat_store_questions(
    questions: list[dict],
    source_pdf: str,
    exam_name: str,
    exam_year: int,
    *,
    job_id: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    questions = _ai_fill_missing_answers(questions)
    inserted = 0
    skipped = 0
    errors: list[str] = []

    numbered_count = sum(1 for q in questions if isinstance(q.get("question_number"), int) and q.get("question_number") > 0)
    if questions and (numbered_count / len(questions)) >= 0.80:
        questions = [q for q in questions if isinstance(q.get("question_number"), int) and q.get("question_number") > 0]

    for i in range(0, len(questions), 50):
        batch = questions[i:i + 50]
        rows = []
        for q in batch:
            q_text = (q.get("question_text") or "").strip()
            if q_text and "__MATCH__:" not in q_text:
                recovered_match = _recover_inline_match_payload(q_text)
                if recovered_match:
                    intro, col1, col2 = recovered_match
                    q["question_text"] = intro + "\n\n__MATCH__:" + json.dumps(
                        {"col1": col1, "col2": col2},
                        ensure_ascii=False,
                    )
                    if str(q.get("question_type") or "").strip().lower() != "match":
                        q["question_type"] = "Match"

            q_num = q.get("question_number")
            if q_num is not None:
                hash_input = f"{exam_name.strip().lower()}|q{q_num}"
            else:
                hash_input = (
                    f"{(q.get('question_text') or '').strip().lower()}"
                    f"|{q.get('option_a', '')}|{q.get('option_b', '')}"
                    f"|{q.get('option_c', '')}|{q.get('option_d', '')}"
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
                "question_hash": qhash,
                "question_number": q_num,
                "is_active": True,
                "needs_review": bool(q.get("needs_review", False) or not q.get("correct_answer")),
                "correct_answers": q.get("correct_answers"),
                "question_type_v2": q.get("question_type_v2"),
            }

            for col in ("has_image", "image_url", "shift_label", "test_date", "test_time", "exam_section", "passage"):
                if q.get(col) is not None:
                    row[col] = q[col]

            if not row["question_text"] or len(row["question_text"]) < 5:
                skipped += 1
                continue
            if len(row["question_text"]) < 15:
                row["needs_review"] = True
            if row["correct_answer"] not in ("A", "B", "C", "D"):
                row["needs_review"] = True
                row["correct_answer"] = "A"
            if row["difficulty"] not in ("Easy", "Medium", "Hard"):
                row["difficulty"] = "Medium"

            row = {k: v for k, v in row.items() if k in QUESTION_COLUMNS}
            rows.append(row)

        deduped = {r["question_hash"]: r for r in rows}
        rows = list(deduped.values())
        if not rows:
            continue

        try:
            result = supabase.table("questions").upsert(rows, on_conflict="question_hash").execute()
            inserted += len(result.data) if result.data else len(rows)
        except Exception as e:
            errors.append(f"Batch {i // 50 + 1}: {e}")
            skipped += len(rows)

    return {"inserted": inserted, "skipped": skipped, "errors": errors}


def _compat_inject_answers(answer_map: dict[int, str], exam_name: str, exam_year: int) -> dict[str, int]:
    updated = 0
    normalized: dict[int, str] = {}
    for k, v in answer_map.items():
        try:
            normalized[int(k)] = str(v).upper()[:1]
        except Exception:
            pass

    try:
        supabase.table("answer_keys").upsert({
            "exam_name": exam_name,
            "exam_year": exam_year,
            "answer_map": normalized,
            "source": "user_upload",
        }, on_conflict="exam_name,exam_year").execute()
    except Exception as e:
        print(f"  ⚠️  Could not persist answer key: {e}")

    changed_ids: list[str] = []
    for letter in "ABCD":
        nums = [num for num, ans in normalized.items() if ans == letter]
        if not nums:
            continue
        id_rows = supabase.table("questions").select("id,correct_answer").eq("exam_name", exam_name).eq("exam_year", exam_year).in_("question_number", nums).execute().data or []
        changed_ids.extend([r["id"] for r in id_rows if (r.get("correct_answer") or "").upper() != letter])
        supabase.table("questions").update({
            "correct_answer": letter,
            "needs_review": False,
        }).eq("exam_name", exam_name).eq("exam_year", exam_year).in_("question_number", nums).execute()
        updated += len(nums)

    if changed_ids:
        for i in range(0, len(changed_ids), 100):
            chunk = changed_ids[i:i + 100]
            supabase.table("explanations").delete().in_("question_id", chunk).execute()

    return {"updated": updated}


def _compat_generate_explanations_bulk(exam_name: str, exam_year: int, job_id: str | None = None, tracker: Any | None = None) -> dict[str, int]:
    print("  ⏭️  Skipping explanation generation during schema-compatible rebuild")
    return {"generated": 0, "skipped": 0}


def _run_universal_compat(pdf_path: Path, exam_name: str, exam_year: int, job_id: str, answer_key_map: dict[int, str] | None, expected_count: int) -> dict[str, Any]:
    import pipeline as pipeline_module
    import papers as papers_module

    original_store = pipeline_module.store_questions
    original_inject = pipeline_module.inject_answers
    original_generate = pipeline_module.generate_explanations_bulk
    original_paper_id_for_job = papers_module.paper_id_for_job
    original_mark_paper_lifecycle = papers_module.mark_paper_lifecycle
    try:
        pipeline_module.store_questions = _compat_store_questions
        pipeline_module.inject_answers = _compat_inject_answers
        pipeline_module.generate_explanations_bulk = _compat_generate_explanations_bulk
        papers_module.paper_id_for_job = lambda *args, **kwargs: None
        papers_module.mark_paper_lifecycle = lambda *args, **kwargs: None
        process_universal_job_background(
            job_id,
            str(pdf_path),
            exam_name,
            exam_year,
            answer_key_map=answer_key_map,
            expected_count=expected_count,
        )
    finally:
        pipeline_module.store_questions = original_store
        pipeline_module.inject_answers = original_inject
        pipeline_module.generate_explanations_bulk = original_generate
        papers_module.paper_id_for_job = original_paper_id_for_job
        papers_module.mark_paper_lifecycle = original_mark_paper_lifecycle

    active_count_res = (
        supabase.table("questions")
        .select("id", count="exact")
        .eq("exam_name", exam_name)
        .eq("exam_year", exam_year)
        .eq("is_active", True)
        .execute()
    )
    return {
        "active_questions": active_count_res.count or 0,
    }


def _run_vision_compat(pdf_path: Path, exam_name: str, exam_year: int, job_id: str, expected_count: int) -> dict[str, Any]:
    print(f"\n{'=' * 60}")
    print(f"📄 {pdf_path.name}  |  {exam_name} ({exam_year}) [vision compat]")
    print(f"{'=' * 60}\n")
    _update_job(job_id, progress=5, status="processing")
    tracker = _VisionCostTracker()

    def _progress(current_page: int, total_pages: int) -> None:
        pct = 10 + int(50 * (current_page / max(1, total_pages)))
        _update_job(job_id, progress=pct, status="processing")

    questions = extract_with_vision(
        str(pdf_path),
        exam_name,
        exam_year,
        tracker=tracker,
        progress_callback=_progress,
    )
    if not questions:
        raise RuntimeError("No questions extracted from vision pipeline")

    _update_job(job_id, progress=80, status="processing")
    result = _compat_store_questions(questions, str(pdf_path), exam_name, exam_year, job_id=job_id)
    _update_job(job_id, progress=100, status="completed")
    active_count_res = (
        supabase.table("questions")
        .select("id", count="exact")
        .eq("exam_name", exam_name)
        .eq("exam_year", exam_year)
        .eq("is_active", True)
        .execute()
    )
    return {
        "active_questions": active_count_res.count or 0,
        "store_result": result,
    }


def process_one(spec: dict[str, Any]) -> dict[str, Any]:
    exam_name = spec["exam_name"]
    exam_year = spec["exam_year"]
    pdf_path: Path = spec["pdf_path"]
    key_path: Path | None = spec.get("key_path")
    expected_count: int = spec["expected_count"]

    if not pdf_path.exists():
        raise FileNotFoundError(f"Missing PDF: {pdf_path}")

    route_format = detect_format(str(pdf_path), source_filename=pdf_path.name)
    force_route = spec.get("force_route")

    file_hash = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    cleared = _clear_cache(file_hash)
    print(f"\n=== {exam_name} {exam_year} ===")
    print(f"  🗑️  Cleared {cleared} cache files")
    _clear_duplicate_jobs(file_hash)
    _archive_existing_exam(exam_name, exam_year)
    answer_key_map = _load_answer_key_map(key_path, pdf_path, expected_count)
    job_id = _create_job(exam_name, exam_year, pdf_path, file_hash)

    try:
        if force_route == "vision":
            result = _run_vision_compat(pdf_path, exam_name, exam_year, job_id, expected_count)
        else:
            if route_format != ExamFormat.DIGITAL_MCQ:
                raise RuntimeError(f"Unexpected format for {pdf_path.name}: {route_format}")
            result = _run_universal_compat(pdf_path, exam_name, exam_year, job_id, answer_key_map, expected_count)
        return {
            "exam_name": exam_name,
            "exam_year": exam_year,
            "job_id": job_id,
            "status": "completed",
            "result": result,
        }
    except Exception as e:
        import traceback

        tb = traceback.format_exc()
        _update_job(job_id, status="failed", error=str(e) + "\n" + tb)
        return {
            "exam_name": exam_name,
            "exam_year": exam_year,
            "job_id": job_id,
            "status": "failed",
            "error": str(e),
        }


def main() -> None:
    results = [process_one(spec) for spec in PAPERS]
    print(json.dumps(results, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
