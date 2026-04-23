"""
Paper identity helpers.

Phase 1 keeps the existing ingestion flow intact and adds a first-class paper
entity around it. This module is intentionally small and additive so uploads,
jobs, and stored questions can all share a stable `paper_id` without changing
extractor behavior.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Optional

PUBLIC_PAPER_STATUSES = {"publishable", "publishable_with_hidden_rows"}
_REUPLOAD_STRUCTURAL_THRESHOLD_MIN = 3
_REUPLOAD_STRUCTURAL_THRESHOLD_PCT = 0.05


def _get_supabase():
    from config import supabase
    return supabase


def normalize_exam_name(exam_name: str) -> str:
    return re.sub(r"\s+", " ", (exam_name or "").strip())


def build_paper_key(exam_name: str, exam_year: int) -> str:
    normalized = normalize_exam_name(exam_name).lower()
    return f"{normalized}::{int(exam_year)}"


def normalize_extractor_type(route_format: Optional[str]) -> str:
    raw = str(route_format or "").strip().lower()
    mapping = {
        "tcsion_cbt": "cbt",
        "telegram_cbt": "cbt",
        "appsc_boxed": "vision",
        "scanned_image": "scanned",
        "digital_mcq": "universal",
        "universal": "universal",
        "vision": "vision",
        "scanned": "scanned",
        "cbt": "cbt",
    }
    return mapping.get(raw, raw or "unknown")


def source_filename_from_path(source_pdf: Optional[str]) -> Optional[str]:
    if not source_pdf:
        return None
    return Path(source_pdf).name


def build_paper_insert_payload(
    exam_name: str,
    exam_year: int,
    *,
    source_filename: Optional[str] = None,
    source_file_hash: Optional[str] = None,
    source_pdf_path: Optional[str] = None,
    extractor_type: Optional[str] = None,
    latest_paper: Optional[dict[str, Any]] = None,
    supersede_latest: bool = False,
) -> dict[str, Any]:
    normalized_name = normalize_exam_name(exam_name)
    upload_version = 1
    supersedes_paper_id = None
    if latest_paper:
        upload_version = int(latest_paper.get("upload_version") or 0) + 1
        if supersede_latest:
            supersedes_paper_id = latest_paper.get("id")

    return {
        "exam_name": normalized_name,
        "exam_year": int(exam_year),
        "display_name": normalized_name,
        "paper_key": build_paper_key(normalized_name, exam_year),
        "source_filename": source_filename,
        "source_file_hash": source_file_hash,
        "source_pdf_path": source_pdf_path,
        "extractor_type": normalize_extractor_type(extractor_type),
        "upload_version": upload_version,
        "lifecycle_status": "pending",
        "publish_status": "draft",
        "question_count": 0,
        "visible_question_count": 0,
        "hidden_question_count": 0,
        "structural_issue_count": 0,
        "last_job_id": None,
        "supersedes_paper_id": supersedes_paper_id,
        "replacement_paper_id": None,
    }


def get_latest_paper_for_exam(
    exam_name: str,
    exam_year: int,
    *,
    sb=None,
) -> Optional[dict[str, Any]]:
    sb = sb or _get_supabase()
    normalized_name = normalize_exam_name(exam_name)
    res = (
        sb.table("papers")
        .select("*")
        .eq("exam_name", normalized_name)
        .eq("exam_year", int(exam_year))
        .order("upload_version", desc=True)
        .limit(1)
        .execute()
    )
    data = res.data or []
    return data[0] if data else None


def ensure_paper_for_upload(
    exam_name: str,
    exam_year: int,
    *,
    source_filename: Optional[str] = None,
    source_file_hash: Optional[str] = None,
    source_pdf_path: Optional[str] = None,
    extractor_type: Optional[str] = None,
    supersede_latest: bool = False,
    sb=None,
) -> dict[str, Any]:
    sb = sb or _get_supabase()
    latest = get_latest_paper_for_exam(exam_name, exam_year, sb=sb)
    payload = build_paper_insert_payload(
        exam_name,
        exam_year,
        source_filename=source_filename,
        source_file_hash=source_file_hash,
        source_pdf_path=source_pdf_path,
        extractor_type=extractor_type,
        latest_paper=latest,
        supersede_latest=supersede_latest,
    )
    created = sb.table("papers").insert(payload).execute()
    if not created.data:
        raise RuntimeError("Failed to create paper record")
    paper = created.data[0]

    if supersede_latest and latest and latest.get("id"):
        try:
            (
                sb.table("papers")
                .update({
                    "lifecycle_status": "replaced",
                    "replacement_paper_id": paper["id"],
                })
                .eq("id", latest["id"])
                .execute()
            )
        except Exception:
            pass
    return paper


def ensure_paper_for_existing_exam(
    exam_name: str,
    exam_year: int,
    *,
    source_filename: Optional[str] = None,
    source_file_hash: Optional[str] = None,
    source_pdf_path: Optional[str] = None,
    extractor_type: Optional[str] = None,
    sb=None,
) -> Optional[dict[str, Any]]:
    """
    Legacy repair helper.

    Older exams may have question rows but no `papers` record because they were
    ingested before the paper layer existed. Gap-repair uploads should attach to
    a stable paper record instead of failing with a 500 in that case.
    """
    sb = sb or _get_supabase()
    latest = get_latest_paper_for_exam(exam_name, exam_year, sb=sb)
    if latest:
        return latest

    normalized_name = normalize_exam_name(exam_name)
    question_probe = (
        sb.table("questions")
        .select("id", count="exact")
        .eq("exam_name", normalized_name)
        .eq("exam_year", int(exam_year))
        .limit(1)
        .execute()
    )
    if not (question_probe.data or []) and not (question_probe.count or 0):
        return None

    paper = ensure_paper_for_upload(
        normalized_name,
        exam_year,
        source_filename=source_filename,
        source_file_hash=source_file_hash,
        source_pdf_path=source_pdf_path,
        extractor_type=extractor_type or "legacy-repair",
        supersede_latest=False,
        sb=sb,
    )

    # Backfill all legacy rows for this exam-year onto the recovered paper.
    (
        sb.table("questions")
        .update({"paper_id": paper["id"]})
        .eq("exam_name", normalized_name)
        .eq("exam_year", int(exam_year))
        .execute()
    )
    refresh_paper_publish_state(paper["id"], sb=sb)
    return paper


def link_job_to_paper(paper_id: str, job_id: str, *, sb=None) -> None:
    sb = sb or _get_supabase()
    (
        sb.table("papers")
        .update({"last_job_id": job_id, "lifecycle_status": "processing"})
        .eq("id", paper_id)
        .execute()
    )


def mark_paper_lifecycle(
    paper_id: Optional[str],
    lifecycle_status: str,
    *,
    publish_status: Optional[str] = None,
    last_job_id: Optional[str] = None,
    sb=None,
) -> None:
    if not paper_id:
        return
    sb = sb or _get_supabase()
    payload: dict[str, Any] = {"lifecycle_status": lifecycle_status}
    if publish_status is not None:
        payload["publish_status"] = publish_status
    if last_job_id is not None:
        payload["last_job_id"] = last_job_id
    sb.table("papers").update(payload).eq("id", paper_id).execute()


def paper_id_for_job(job_id: str, *, sb=None) -> Optional[str]:
    sb = sb or _get_supabase()
    res = sb.table("jobs").select("paper_id").eq("id", job_id).limit(1).execute()
    data = res.data or []
    if not data:
        return None
    return data[0].get("paper_id")


def resolve_paper_id(
    *,
    paper_id: Optional[str] = None,
    job_id: Optional[str] = None,
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
    sb=None,
) -> Optional[str]:
    if paper_id:
        return paper_id
    sb = sb or _get_supabase()
    if job_id:
        linked = paper_id_for_job(job_id, sb=sb)
        if linked:
            return linked
    if exam_name and exam_year is not None:
        latest = get_latest_paper_for_exam(exam_name, exam_year, sb=sb)
        if latest:
            return latest.get("id")
    return None


def sync_paper_question_counts(
    paper_id: Optional[str],
    *,
    sb=None,
) -> None:
    refresh_paper_publish_state(paper_id, sb=sb)


def _structural_failure_threshold(question_count: int) -> int:
    scaled = int(question_count * _REUPLOAD_STRUCTURAL_THRESHOLD_PCT)
    if (question_count * _REUPLOAD_STRUCTURAL_THRESHOLD_PCT) > scaled:
        scaled += 1
    return max(_REUPLOAD_STRUCTURAL_THRESHOLD_MIN, scaled)


def _row_is_structurally_broken(row: dict[str, Any]) -> bool:
    if row.get("structural_status") == "broken":
        return True
    return row.get("public_visibility") == "hidden_structural"


def _row_is_publicly_visible(row: dict[str, Any]) -> bool:
    visibility = row.get("public_visibility")
    if visibility is not None:
        return visibility == "visible"
    if _row_is_structurally_broken(row):
        return False
    return bool(row.get("is_active", True))


def refresh_paper_publish_state(
    paper_id: Optional[str],
    *,
    sb=None,
) -> None:
    if not paper_id:
        return
    sb = sb or _get_supabase()
    try:
        rows: list[dict[str, Any]] = []
        offset = 0
        try:
            while True:
                res = (
                    sb.table("questions")
                    .select("id, is_active, structural_status, public_visibility")
                    .eq("paper_id", paper_id)
                    .range(offset, offset + 999)
                    .execute()
                )
                batch = res.data or []
                rows.extend(batch)
                if len(batch) < 1000:
                    break
                offset += 1000
            has_quality_fields = True
        except Exception:
            rows = []
            offset = 0
            has_quality_fields = False
            while True:
                res = (
                    sb.table("questions")
                    .select("id, is_active, needs_review")
                    .eq("paper_id", paper_id)
                    .range(offset, offset + 999)
                    .execute()
                )
                batch = res.data or []
                rows.extend(batch)
                if len(batch) < 1000:
                    break
                offset += 1000

        total = len(rows)
        if has_quality_fields:
            visible = sum(1 for row in rows if _row_is_publicly_visible(row))
            hidden = max(0, total - visible)
            structural_issue_count = sum(1 for row in rows if _row_is_structurally_broken(row))
            threshold = _structural_failure_threshold(total)
            publish_status = "draft"
            lifecycle_status = "ingested" if total else "processing"
            if total == 0:
                publish_status = "blocked"
            elif visible == 0:
                publish_status = "blocked"
            elif structural_issue_count >= threshold:
                publish_status = "reupload_needed"
            elif structural_issue_count > 0:
                publish_status = "publishable_with_hidden_rows"
            else:
                publish_status = "publishable"
        else:
            visible = sum(1 for row in rows if bool(row.get("is_active", True)))
            hidden = max(0, total - visible)
            structural_issue_count = 0
            lifecycle_status = "ingested" if total else "processing"
            publish_status = "publishable" if visible > 0 else "blocked"

        (
            sb.table("papers")
            .update({
                "question_count": total,
                "visible_question_count": visible,
                "hidden_question_count": hidden,
                "structural_issue_count": structural_issue_count,
                "publish_status": publish_status,
                "lifecycle_status": lifecycle_status,
            })
            .eq("id", paper_id)
            .execute()
        )
    except Exception:
        # Phase 1 metadata sync must never break ingestion.
        pass


def public_paper_rows(
    *,
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
    sb=None,
) -> list[dict[str, Any]]:
    sb = sb or _get_supabase()
    q = sb.table("papers").select("id, exam_name, exam_year, publish_status, lifecycle_status")
    if exam_name:
        q = q.eq("exam_name", normalize_exam_name(exam_name))
    if exam_year is not None:
        q = q.eq("exam_year", int(exam_year))
    res = q.execute()
    rows = res.data or []
    return [
        row for row in rows
        if row.get("publish_status") in PUBLIC_PAPER_STATUSES
        and row.get("lifecycle_status") not in {"replaced", "archived"}
    ]


def public_paper_ids(
    *,
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
    sb=None,
) -> set[str]:
    return {str(row["id"]) for row in public_paper_rows(exam_name=exam_name, exam_year=exam_year, sb=sb)}


def public_exam_keys(
    *,
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
    sb=None,
) -> set[tuple[str, int]]:
    return {
        (str(row["exam_name"]), int(row["exam_year"]))
        for row in public_paper_rows(exam_name=exam_name, exam_year=exam_year, sb=sb)
    }


def refresh_question_publish_state(question_id: str, *, sb=None) -> None:
    sb = sb or _get_supabase()
    res = sb.table("questions").select("paper_id").eq("id", question_id).limit(1).execute()
    data = res.data or []
    if not data:
        return
    refresh_paper_publish_state(data[0].get("paper_id"), sb=sb)


def should_delete_pdf_after_job(pdf_path: Optional[str], *, keep_temp: Optional[bool] = None) -> bool:
    if keep_temp is not None:
        return not keep_temp
    # Preserve current behavior unless an explicit keep flag is requested later.
    return bool(pdf_path and os.path.exists(pdf_path))
