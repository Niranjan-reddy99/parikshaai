"""
UPSC AI Strategy Engine — FastAPI Backend
Admin-Only Architecture: No public upload. Users only consume data.

Endpoints:
  PUBLIC (no auth):
    GET  /health          — API status
    GET  /questions       — Filtered + paginated questions
    GET  /questions/{id}  — Single question with answer
    GET  /explanation/{id}— Lazy-loaded explanation
    GET  /practice        — Random questions for practice
    GET  /stats           — Dashboard statistics
  
  AUTH REQUIRED (Firebase token):
    POST /attempt         — Record user attempt
  
  ADMIN ONLY (API key):
    POST   /admin/upload-pdf       — Upload + process PDF
    PATCH  /admin/questions/{id}    — Toggle is_active / edit
    DELETE /admin/questions/{id}    — Hard delete
    GET    /admin/questions         — All questions (including inactive)
"""
import patch_print
import concurrent.futures as _cf
import hashlib
import os
import json
import time
import tempfile
import threading
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

from google import genai as _genai_main
from google.genai import types as _gtypes
from functools import lru_cache
_GENAI_EXECUTOR = _cf.ThreadPoolExecutor(max_workers=4, thread_name_prefix="main-genai")


@lru_cache(maxsize=1)
def _get_main_genai_client():
    return _genai_main.Client(
        vertexai=True,
        project=os.getenv("GOOGLE_CLOUD_PROJECT"),
        location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
    )

from fastapi import FastAPI, HTTPException, Header, Query, Depends, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from config import supabase, verify_firebase_token
from extractor.pattern_book_classifier import classify_pattern_book_pdf
from extractor.pattern_book_gemini_pilot import extract_pattern_book_question_pages_with_gemini
from extractor.pattern_book_gemini_stage12 import run_pattern_book_gemini_stage12
from extractor.pattern_book_phase_c_drafts import build_pattern_book_normalized_draft
from extractor.pattern_book_raw_blocks import build_phase_c_readiness_audit
from extraction_cleanup import clean_extracted_question
from canonical_taxonomy import apply_canonical_taxonomy, derive_canonical_taxonomy
from papers import (
    ensure_paper_for_existing_exam,
    ensure_paper_for_upload,
    get_latest_paper_for_exam,
    link_job_to_paper,
    mark_paper_lifecycle,
    normalize_exam_name,
    paper_id_for_job,
    public_exam_keys,
    public_paper_ids,
    refresh_paper_publish_state,
    refresh_question_publish_state,
    resolve_paper_id,
)
from row_quality import merge_quality_fields

# ── App ──────────────────────────────────────────────────
app = FastAPI(
    title="UPSC AI Strategy Engine API",
    version="2.0.0",
    description="Admin-managed exam platform. Users consume questions, admin manages content.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=(
        os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:4000")
        .split(",")
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_raw_admin_key = os.getenv("ADMIN_API_KEY")
if not _raw_admin_key:
    raise RuntimeError("ADMIN_API_KEY env var is not set — refusing to start without it")
ADMIN_API_KEY = _raw_admin_key

# ── In-process metadata cache ─────────────────────────────
# /questions/meta is called on every user login. Cache the result for
# 2 minutes so 100 simultaneous logins = 1 Supabase query, not 100.
_meta_cache: dict | None = None
_meta_cache_ts: float = 0.0
_META_CACHE_TTL = 120  # seconds
_publish_gate_cache: dict | None = None
_publish_gate_cache_ts: float = 0.0
_PUBLISH_GATE_TTL = 120  # seconds
_topic_bucket_cache: dict[tuple[bool, str, str], tuple[float, list[dict]]] = {}
_TOPIC_BUCKET_CACHE_TTL = 120  # seconds
_REUPLOAD_STRUCTURAL_THRESHOLD_MIN = 3
_REUPLOAD_STRUCTURAL_THRESHOLD_PCT = 0.05
_question_supported_columns_cache: set[str] | None = None

_DEVANAGARI_RE = re.compile(r'[\u0900-\u097F]')
_TELUGU_RE = re.compile(r'[\u0C00-\u0C7F]')
_MATCH_CODE_OPT_RE = re.compile(
    r'^\s*(?:'
    r'(?:\d+\s*[-–]\s*[A-D](?:\s*,\s*\d+\s*[-–]\s*[A-D]){1,7})'
    r'|'
    r'(?:[A-D]\s*[-–]\s*\d+(?:\s*,\s*[A-D]\s*[-–]\s*\d+){1,7})'
    r')\s*$',
    re.IGNORECASE,
)


def _invalidate_meta_cache() -> None:
    global _meta_cache, _meta_cache_ts, _publish_gate_cache, _publish_gate_cache_ts, _topic_bucket_cache
    _meta_cache = None
    _meta_cache_ts = 0.0
    _publish_gate_cache = None
    _publish_gate_cache_ts = 0.0
    _topic_bucket_cache = {}


def _question_supported_columns() -> set[str]:
    global _question_supported_columns_cache
    if _question_supported_columns_cache is not None:
        return _question_supported_columns_cache

    fallback = {
        "question_text", "option_a", "option_b", "option_c", "option_d",
        "correct_answer", "subject", "topic", "subtopic", "difficulty",
        "canonical_subject", "canonical_topic_family", "canonical_subtopic_family",
        "question_type", "concept", "exam_name", "exam_year", "source_pdf",
        "paper_id", "question_hash", "question_number", "is_active",
        "needs_review", "has_image", "image_url", "shift_label",
        "test_date", "test_time", "exam_section", "passage",
        "structural_status", "answer_status", "explanation_status",
        "tagging_status", "review_required", "confidence_score",
        "public_visibility", "primary_issue_code", "issue_codes",
    }
    try:
        data = supabase.table("questions").select("*").limit(1).execute().data or []
        _question_supported_columns_cache = set(data[0].keys()) if data else fallback
    except Exception:
        _question_supported_columns_cache = fallback
    return _question_supported_columns_cache


def _question_select_clause(base_cols: list[str], supported_cols: set[str] | None = None) -> str:
    supported = supported_cols or _question_supported_columns()
    cols = list(base_cols)
    for optional in ("canonical_subject", "canonical_topic_family", "canonical_subtopic_family"):
        if optional in supported and optional not in cols:
            cols.append(optional)
    return ", ".join(cols)


def _apply_public_question_filter(query, supported_cols: set[str] | None = None):
    supported = supported_cols or _question_supported_columns()
    if "public_visibility" in supported:
        return query.eq("public_visibility", "visible")
    if "is_active" in supported:
        return query.eq("is_active", True)
    return query


def _row_is_public(row: dict, supported_cols: set[str] | None = None) -> bool:
    supported = supported_cols or _question_supported_columns()
    if "public_visibility" in supported:
        return row.get("public_visibility") == "visible"
    if "is_active" in supported:
        return row.get("is_active", True) is True
    return True


def _filter_question_write_payload(payload: dict, supported_cols: set[str] | None = None) -> dict:
    supported = supported_cols or _question_supported_columns()
    return {key: value for key, value in payload.items() if key in supported}


def _topic_bucket_questions(
    *,
    subject: str,
    topic: str,
    admin_mode: bool,
    limit: int,
    offset: int,
) -> dict:
    cache_key = (admin_mode, subject.strip(), topic.strip())
    cached = _topic_bucket_cache.get(cache_key)
    now = time.time()
    if cached and (now - cached[0]) <= _TOPIC_BUCKET_CACHE_TTL:
        cached_rows = cached[1]
        page = cached_rows[offset: offset + limit]
        return {
            "questions": page,
            "total": len(cached_rows),
            "limit": limit,
            "offset": offset,
            "has_more": (offset + len(page)) < len(cached_rows),
        }

    supported_cols = _question_supported_columns()
    base_cols = [
        "id", "question_text", "option_a", "option_b", "option_c", "option_d",
        "correct_answer", "subject", "topic", "subtopic", "difficulty", "exam_name", "exam_year",
        "question_type", "concept", "question_number", "needs_review", "has_image", "image_url", "paper_id",
    ]
    if "is_active" in supported_cols and "is_active" not in base_cols:
        base_cols.append("is_active")
    if "public_visibility" in supported_cols and "public_visibility" not in base_cols:
        base_cols.append("public_visibility")
    select_clause = _question_select_clause(base_cols, supported_cols)

    publishable_paper_ids = public_paper_ids(sb=supabase) if not admin_mode else None
    all_data: list[dict] = []
    scan_offset = 0
    while True:
        q = supabase.table("questions").select(select_clause)
        if admin_mode:
            if "is_active" in supported_cols:
                q = q.eq("is_active", True)
        else:
            q = _apply_public_question_filter(q, supported_cols)
        q = q.order("created_at", desc=True).range(scan_offset, scan_offset + 999)
        result = q.execute()
        batch = result.data or []
        if not batch:
            break

        for row in batch:
            if not admin_mode and publishable_paper_ids is not None and str(row.get("paper_id")) not in publishable_paper_ids:
                continue
            sanitized = _sanitize_public_question_row(row)
            if sanitized is None:
                continue
            if sanitized.get("subject") != subject or sanitized.get("topic") != topic:
                continue
            all_data.append(sanitized)

        if len(batch) < 1000:
            break
        scan_offset += 1000

    all_data.sort(
        key=lambda row: (
            -(int(row.get("year") or row.get("exam_year") or 0)),
            str(row.get("exam") or row.get("exam_name") or ""),
            int(row.get("question_number") or 10**9),
            str(row.get("id") or ""),
        )
    )
    _topic_bucket_cache[cache_key] = (now, all_data)

    total = len(all_data)
    page = all_data[offset: offset + limit]
    return {
        "questions": page,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + len(page)) < total,
    }


def _regional_script_ratio(text: str) -> float:
    alpha = [c for c in text if c.isalpha()]
    if not alpha:
        return 0.0
    regional = sum(1 for c in alpha if _DEVANAGARI_RE.match(c) or _TELUGU_RE.match(c))
    return regional / len(alpha)


def _question_publish_issue(q: dict) -> Optional[str]:
    reasons = _row_base_reasons(q)
    structural = [r for r in reasons if r in _STRUCTURAL_ROW_REASONS]
    return structural[0] if structural else None


def _structural_failure_threshold(question_count: int) -> int:
    scaled = int(question_count * _REUPLOAD_STRUCTURAL_THRESHOLD_PCT)
    if (question_count * _REUPLOAD_STRUCTURAL_THRESHOLD_PCT) > scaled:
        scaled += 1
    return max(_REUPLOAD_STRUCTURAL_THRESHOLD_MIN, scaled)


def _compute_publish_gate() -> dict:
    global _publish_gate_cache, _publish_gate_cache_ts
    now = time.time()
    if _publish_gate_cache is not None and (now - _publish_gate_cache_ts) < _PUBLISH_GATE_TTL:
        return _publish_gate_cache

    rows: list[dict] = []
    offset = 0
    while True:
        r = supabase.table("questions").select(
            "id, exam_name, exam_year, question_number, needs_review, correct_answer, "
            "question_text, option_a, option_b, option_c, option_d, question_type, topic"
        ).eq("is_active", True).range(offset, offset + 999).execute()
        batch = r.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    grouped: dict[tuple[str, int], list[dict]] = {}
    for row in rows:
        key = (str(row.get("exam_name") or ""), int(row.get("exam_year") or 0))
        grouped.setdefault(key, []).append(row)

    publishable_keys: set[tuple[str, int]] = set()
    reports: list[dict] = []
    for (exam_name, exam_year), exam_rows in grouped.items():
        queue = _build_exam_repair_queue(exam_name, exam_year, exam_rows, contradiction_by_qid={})
        assessment = _paper_publish_assessment(exam_rows, queue)
        reason_set = sorted({
            reason
            for item in queue
            if item["publish_blocker"] in {"row", "paper"}
            for reason in item.get("reasons", [])
        })
        bad_samples = [
            f"Q{item['question_number'] if item.get('question_number') is not None else '?'}:{item['issue_type']}"
            for item in queue
            if item["publish_blocker"] in {"row", "paper"}
        ][:20]
        report = {
            "exam_name": exam_name,
            "exam_year": exam_year,
            "question_count": len(exam_rows),
            "publishable": assessment["publishable"],
            "likely_publishable_with_hidden_rows": assessment["likely_publishable_with_hidden_rows"],
            "reupload_needed": assessment["reupload_needed"],
            "visible_question_count": assessment["visible_question_count"],
            "hidden_question_count": assessment["hidden_question_count"],
            "reasons": reason_set,
            "samples": bad_samples[:20],
        }
        reports.append(report)
        if assessment["publishable"]:
            publishable_keys.add((exam_name, exam_year))

    # Include latest paper records that currently have zero active questions.
    # Without this, failed/fully-blocked uploads disappear from the admin
    # review UI because the gate is built only from active question rows.
    try:
        paper_rows = (
            supabase.table("papers")
            .select(
                "exam_name, exam_year, question_count, visible_question_count, "
                "hidden_question_count, publish_status, lifecycle_status, upload_version"
            )
            .execute()
            .data
            or []
        )
        latest_papers: dict[tuple[str, int], dict] = {}
        for paper in paper_rows:
            if paper.get("lifecycle_status") in {"replaced", "archived"}:
                continue
            key = (str(paper.get("exam_name") or ""), int(paper.get("exam_year") or 0))
            current = latest_papers.get(key)
            if current is None or int(paper.get("upload_version") or 0) > int(current.get("upload_version") or 0):
                latest_papers[key] = paper

        existing_keys = {(r["exam_name"], r["exam_year"]) for r in reports}
        for (exam_name, exam_year), paper in latest_papers.items():
            if (exam_name, exam_year) in existing_keys:
                continue
            reports.append({
                "exam_name": exam_name,
                "exam_year": exam_year,
                "question_count": int(paper.get("question_count") or 0),
                "publishable": False,
                "likely_publishable_with_hidden_rows": False,
                "reupload_needed": paper.get("publish_status") == "reupload_needed",
                "visible_question_count": int(paper.get("visible_question_count") or 0),
                "hidden_question_count": int(paper.get("hidden_question_count") or 0),
                "reasons": ["no-active-questions"],
                "samples": [],
            })
    except Exception:
        pass

    result = {
        "publishable_keys": publishable_keys,
        "reports": sorted(reports, key=lambda x: (x["publishable"], x["exam_year"], x["exam_name"])),
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }
    _publish_gate_cache = result
    _publish_gate_cache_ts = now
    return result


