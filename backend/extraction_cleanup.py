from __future__ import annotations

import re
from typing import Any

_DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")
_TELUGU_RE = re.compile(r"[\u0C00-\u0C7F]")
_MULTISPACE_RE = re.compile(r"[ \t]{2,}")
_MULTIBLANK_RE = re.compile(r"\n{3,}")
_ASCII_ALPHA_RE = re.compile(r"[A-Za-z]")

_INSTRUCTION_RE = re.compile(
    r"\b(?:"
    r"hall\s+ticket|admission\s+certificate|invigilator|answer\s+sheet|omr|"
    r"general\s+instructions|read\s+carefully|candidate\s+should|candidates?\s+(?:are|must|should|will)|"
    r"do\s+not\s+(?:open|write|fold|start|mark)|"
    r"write\s+your\s+(?:name|roll\s+number|registration\s+number)|"
    r"maximum\s+marks?|time\s+allowed|rough\s+work|mobile\s+phones?|"
    r"electronic\s+gadgets?|question\s+booklet|booklet\s+series|seal\s+of\s+the|"
    r"darken\s+(?:the\s+)?(?:appropriate|correct)\s+(?:circle|bubble|oval)|"
    r"before\s+you\s+proceed\s+to\s+mark|fill\s+in\s+some\s+particulars"
    r")\b",
    re.IGNORECASE,
)

_DIRECTIVE_RE = re.compile(
    r"^(?:"
    r"before|after|do\s+not|write|read|fill|mark|ensure|check|keep|use|switch\s+off|"
    r"note\b|all\s+questions?|time\s+allowed|maximum\s+marks?|"
    r"this\s+(?:question|paper|booklet)|answer\s+all|attempt\s+all|rough\s+work|"
    r"candidates?\s+(?:are|must|should|will)"
    r")",
    re.IGNORECASE,
)


def regional_script_ratio(text: str) -> float:
    alpha = [c for c in (text or "") if c.isalpha()]
    if not alpha:
        return 0.0
    regional = sum(1 for c in alpha if _DEVANAGARI_RE.match(c) or _TELUGU_RE.match(c))
    return regional / len(alpha)


def strip_regional_script(text: str) -> str:
    if not text:
        return ""
    text = _DEVANAGARI_RE.sub("", text)
    text = _TELUGU_RE.sub("", text)
    text = _MULTISPACE_RE.sub(" ", text)
    text = _MULTIBLANK_RE.sub("\n\n", text)
    lines = [line.strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line).strip()


def option_count(question: dict[str, Any]) -> int:
    return sum(
        1
        for key in ("option_a", "option_b", "option_c", "option_d")
        if str(question.get(key) or "").strip()
    )


def looks_like_instruction_question(text: str, opts: int = 0) -> bool:
    text = (text or "").strip()
    if not text:
        return False
    if _INSTRUCTION_RE.search(text):
        return True
    return opts < 2 and bool(_DIRECTIVE_RE.match(text))


def question_quality_score(question: dict[str, Any]) -> int:
    text = str(question.get("question_text") or "").strip()
    opts = option_count(question)
    combined = " ".join(
        str(question.get(key) or "")
        for key in ("question_text", "option_a", "option_b", "option_c", "option_d")
    )
    score = opts * 250 + min(len(text), 240)
    if isinstance(question.get("question_number"), int):
        score += 25
    if str(question.get("correct_answer") or "").strip().upper() in {"A", "B", "C", "D"}:
        score += 20
    if not bool(question.get("needs_review")):
        score += 10
    score += min(40, len(_ASCII_ALPHA_RE.findall(text)))

    ratio = regional_script_ratio(combined)
    if ratio >= 0.35:
        score -= 1200
    elif ratio >= 0.12:
        score -= 500
    elif ratio >= 0.04:
        score -= 120

    if looks_like_instruction_question(text, opts):
        score -= 1500
    if opts == 0:
        score -= 120
    if len(text) < 15:
        score -= 80
    return score


def clean_extracted_question(question: dict[str, Any]) -> dict[str, Any] | None:
    cleaned = dict(question)
    original_combined = " ".join(
        str(question.get(key) or "")
        for key in ("question_text", "option_a", "option_b", "option_c", "option_d", "passage")
    )

    for key in ("question_text", "option_a", "option_b", "option_c", "option_d", "passage"):
        if key in cleaned:
            cleaned[key] = strip_regional_script(str(cleaned.get(key) or ""))

    text = str(cleaned.get("question_text") or "").strip()
    opts = option_count(cleaned)
    if not text or len(text) < 5:
        return None
    if looks_like_instruction_question(text, opts):
        return None

    if regional_script_ratio(original_combined) >= 0.35:
        english_chars = len(_ASCII_ALPHA_RE.findall(" ".join(
            str(cleaned.get(key) or "")
            for key in ("question_text", "option_a", "option_b", "option_c", "option_d")
        )))
        if english_chars < 20:
            return None

    return cleaned


def clean_and_dedupe_questions(questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    numbered: dict[int, dict[str, Any]] = {}
    unnumbered: list[dict[str, Any]] = []

    for question in questions or []:
        cleaned = clean_extracted_question(question)
        if not cleaned:
            continue
        qn = cleaned.get("question_number")
        if isinstance(qn, int) and qn > 0:
            current = numbered.get(qn)
            if current is None or question_quality_score(cleaned) > question_quality_score(current):
                numbered[qn] = cleaned
        else:
            unnumbered.append(cleaned)

    return [numbered[qn] for qn in sorted(numbered)] + unnumbered
