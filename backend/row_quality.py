"""
Row-quality compatibility layer.

Phase 2 introduces explicit quality fields without changing the existing
`needs_review`-driven publish/read behavior yet. The helpers in this module
derive additive row state from the current question shape so older code can
continue to function while newer code writes richer metadata.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

_DEVANAGARI_RE = re.compile(r'[\u0900-\u097F]')
_TELUGU_RE = re.compile(r'[\u0C00-\u0C7F]')
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
_STATEMENT_STYLE_STEM_RE = re.compile(
    r'(?:which\s+of\s+the\s+following\s+statements|read\s+the\s+statements|arrange\s+the\s+following|'
    r'which\s+of\s+the\s+above|select\s+the\s+correct\s+option|select\s+the\s+correct\s+pair|'
    r'chronological\s+order|jumbled\s+order|meaningful\s+sentences|synonyms?|antonyms?|statements?\s+\d)',
    re.IGNORECASE,
)
_MATCH_CODE_OPT_RE = re.compile(
    r'^\s*(?:'
    r'(?:\d+\s*[-–]\s*[A-D](?:\s*,\s*\d+\s*[-–]\s*[A-D]){1,7})'
    r'|'
    r'(?:[A-D]\s*[-–]\s*\d+(?:\s*,\s*[A-D]\s*[-–]\s*\d+){1,7})'
    r')\s*$',
    re.IGNORECASE,
)

STRUCTURAL_ISSUE_CODES = {
    "short-or-empty-text",
    "incomplete-options",
    "image-dependent-review",
    "broken-extraction",
    "regional-script",
    "invalid-match-payload",
    "incomplete-match-columns",
    "incomplete-match-stem",
    "unnumbered-questions",
}
ANSWER_ISSUE_CODES = {
    "invalid-answer",
    "answer-option-missing",
}
EXPLANATION_ISSUE_CODES = {
    "answer-explanation-contradiction",
}
TAGGING_ISSUE_CODES = {
    "generic-subject-tag",
    "generic-topic-tag",
    "missing-subtopic-tag",
}
CRITICAL_PUBLISH_ISSUES = STRUCTURAL_ISSUE_CODES | ANSWER_ISSUE_CODES | EXPLANATION_ISSUE_CODES
_GENERIC_SUBJECTS = {"", "general knowledge", "unclassified"}
_GENERIC_TOPICS = {"", "general", "unclassified"}


def _regional_script_ratio(text: str) -> float:
    alpha = [c for c in text if c.isalpha()]
    if not alpha:
        return 0.0
    regional = sum(1 for c in alpha if _DEVANAGARI_RE.match(c) or _TELUGU_RE.match(c))
    return regional / len(alpha)


def _is_image_dependent(row: dict[str, Any]) -> bool:
    if row.get("has_image") or row.get("image_url"):
        return True
    text = " ".join(str(row.get(key) or "") for key in ("question_text", "option_a", "option_b", "option_c", "option_d"))
    return bool(_IMAGE_RE.search(text))


def _is_statement_style_question(text: str, filled_opts: list[str]) -> bool:
    if len(_INLINE_OPTION_RE.findall(text or "")) < 2 or len(filled_opts) < 4:
        return False
    if not _STATEMENT_STYLE_STEM_RE.search(text or ""):
        return False
    return all(len(opt.strip()) <= 120 for opt in filled_opts)


def _extract_match_payload(text: str) -> dict[str, Any]:
    if "__MATCH__:" not in text:
        raise ValueError("missing __MATCH__ payload")
    payload_text = text.split("__MATCH__:", 1)[1].strip()
    return json.loads(payload_text)


def infer_issue_codes(row: dict[str, Any]) -> list[str]:
    text = str(row.get("question_text") or "").strip()
    opts = [(row.get("option_a") or "").strip(), (row.get("option_b") or "").strip(), (row.get("option_c") or "").strip(), (row.get("option_d") or "").strip()]
    filled_opts = [opt for opt in opts if opt]
    publishable_image_fallback = bool(row.get("has_image") and row.get("image_url") and len(filled_opts) == 4)
    reasons: list[str] = []
    subject = str(row.get("subject") or "").strip()
    topic = str(row.get("topic") or "").strip()
    subtopic = str(row.get("subtopic") or "").strip()

    qn = row.get("question_number")
    if not isinstance(qn, int) or qn <= 0:
        reasons.append("unnumbered-questions")

    if not text or len(text) < 15:
        if not publishable_image_fallback:
            reasons.append("short-or-empty-text")

    image_dependent = _is_image_dependent(row)
    if len(filled_opts) < 4:
        reasons.append("image-dependent-review" if image_dependent else "incomplete-options")
    if image_dependent and len(filled_opts) == 0:
        reasons.append("image-dependent-review")

    if (
        len(filled_opts) >= 4
        and len(_INLINE_OPTION_RE.findall(text or "")) >= 2
        and not _is_statement_style_question(text, filled_opts)
        and not publishable_image_fallback
    ):
        reasons.append("broken-extraction")

    exam_name = str(row.get("exam_name") or "")
    is_upsc_like = any(k in exam_name.lower() for k in ("upsc", "cisf", "nda", "cds"))
    if not is_upsc_like and _regional_script_ratio(" ".join([text] + filled_opts)) >= 0.12 and not publishable_image_fallback:
        reasons.append("regional-script")

    is_match_like = (
        str(row.get("question_type") or "").lower() == "match"
        or "match the following" in text.lower()
        or str(row.get("topic") or "").strip().lower() == "matching"
    )
    if is_match_like:
        if "__MATCH__:" in text:
            try:
                payload = _extract_match_payload(text)
                if not (payload.get("col1") or []) or not (payload.get("col2") or []):
                    if not publishable_image_fallback:
                        reasons.append("incomplete-match-columns")
            except Exception:
                if not publishable_image_fallback:
                    reasons.append("invalid-match-payload")
        else:
            intro = re.sub(r'(?i)^match\s+the\s+following[:\s-]*', '', text).strip()
            intro_alnum = len(re.sub(r'[^A-Za-z0-9]+', '', intro))
            all_code_opts = len(filled_opts) == 4 and all(_MATCH_CODE_OPT_RE.match(o) for o in filled_opts)
            has_match_structure = bool(re.search(r'\b(?:column|list\s+i|list\s+ii|a\.|b\.|c\.|d\.|1\.|2\.|3\.|4\.)', text, re.IGNORECASE))
            if all_code_opts and (intro_alnum < 24 or not has_match_structure) and not publishable_image_fallback:
                reasons.append("incomplete-match-stem")

    if row.get("needs_review") is True:
        reasons.append("answer-review")
    answer = str(row.get("correct_answer") or "").strip().upper()
    if answer not in {"A", "B", "C", "D"}:
        reasons.append("invalid-answer")
    else:
        answer_text = str(row.get(f"option_{answer.lower()}") or "").strip()
        if not answer_text:
            reasons.append("answer-option-missing")

    if subject.lower() in _GENERIC_SUBJECTS:
        reasons.append("generic-subject-tag")
    if topic.lower() in _GENERIC_TOPICS:
        reasons.append("generic-topic-tag")
    if not subtopic:
        reasons.append("missing-subtopic-tag")

    return sorted(set(reasons))


def derive_quality_fields(
    row: dict[str, Any],
    *,
    issue_codes: Optional[list[str]] = None,
    explanation_present: bool = False,
    explanation_contradiction: bool = False,
) -> dict[str, Any]:
    reasons = issue_codes if issue_codes is not None else infer_issue_codes(row)
    structural_reasons = [r for r in reasons if r in STRUCTURAL_ISSUE_CODES]
    answer_reasons = [r for r in reasons if r in ANSWER_ISSUE_CODES]
    tagging_reasons = [r for r in reasons if r in TAGGING_ISSUE_CODES]

    structural_status = "broken" if structural_reasons else "valid"

    answer = str(row.get("correct_answer") or "").strip().upper()
    explicit_answer_status = str(row.get("answer_status") or "").strip().lower()
    if explicit_answer_status == "deleted":
        answer_status = "deleted"
    elif explicit_answer_status == "multiple":
        answer_status = "multiple"
    elif answer_reasons or answer not in {"A", "B", "C", "D"}:
        answer_status = "invalid"
    elif row.get("needs_review") is True:
        answer_status = "ai_inferred"
    else:
        answer_status = "verified"

    if tagging_reasons:
        if "generic-subject-tag" in tagging_reasons or "generic-topic-tag" in tagging_reasons:
            tagging_status = "weak"
        else:
            tagging_status = "partial"
    else:
        tagging_status = "strong"

    if explanation_contradiction:
        explanation_status = "contradiction"
    elif row.get("explanation_status") == "stale":
        explanation_status = "stale"
    elif explanation_present:
        explanation_status = "generated"
    else:
        explanation_status = "missing"

    is_active = row.get("is_active", True)
    if structural_status == "broken":
        public_visibility = "hidden_structural"
    elif explanation_contradiction or answer_reasons:
        public_visibility = "hidden_quality"
    elif not is_active:
        public_visibility = "hidden_admin"
    else:
        public_visibility = "visible"

    primary_issue_code = structural_reasons[0] if structural_reasons else (reasons[0] if reasons else None)
    tagging_requires_review = any(reason in {"generic-subject-tag", "generic-topic-tag"} for reason in tagging_reasons)
    review_required = bool(
        row.get("needs_review")
        or structural_reasons
        or answer_reasons
        or explanation_contradiction
        or tagging_requires_review
    )

    confidence = 100
    penalties = {
        "short-or-empty-text": 35,
        "incomplete-options": 35,
        "image-dependent-review": 18,
        "broken-extraction": 30,
        "regional-script": 20,
        "invalid-match-payload": 30,
        "incomplete-match-columns": 25,
        "incomplete-match-stem": 20,
        "unnumbered-questions": 15,
        "invalid-answer": 30,
        "answer-option-missing": 25,
        "answer-explanation-contradiction": 30,
        "generic-subject-tag": 8,
        "generic-topic-tag": 6,
        "missing-subtopic-tag": 3,
        "answer-review": 8,
    }
    for reason in reasons:
        confidence -= penalties.get(reason, 0)
    if explanation_status == "stale":
        confidence -= 12
    confidence_score = max(0, min(100, confidence))

    return {
        "structural_status": structural_status,
        "answer_status": answer_status,
        "explanation_status": explanation_status,
        "tagging_status": tagging_status,
        "review_required": review_required,
        "confidence_score": confidence_score,
        "public_visibility": public_visibility,
        "primary_issue_code": primary_issue_code,
        "issue_codes": reasons,
    }


def merge_quality_fields(
    row: dict[str, Any],
    updates: Optional[dict[str, Any]] = None,
    *,
    explanation_present: bool = False,
    explanation_contradiction: bool = False,
) -> dict[str, Any]:
    merged = dict(row)
    if updates:
        merged.update(updates)
    quality = derive_quality_fields(
        merged,
        explanation_present=explanation_present,
        explanation_contradiction=explanation_contradiction,
    )
    merged.update(quality)
    return merged