def _publishable_exam_keys() -> set[tuple[str, int]]:
    return _compute_publish_gate()["publishable_keys"]


def _question_rows_for_exam(exam_name: str, exam_year: int, *, is_active: Optional[bool] = True) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        q = supabase.table("questions").select(
            "id, exam_name, exam_year, question_number, needs_review, correct_answer, "
            "question_text, option_a, option_b, option_c, option_d, question_type, topic, "
            "subject, subtopic, difficulty, concept, passage, has_image, image_url, is_active"
        ).eq("exam_name", exam_name).eq("exam_year", exam_year)
        if is_active is not None:
            q = q.eq("is_active", is_active)
        r = q.range(offset, offset + 999).execute()
        batch = r.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def _missing_question_numbers_for_exam(
    exam_name: str,
    exam_year: int,
    *,
    expected_count: int = 0,
) -> list[int]:
    rows = _question_rows_for_exam(exam_name, exam_year)
    numbered = sorted(
        int(q["question_number"])
        for q in rows
        if isinstance(q.get("question_number"), int) and int(q.get("question_number")) > 0
    )
    numbered_set = set(numbered)
    max_seen = max(numbered, default=0)
    upper_bound = max(max_seen, int(expected_count or 0))
    if upper_bound <= 0:
        return []
    return [n for n in range(1, upper_bound + 1) if n not in numbered_set]


def _repair_target_numbers_for_exam(
    exam_name: str,
    exam_year: int,
    *,
    expected_count: int = 0,
) -> list[int]:
    rows = _question_rows_for_exam(exam_name, exam_year, is_active=None)
    active_numbers = {
        int(q["question_number"])
        for q in rows
        if q.get("is_active") is True
        and isinstance(q.get("question_number"), int)
        and int(q.get("question_number")) > 0
    }
    all_numbered = {
        int(q["question_number"])
        for q in rows
        if isinstance(q.get("question_number"), int)
        and int(q.get("question_number")) > 0
    }
    upper_bound = max(max(all_numbered, default=0), int(expected_count or 0))
    if upper_bound <= 0:
        return []
    # Any numbered row that is currently inactive should also be repaired on re-upload,
    # not just gaps that are completely absent from the DB.
    return [n for n in range(1, upper_bound + 1) if n not in active_numbers]


def _count_explanations(question_ids: list[str]) -> int:
    total = 0
    for i in range(0, len(question_ids), 50):
        chunk = question_ids[i:i+50]
        if not chunk:
            continue
        r = supabase.table("explanations").select("question_id", count="exact").in_("question_id", chunk).execute()
        total += int(r.count or 0)
    return total


def _exam_quality_report(exam_name: str, exam_year: int) -> dict:
    rows = _question_rows_for_exam(exam_name, exam_year)
    if not rows:
        return {
            "exam_name": exam_name,
            "exam_year": exam_year,
            "question_count": 0,
            "publishable": False,
            "reasons": ["no-active-questions"],
        }

    gate = _compute_publish_gate()
    gate_map = {(r["exam_name"], r["exam_year"]): r for r in gate["reports"]}
    gate_report = gate_map.get((exam_name, exam_year), {})
    contradiction_by_qid = _contradiction_map(exam_name, exam_year)
    repair_queue = _build_exam_repair_queue(exam_name, exam_year, rows, contradiction_by_qid=contradiction_by_qid)
    publish_assessment = _paper_publish_assessment(rows, repair_queue)

    numbered = sorted(int(q["question_number"]) for q in rows if isinstance(q.get("question_number"), int))
    numbered_set = set(numbered)
    max_seen = max(numbered) if numbered else 0
    missing_numbers = [n for n in range(1, max_seen + 1) if n not in numbered_set] if max_seen else []
    duplicate_numbers = sorted({n for n in numbered if numbered.count(n) > 1})
    unnumbered_count = sum(1 for q in rows if not isinstance(q.get("question_number"), int))
    needs_review_count = sum(1 for q in rows if q.get("needs_review") is True)
    invalid_answer_count = sum(1 for q in rows if str(q.get("correct_answer") or "").strip().upper() not in {"A", "B", "C", "D"})
    generic_subject_count = sum(1 for q in rows if (q.get("subject") or "").strip() in {"General Knowledge", "Unclassified", ""})
    generic_topic_count = sum(1 for q in rows if (q.get("topic") or "").strip() in {"General", "Unclassified", ""})
    empty_subtopic_count = sum(1 for q in rows if not (q.get("subtopic") or "").strip())
    explanation_count = _count_explanations([q["id"] for q in rows])

    return {
        "exam_name": exam_name,
        "exam_year": exam_year,
        "question_count": len(rows),
        "publishable": bool(gate_report.get("publishable")),
        "likely_publishable_with_hidden_rows": publish_assessment["likely_publishable_with_hidden_rows"],
        "reupload_needed": publish_assessment["reupload_needed"],
        "visible_question_count": publish_assessment["visible_question_count"],
        "hidden_question_count": publish_assessment["hidden_question_count"],
        "reasons": gate_report.get("reasons", []),
        "samples": gate_report.get("samples", []),
        "numbering": {
            "numbered": len(numbered),
            "unnumbered": unnumbered_count,
            "max_seen": max_seen,
            "missing_count": len(missing_numbers),
            "missing_numbers": missing_numbers[:25],
            "duplicate_count": len(duplicate_numbers),
            "duplicate_numbers": duplicate_numbers[:25],
        },
        "review": {
            "needs_review": needs_review_count,
            "verified_answers": len(rows) - needs_review_count,
            "invalid_answers": invalid_answer_count,
        },
        "tagging": {
            "generic_subjects": generic_subject_count,
            "generic_topics": generic_topic_count,
            "empty_subtopics": empty_subtopic_count,
        },
        "explanations": {
            "generated": explanation_count,
            "missing": max(0, len(rows) - explanation_count),
            "coverage_pct": round((explanation_count / max(len(rows), 1)) * 100, 1),
        },
        "repair_queue_summary": {
            "rows": len(repair_queue),
            "paper_blockers": publish_assessment["paper_blocker_count"],
            "row_blockers": publish_assessment["row_blocker_count"],
            "structural_failure_count": publish_assessment["structural_failure_count"],
            "structural_failure_threshold": publish_assessment["structural_failure_threshold"],
            "contradictions": len(contradiction_by_qid),
        },
    }


