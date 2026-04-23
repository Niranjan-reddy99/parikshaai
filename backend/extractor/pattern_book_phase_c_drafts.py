from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .pattern_book_raw_blocks import build_phase_c_readiness_audit, isolate_options_from_raw_block


def _normalized_draft_report_path(pdf_path: str) -> Path:
    pdf_file = Path(pdf_path)
    digest = hashlib.sha256(str(pdf_file.resolve()).encode("utf-8")).hexdigest()[:16]
    reports_dir = Path(__file__).resolve().parent.parent / "cache" / "pattern_book_normalized_drafts"
    reports_dir.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", pdf_file.stem)[:80]
    return reports_dir / f"{safe_name}_{digest}.json"


def _source_block_id(block: dict[str, Any], index: int) -> str:
    bbox = block.get("bbox") or {}
    bbox_key = f"{bbox.get('x0','na')}_{bbox.get('y0','na')}_{bbox.get('x1','na')}_{bbox.get('y1','na')}"
    return f"p{block.get('page_number','na')}_q{block.get('question_number_raw','na')}_{index}_{bbox_key}"


def _normalize_ready_block(block: dict[str, Any], *, source_block_id: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    option_shape = isolate_options_from_raw_block(block)
    options = option_shape["options"]
    missing = [label for label in ("A", "B", "C", "D") if not options.get(label)]
    if missing:
        return None, {
            "source_block_id": source_block_id,
            "page_number": block.get("page_number"),
            "question_number_raw": block.get("question_number_raw"),
            "reason": "normalized_options_missing",
            "missing_option_labels": missing,
        }
    qn = block.get("question_number_raw")
    if qn is None or not str(qn).isdigit():
        return None, {
            "source_block_id": source_block_id,
            "page_number": block.get("page_number"),
            "question_number_raw": qn,
            "reason": "normalized_question_number_invalid",
        }
    stem_text = option_shape["stem_text"].strip()
    if not stem_text:
        return None, {
            "source_block_id": source_block_id,
            "page_number": block.get("page_number"),
            "question_number_raw": qn,
            "reason": "normalized_stem_missing",
        }
    qn_text = str(qn)
    stem_text = re.sub(rf"^\s*{re.escape(qn_text)}\s*[\).:-]?\s*", "", stem_text).strip()
    if not stem_text:
        return None, {
            "source_block_id": source_block_id,
            "page_number": block.get("page_number"),
            "question_number_raw": qn,
            "reason": "normalized_stem_missing_after_number_strip",
        }
    notes: list[str] = []
    if option_shape["option_isolation_confidence"] < 0.9:
        notes.append("option_isolation_not_perfect")
    if option_shape["isolation_notes"]:
        notes.extend(option_shape["isolation_notes"])
    normalized = {
        "question_number": int(str(qn)),
        "question_text": stem_text,
        "option_a": options["A"],
        "option_b": options["B"],
        "option_c": options["C"],
        "option_d": options["D"],
        "source_page_number": block.get("page_number"),
        "source_block_id": source_block_id,
        "extraction_confidence": block.get("extraction_confidence"),
        "source_page_type": block.get("source_page_type") or "question_page",
        "normalization_notes": notes,
        "detected_pattern_heading": block.get("detected_pattern_heading"),
        "source_bbox": block.get("bbox"),
    }
    return normalized, None


def build_pattern_book_normalized_draft(report: dict[str, Any], *, write_report: bool = False) -> dict[str, Any]:
    audit = report.get("phase_c_readiness_audit") or build_phase_c_readiness_audit(report)
    question_blocks = report.get("question_blocks", [])
    readiness_by_block: dict[tuple[int | None, str | None, int], dict[str, Any]] = {}
    for idx, readiness in enumerate(audit.get("block_readiness", [])):
        key = (readiness.get("page_number"), readiness.get("question_number_raw"), idx)
        readiness_by_block[key] = readiness

    normalized_questions: list[dict[str, Any]] = []
    normalization_failures: list[dict[str, Any]] = []
    pages_contributing: set[int] = set()

    for idx, block in enumerate(question_blocks):
        key = (block.get("page_number"), block.get("question_number_raw"), idx)
        readiness = readiness_by_block.get(key)
        if not readiness or readiness.get("status") != "ready_for_phase_c":
            continue
        block_id = _source_block_id(block, idx)
        normalized, failure = _normalize_ready_block(block, source_block_id=block_id)
        if normalized:
            normalized_questions.append(normalized)
            if normalized.get("source_page_number") is not None:
                pages_contributing.add(int(normalized["source_page_number"]))
        elif failure:
            normalization_failures.append(failure)

    result = {
        "pdf_path": report.get("pdf_path"),
        "page_count": report.get("page_count"),
        "source_report_path": report.get("report_path"),
        "source_summary": report.get("summary", {}),
        "phase_c_readiness_audit_summary": {
            "total_raw_blocks": audit.get("total_raw_blocks", 0),
            "ready_for_phase_c_count": audit.get("ready_for_phase_c_count", 0),
            "needs_manual_review_count": audit.get("needs_manual_review_count", 0),
            "withhold_for_now_count": audit.get("withhold_for_now_count", 0),
        },
        "summary": {
            "blocks_considered_for_normalization": audit.get("ready_for_phase_c_count", 0),
            "normalized_blocks_count": len(normalized_questions),
            "normalization_failures_count": len(normalization_failures),
            "pages_contributing_normalized_questions": sorted(pages_contributing),
        },
        "normalized_questions": normalized_questions,
        "normalization_failures": normalization_failures,
        "sample_normalized_outputs": normalized_questions[:8],
    }
    if write_report and report.get("pdf_path"):
        report_path = _normalized_draft_report_path(report["pdf_path"])
        report_path.write_text(json.dumps(result, indent=2), encoding="utf-8")
        result["report_path"] = str(report_path)
    return result
