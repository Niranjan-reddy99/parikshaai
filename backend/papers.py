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
import tempfile
from collections import defaultdict
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
        patch: dict[str, Any] = {}
        if source_pdf_path and latest.get("source_pdf_path") != source_pdf_path:
            patch["source_pdf_path"] = source_pdf_path
        if source_filename and latest.get("source_filename") != source_filename:
            patch["source_filename"] = source_filename
        if source_file_hash and latest.get("source_file_hash") != source_file_hash:
            patch["source_file_hash"] = source_file_hash
        normalized_extractor = normalize_extractor_type(extractor_type)
        if normalized_extractor and latest.get("extractor_type") != normalized_extractor:
            patch["extractor_type"] = normalized_extractor
        if patch:
            try:
                (
                    sb.table("papers")
                    .update(patch)
                    .eq("id", latest["id"])
                    .execute()
                )
                latest.update(patch)
            except Exception:
                pass
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
    import time as _time
    for _attempt in range(4):
        try:
            sb.table("papers").update(payload).eq("id", paper_id).execute()
            return
        except Exception as _e:
            if _attempt == 3:
                raise
            _time.sleep(1.5 ** _attempt)


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
    if not paper_id:
        return
    sb = sb or _get_supabase()
    try:
        paper_res = sb.table("papers").select("exam_name, exam_year").eq("id", paper_id).limit(1).execute()
        paper_rows = paper_res.data or []
        if paper_rows:
            recompute_practice_ready_for_exam(
                str(paper_rows[0].get("exam_name") or ""),
                int(paper_rows[0].get("exam_year") or 0),
                sb=sb,
            )
    except Exception:
        pass


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


def _question_identity_for_practice(row: dict[str, Any]) -> tuple[str, ...]:
    exam_name = normalize_exam_name(str(row.get("exam_name") or ""))
    exam_year = int(row.get("exam_year") or 0)
    qnum = row.get("question_number")
    # Include shift_label so questions from different shifts of the same exam
    # (e.g. AP High Court Shift 1 vs Shift 2) are never treated as duplicates.
    shift = str(row.get("shift_label") or "").strip()
    if exam_name and exam_year > 0 and isinstance(qnum, int) and qnum > 0:
        if shift:
            return ("exam_shift", exam_name, str(exam_year), shift, str(qnum))
        return ("exam", exam_name, str(exam_year), str(qnum))
    qhash = str(row.get("question_hash") or "").strip()
    if qhash:
        return ("hash", qhash)
    qid = str(row.get("id") or "").strip()
    return ("id", qid)


def _row_is_practice_candidate(row: dict[str, Any]) -> bool:
    if row.get("is_active", True) is not True:
        return False
    if row.get("public_visibility") == "hidden_structural":
        return False
    text = str(row.get("question_text") or "").strip()
    if len(text) < 3:
        return False
    return True


def _preferred_practice_row(rows: list[dict[str, Any]], selected_paper_id: Optional[str]) -> dict[str, Any]:
    def sort_key(row: dict[str, Any]) -> tuple[int, int, str]:
        paper_match = 1 if selected_paper_id and str(row.get("paper_id") or "") == str(selected_paper_id) else 0
        created = str(row.get("created_at") or "")
        legacy_penalty = 0 if row.get("paper_id") else -1
        return (paper_match, legacy_penalty, created)
    return sorted(rows, key=sort_key, reverse=True)[0]