def _iter_active_questions(
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        q = supabase.table("questions").select(
            "id, exam_name, exam_year, question_number, question_text, "
            "option_a, option_b, option_c, option_d, correct_answer, needs_review"
        ).eq("is_active", True)
        if exam_name:
            q = q.eq("exam_name", exam_name)
        if exam_year is not None:
            q = q.eq("exam_year", exam_year)
        r = q.range(offset, offset + 999).execute()
        batch = r.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def _find_explanation_answer_mismatches(
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
) -> list[dict]:
    """Heuristic audit: explanation text explicitly points to a different option.

    We only flag rows where the explanation clearly mentions exactly one option's
    text and that option conflicts with the stored correct_answer.
    """
    rows = _iter_active_questions(exam_name=exam_name, exam_year=exam_year)
    if not rows:
        return []

    ids = [row["id"] for row in rows]
    explanation_map: dict[str, str] = {}
    for i in range(0, len(ids), 50):
        chunk = ids[i:i+50]
        er = supabase.table("explanations").select("question_id, explanation").in_("question_id", chunk).execute()
        for item in (er.data or []):
            qid = item.get("question_id")
            explanation = item.get("explanation")
            if qid and explanation:
                explanation_map[qid] = explanation

    mismatches: list[dict] = []
    for row in rows:
        explanation = explanation_map.get(row["id"])
        if not explanation:
            continue

        answer = str(row.get("correct_answer") or "").strip().upper()
        if answer not in {"A", "B", "C", "D"}:
            continue

        option_map = {
            "A": str(row.get("option_a") or "").strip(),
            "B": str(row.get("option_b") or "").strip(),
            "C": str(row.get("option_c") or "").strip(),
            "D": str(row.get("option_d") or "").strip(),
        }
        explanation_lc = explanation.lower()
        mentioned_letters: list[str] = []
        for letter, option_text in option_map.items():
            if len(option_text) >= 3 and option_text.lower() in explanation_lc:
                mentioned_letters.append(letter)

        mentioned_letters = sorted(set(mentioned_letters))
        if len(mentioned_letters) == 1 and mentioned_letters[0] != answer:
            wrong_letter = mentioned_letters[0]
            mismatches.append({
                "question_id": row["id"],
                "exam_name": row.get("exam_name"),
                "exam_year": row.get("exam_year"),
                "question_number": row.get("question_number"),
                "correct_answer": answer,
                "explanation_implies": wrong_letter,
                "correct_option_text": option_map.get(answer, ""),
                "implied_option_text": option_map.get(wrong_letter, ""),
                "explanation_excerpt": explanation[:240],
            })
    return mismatches


_ANSWER_RELATED_REASONS = {"needs-review", "invalid-answer"}
_STRUCTURAL_REASONS = {
    "missing-question-numbers",
    "duplicate-question-numbers",
    "unnumbered-questions",
    "invalid-match-payload",
    "incomplete-match-columns",
    "incomplete-match-stem",
    "regional-script",
    "short-or-empty-text",
    "no-active-questions",
}
_IMAGE_REPAIR_REASONS = {"image-dependent"}
_STRUCTURAL_ROW_REASONS = {
    "invalid-match-payload",
    "incomplete-match-columns",
    "image-dependent-review",
    "regional-script",
    "short-or-empty-text",
    "incomplete-options",
    "broken-extraction",
    "unnumbered-questions",
}
_QUEUE_ISSUE_ORDER = {
    "numbering/data repair": 0,
    "structural manual review": 1,
    "image/manual review": 2,
    "answer verification": 3,
    "explanation regeneration": 4,
}
_IMAGE_RE = re.compile(
    r"\b(?:bar\s+graph|pie\s+chart|bar\s+chart|line\s+graph|histogram|"
    r"(?:the\s+)?(?:graph|chart|figure|diagram|picture|map)\s+(?:below|above|given|shown|following)|"
    r"(?:following|given|below)\s+(?:graph|chart|figure|diagram|table|map)|"
    r"refer\s+to\s+the|data\s+given\s+(?:below|above)|study\s+the\s+(?:following\s+)?"
    r"(?:graph|chart|figure|table|diagram)|from\s+the\s+(?:graph|chart|figure|table)|"
    r"dice|venn\s+diagram)\b",
    re.IGNORECASE,
)
_INLINE_OPTION_RE = re.compile(r'(?:^|\s)(?:A[\).]|B[\).]|C[\).]|D[\).])\s+', re.IGNORECASE)


def _question_is_image_dependent(row: dict) -> bool:
    if row.get("has_image") or row.get("image_url"):
        return True
    text = " ".join(
        str(row.get(key) or "")
        for key in ("question_text", "option_a", "option_b", "option_c", "option_d")
    )
    return bool(_IMAGE_RE.search(text))


def _has_inline_option_blob(text: str) -> bool:
    return len(_INLINE_OPTION_RE.findall(text or "")) >= 2


def _sanitize_public_question_row(row: dict) -> Optional[dict]:
    cleaned = clean_extracted_question({
        "question_text": row.get("question_text"),
        "option_a": row.get("option_a"),
        "option_b": row.get("option_b"),
        "option_c": row.get("option_c"),
        "option_d": row.get("option_d"),
        "passage": row.get("passage"),
        "question_number": row.get("question_number"),
        "correct_answer": row.get("correct_answer"),
        "needs_review": row.get("needs_review"),
    })
    if not cleaned:
        return None

    sanitized = apply_canonical_taxonomy(dict(row))
    for key in ("question_text", "option_a", "option_b", "option_c", "option_d", "passage"):
        if key in cleaned:
            sanitized[key] = cleaned[key]
    return sanitized


def _row_base_reasons(row: dict) -> list[str]:
    text = (row.get("question_text") or "").strip()
    opts = [
        (row.get("option_a") or "").strip(),
        (row.get("option_b") or "").strip(),
        (row.get("option_c") or "").strip(),
        (row.get("option_d") or "").strip(),
    ]
    filled_opts = [o for o in opts if o]
    exam_name = str(row.get("exam_name") or "")
    is_upsc_like = any(k in exam_name.lower() for k in ("upsc", "cisf", "nda", "cds"))
    reasons: list[str] = []

    if not text or len(text) < 15:
        reasons.append("short-or-empty-text")
    image_dependent = _question_is_image_dependent(row)
    if len(filled_opts) < 4:
        if image_dependent:
            reasons.append("image-dependent-review")
        else:
            reasons.append("incomplete-options")
    if image_dependent and len(filled_opts) == 0:
        reasons.append("image-dependent-review")
    if row.get("needs_review") is True:
        reasons.append("answer-review")
    if str(row.get("correct_answer") or "").strip().upper() not in ("A", "B", "C", "D"):
        reasons.append("invalid-answer")
    if _has_inline_option_blob(text) and len(filled_opts) >= 4:
        reasons.append("broken-extraction")
    if not is_upsc_like and _regional_script_ratio(" ".join([text] + filled_opts)) >= 0.12:
        reasons.append("regional-script")
    if _sanitize_public_question_row(row) is None:
        reasons.append("broken-extraction")

    is_match_like = (
        str(row.get("question_type") or "").lower() == "match"
        or "match the following" in text.lower()
        or str(row.get("topic") or "").strip().lower() == "matching"
    )
    if is_match_like:
        if "__MATCH__:" in text:
            try:
                payload = json.loads(text.split("\n\n__MATCH__:", 1)[1])
                col1 = payload.get("col1") or []
                col2 = payload.get("col2") or []
                if not col1 or not col2:
                    reasons.append("incomplete-match-columns")
            except Exception:
                reasons.append("invalid-match-payload")
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
                reasons.append("incomplete-match-stem")

    return sorted(set(reasons))


def _exam_numbering_reasons(rows: list[dict]) -> tuple[list[str], list[str]]:
    reasons: list[str] = []
    samples: list[str] = []
    numbered = [int(q["question_number"]) for q in rows if isinstance(q.get("question_number"), int)]
    mostly_numbered = len(numbered) >= max(5, int(len(rows) * 0.8))
    if not mostly_numbered:
        return reasons, samples
    if len(numbered) != len(rows):
        reasons.append("unnumbered-questions")
        missing_qids = [q for q in rows if not isinstance(q.get("question_number"), int)]
        for row in missing_qids[:10]:
            samples.append(f"Q?:unnumbered-questions")
    dupes = sorted({n for n in numbered if numbered.count(n) > 1})
    if dupes:
        reasons.append("duplicate-question-numbers")
        samples.append(f"dupes:{','.join(map(str, dupes[:10]))}")
    missing = [n for n in range(1, max(numbered) + 1) if n not in set(numbered)]
    if missing:
        reasons.append("missing-question-numbers")
        samples.append(f"missing:{','.join(map(str, missing[:10]))}")
    return reasons, samples


def _contradiction_map(
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
) -> dict[str, dict]:
    return {
        item["question_id"]: item
        for item in _find_explanation_answer_mismatches(exam_name=exam_name, exam_year=exam_year)
    }


def _classify_row_queue_issue(reasons: list[str]) -> tuple[str, str, str, str]:
    reason_set = set(reasons)
    if {"unnumbered-questions", "duplicate-question-numbers", "missing-question-numbers"} & reason_set:
        return ("numbering/data repair", "critical", "none", "P3")
    if {"invalid-match-payload", "incomplete-match-columns", "incomplete-match-stem", "regional-script", "short-or-empty-text", "incomplete-options", "broken-extraction"} & reason_set:
        return ("structural manual review", "critical", "row", "P0")
    if "image-dependent-review" in reason_set:
        return ("image/manual review", "medium", "row", "P1")
    if "answer-explanation-contradiction" in reason_set:
        return ("explanation regeneration", "high", "row", "P1")
    if {"answer-review", "invalid-answer"} & reason_set:
        return ("answer verification", "medium", "none", "P3")
    return ("answer verification", "low", "none", "P3")


def _build_exam_repair_queue(
    exam_name: str,
    exam_year: int,
    rows: list[dict],
    contradiction_by_qid: Optional[dict[str, dict]] = None,
) -> list[dict]:
    contradiction_by_qid = contradiction_by_qid or {}
    numbering_reasons, _ = _exam_numbering_reasons(rows)
    queue: list[dict] = []
    duplicate_numbers: set[int] = set()
    numbered = [int(q["question_number"]) for q in rows if isinstance(q.get("question_number"), int)]
    duplicate_numbers = {n for n in numbered if numbered.count(n) > 1}
    missing_numbers = set()
    if numbered:
        missing_numbers = {n for n in range(1, max(numbered) + 1) if n not in set(numbered)}

    for row in rows:
        reasons = _row_base_reasons(row)
        qid = row.get("id")
        if qid in contradiction_by_qid:
            reasons.append("answer-explanation-contradiction")
        if "unnumbered-questions" in numbering_reasons and not isinstance(row.get("question_number"), int):
            reasons.append("unnumbered-questions")
        if isinstance(row.get("question_number"), int) and row["question_number"] in duplicate_numbers:
            reasons.append("duplicate-question-numbers")
        reasons = sorted(set(reasons))
        if not reasons:
            continue
        issue_type, severity, publish_blocker, priority = _classify_row_queue_issue(reasons)
        queue.append({
            "exam": f"{exam_name} {exam_year}",
            "exam_name": exam_name,
            "exam_year": exam_year,
            "question_number": row.get("question_number"),
            "question_id": qid,
            "question_text": row.get("question_text") or "",
            "option_a": row.get("option_a") or "",
            "option_b": row.get("option_b") or "",
            "option_c": row.get("option_c") or "",
            "option_d": row.get("option_d") or "",
            "correct_answer": row.get("correct_answer") or "",
            "subject": row.get("subject") or "",
            "topic": row.get("topic") or "",
            "subtopic": row.get("subtopic") or "",
            "difficulty": row.get("difficulty") or "",
            "question_type": row.get("question_type") or "",
            "concept": row.get("concept") or "",
            "passage": row.get("passage") or "",
            "has_image": bool(row.get("has_image")),
            "image_url": row.get("image_url"),
            "is_active": bool(row.get("is_active")),
            "needs_review": bool(row.get("needs_review")),
            "issue_type": issue_type,
            "severity": severity,
            "publish_blocker": publish_blocker,
            "repair_path": issue_type,
            "priority": priority,
            "safe_to_hide": publish_blocker == "row",
            "reasons": reasons,
        })

    # Missing-number gaps are audit-only queue items without a specific row.
    if "missing-question-numbers" in numbering_reasons:
        for missing_qn in sorted(missing_numbers):
            queue.append({
                "exam": f"{exam_name} {exam_year}",
                "exam_name": exam_name,
                "exam_year": exam_year,
                "question_number": missing_qn,
                "question_id": None,
                "question_text": "",
                "option_a": "",
                "option_b": "",
                "option_c": "",
                "option_d": "",
                "correct_answer": "",
                "subject": "",
                "topic": "",
                "subtopic": "",
                "difficulty": "",
                "question_type": "",
                "concept": "",
                "passage": "",
                "has_image": False,
                "image_url": None,
                "is_active": False,
                "needs_review": True,
                "issue_type": "numbering/data repair",
                "severity": "critical",
                "publish_blocker": "none",
                "repair_path": "numbering/data repair",
                "priority": "P0",
                "safe_to_hide": False,
                "reasons": ["missing-question-numbers"],
            })

    queue.sort(
        key=lambda item: (
            _QUEUE_ISSUE_ORDER.get(item["issue_type"], 99),
            item["question_number"] is None,
            item["question_number"] if isinstance(item["question_number"], int) else 10**9,
            item["question_id"] or "",
        )
    )
    return queue


def _paper_publish_assessment(rows: list[dict], queue: list[dict]) -> dict:
    structural_row_blockers = [
        item for item in queue
        if item["publish_blocker"] == "row"
        and item["issue_type"] in {"numbering/data repair", "structural manual review", "image/manual review"}
    ]
    threshold = _structural_failure_threshold(len(rows))
    reupload_needed = len(structural_row_blockers) >= threshold
    paper_blockers = [
        item for item in queue
        if item["publish_blocker"] == "paper"
    ]
    if reupload_needed:
        paper_blockers = paper_blockers + structural_row_blockers
    row_blockers = [item for item in queue if item["publish_blocker"] == "row"]
    visible_rows = [row for row in rows if not any(
        item.get("question_id") == row.get("id") and item["publish_blocker"] == "row"
        for item in queue
    )]
    likely_publishable_with_hidden_rows = bool(rows) and not paper_blockers and bool(row_blockers)
    return {
        "publishable": bool(rows) and not paper_blockers,
        "likely_publishable_with_hidden_rows": likely_publishable_with_hidden_rows,
        "blocked": bool(paper_blockers),
        "reupload_needed": reupload_needed,
        "visible_question_count": len(visible_rows),
        "hidden_question_count": len(row_blockers),
        "paper_blocker_count": len(paper_blockers),
        "row_blocker_count": len(row_blockers),
        "structural_failure_count": len(structural_row_blockers),
        "structural_failure_threshold": threshold,
    }


def _visible_public_question_ids(
    exam_name: str,
    exam_year: int,
    rows: Optional[list[dict]] = None,
    contradiction_by_qid: Optional[dict[str, dict]] = None,
) -> set[str]:
    exam_rows = rows if rows is not None else _question_rows_for_exam(exam_name, exam_year)
    contradiction_by_qid = contradiction_by_qid or _contradiction_map(exam_name, exam_year)
    queue = _build_exam_repair_queue(
        exam_name,
        exam_year,
        exam_rows,
        contradiction_by_qid=contradiction_by_qid,
    )
    hidden_ids = {
        item["question_id"]
        for item in queue
        if item["publish_blocker"] == "row" and item.get("question_id")
    }
    return {
        str(row["id"])
        for row in exam_rows
        if str(row.get("id")) not in hidden_ids
    }


def _question_has_explanation_contradiction(question_id: str, exam_name: Optional[str] = None, exam_year: Optional[int] = None) -> bool:
    for item in _find_explanation_answer_mismatches(exam_name=exam_name, exam_year=exam_year):
        if item.get("question_id") == question_id:
            return True
    return False


def _repair_decision_for_exam(
    exam_name: str,
    exam_year: int,
    rows: list[dict],
    reasons: list[str],
    explanation_count: Optional[int] = None,
    mismatches: Optional[list[dict]] = None,
) -> dict:
    reason_set = set(reasons)
    needs_review_rows = [row for row in rows if row.get("needs_review") is True]
    image_review_rows = [row for row in needs_review_rows if _question_is_image_dependent(row)]
    mismatch_items = mismatches if mismatches is not None else _find_explanation_answer_mismatches(exam_name, exam_year)
    mismatch_count = len(mismatch_items)
    explanation_count = explanation_count if explanation_count is not None else _count_explanations([q["id"] for q in rows])
    missing_explanations = max(0, len(rows) - explanation_count)

    structural_reasons = sorted(reason_set & _STRUCTURAL_REASONS)
    answer_reasons = sorted(reason_set & _ANSWER_RELATED_REASONS)

    if not reason_set:
        return {
            "category": "publishable",
            "summary": "No publish blockers detected.",
            "recommended_actions": [],
            "counts": {
                "needs_review": 0,
                "image_dependent_reviews": 0,
                "answer_explanation_mismatches": mismatch_count,
                "missing_explanations": missing_explanations,
            },
        }

    image_only = (
        bool(answer_reasons)
        and not structural_reasons
        and len(needs_review_rows) > 0
        and len(image_review_rows) == len(needs_review_rows)
    )
    answer_only = bool(answer_reasons) and not structural_reasons and not image_only

    if image_only:
        return {
            "category": "image-dependent",
            "summary": "Blocked rows depend on diagrams, charts, maps, or image-only data.",
            "recommended_actions": [
                "manual review queue",
                "or image-aware extraction flow",
                "do not auto-approve",
            ],
            "counts": {
                "needs_review": len(needs_review_rows),
                "image_dependent_reviews": len(image_review_rows),
                "answer_explanation_mismatches": mismatch_count,
                "missing_explanations": missing_explanations,
            },
        }

    if answer_only:
        return {
            "category": "answer-related",
            "summary": "Blocked only by untrusted answers or answer/explanation disagreement.",
            "recommended_actions": [
                "targeted answer verification",
                "explanation cleanup/regeneration for changed rows",
                "publish approved rows",
            ],
            "counts": {
                "needs_review": len(needs_review_rows),
                "image_dependent_reviews": len(image_review_rows),
                "answer_explanation_mismatches": mismatch_count,
                "missing_explanations": missing_explanations,
            },
        }

    if structural_reasons and not answer_reasons:
        return {
            "category": "extraction-structure-related",
            "summary": "Blocked by numbering, payload, language, or extraction-shape issues.",
            "recommended_actions": [
                "parser fix or remap fix",
                "maybe paper re-ingestion",
                "keep paper blocked until fixed",
            ],
            "counts": {
                "needs_review": len(needs_review_rows),
                "image_dependent_reviews": len(image_review_rows),
                "answer_explanation_mismatches": mismatch_count,
                "missing_explanations": missing_explanations,
            },
        }

    return {
        "category": "mixed",
        "summary": "Blocked by both structural issues and answer-review issues.",
        "recommended_actions": [
            "fix extraction structure first",
            "then run targeted answer verification",
            "then cleanup/regenerate explanations for changed rows",
        ],
        "counts": {
            "needs_review": len(needs_review_rows),
            "image_dependent_reviews": len(image_review_rows),
            "answer_explanation_mismatches": mismatch_count,
            "missing_explanations": missing_explanations,
        },
    }


# ── Startup: reset stuck jobs ─────────────────────────────
# If uvicorn was killed mid-run, jobs stay "processing" forever — reset them.
try:
    _stuck = supabase.table("jobs").update({
        "status": "failed",
        "error_log": "Server restarted while job was running. Re-upload to retry.",
        "progress": 0,
    }).eq("status", "processing").execute()
    if _stuck.data:
        print(f"[startup] Reset {len(_stuck.data)} stuck processing job(s) to failed")
except Exception as _e:
    print(f"[startup] Could not reset stuck jobs: {_e}")


# ── Dependencies ─────────────────────────────────────────

async def get_current_user(authorization: str = Header(None)) -> dict:
    """Verify Firebase ID token."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Authorization header")
    token = authorization.split("Bearer ")[1]
    try:
        return verify_firebase_token(token)
    except ValueError as e:
        raise HTTPException(401, str(e))


async def verify_admin(x_admin_key: str = Header(None)):
    """Simple API key auth for admin endpoints."""
    if not x_admin_key or x_admin_key != ADMIN_API_KEY:
        raise HTTPException(403, "Invalid admin API key")


@app.post("/admin/pattern-book/classify-pages", dependencies=[Depends(verify_admin)])
async def admin_classify_pattern_book_pages(
    file: Optional[UploadFile] = File(None),
    pdf_path: str = Form(""),
):
    """
    Pilot-only page classification for pattern-book PDFs.
    Produces a report artifact and returns per-page classification metadata.
    """
    tmp_path: str | None = None
    target_path = pdf_path.strip()

    if file is not None:
        filename = (file.filename or "").lower()
        if not filename.endswith(".pdf"):
            raise HTTPException(400, "Only PDF files accepted")
        content = await file.read()
        if not content:
            raise HTTPException(400, "Uploaded PDF is empty")
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        target_path = tmp_path

    if not target_path:
        raise HTTPException(400, "Provide either a PDF upload or pdf_path")

    path_obj = Path(target_path)
    if not path_obj.exists():
        raise HTTPException(404, f"PDF not found: {target_path}")

    try:
        report = classify_pattern_book_pdf(str(path_obj), write_report=True)
        return {
            "pdf_path": report["pdf_path"],
            "page_count": report["page_count"],
            "counts": report["counts"],
            "report_path": report.get("report_path"),
            "pages": report["pages"],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Pattern-book page classification failed: {exc}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.post("/admin/pattern-book/extract-raw-blocks", dependencies=[Depends(verify_admin)])
async def admin_extract_pattern_book_raw_blocks(
    file: Optional[UploadFile] = File(None),
    pdf_path: str = Form(""),
):
    """
    Phase B pilot: extract raw question/solution blocks only.
    Never writes canonical questions.
    """
    tmp_path: str | None = None
    target_path = pdf_path.strip()

    if file is not None:
        filename = (file.filename or "").lower()
        if not filename.endswith(".pdf"):
            raise HTTPException(400, "Only PDF files accepted")
        content = await file.read()
        if not content:
            raise HTTPException(400, "Uploaded PDF is empty")
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        target_path = tmp_path

    if not target_path:
        raise HTTPException(400, "Provide either a PDF upload or pdf_path")

    path_obj = Path(target_path)
    if not path_obj.exists():
        raise HTTPException(404, f"PDF not found: {target_path}")

    try:
        from extractor.pattern_book_raw_blocks import extract_pattern_book_raw_blocks

        report = extract_pattern_book_raw_blocks(str(path_obj), write_report=True)
        return report
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Pattern-book raw block extraction failed: {exc}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


def _load_latest_or_named_json_artifact(directory: Path, filename: str = "") -> dict:
    directory.mkdir(parents=True, exist_ok=True)
    if filename:
        target = directory / Path(filename).name
        if not target.exists():
            raise HTTPException(404, f"Report not found: {filename}")
    else:
        candidates = sorted(directory.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not candidates:
            raise HTTPException(404, f"No reports found in {directory.name}")
        target = candidates[0]
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(500, f"Invalid report JSON: {target.name}") from exc


@app.get("/admin/pattern-book/raw-report", dependencies=[Depends(verify_admin)])
async def admin_get_pattern_book_raw_report(filename: str = Query("")):
    report_dir = Path(__file__).resolve().parent / "cache" / "pattern_book_raw_blocks"
    return _load_latest_or_named_json_artifact(report_dir, filename)


@app.get("/admin/pattern-book/classification-report", dependencies=[Depends(verify_admin)])
async def admin_get_pattern_book_classification_report(filename: str = Query("")):
    report_dir = Path(__file__).resolve().parent / "cache" / "pattern_book_reports"
    return _load_latest_or_named_json_artifact(report_dir, filename)


@app.get("/admin/pattern-book/readiness-audit", dependencies=[Depends(verify_admin)])
async def admin_get_pattern_book_readiness_audit(filename: str = Query("")):
    report_dir = Path(__file__).resolve().parent / "cache" / "pattern_book_raw_blocks"
    report = _load_latest_or_named_json_artifact(report_dir, filename)
    audit = report.get("phase_c_readiness_audit")
    if not audit:
        audit = build_phase_c_readiness_audit(report)
    return {
        "report_path": report.get("report_path"),
        "pdf_path": report.get("pdf_path"),
        "page_count": report.get("page_count"),
        "summary": report.get("summary", {}),
        "phase_c_readiness_audit": audit,
    }


@app.post("/admin/pattern-book/build-normalized-draft", dependencies=[Depends(verify_admin)])
async def admin_build_pattern_book_normalized_draft(filename: str = Query("")):
    report_dir = Path(__file__).resolve().parent / "cache" / "pattern_book_raw_blocks"
    report = _load_latest_or_named_json_artifact(report_dir, filename)
    return build_pattern_book_normalized_draft(report, write_report=True)


@app.get("/admin/pattern-book/normalized-draft", dependencies=[Depends(verify_admin)])
async def admin_get_pattern_book_normalized_draft(filename: str = Query("")):
    report_dir = Path(__file__).resolve().parent / "cache" / "pattern_book_normalized_drafts"
    return _load_latest_or_named_json_artifact(report_dir, filename)


@app.post("/admin/pattern-book/gemini-question-pilot", dependencies=[Depends(verify_admin)])
async def admin_build_pattern_book_gemini_question_pilot(
    pdf_path: str = Form(""),
    file: UploadFile | None = File(default=None),
):
    target_path = pdf_path.strip()
    tmp_path = None
    try:
        if file is not None:
            if not (file.filename or "").lower().endswith(".pdf"):
                raise HTTPException(400, "Only PDF files accepted")
            content = await file.read()
            if not content:
                raise HTTPException(400, "Uploaded PDF is empty")
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            target_path = tmp_path

        if not target_path:
            raise HTTPException(400, "Provide either a PDF upload or pdf_path")

        path_obj = Path(target_path)
        if not path_obj.exists():
            raise HTTPException(404, f"PDF not found: {target_path}")

        return extract_pattern_book_question_pages_with_gemini(str(path_obj), write_report=True)
    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)


@app.get("/admin/pattern-book/gemini-question-pilot", dependencies=[Depends(verify_admin)])
async def admin_get_pattern_book_gemini_question_pilot(filename: str = Query("")):
    report_dir = Path(__file__).resolve().parent / "cache" / "pattern_book_gemini_pilot"
    return _load_latest_or_named_json_artifact(report_dir, filename)


@app.post("/admin/pattern-book/gemini-stage12", dependencies=[Depends(verify_admin)])
async def admin_build_pattern_book_gemini_stage12(
    pdf_path: str = Form(""),
    file: UploadFile | None = File(default=None),
):
    target_path = pdf_path.strip()
    tmp_path = None
    try:
        if file is not None:
            if not (file.filename or "").lower().endswith(".pdf"):
                raise HTTPException(400, "Only PDF files accepted")
            content = await file.read()
            if not content:
                raise HTTPException(400, "Uploaded PDF is empty")
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            target_path = tmp_path

        if not target_path:
            raise HTTPException(400, "Provide either a PDF upload or pdf_path")

        path_obj = Path(target_path)
        if not path_obj.exists():
            raise HTTPException(404, f"PDF not found: {target_path}")

        return run_pattern_book_gemini_stage12(str(path_obj), write_report=True)
    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)


@app.get("/admin/pattern-book/gemini-stage12", dependencies=[Depends(verify_admin)])
async def admin_get_pattern_book_gemini_stage12(filename: str = Query("")):
    report_dir = Path(__file__).resolve().parent / "cache" / "pattern_book_gemini_stage12"
    return _load_latest_or_named_json_artifact(report_dir, filename)


# ══════════════════════════════════════════════════════════
# PUBLIC ENDPOINTS (No auth — questions are shared data)
# ══════════════════════════════════════════════════════════

@app.get("/health")
async def health():
    try:
        r = supabase.table("questions").select("id", count="exact").limit(1).execute()
        return {"status": "ok", "questions_count": r.count, "time": datetime.now(timezone.utc).isoformat()}
    except Exception:
        return {"status": "error", "database": "unreachable"}


# ══════════════════════════════════════════════════════════════════════ #
# PATTERN PRACTICE — SSC/CGL Pattern Book APIs
# ══════════════════════════════════════════════════════════════════════ #

@app.get("/pattern-books")
async def list_pattern_books():
    """List all ingested pattern books (SSC CGL chapters etc.)."""
    try:
        res = supabase.table("pattern_books").select("*").order("created_at").execute()
        return res.data or []
    except Exception as e:
        raise HTTPException(503, f"Pattern books unavailable: {e}")


@app.get("/pattern-books/{book_id}/questions")
async def get_pattern_questions(book_id: str):
    """All questions for a given pattern book, ordered by question_number."""
    try:
        res = supabase.table("pattern_questions").select("*").eq("book_id", book_id).order("question_number").execute()
        return res.data or []
    except Exception as e:
        raise HTTPException(503, f"Pattern questions unavailable: {e}")


@app.post("/admin/pattern-books/ingest", dependencies=[Depends(verify_admin)])
async def ingest_pattern_book_from_cache(
    title:       str = Query(...),
    chapter:     str = Query(default="Chapter 1: Percentage"),
    exam_target: str = Query(default="SSC CGL"),
    source_file: str = Query(default="SSC_CGL PERCENTAGES.pdf"),
):
    """One-shot: ingest stage12 cache → pattern_books + pattern_questions tables."""
    from pathlib import Path as Pth
    import json as _json
    stage12_dir = Pth(__file__).parent / "cache" / "pattern_book_gemini_stage12"
    files = list(stage12_dir.glob("*.json"))
    if not files:
        raise HTTPException(404, "No stage12 cache found. Run extraction first.")
    data = _json.loads(files[0].read_text())
    qs   = data.get("valid_questions", [])
    if not qs:
        raise HTTPException(400, "No valid questions in cache.")
    book_res = supabase.table("pattern_books").upsert(
        {"title": title, "chapter": chapter, "exam_target": exam_target,
         "source_file": source_file, "question_count": len(qs)},
        on_conflict="title").execute()
    book_id = book_res.data[0]["id"]
    supabase.table("pattern_questions").delete().eq("book_id", book_id).execute()
    rows = [{
        "book_id": book_id,
        "question_number": q.get("question_number"),
        "question_text": (q.get("question_text") or "").strip(),
        "option_a": (q.get("option_a") or "").strip(),
        "option_b": (q.get("option_b") or "").strip(),
        "option_c": (q.get("option_c") or "").strip(),
        "option_d": (q.get("option_d") or "").strip(),
        "correct_answer": q.get("correct_answer"),
        "difficulty": "Medium",
        "pattern_tag": chapter,
        "source_page": q.get("source_page_number"),
    } for q in qs]
    for i in range(0, len(rows), 50):
        supabase.table("pattern_questions").insert(rows[i:i+50]).execute()
    supabase.table("pattern_books").update({"question_count": len(rows)}).eq("id", book_id).execute()
    return {"status": "ingested", "book_id": book_id, "question_count": len(rows)}


@app.get("/questions")
async def get_questions(
    subject: Optional[str] = Query(None),
    topic: Optional[str] = Query(None),
    exam_name: Optional[str] = Query(None),
    exam_year: Optional[int] = Query(None),
    difficulty: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=10000),
    offset: int = Query(0, ge=0),
):
    """Fetch filtered + paginated questions from stored publishable papers only."""
    try:
        normalized_exam_name = normalize_exam_name(exam_name) if exam_name else None
        publishable_keys = public_exam_keys(exam_name=normalized_exam_name, exam_year=exam_year, sb=supabase)
        publishable_paper_ids = public_paper_ids(exam_name=normalized_exam_name, exam_year=exam_year, sb=supabase)
        supported_cols = _question_supported_columns()
        has_canonical_subject = "canonical_subject" in supported_cols
        has_canonical_topic = "canonical_topic_family" in supported_cols
        subject_col = "canonical_subject" if has_canonical_subject else "subject"
        topic_col = "canonical_topic_family" if has_canonical_topic else "topic"
        if normalized_exam_name and exam_year and (normalized_exam_name, exam_year) not in publishable_keys:
            return {"questions": [], "total": 0, "limit": limit, "offset": offset, "has_more": False}

        all_data = []
        scan_offset = 0
        select_clause = _question_select_clause([
            "id", "question_text", "option_a", "option_b", "option_c", "option_d",
            "correct_answer", "subject", "topic", "subtopic", "difficulty", "exam_name", "exam_year",
            "question_type", "concept", "question_number", "needs_review", "has_image", "image_url", "paper_id",
        ], supported_cols)
        while True:
            q = _apply_public_question_filter(supabase.table("questions").select(select_clause), supported_cols)

            if subject and has_canonical_subject:
                q = q.eq(subject_col, subject)
            if topic and has_canonical_topic:
                q = q.eq(topic_col, topic)
            if normalized_exam_name:
                q = q.eq("exam_name", normalized_exam_name)
            if exam_year:
                q = q.eq("exam_year", exam_year)
            if difficulty:
                q = q.eq("difficulty", difficulty)

            q = q.order("created_at", desc=True).range(scan_offset, scan_offset + 999)
            result = q.execute()
            batch = result.data or []
            if not batch:
                break

            for row in batch:
                if str(row.get("paper_id")) not in publishable_paper_ids:
                    continue
                sanitized = _sanitize_public_question_row(row)
                if sanitized is not None:
                    if subject and sanitized.get("subject") != subject:
                        continue
                    if topic and sanitized.get("topic") != topic:
                        continue
                    all_data.append(sanitized)
            if len(batch) < 1000:
                break
            scan_offset += 1000

        total = len(all_data)
        page = all_data[offset: offset + limit]

        return {
            "questions": page,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + len(page)) < total,
        }
    except Exception as e:
        raise HTTPException(500, f"Database error: {e}")


@app.get("/questions/meta")
async def get_questions_meta():
    """Lightweight question metadata for navigation, feed, and dashboard.
    Returns only id, exam_name, exam_year, subject, topic, subtopic, difficulty.
    Cached in-process for 2 minutes — 100 concurrent logins = 1 Supabase query."""
    global _meta_cache, _meta_cache_ts
    now = time.time()
    if _meta_cache is not None and (now - _meta_cache_ts) < _META_CACHE_TTL:
        return _meta_cache
    try:
        publishable_paper_ids = public_paper_ids(sb=supabase)
        supported_cols = _question_supported_columns()
        all_data: list[dict] = []
        offset = 0
        select_clause = _question_select_clause([
            "id", "exam_name", "exam_year", "subject", "topic", "subtopic", "difficulty", "paper_id",
            "question_text", "option_a", "option_b", "option_c", "option_d", "correct_answer", "needs_review", "question_number",
        ], supported_cols)
        while True:
            r = _apply_public_question_filter(supabase.table("questions").select(select_clause), supported_cols).range(offset, offset + 999).execute()
            batch = r.data or []
            for row in batch:
                if str(row.get("paper_id")) not in publishable_paper_ids:
                    continue
                sanitized = _sanitize_public_question_row(row)
                if sanitized is None:
                    continue
                all_data.append({
                    "id": sanitized.get("id"),
                    "exam_name": row.get("exam_name"),
                    "exam_year": row.get("exam_year"),
                    "subject": sanitized.get("subject"),
                    "topic": sanitized.get("topic"),
                    "subtopic": sanitized.get("subtopic"),
                    "difficulty": sanitized.get("difficulty"),
                    "paper_id": row.get("paper_id"),
                })
            if len(batch) < 1000:
                break
            offset += 1000
        result = {"questions": all_data, "total": len(all_data)}
        _meta_cache = result
        _meta_cache_ts = now
        return result
    except Exception as e:
        raise HTTPException(500, f"Database error: {e}")


@app.get("/questions/{question_id}")
async def get_question_with_answer(question_id: str):
    """Single question WITH correct answer (after user submits)."""
    try:
        supported_cols = _question_supported_columns()
        select_clause = _question_select_clause([
            "id", "question_text", "option_a", "option_b", "option_c", "option_d",
            "correct_answer", "subject", "topic", "subtopic", "difficulty",
            "exam_name", "exam_year", "question_type", "concept", "question_number", "needs_review", "has_image", "image_url", "paper_id", "public_visibility",
        ], supported_cols)
        r = supabase.table("questions").select(
            select_clause
        ).eq("id", question_id).single().execute()

        if not r.data:
            raise HTTPException(404, "Question not found")
        if not _row_is_public(r.data, supported_cols):
            raise HTTPException(404, "Question not found")
        if str(r.data.get("paper_id")) not in public_paper_ids(
            exam_name=r.data.get("exam_name"),
            exam_year=r.data.get("exam_year"),
            sb=supabase,
        ):
            raise HTTPException(404, "Question not found")
        sanitized = _sanitize_public_question_row(r.data)
        if sanitized is None:
            raise HTTPException(404, "Question not found")
        return sanitized
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {e}")


@app.get("/explanation/{question_id}")
async def get_explanation(question_id: str):
    """
    Lazy-loaded explanation + Real-time Answer Consistency.
    If the Reasoning Engine finds a corrected answer, it is returned here
    to sync the frontend UI state.
    """
    try:
        qr_select = ["exam_name", "exam_year", "paper_id"]
        supported_cols = _question_supported_columns()
        if "public_visibility" in supported_cols:
            qr_select.append("public_visibility")
        if "is_active" in supported_cols:
            qr_select.append("is_active")
        qr = supabase.table("questions").select(", ".join(qr_select)).eq("id", question_id).single().execute()
        if not qr.data:
            raise HTTPException(404, "Question not found")
        if not _row_is_public(qr.data, supported_cols):
            raise HTTPException(404, "Question not found")
        if str(qr.data.get("paper_id")) not in public_paper_ids(
            exam_name=qr.data.get("exam_name"),
            exam_year=qr.data.get("exam_year"),
            sb=supabase,
        ):
            raise HTTPException(404, "Question not found")
        question_row = supabase.table("questions").select(
            "id, question_text, option_a, option_b, option_c, option_d, "
            "correct_answer, needs_review, question_number"
        ).eq("id", question_id).single().execute()
        if not question_row.data or _sanitize_public_question_row(question_row.data) is None:
            raise HTTPException(404, "Question not found")
        from pipeline import generate_single_explanation
        result = generate_single_explanation(question_id)
        if not result:
            raise HTTPException(404, "Question or explanation could not be generated")
        if _question_has_explanation_contradiction(
            question_id,
            exam_name=qr.data.get("exam_name"),
            exam_year=qr.data.get("exam_year"),
        ):
            return {
                "question_id": question_id,
                "explanation": "",
                "source": "hidden-contradiction",
                "verified_answer": result.get("verified_answer"),
                "needs_review": result.get("needs_review"),
            }
        
        # Returns: {question_id, explanation, source, verified_answer, needs_review}
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR in get_explanation: {e}")
        raise HTTPException(500, f"Error generating explanation: {e}")


@app.get("/practice")
async def get_practice_questions(
    subject: Optional[str] = Query(None),
    topic: Optional[str] = Query(None),
    difficulty: Optional[str] = Query(None),
    count: int = Query(10, ge=1, le=50),
):
    """
    Random questions for practice mode.
    Returns WITHOUT correct_answer — user must submit to see answer.
    
    Flow: GET /practice → user answers → GET /questions/{id} → GET /explanation/{id} → POST /attempt
    """
    try:
        publishable_paper_ids = public_paper_ids(sb=supabase)
        supported_cols = _question_supported_columns()
        has_canonical_subject = "canonical_subject" in supported_cols
        has_canonical_topic = "canonical_topic_family" in supported_cols
        subject_col = "canonical_subject" if has_canonical_subject else "subject"
        topic_col = "canonical_topic_family" if has_canonical_topic else "topic"
        select_clause = _question_select_clause([
            "id", "question_text", "option_a", "option_b", "option_c", "option_d",
            "subject", "topic", "subtopic", "difficulty", "exam_name", "exam_year", "has_image", "image_url", "paper_id",
        ], supported_cols)
        q = _apply_public_question_filter(supabase.table("questions").select(select_clause), supported_cols)

        if subject and has_canonical_subject:
            q = q.eq(subject_col, subject)
        if topic and has_canonical_topic:
            q = q.eq(topic_col, topic)
        if difficulty:
            q = q.eq("difficulty", difficulty)

        q = q.limit(max(count * 10, 200))
        result = q.execute()
        questions = []
        for row in result.data or []:
            if str(row.get("paper_id")) not in publishable_paper_ids:
                continue
            sanitized = _sanitize_public_question_row(row)
            if sanitized is not None:
                if subject and sanitized.get("subject") != subject:
                    continue
                if topic and sanitized.get("topic") != topic:
                    continue
                questions.append(sanitized)

        import random
        random.shuffle(questions)
        return {"questions": questions[:count], "count": min(len(questions), count)}
    except Exception as e2:
        raise HTTPException(500, f"Database error: {e2}")


@app.get("/topic-questions")
async def get_questions_by_topic(
    subject: str = Query(...),
    topic: str = Query(...),
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
):
    try:
        return _topic_bucket_questions(
            subject=subject,
            topic=topic,
            admin_mode=False,
            limit=limit,
            offset=offset,
        )
    except Exception as e:
        raise HTTPException(500, f"Database error: {e}")


@app.get("/stats")
async def get_stats():
    """Dashboard statistics — cached-friendly, no auth needed."""
    try:
        publishable_paper_ids = public_paper_ids(sb=supabase)
        all_rows: list[dict] = []
        offset = 0
        while True:
            r = _apply_public_question_filter(supabase.table("questions").select(
                "id, subject, difficulty, exam_year, exam_name, paper_id, "
                "question_text, option_a, option_b, option_c, option_d, correct_answer, needs_review, question_number"
            ), _question_supported_columns()).range(offset, offset + 999).execute()
            batch = r.data or []
            for row in batch:
                if str(row.get("paper_id")) not in publishable_paper_ids:
                    continue
                sanitized = _sanitize_public_question_row(row)
                if sanitized is None:
                    continue
                all_rows.append(sanitized)
            if len(batch) < 1000:
                break
            offset += 1000

        total = len(all_rows)
        sc: dict[str, int] = {}
        for q in all_rows:
            s = q["subject"]
            sc[s] = sc.get(s, 0) + 1
        subjects = [{"subject": k, "count": v} for k, v in sorted(sc.items(), key=lambda x: x[1], reverse=True)]

        diff = {"Easy": 0, "Medium": 0, "Hard": 0}
        for q in all_rows:
            level = q.get("difficulty")
            if level in diff:
                diff[level] += 1

        years = sorted(set(q["exam_year"] for q in all_rows), reverse=True)
        exams = sorted(set(q["exam_name"] for q in all_rows))

        return {
            "total_questions": total,
            "subjects": subjects,
            "difficulty_distribution": diff,
            "exam_years": years,
            "exam_names": exams,
        }
    except Exception as e:
        raise HTTPException(500, f"Stats error: {e}")


# ══════════════════════════════════════════════════════════
# AUTH ENDPOINT (Firebase token required)
# ══════════════════════════════════════════════════════════

class AttemptCreate(BaseModel):
    question_id: str
    selected_answer: str = Field(..., pattern="^[A-D]$")
    is_correct: bool
    time_taken_seconds: Optional[int] = None
    exam_name: Optional[str] = None
    subject: Optional[str] = None


@app.post("/attempt")
async def record_attempt(attempt: AttemptCreate, user: dict = Depends(get_current_user)):
    """Store user attempt in Firebase Firestore."""
    from firebase_admin import firestore

    try:
        db = firestore.client()
        ref = db.collection("attempts").document()
        ref.set({
            "userId": user["uid"],
            "questionId": attempt.question_id,
            "selectedAnswer": attempt.selected_answer,
            "isCorrect": attempt.is_correct,
            "timeTakenSeconds": attempt.time_taken_seconds,
            "examName": attempt.exam_name,
            "subject": attempt.subject,
            "attemptedAt": firestore.SERVER_TIMESTAMP,
        })
        return {"status": "recorded", "attemptId": ref.id, "isCorrect": attempt.is_correct}
    except Exception as e:
        raise HTTPException(500, f"Failed to record attempt: {e}")


@app.get("/progress/me")
async def get_my_progress(user: dict = Depends(get_current_user)):
    """Return dashboard-ready progress for the authenticated user."""
    from firebase_admin import firestore

    try:
        db = firestore.client()
        docs = db.collection("attempts").where("userId", "==", user["uid"]).stream()
        attempts = [doc.to_dict() or {} for doc in docs]

        by_subject: dict[str, dict[str, int]] = {}
        total_answered = 0
        xp = 0
        daily_activity: dict[str, int] = {}
        recent_attempts: list[dict[str, object]] = []

        def _attempt_date_str(item: dict) -> str:
            stamp = item.get("attemptedAt")
            if hasattr(stamp, "date"):
                return stamp.date().isoformat()
            return datetime.now(timezone.utc).date().isoformat()

        def _attempt_sort_key(item: dict) -> datetime:
            stamp = item.get("attemptedAt")
            if hasattr(stamp, "astimezone"):
                return stamp.astimezone(timezone.utc)
            return datetime.now(timezone.utc)

        attempts.sort(key=_attempt_sort_key, reverse=True)

        for item in attempts:
            subject = str(item.get("subject") or "Unknown")
            is_correct = bool(item.get("isCorrect"))
            total_answered += 1
            xp += 10 if is_correct else 2

            if subject not in by_subject:
                by_subject[subject] = {"correct": 0, "total": 0}
            by_subject[subject]["total"] += 1
            if is_correct:
                by_subject[subject]["correct"] += 1

            date_key = _attempt_date_str(item)
            daily_activity[date_key] = daily_activity.get(date_key, 0) + 1

        for item in attempts[:20]:
            recent_attempts.append({
                "q": str(item.get("examName") or item.get("subject") or "Attempt"),
                "correct": bool(item.get("isCorrect")),
                "subject": str(item.get("subject") or "Unknown"),
                "topic": str(item.get("examName") or ""),
                "time": (
                    f"{int(item.get('timeTakenSeconds') or 0)}s"
                    if item.get("timeTakenSeconds") is not None
                    else "saved"
                ),
            })

        streak = 0
        active_dates = sorted(daily_activity.keys(), reverse=True)
        today = datetime.now(timezone.utc).date()
        for idx, date_key in enumerate(active_dates):
            expected = (today - timedelta(days=idx)).isoformat()
            if date_key == expected:
                streak += 1
            else:
                break

        return {
            "bySubject": by_subject,
            "streak": streak,
            "lastActiveDate": active_dates[0] if active_dates else "",
            "xp": xp,
            "totalAnswered": total_answered,
            "recentAttempts": recent_attempts,
            "dailyActivity": daily_activity,
        }
    except Exception as e:
        raise HTTPException(500, f"Failed to load progress: {e}")


# ══════════════════════════════════════════════════════════
# ADMIN ENDPOINTS (API key required)
# ══════════════════════════════════════════════════════════

@app.post("/admin/upload-pdf", dependencies=[Depends(verify_admin)])
async def admin_upload_pdf(
    file: UploadFile = File(...),
    exam_name: str = Form(...),
    exam_year: int = Form(...),
    series: str = Form(""),
    use_vision: bool = Form(False),
    is_cbt: bool = Form(False),
    shift_label_override: str = Form(""),
    answer_key_file: Optional[UploadFile] = File(None),
    expected_count: int = Form(0),
    force_replace: bool = Form(False),
    clear_cache: bool = Form(False),
):
    """
    Admin uploads a PDF → Async Job is created and queued.
    Uses threading.Thread instead of BackgroundTasks so tasks
    survive uvicorn --reload restarts.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files accepted")

    # Normalize exam_name: collapse multiple spaces, strip edges, preserve original casing
    exam_name = normalize_exam_name(exam_name)
    existing_missing_numbers = _repair_target_numbers_for_exam(
        exam_name,
        exam_year,
        expected_count=expected_count,
    )
    missing_reupload_mode = bool(existing_missing_numbers) and not force_replace

    content = await file.read()

    MAX_SIZE = 100 * 1024 * 1024  # 100 MB
    if len(content) > MAX_SIZE:
        raise HTTPException(413, f"File too large ({len(content)//1024//1024} MB). Max allowed: 100 MB.")
    file_hash = hashlib.sha256(content).hexdigest()

    # ── Multi-billion Dollar Deduction & Overwrite Intelligence ─────────────
    # 1. File Hash Check (prevents same file twice)
    existing_job = supabase.table("jobs").select("id, status, exam_name, exam_year").eq("file_hash", file_hash).execute()
    if existing_job.data:
        if not force_replace and not missing_reupload_mode:
            job = existing_job.data[0]
            if job["status"] in ["completed", "processing", "pending"]:
                existing_exam = f"{job.get('exam_name', '')} {job.get('exam_year', '')}".strip()
                return JSONResponse(status_code=409, content={
                    "error": "duplicate_file",
                    "message": f"This PDF was already uploaded as '{existing_exam}'. Re-processing it will create a new entry under '{exam_name} {exam_year}'.",
                    "job_id": job["id"],
                    "existing_exam_name": job.get("exam_name", ""),
                    "existing_exam_year": job.get("exam_year", ""),
                })
        # If we ARE forcing replace, retrying a failed job, or running a missing-question repair,
        # clear the previous file_hash row so a fresh repair job can be inserted.
        for job in existing_job.data:
            supabase.table("jobs").delete().eq("id", job["id"]).execute()

    # 2. Exam Name + Year Check (prevents same exam with different PDF)
    existing_q = supabase.table("questions").select("id").eq("exam_name", exam_name).eq("exam_year", exam_year).limit(1).execute()
    if existing_q.data and not force_replace and not missing_reupload_mode:
        return JSONResponse(status_code=409, content={
            "error": "exam_exists",
            "message": f"'{exam_name} {exam_year}' already exists in the database.",
            "exam_name": exam_name,
            "exam_year": exam_year
        })

    # If force_replace is on, archive old questions for this exam+year
    if force_replace:
        print(f"  📦 Archiving old questions for {exam_name} {exam_year} (Force Replace)...")
        supabase.table("questions").update({"is_active": False}).eq("exam_name", exam_name).eq("exam_year", exam_year).execute()
        # Also clean up old jobs for this specific name/year to avoid UI confusion
        supabase.table("jobs").update({"status": "archived"}).eq("exam_name", exam_name).eq("exam_year", exam_year).execute()

    # If clear_cache is on, delete per-page cache files for this PDF so it re-extracts fresh
    if clear_cache:
        from pathlib import Path as _Path
        cache_dir = _Path(__file__).parent / "cache"
        patterns = [
            f"univ_{file_hash[:16]}_p*.json",
            f"univ_v*_{file_hash[:16]}_p*.json",
            f"vision_{file_hash[:16]}_p*.json",
        ]
        cleared = 0
        for pattern in patterns:
            for f in cache_dir.glob(pattern):
                f.unlink()
                cleared += 1
        print(f"  🗑️  Cleared {cleared} cache pages for PDF {file_hash[:16]}")

    # Save to temp file
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Parse answer key synchronously if provided
        answer_key_map: dict | None = None
        if answer_key_file and answer_key_file.filename:
            ak_content = await answer_key_file.read()
            if ak_content:
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as ak_tmp:
                    ak_tmp.write(ak_content)
                    ak_tmp_path = ak_tmp.name
                try:
                    from extractor.answer_key_parser import parse_answer_key
                    answer_key_map = parse_answer_key(ak_tmp_path, expected_count=expected_count)
                    print(f"[upload] Answer key parsed: {len(answer_key_map)} answers")
                except Exception as e:
                    print(f"[upload] Answer key parse failed: {e}")
                finally:
                    os.unlink(ak_tmp_path)

        # ── Smart Routing with explicit admin overrides ──
        from extractor.router import detect_format, ExamFormat
        detected_format = detect_format(tmp_path)
        route_format = detected_format
        if is_cbt:
            route_format = ExamFormat.TCSION_CBT
            print("  🧭 Admin override: forcing CBT pipeline")
        elif use_vision:
            route_format = ExamFormat.APPSC_BOXED
            print("  🧭 Admin override: forcing visual/final-key pipeline")

        print(f"  🧠 Smart Router detected format: {detected_format} | route={route_format}")

        if missing_reupload_mode:
            paper = ensure_paper_for_existing_exam(
                exam_name,
                exam_year,
                source_filename=file.filename,
                source_file_hash=file_hash,
                source_pdf_path=tmp_path,
                extractor_type=route_format,
                sb=supabase,
            )
            if not paper:
                raise HTTPException(500, "Could not find the existing paper to repair missing questions.")
        else:
            paper = ensure_paper_for_upload(
                exam_name,
                exam_year,
                source_filename=file.filename,
                source_file_hash=file_hash,
                source_pdf_path=tmp_path,
                extractor_type=route_format,
                supersede_latest=force_replace,
                sb=supabase,
            )

        # Create pending job in Supabase
        job_res = supabase.table("jobs").insert({
            "paper_id": paper["id"],
            "filename": file.filename,
            "file_hash": file_hash,
            "exam_name": exam_name,
            "exam_year": exam_year,
            "status": "pending",
            "progress": 0,
            "pdf_path": tmp_path,
        }).execute()

        if not job_res.data:
            raise HTTPException(500, "Failed to create job in database")

        job_id = job_res.data[0]["id"]
        link_job_to_paper(paper["id"], job_id, sb=supabase)

        if missing_reupload_mode:
            from pipeline import process_missing_questions_job_background
            t = threading.Thread(
                target=process_missing_questions_job_background,
                args=(job_id, tmp_path, exam_name, exam_year, existing_missing_numbers, answer_key_map),
                daemon=True,
                name=f"job-{job_id[:8]}",
            )
        elif route_format in [ExamFormat.TCSION_CBT, ExamFormat.TELEGRAM_CBT]:
            from extractor.cbt_pipeline import process_cbt_job_background
            t = threading.Thread(
                target=process_cbt_job_background,
                args=(job_id, tmp_path, exam_name, exam_year, shift_label_override or None, expected_count),
                daemon=True,
                name=f"job-{job_id[:8]}",
            )
        elif route_format == ExamFormat.APPSC_BOXED:
            from extractor.vision_extractor import process_vision_job_background
            t = threading.Thread(
                target=process_vision_job_background,
                args=(job_id, tmp_path, exam_name, exam_year, series),
                daemon=True,
                name=f"job-{job_id[:8]}",
            )
        else:
            from extractor.universal_extractor import process_universal_job_background
            t = threading.Thread(
                target=process_universal_job_background,
                args=(job_id, tmp_path, exam_name, exam_year, answer_key_map, expected_count),
                daemon=True,
                name=f"job-{job_id[:8]}",
            )
        t.start()
        print(f"[upload] Started thread {t.name} for job {job_id}")

        return {
            "status": "queued",
            "job_id": job_id,
            "message": (
                f"Gap repair queued for missing questions {existing_missing_numbers[:20]}"
                if missing_reupload_mode
                else "File uploaded successfully. Processing in background."
            ),
            "missing_reupload_mode": missing_reupload_mode,
            "target_missing_numbers": existing_missing_numbers[:50] if missing_reupload_mode else [],
        }
    except Exception as e:
        os.unlink(tmp_path)
        raise HTTPException(500, f"Error queuing job: {e}")

@app.post("/admin/inject-answers", dependencies=[Depends(verify_admin)])
async def admin_inject_answers(
    exam_name: str = Form(...),
    exam_year: int = Form(...),
    answer_key_file: UploadFile = File(...),
    expected_count: int = Form(150),
):
    """
    Inject answers from a standalone answer key PDF into an already-uploaded exam.
    Useful when the question paper was uploaded earlier without an answer key.
    Matches by question_number within the given exam_name + exam_year.
    """
    if not answer_key_file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files accepted for answer key")

    ak_content = await answer_key_file.read()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as ak_tmp:
        ak_tmp.write(ak_content)
        ak_tmp_path = ak_tmp.name

    try:
        from extractor.answer_key_parser import parse_answer_key
        from pipeline import inject_answers
        answer_map = parse_answer_key(ak_tmp_path, expected_count=expected_count)
        if not answer_map:
            raise HTTPException(422, "Could not extract any answers from the PDF. Check the format.")
        result = inject_answers(answer_map, exam_name.strip(), exam_year)
        return {
            "status": "ok",
            "answers_parsed": len(answer_map),
            "questions_updated": result["updated"],
            "exam": f"{exam_name} {exam_year}",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Answer key injection failed: {e}")
    finally:
        os.unlink(ak_tmp_path)


@app.get("/admin/status", response_class=HTMLResponse, dependencies=[Depends(verify_admin)])
async def admin_status_page():
    """Visual progress dashboard — open in browser, auto-refreshes every 5s."""
    try:
        r = supabase.table("jobs").select("*").order("created_at", desc=True).limit(20).execute()
        jobs = r.data or []
    except Exception as e:
        jobs = []

    rows = ""
    for job in jobs:
        prog = job.get("progress", 0)
        status = job.get("status", "unknown")
        color = {"completed": "#10b981", "processing": "#6366f1", "pending": "#f59e0b", "failed": "#ef4444"}.get(status, "#94a3b8")
        bar_color = color
        icon = {"completed": "✅", "processing": "⏳", "pending": "🕐", "failed": "❌"}.get(status, "•")
        error_row = f'<div style="color:#ef4444;font-size:12px;margin-top:4px;">⚠️ {job.get("error_log","")}</div>' if job.get("error_log") else ""
        rows += f"""
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div>
              <span style="font-weight:700;font-size:15px;">{icon} {job.get('filename','?')}</span>
              <span style="margin-left:12px;color:#64748b;font-size:13px;">{job.get('exam_name','')} · {job.get('exam_year','')}</span>
            </div>
            <span style="background:{color};color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;">{status.upper()}</span>
          </div>
          <div style="background:#f1f5f9;border-radius:99px;height:10px;overflow:hidden;">
            <div style="background:{bar_color};width:{prog}%;height:100%;border-radius:99px;transition:width 0.5s;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:12px;color:#94a3b8;">
            <span>Progress</span><span style="font-weight:700;color:{color};">{prog}%</span>
          </div>
          {error_row}
          <div style="font-size:11px;color:#cbd5e1;margin-top:6px;">ID: {job.get('id','')} · Updated: {job.get('updated_at','')[:19].replace('T',' ')}</div>
        </div>"""

    if not rows:
        rows = '<div style="text-align:center;color:#94a3b8;padding:40px;">No jobs yet. Upload a PDF from the docs page.</div>'

    html = f"""<!DOCTYPE html>
<html><head>
  <title>Upload Status</title>
  <meta http-equiv="refresh" content="5">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:24px;}}
  h1{{font-size:22px;font-weight:800;color:#0f172a;margin-bottom:4px;}}
  p{{color:#64748b;font-size:13px;margin-bottom:24px;}}</style>
</head><body>
  <h1>📄 PDF Upload Status</h1>
  <p>Auto-refreshes every 5 seconds · <a href="/docs" style="color:#6366f1;">Back to API Docs</a></p>
  {rows}
</body></html>"""
    return HTMLResponse(content=html)


@app.get("/admin/jobs", dependencies=[Depends(verify_admin)])
async def admin_list_jobs(limit: int = Query(50, ge=1, le=100)):
    """List all upload jobs and their statuses."""
    try:
        r = supabase.table("jobs").select("*").order("created_at", desc=True).limit(limit).execute()
        jobs = r.data or []
        for job in jobs:
            if job.get("exam_name") and job.get("exam_year") and str(job.get("status")) in {"completed", "failed", "archived"}:
                try:
                    job["quality_report"] = _exam_quality_report(job["exam_name"], int(job["exam_year"]))
                except Exception:
                    job["quality_report"] = None
        return {"jobs": jobs}
    except Exception as e:
        raise HTTPException(500, f"Database error: {e}")

@app.get("/admin/jobs/{job_id}", dependencies=[Depends(verify_admin)])
async def admin_get_job(job_id: str):
    """Poll a specific job's real-time progress."""
    try:
        r = supabase.table("jobs").select("*").eq("id", job_id).limit(1).execute()
        rows = r.data or []
        if not rows:
            raise HTTPException(404, "Job not found")
        job = rows[0]
        if job.get("exam_name") and job.get("exam_year"):
            try:
                job["quality_report"] = _exam_quality_report(job["exam_name"], int(job["exam_year"]))
            except Exception:
                job["quality_report"] = None
        return job
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {e}")


@app.get("/admin/exam-quality", dependencies=[Depends(verify_admin)])
async def admin_exam_quality(
    exam_name: str = Query(..., description="Exact exam name as stored in DB"),
    exam_year: int = Query(..., description="Exam year"),
):
    """Detailed quality report for a single exam upload."""
    try:
        return _exam_quality_report(exam_name, exam_year)
    except Exception as e:
        raise HTTPException(500, f"Quality report error: {e}")


@app.get("/admin/publish-readiness", dependencies=[Depends(verify_admin)])
async def admin_publish_readiness():
    """Exam-level publish gate report for admin review."""
    try:
        gate = _compute_publish_gate()
        reports = []
        publishable_with_hidden_rows = 0
        for report in gate["reports"]:
            exam_name = report["exam_name"]
            exam_year = report["exam_year"]
            rows = _question_rows_for_exam(exam_name, exam_year)
            contradiction_by_qid = _contradiction_map(exam_name, exam_year)
            queue = _build_exam_repair_queue(exam_name, exam_year, rows, contradiction_by_qid=contradiction_by_qid)
            assessment = _paper_publish_assessment(rows, queue)
            enriched = dict(report)
            enriched.update({
                "likely_publishable_with_hidden_rows": assessment["likely_publishable_with_hidden_rows"],
                "reupload_needed": assessment["reupload_needed"],
                "visible_question_count": assessment["visible_question_count"],
                "hidden_question_count": assessment["hidden_question_count"],
                "paper_blocker_count": assessment["paper_blocker_count"],
                "row_blocker_count": assessment["row_blocker_count"],
            })
            reports.append(enriched)
            if assessment["likely_publishable_with_hidden_rows"]:
                publishable_with_hidden_rows += 1
        return {
            "computed_at": gate["computed_at"],
            "publishable_exams": sum(1 for r in reports if r["publishable"]),
            "blocked_exams": sum(1 for r in reports if not r["publishable"]),
            "likely_publishable_with_hidden_rows": publishable_with_hidden_rows,
            "reupload_needed_exams": sum(1 for r in reports if r.get("reupload_needed")),
            "reports": reports,
        }
    except Exception as e:
        raise HTTPException(500, f"Publish readiness error: {e}")


@app.get("/admin/repair-queue", dependencies=[Depends(verify_admin)])
async def admin_repair_queue(
    exam_name: Optional[str] = Query(None),
    exam_year: Optional[int] = Query(None),
):
    """Structured per-row repair queue with hide/block guidance."""
    try:
        if exam_name and exam_year is not None:
            exams = [(exam_name, exam_year)]
        else:
            gate = _compute_publish_gate()
            exams = [(r["exam_name"], r["exam_year"]) for r in gate["reports"]]

        items: list[dict] = []
        exam_reports: list[dict] = []
        for current_exam_name, current_exam_year in exams:
            active_rows = _question_rows_for_exam(current_exam_name, current_exam_year, is_active=True)
            audit_rows = _question_rows_for_exam(current_exam_name, current_exam_year, is_active=None)
            if not active_rows and not audit_rows:
                continue
            contradiction_by_qid = _contradiction_map(current_exam_name, current_exam_year)
            queue = _build_exam_repair_queue(
                current_exam_name,
                current_exam_year,
                audit_rows,
                contradiction_by_qid=contradiction_by_qid,
            )
            assessment = _paper_publish_assessment(active_rows, queue)
            items.extend(queue)
            exam_reports.append({
                "exam": f"{current_exam_name} {current_exam_year}",
                "exam_name": current_exam_name,
                "exam_year": current_exam_year,
                **assessment,
            })

        items.sort(
            key=lambda item: (
                item["exam_year"],
                item["exam_name"],
                _QUEUE_ISSUE_ORDER.get(item["issue_type"], 99),
                item["question_number"] is None,
                item["question_number"] if isinstance(item["question_number"], int) else 10**9,
            )
        )
        return {
            "total": len(items),
            "items": items,
            "papers": exam_reports,
        }
    except Exception as e:
        raise HTTPException(500, f"Repair queue error: {e}")


@app.post("/admin/retry-job/{job_id}", dependencies=[Depends(verify_admin)])
async def admin_retry_job(job_id: str):
    """
    Retry a stuck or failed universal-mode job without re-uploading the PDF.
    Requires the original tmp PDF file to still exist on disk (it persists until server restart).
    """
    try:
        r = supabase.table("jobs").select("*").eq("id", job_id).single().execute()
        if not r.data:
            raise HTTPException(404, "Job not found")
        job = r.data
        status = str(job.get("status") or "").strip().lower()
        if status == "completed":
            raise HTTPException(400, "Job already completed successfully")
        if status.startswith("processing") or status in {"pending", "queued", "retrying"}:
            raise HTTPException(
                409,
                "Job is still running. Retry is disabled for active jobs to prevent mixed pipeline corruption."
            )
        if status not in {"failed", "cancelled", "stopped"}:
            raise HTTPException(400, f"Retry not allowed for job status '{job.get('status')}'")
        pdf_path = job.get("pdf_path")
        if not pdf_path or not os.path.exists(pdf_path):
            raise HTTPException(
                400,
                "Original PDF no longer on disk (server was restarted). "
                "Please re-upload the file — all pages already cached will be free."
            )
        # Reset job state
        supabase.table("jobs").update({
            "status": "pending", "progress": 0, "error_log": None
        }).eq("id", job_id).execute()
        mark_paper_lifecycle(job.get("paper_id"), "processing", last_job_id=job_id, sb=supabase)

        exam_name  = job["exam_name"]
        exam_year  = job["exam_year"]
        from extractor.universal_extractor import process_universal_job_background
        t = threading.Thread(
            target=process_universal_job_background,
            args=(job_id, pdf_path, exam_name, exam_year, None, 0),
            daemon=True,
            name=f"retry-{job_id[:8]}",
        )
        t.start()
        return {"job_id": job_id, "status": "retrying", "message": "Job restarted — cached pages are free"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Retry failed: {e}")


class QuestionUpdate(BaseModel):
    is_active: Optional[bool] = None
    question_text: Optional[str] = None
    option_a: Optional[str] = None
    option_b: Optional[str] = None
    option_c: Optional[str] = None
    option_d: Optional[str] = None
    subject: Optional[str] = None
    topic: Optional[str] = None
    subtopic: Optional[str] = None
    difficulty: Optional[str] = None
    correct_answer: Optional[str] = Field(None, pattern="^[A-D]$")


@app.patch("/admin/questions/{question_id}", dependencies=[Depends(verify_admin)])
async def admin_update_question(question_id: str, update: QuestionUpdate):
    """Admin can deactivate bad questions or fix tags."""
    try:
        data = update.model_dump(exclude_none=True)
        if not data:
            raise HTTPException(400, "No fields to update")
        current_res = supabase.table("questions").select("*").eq("id", question_id).single().execute()
        current = current_res.data
        if not current:
            raise HTTPException(404, "Question not found")
        quality_sensitive = {
            "is_active", "question_text", "option_a", "option_b", "option_c", "option_d",
            "correct_answer", "subject", "topic", "subtopic",
        }
        if quality_sensitive & set(data.keys()):
            patch = dict(data)
            supported_cols = _question_supported_columns()
            taxonomy_seed = {
                "subject": patch.get("subject", current.get("subject")),
                "topic": patch.get("topic", current.get("topic")),
                "subtopic": patch.get("subtopic", current.get("subtopic")),
            }
            canonical = derive_canonical_taxonomy(
                taxonomy_seed["subject"],
                taxonomy_seed["topic"],
                taxonomy_seed["subtopic"],
            )
            for key, value in canonical.items():
                if key in supported_cols:
                    patch[key] = value
                    data[key] = value
            if "correct_answer" in patch and patch["correct_answer"] != current.get("correct_answer"):
                patch["explanation_status"] = "stale"
            merged = merge_quality_fields(
                current,
                patch,
                explanation_present=current.get("explanation_status") == "generated",
                explanation_contradiction=current.get("explanation_status") == "contradiction",
            )
            for key in (
                "structural_status",
                "answer_status",
                "explanation_status",
                "tagging_status",
                "review_required",
                "confidence_score",
                "public_visibility",
                "primary_issue_code",
                "issue_codes",
            ):
                if key in supported_cols and key in merged:
                    data[key] = merged[key]

        r = supabase.table("questions").update(data).eq("id", question_id).execute()
        refresh_question_publish_state(question_id, sb=supabase)
        _invalidate_meta_cache()
        return {"status": "updated", "question_id": question_id, "updated_fields": list(data.keys())}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Update error: {e}")


@app.delete("/admin/questions/{question_id}", dependencies=[Depends(verify_admin)])
async def admin_delete_question(question_id: str):
    """Hard delete a question (prefer PATCH is_active=false instead)."""
    try:
        current_res = supabase.table("questions").select("paper_id").eq("id", question_id).single().execute()
        current = current_res.data or {}
        r = supabase.table("questions").delete().eq("id", question_id).execute()
        refresh_paper_publish_state(current.get("paper_id"), sb=supabase)
        _invalidate_meta_cache()
        return {"status": "deleted", "question_id": question_id}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Delete error: {e}")


@app.patch("/admin/rename-exam", dependencies=[Depends(verify_admin)])
async def admin_rename_exam(
    old_name: str = Query(..., description="Current exam_name"),
    new_name: str = Query(..., description="New exam_name"),
    exam_year: int = Query(..., description="Exam year"),
):
    """Rename an exam — updates exam_name on all matching questions."""
    new_name = new_name.strip()
    if not new_name:
        raise HTTPException(400, "new_name cannot be empty")
    try:
        r = supabase.table("questions").update({"exam_name": new_name}).eq("exam_name", old_name).eq("exam_year", exam_year).execute()
        supabase.table("papers").update({
            "exam_name": new_name,
            "display_name": new_name,
            "paper_key": f"{new_name.lower()}::{exam_year}",
        }).eq("exam_name", old_name).eq("exam_year", exam_year).execute()
        _invalidate_meta_cache()
        return {"status": "renamed", "updated": len(r.data or []), "old_name": old_name, "new_name": new_name}
    except Exception as e:
        raise HTTPException(500, f"Rename error: {e}")


@app.post("/admin/add-blank-question", dependencies=[Depends(verify_admin)])
async def admin_add_blank_question(req: dict):
    """Add a blank question for manual correction of missing numbers."""
    try:
        supported_cols = _question_supported_columns()
        target_paper_id = resolve_paper_id(exam_name=req.get("exam_name", ""), exam_year=req.get("exam_year", 2024), sb=supabase)
        new_q = {
            "exam_name": req.get("exam_name", ""),
            "exam_year": req.get("exam_year", 2024),
            "paper_id": target_paper_id,
            "question_number": req.get("question_number", 1),
            "question_text": req.get("question_text") or "New Blank Question",
            "option_a": req.get("option_a") or "Option A",
            "option_b": req.get("option_b") or "Option B",
            "option_c": req.get("option_c") or "Option C",
            "option_d": req.get("option_d") or "Option D",
            "correct_answer": req.get("correct_answer") or "A",
            "subject": req.get("subject") or "General Knowledge",
            "topic": req.get("topic") or "General",
            "subtopic": req.get("subtopic") or "",
            "difficulty": req.get("difficulty") or "Medium",
            "question_type": req.get("question_type") or "mcq",
            "concept": req.get("concept") or "",
            "passage": req.get("passage") or "",
            "is_active": True,
            "needs_review": bool(req.get("needs_review", True)),
            "question_hash": f"manual_{int(time.time())}_{req.get('question_number', 1)}"
        }
        merged = merge_quality_fields(new_q, explanation_present=False)
        new_q.update(_filter_question_write_payload(merged, supported_cols))
        new_q = _filter_question_write_payload(new_q, supported_cols)
        r = supabase.table("questions").insert([new_q]).execute()
        refresh_paper_publish_state(target_paper_id, sb=supabase)
        _invalidate_meta_cache()
        return {"status": "success", "data": r.data}
    except Exception as e:
        raise HTTPException(500, f"Error adding question: {e}")

@app.delete("/admin/delete-exam", dependencies=[Depends(verify_admin)])
async def admin_delete_exam(
    exam_name: str = Query(...),
    exam_year: int = Query(...),
):
    """Delete all questions for an exam (use with care)."""
    try:
        pr = supabase.table("papers").select("id").eq("exam_name", exam_name).eq("exam_year", exam_year).execute()
        paper_ids = [row["id"] for row in (pr.data or [])]
        r = supabase.table("questions").delete().eq("exam_name", exam_name).eq("exam_year", exam_year).execute()
        for pid in paper_ids:
            refresh_paper_publish_state(pid, sb=supabase)
        _invalidate_meta_cache()
        return {"status": "deleted", "removed": len(r.data or []), "exam_name": exam_name}
    except Exception as e:
        raise HTTPException(500, f"Delete error: {e}")


@app.post("/admin/retag", dependencies=[Depends(verify_admin)])
async def admin_retag(
    exam_name: str = Query(..., description="Exact exam name as stored in DB"),
    exam_year: int = Query(..., description="Exam year"),
):
    """
    Re-run subject/topic/difficulty tagging for all questions in an exam.
    Use when questions show as 'Unclassified' after upload.
    Cost: ~₹0.20 per 150 questions (cached after first run, so repeat calls are free).
    """
    try:
        import asyncio
        from pipeline import retag_exam
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, retag_exam, exam_name, exam_year)
        return result
    except Exception as e:
        raise HTTPException(500, f"Retag error: {e}")


@app.post("/admin/generate-explanations", dependencies=[Depends(verify_admin)])
async def admin_generate_explanations(
    exam_name: str = Query(..., description="Exact exam name as stored in DB"),
    exam_year: int = Query(..., description="Exam year"),
):
    """
    Bulk-generate explanations for all questions in an exam that don't have one yet.
    Only generates for questions that have a correct_answer set.
    Cost: ~₹0.22 per 150 questions (cached after first run — repeat calls are free).
    """
    try:
        import asyncio
        from pipeline import generate_explanations_bulk
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, generate_explanations_bulk, exam_name, exam_year)
        _invalidate_meta_cache()
        return result
    except Exception as e:
        raise HTTPException(500, f"Explanation generation error: {e}")


@app.post("/admin/validate-answers", dependencies=[Depends(verify_admin)])
async def admin_validate_answers(
    exam_name: str = Query(..., description="Exact exam name as stored in DB"),
    exam_year: int = Query(..., description="Exam year"),
):
    """
    Use gemini-2.5-flash (best model) to determine correct answers for all questions
    with needs_review=True (AI-guessed or missing answers). Verified answer-key answers
    (needs_review=False) are never touched.
    Cost: ~₹2–5 per 125 questions — runs on GCP Vertex AI credits.
    """
    try:
        import asyncio
        from pipeline import validate_answers_bulk
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, validate_answers_bulk, exam_name, exam_year)
        _invalidate_meta_cache()
        return result
    except Exception as e:
        raise HTTPException(500, f"Answer validation error: {e}")


