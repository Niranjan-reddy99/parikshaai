"""
Auditable repair proposals for AI-detected question corrections.

Phase 3 stops explanation generation from silently mutating canonical question
rows. Instead, potential fixes are recorded here and can be applied explicitly.
"""
from __future__ import annotations

from typing import Any, Optional

from canonical_taxonomy import derive_canonical_taxonomy
from row_quality import merge_quality_fields
from papers import refresh_paper_publish_state


def _get_supabase():
    from config import supabase
    return supabase


def build_ai_repair_proposals(question_id: str, current_q: dict[str, Any], ai_item: dict[str, Any]) -> list[dict[str, Any]]:
    proposals: list[dict[str, Any]] = []
    paper_id = current_q.get("paper_id")
    source = "explanation_ai"

    detected = str(ai_item.get("detected_answer") or "").strip().upper()[:1]
    db_ans = str(current_q.get("correct_answer") or "").strip().upper()
    if detected in {"A", "B", "C", "D"} and detected != db_ans:
        proposals.append({
            "question_id": question_id,
            "paper_id": paper_id,
            "repair_type": "answer_correction",
            "status": "proposed",
            "proposed_patch": {
                "correct_answer": detected,
                "needs_review": True,
                "answer_status": "corrected",
                "explanation_status": "stale",
            },
            "evidence": {
                "old_answer": db_ans,
                "detected_answer": detected,
                "logic_steps": ai_item.get("logic_steps"),
            },
            "source": source,
        })

    # Safety: do not generate question_text cleanup proposals from explanation-time AI.
    # The explanation prompt intentionally truncates question text for token control,
    # so `cleaned_question` can silently drop later statements/lists on long rows.
    # That makes it unsafe as a canonical source of truth for production question_text.

    cleaned_opts = ai_item.get("cleaned_options") or {}
    if isinstance(cleaned_opts, dict):
        patch: dict[str, Any] = {}
        evidence: dict[str, Any] = {}
        for letter in ("A", "B", "C", "D"):
            new_val = str(cleaned_opts.get(letter) or "").strip()
            key = f"option_{letter.lower()}"
            old_val = str(current_q.get(key) or "").strip()
            if new_val and new_val != old_val:
                patch[key] = new_val
                evidence[key] = {"old": old_val, "new": new_val}
        if patch:
            patch["needs_review"] = True
            proposals.append({
                "question_id": question_id,
                "paper_id": paper_id,
                "repair_type": "options_cleanup",
                "status": "proposed",
                "proposed_patch": patch,
                "evidence": evidence,
                "source": source,
            })

    return proposals


def record_ai_repair_proposals(question_id: str, current_q: dict[str, Any], ai_item: dict[str, Any], sb=None) -> int:
    sb = sb or _get_supabase()
    proposals = build_ai_repair_proposals(question_id, current_q, ai_item)
    if not proposals:
        return 0
    try:
        sb.table("question_repairs").insert(proposals).execute()
        return len(proposals)
    except Exception as e:
        print(f"      ⚠️  Failed to record repair proposals for Q_{question_id[:8]}: {e}")
        return 0


def apply_question_repair(repair_row: dict[str, Any], *, sb=None) -> bool:
    sb = sb or _get_supabase()
    question_id = repair_row.get("question_id")
    if not question_id:
        return False
    qr = sb.table("questions").select("*").eq("id", question_id).single().execute()
    if not qr.data:
        return False
    current_q = qr.data
    patch = repair_row.get("proposed_patch") or {}
    if {"subject", "topic", "subtopic"} & set(patch.keys()):
        patch = dict(patch)
        canonical = derive_canonical_taxonomy(
            patch.get("subject", current_q.get("subject")),
            patch.get("topic", current_q.get("topic")),
            patch.get("subtopic", current_q.get("subtopic")),
        )
        for key, value in canonical.items():
            if key in current_q:
                patch[key] = value
    merged = merge_quality_fields(current_q, patch, explanation_present=(current_q.get("explanation_status") == "generated"))
    update_row = dict(patch)
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
        update_row[key] = merged[key]
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
        if key in patch:
            update_row[key] = patch[key]
    sb.table("questions").update(update_row).eq("id", question_id).execute()
    refresh_paper_publish_state(current_q.get("paper_id"), sb=sb)
    sb.table("question_repairs").update({"status": "applied"}).eq("id", repair_row["id"]).execute()
    return True


def apply_latest_answer_correction(question_id: str, *, sb=None) -> bool:
    """Apply the newest proposed answer_correction for a question, if one exists."""
    sb = sb or _get_supabase()
    try:
        rr = (
            sb.table("question_repairs")
            .select("*")
            .eq("question_id", question_id)
            .eq("repair_type", "answer_correction")
            .eq("status", "proposed")
            .execute()
        )
    except Exception as e:
        print(f"      ⚠️  Skipping answer-correction lookup for Q_{question_id[:8]}: {e}")
        return False
    raw_repairs = rr.data or []
    repairs = raw_repairs if isinstance(raw_repairs, list) else [raw_repairs]
    if not repairs:
        return False
    latest = repairs[-1]
    return apply_question_repair(latest, sb=sb)