def recompute_practice_ready_for_exam(
    exam_name: str,
    exam_year: int,
    *,
    sb=None,
) -> dict[str, Any]:
    sb = sb or _get_supabase()
    normalized_name = normalize_exam_name(exam_name)

    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        res = (
            sb.table("questions")
            .select(
                "id, paper_id, exam_name, exam_year, question_number, question_hash, "
                "is_active, structural_status, public_visibility, question_text, created_at, practice_ready, shift_label"
            )
            .eq("exam_name", normalized_name)
            .eq("exam_year", int(exam_year))
            .range(offset, offset + 999)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    latest_rows = latest_live_paper_rows(exam_name=normalized_name, exam_year=exam_year, sb=sb)
    selected_paper_id = str(latest_rows[0]["id"]) if latest_rows else None

    grouped: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if not _row_is_practice_candidate(row):
            continue
        grouped[_question_identity_for_practice(row)].append(row)

    ready_ids: set[str] = {
        str(_preferred_practice_row(candidates, selected_paper_id).get("id"))
        for candidates in grouped.values()
        if candidates
    }

    for i in range(0, len(rows), 200):
        chunk = rows[i:i + 200]
        updates = []
        for row in chunk:
            qid = str(row.get("id") or "")
            target = qid in ready_ids
            if bool(row.get("practice_ready")) == target:
                continue
            updates.append((qid, target))
        for qid, target in updates:
            sb.table("questions").update({"practice_ready": target}).eq("id", qid).execute()

    return {
        "exam_name": normalized_name,
        "exam_year": int(exam_year),
        "question_count": len(rows),
        "practice_ready_count": len(ready_ids),
        "selected_paper_id": selected_paper_id,
    }


def recompute_practice_ready_for_all(*, sb=None) -> dict[str, Any]:
    sb = sb or _get_supabase()
    res = sb.table("questions").select("exam_name, exam_year").execute()
    rows = res.data or []
    seen: set[tuple[str, int]] = set()
    reports: list[dict[str, Any]] = []
    for row in rows:
        key = (normalize_exam_name(str(row.get("exam_name") or "")), int(row.get("exam_year") or 0))
        if not key[0] or key[1] <= 0 or key in seen:
            continue
        seen.add(key)
        reports.append(recompute_practice_ready_for_exam(key[0], key[1], sb=sb))
    return {
        "total_exams": len(reports),
        "reports": reports,
        "practice_ready_total": sum(int(r.get("practice_ready_count") or 0) for r in reports),
    }


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


def latest_live_paper_rows(
    *,
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
    sb=None,
) -> list[dict[str, Any]]:
    sb = sb or _get_supabase()
    q = sb.table("papers").select(
        "id, exam_name, exam_year, publish_status, lifecycle_status, upload_version, "
        "visible_question_count, hidden_question_count, question_count"
    )
    if exam_name:
        q = q.eq("exam_name", normalize_exam_name(exam_name))
    if exam_year is not None:
        q = q.eq("exam_year", int(exam_year))
    rows = q.execute().data or []
    best_by_exam: dict[tuple[str, int], dict[str, Any]] = {}

    def paper_rank(row: dict[str, Any]) -> tuple[int, int, int, int]:
        publish_status = str(row.get("publish_status") or "")
        status_rank = {
            "publishable": 4,
            "publishable_with_hidden_rows": 3,
            "reupload_needed": 2,
            "draft": 1,
            "blocked": 0,
        }.get(publish_status, 0)
        visible = int(row.get("visible_question_count") or 0)
        total = int(row.get("question_count") or 0)
        version = int(row.get("upload_version") or 0)
        return (visible, total, status_rank, version)

    for row in rows:
        if row.get("lifecycle_status") == "archived":
            continue
        if row.get("publish_status") not in PUBLIC_PAPER_STATUSES:
            continue
        if int(row.get("question_count") or 0) <= 0:
            continue
        if int(row.get("visible_question_count") or 0) <= 0 and int(row.get("hidden_question_count") or 0) <= 0:
            continue
        key = (str(row.get("exam_name") or ""), int(row.get("exam_year") or 0))
        current = best_by_exam.get(key)
        if current is None or paper_rank(row) > paper_rank(current):
            best_by_exam[key] = row
    return list(best_by_exam.values())


def latest_live_paper_ids(
    *,
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
    sb=None,
) -> set[str]:
    return {str(row["id"]) for row in latest_live_paper_rows(exam_name=exam_name, exam_year=exam_year, sb=sb)}


def latest_live_exam_keys(
    *,
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
    sb=None,
) -> set[tuple[str, int]]:
    return {
        (str(row["exam_name"]), int(row["exam_year"]))
        for row in latest_live_paper_rows(exam_name=exam_name, exam_year=exam_year, sb=sb)
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
    if not pdf_path or not os.path.exists(pdf_path):
        return False
    try:
        resolved = Path(pdf_path).resolve()
        temp_root = Path(tempfile.gettempdir()).resolve()
        return temp_root == resolved or temp_root in resolved.parents
    except Exception:
        return False