@app.post("/admin/fix-explanation-mismatches", dependencies=[Depends(verify_admin)])
async def admin_fix_explanation_mismatches(
    exam_name: Optional[str] = Query(None, description="Filter by exam name (omit for all exams)"),
    dry_run: bool = Query(False, description="If true, only count affected — do not delete"),
):
    """
    Delete cached explanations for questions where correct_answer was overridden
    by AI during bulk explanation generation (needs_review=true + has explanation).
    After deletion, explanations regenerate lazily using the verified correct answer.
    """
    try:
        q = supabase.table("questions").select("id, correct_answer, exam_name").eq("needs_review", True)
        if exam_name:
            q = q.eq("exam_name", exam_name)
        qr = q.execute()
        flagged_ids = [row["id"] for row in (qr.data or [])]

        if not flagged_ids:
            return {"deleted": 0, "dry_run": dry_run, "message": "No needs_review questions found"}

        # Find which of those have cached explanations
        expl_r = supabase.table("explanations").select("question_id").in_("question_id", flagged_ids).execute()
        to_delete = [row["question_id"] for row in (expl_r.data or [])]

        if dry_run:
            return {
                "dry_run": True,
                "needs_review_questions": len(flagged_ids),
                "explanations_to_delete": len(to_delete),
                "message": "Run with dry_run=false to actually delete",
            }

        # Delete in chunks of 50 (Supabase IN filter limit)
        deleted = 0
        for i in range(0, len(to_delete), 50):
            chunk = to_delete[i:i+50]
            supabase.table("explanations").delete().in_("question_id", chunk).execute()
            supabase.table("questions").update({"explanation_status": "missing"}).in_("id", chunk).execute()
            deleted += len(chunk)

        _invalidate_meta_cache()
        return {
            "deleted": deleted,
            "dry_run": False,
            "message": f"Deleted {deleted} stale explanations. They will regenerate correctly on next user access.",
        }
    except Exception as e:
        raise HTTPException(500, f"Error: {e}")


@app.get("/admin/explanation-mismatches", dependencies=[Depends(verify_admin)])
async def admin_list_explanation_mismatches(
    exam_name: Optional[str] = Query(None),
    exam_year: Optional[int] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
):
    """List rows where explanation text appears to contradict stored answer."""
    try:
        mismatches = _find_explanation_answer_mismatches(exam_name=exam_name, exam_year=exam_year)
        return {
            "total": len(mismatches),
            "limit": limit,
            "items": mismatches[:limit],
        }
    except Exception as e:
        raise HTTPException(500, f"Explanation mismatch audit error: {e}")


@app.post("/admin/repair-explanation-mismatches", dependencies=[Depends(verify_admin)])
async def admin_repair_explanation_mismatches(
    exam_name: Optional[str] = Query(None),
    exam_year: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    dry_run: bool = Query(False),
):
    """Force re-verification/regeneration for explanation-answer mismatch rows."""
    try:
        mismatches = _find_explanation_answer_mismatches(exam_name=exam_name, exam_year=exam_year)[:limit]
        if dry_run:
            return {"dry_run": True, "count": len(mismatches), "items": mismatches}
        if not mismatches:
            return {"repaired": 0, "attempted": 0, "failed": []}

        from pipeline import generate_single_explanation
        from question_repairs import apply_latest_answer_correction

        repaired = 0
        answer_repairs_applied = 0
        failed: list[dict] = []
        for item in mismatches:
            qid = item["question_id"]
            try:
                supabase.table("explanations").delete().eq("question_id", qid).execute()
                supabase.table("questions").update({"needs_review": True, "explanation_status": "missing"}).eq("id", qid).execute()
                result = generate_single_explanation(qid)
                if not result:
                    failed.append({
                        "question_id": qid,
                        "question_number": item.get("question_number"),
                    })
                    continue

                # If the explanation run proposed a corrected answer, apply it and
                # regenerate once so the stored answer and explanation align.
                try:
                    answer_changed = apply_latest_answer_correction(qid, sb=supabase)
                except Exception:
                    answer_changed = False
                if answer_changed:
                    answer_repairs_applied += 1
                    supabase.table("explanations").delete().eq("question_id", qid).execute()
                    supabase.table("questions").update({"explanation_status": "missing"}).eq("id", qid).execute()
                    second_pass = generate_single_explanation(qid)
                    if not second_pass:
                        failed.append({
                            "question_id": qid,
                            "question_number": item.get("question_number"),
                        })
                        continue
                repaired += 1
            except Exception:
                failed.append({
                    "question_id": qid,
                    "question_number": item.get("question_number"),
                })

        _invalidate_meta_cache()
        return {
            "repaired": repaired,
            "attempted": len(mismatches),
            "answer_repairs_applied": answer_repairs_applied,
            "failed": failed,
        }
    except Exception as e:
        raise HTTPException(500, f"Repair explanation mismatch error: {e}")


@app.get("/admin/question-repairs", dependencies=[Depends(verify_admin)])
async def admin_list_question_repairs(
    exam_name: Optional[str] = Query(None),
    exam_year: Optional[int] = Query(None),
    status: Optional[str] = Query("proposed"),
    limit: int = Query(200, ge=1, le=1000),
):
    """List auditable repair proposals generated by explanation-time AI."""
    try:
        q = supabase.table("question_repairs").select("*")
        if status:
            q = q.eq("status", status)
        repairs_res = q.order("created_at", desc=True).limit(limit).execute()
        repairs = repairs_res.data or []

        if exam_name or exam_year is not None:
            question_ids = [item.get("question_id") for item in repairs if item.get("question_id")]
            if question_ids:
                qr = supabase.table("questions").select("id, exam_name, exam_year, question_number").in_("id", question_ids).execute()
                qmap = {row["id"]: row for row in (qr.data or [])}
                filtered = []
                for item in repairs:
                    qrow = qmap.get(item.get("question_id"))
                    if not qrow:
                        continue
                    if exam_name and qrow.get("exam_name") != exam_name:
                        continue
                    if exam_year is not None and qrow.get("exam_year") != exam_year:
                        continue
                    enriched = dict(item)
                    enriched["exam_name"] = qrow.get("exam_name")
                    enriched["exam_year"] = qrow.get("exam_year")
                    enriched["question_number"] = qrow.get("question_number")
                    filtered.append(enriched)
                repairs = filtered
            else:
                repairs = []

        return {"total": len(repairs), "items": repairs[:limit]}
    except Exception as e:
        raise HTTPException(500, f"Question repair list error: {e}")


@app.post("/admin/apply-question-repair/{repair_id}", dependencies=[Depends(verify_admin)])
async def admin_apply_question_repair(repair_id: str):
    """Explicitly apply a recorded question repair proposal."""
    try:
        rr = supabase.table("question_repairs").select("*").eq("id", repair_id).single().execute()
        repair = rr.data
        if not repair:
            raise HTTPException(404, "Repair proposal not found")
        if repair.get("status") == "applied":
            return {"repair_id": repair_id, "status": "already_applied"}

        from question_repairs import apply_question_repair

        ok = apply_question_repair(repair, sb=supabase)
        if not ok:
            raise HTTPException(400, "Repair proposal could not be applied")
        _invalidate_meta_cache()
        return {"repair_id": repair_id, "status": "applied"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Apply question repair error: {e}")


@app.post("/admin/ai-detect-answers", dependencies=[Depends(verify_admin)])
async def admin_ai_detect_answers(
    exam_name: str = Query(...),
    exam_year: Optional[int] = Query(None),
    dry_run: bool = Query(False),
):
    """
    Use Gemini to detect correct answers for questions that have no answer key.
    Batches 25 questions per API call. Cost: ~₹0.10-0.20 per 100 questions.
    Stores detected answers with needs_review=true for human spot-check.
    """
    import asyncio, time as _time

    try:
        q = supabase.table("questions").select(
            "id, question_number, question_text, option_a, option_b, option_c, option_d, correct_answer"
        ).eq("exam_name", exam_name).eq("is_active", True)
        if exam_year:
            q = q.eq("exam_year", exam_year)
        qr = q.execute()
        all_qs = qr.data or []

        # Only process questions with missing/unknown answers
        pending = [q for q in all_qs if (q.get("correct_answer") or "").strip().upper() not in ("A","B","C","D")]

        if dry_run:
            return {"total": len(all_qs), "missing_answers": len(pending), "dry_run": True,
                    "estimated_cost_inr": round(len(pending) * 0.002, 3)}

        if not pending:
            return {"updated": 0, "message": "All questions already have answers"}

        from google.genai import types as _gtypes
        try:
            genai_client = _get_main_genai_client()
        except Exception as e:
            raise HTTPException(503, f"AI client unavailable: {e}")

        BATCH = 25
        updated = 0
        errors = 0

        for i in range(0, len(pending), BATCH):
            batch = pending[i:i+BATCH]
            lines = []
            for idx, q in enumerate(batch):
                lines.append(
                    f"{idx+1}. {q['question_text']}\n"
                    f"   A) {q.get('option_a','')}  B) {q.get('option_b','')}  "
                    f"C) {q.get('option_c','')}  D) {q.get('option_d','')}"
                )
            prompt = (
                "You are an expert on Indian competitive exams (UPSC, SSC, State PSC).\n"
                "For each question below, determine the single correct answer.\n"
                "Return ONLY a JSON array: [{\"id\": 1, \"answer\": \"A\"}, ...]\n"
                "No explanation. No markdown. Just the JSON array.\n\n"
                + "\n\n".join(lines)
            )

            for attempt in range(3):
                try:
                    fut = _GENAI_EXECUTOR.submit(
                        genai_client.models.generate_content,
                        model="publishers/google/models/gemini-2.5-flash",
                        contents=prompt,
                        config=_gtypes.GenerateContentConfig(temperature=0.0, max_output_tokens=512),
                    )
                    try:
                        resp = fut.result(timeout=45)
                    except _cf.TimeoutError:
                        if attempt == 2:
                            errors += len(batch)
                        else:
                            _time.sleep(5)
                        continue
                    raw = (resp.text or "").strip()
                    if raw.startswith("```"):
                        import re as _re
                        raw = _re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
                    items = json.loads(raw)
                    for item in items:
                        idx = int(item.get("id", 0)) - 1
                        ans = str(item.get("answer", "")).strip().upper()[:1]
                        if 0 <= idx < len(batch) and ans in "ABCD":
                            q = batch[idx]
                            supabase.table("questions").update(
                                {"correct_answer": ans, "needs_review": True, "answer_status": "ai_inferred"}
                            ).eq("id", q["id"]).execute()
                            updated += 1
                    break
                except Exception as e:
                    if attempt == 2:
                        errors += len(batch)
                    else:
                        _time.sleep(5 * (attempt + 1))

            _time.sleep(1)  # rate limit buffer between batches

        return {
            "updated": updated,
            "errors": errors,
            "total_pending": len(pending),
            "message": f"AI detected answers for {updated} questions (needs_review=true). Verify a sample before publishing.",
        }
    except Exception as e:
        raise HTTPException(500, f"Error: {e}")


@app.delete("/admin/explanations", dependencies=[Depends(verify_admin)])
async def admin_delete_explanations(
    exam_name: str = Query(..., description="Exam name to clear explanations for"),
    dry_run: bool = Query(False),
):
    """
    Delete ALL cached explanations for an exam so they regenerate lazily
    with the verified correct answer. Use when answer key was injected after
    explanations were already generated.
    """
    try:
        # Get all question IDs for this exam
        qr = supabase.table("questions").select("id").eq("exam_name", exam_name).eq("is_active", True).execute()
        q_ids = [r["id"] for r in (qr.data or [])]
        if not q_ids:
            return {"deleted": 0, "message": f"No questions found for exam: {exam_name}"}

        # Count existing explanations
        count = 0
        for i in range(0, len(q_ids), 50):
            chunk = q_ids[i:i+50]
            er = supabase.table("explanations").select("question_id", count="exact").in_("question_id", chunk).execute()
            count += er.count or 0

        if dry_run:
            return {"dry_run": True, "questions": len(q_ids), "explanations_to_delete": count}

        deleted = 0
        for i in range(0, len(q_ids), 50):
            chunk = q_ids[i:i+50]
            supabase.table("explanations").delete().in_("question_id", chunk).execute()
            supabase.table("questions").update({"explanation_status": "missing"}).in_("id", chunk).execute()
            deleted += len(chunk)

        return {"deleted": deleted, "message": f"Cleared all explanations for '{exam_name}'. They regenerate on next user access."}
    except Exception as e:
        raise HTTPException(500, f"Error: {e}")


@app.get("/admin/cost-log", dependencies=[Depends(verify_admin)])
async def admin_cost_log():
    """Return the full cost history from cache/cost_log.json."""
    from pathlib import Path
    log_path = Path(__file__).parent / "cache" / "cost_log.json"
    if not log_path.exists():
        return {"runs": [], "total_inr": 0}
    try:
        runs = json.loads(log_path.read_text())
        total = round(sum(r.get("total_inr", 0) for r in runs), 4)
        return {"runs": list(reversed(runs)), "total_inr": total}
    except Exception as e:
        raise HTTPException(500, f"Could not read cost log: {e}")


@app.get("/admin/questions", dependencies=[Depends(verify_admin)])
async def admin_list_all_questions(
    exam_name: Optional[str] = Query(None),
    exam_year: Optional[int] = Query(None),
    is_active: Optional[bool] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Admin view: see ALL questions including deactivated ones."""
    try:
        q = supabase.table("questions").select("*", count="exact")
        if exam_name:
            q = q.eq("exam_name", exam_name)
        if exam_year:
            q = q.eq("exam_year", exam_year)
        if is_active is not None:
            q = q.eq("is_active", is_active)

        q = q.order("question_number", desc=False).order("created_at", desc=False).range(offset, offset + limit - 1)
        result = q.execute()

        return {
            "questions": result.data or [],
            "total": result.count or 0,
            "limit": limit,
            "offset": offset,
        }
    except Exception as e:
        raise HTTPException(500, f"Database error: {e}")


@app.get("/admin/questions/{question_id}", dependencies=[Depends(verify_admin)])
async def admin_get_question(question_id: str):
    """Admin view: fetch a single question even if it is blocked from public endpoints."""
    try:
        r = supabase.table("questions").select("*").eq("id", question_id).limit(1).execute()
        rows = r.data or []
        if not rows:
            raise HTTPException(404, "Question not found")
        return rows[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Database error: {e}")


@app.get("/admin/explanation/{question_id}", dependencies=[Depends(verify_admin)])
async def admin_get_explanation(question_id: str):
    """Admin view: fetch or generate explanation for blocked/review papers."""
    try:
        qr = supabase.table("questions").select("id").eq("id", question_id).eq("is_active", True).single().execute()
        if not qr.data:
            raise HTTPException(404, "Question not found")
        from pipeline import generate_single_explanation
        result = generate_single_explanation(question_id)
        if not result:
            raise HTTPException(404, "Question or explanation could not be generated")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Explanation error: {e}")


@app.get("/admin/questions-meta", dependencies=[Depends(verify_admin)])
@app.get("/admin/questions/meta", dependencies=[Depends(verify_admin)])
async def admin_questions_meta(is_active: Optional[bool] = Query(True)):
    """Admin metadata view: includes blocked/review papers for audit and cleanup."""
    try:
        all_data: list[dict] = []
        offset = 0
        while True:
            q = supabase.table("questions").select(
                "id, exam_name, exam_year, subject, topic, subtopic, difficulty, needs_review, is_active"
            )
            if is_active is not None:
                q = q.eq("is_active", is_active)
            r = q.range(offset, offset + 999).execute()
            batch = r.data or []
            all_data.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000

        return {"questions": all_data, "total": len(all_data)}
    except Exception as e:
        raise HTTPException(500, f"Database error: {e}")


@app.get("/admin/topic-questions", dependencies=[Depends(verify_admin)])
async def admin_questions_by_topic(
    subject: str = Query(...),
    topic: str = Query(...),
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
):
    try:
        return _topic_bucket_questions(
            subject=subject,
            topic=topic,
            admin_mode=True,
            limit=limit,
            offset=offset,
        )
    except Exception as e:
        raise HTTPException(500, f"Database error: {e}")


# ── Run ──────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    reload_enabled = os.getenv("UVICORN_RELOAD", "").lower() in {"1", "true", "yes"}
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload_enabled)
