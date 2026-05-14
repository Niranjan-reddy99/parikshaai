"""
Rule-first pattern classification for PYQ intelligence.

The goal is to classify obvious question frames without an AI call, then let
Gemini handle only genuinely ambiguous questions. This keeps tagging cheaper,
more consistent, and easier to audit.
"""
from __future__ import annotations

import re
from typing import Any

PATTERN_TAGS = {
    "statement-based", "assertion-reason", "chronology", "match-the-following",
    "factual-recall", "concept-application", "elimination",
    "article-provision", "committee-mapping",
}
TRAP_TAGS = {
    "absolute-wording", "negation", "except-not", "all-of-above",
    "double-negation", "partial-truth",
}
SKILL_TAGS = {"elimination", "recall", "inference", "application", "analysis"}
QUESTION_STYLES = {"direct", "indirect", "analytical", "comparative", "definitional"}

_SPACE_RE = re.compile(r"\s+")
_MATCH_RE = re.compile(
    r"__match__:|match\s+(?:the\s+)?following|match\s+(?:list|column)|"
    r"list\s*[-–]?\s*i\b.*list\s*[-–]?\s*ii\b|column\s*[-–]?\s*i\b.*column\s*[-–]?\s*ii\b",
    re.IGNORECASE | re.DOTALL,
)
_ASSERTION_REASON_RE = re.compile(r"\bassertion\b.{0,180}\breason\b", re.IGNORECASE | re.DOTALL)
_CHRONOLOGY_RE = re.compile(
    r"chronolog|arrange\s+(?:the\s+following\s+)?(?:events|sentences|statements|acts|states|items)|"
    r"correct\s+(?:sequence|order)|logical\s+order|jumbled\s+order|meaningful\s+and\s+coherent\s+paragraph|"
    r"ascending\s+order|descending\s+order",
    re.IGNORECASE,
)
_ARTICLE_RE = re.compile(
    r"\barticle\s+\d+[a-z]?\b|\bschedule\s+(?:\d+|[ivxlcdm]+)\b|\bsection\s+\d+[a-z]?\b|"
    r"\bamendment\b|\bconstitutional\s+provision\b|\bpart\s+(?:\d+|[ivxlcdm]+)\b",
    re.IGNORECASE,
)
_COMMITTEE_RE = re.compile(
    r"\bcommittee\b|\bcommission\b|\breport\b|\brecommended\s+by\b|\bheaded\s+by\b|\bchair(?:man|person)?\b",
    re.IGNORECASE,
)
_STATEMENT_RE = re.compile(
    r"consider\s+the\s+following\s+statements|which\s+of\s+the\s+following\s+statements|"
    r"which\s+of\s+the\s+above|statements?\s+(?:is|are)\s+(?:correct|incorrect|true|false)|"
    r"\b(?:i|ii|iii|iv)\.\s+|\b[abc]\.\s+",
    re.IGNORECASE,
)
_WITH_REFERENCE_RE = re.compile(r"\bwith\s+reference\s+to\b|\bin\s+the\s+context\s+of\b", re.IGNORECASE)
_DIRECT_RECALL_RE = re.compile(
    r"^(?:who|what|when|where|which|the\s+term|the\s+word|identify)\b|"
    r"\brefers\s+to\b|\bknown\s+as\b|\bis\s+called\b|\bwas\s+founded\s+by\b|\bis\s+located\s+in\b",
    re.IGNORECASE,
)
_COMPARATIVE_RE = re.compile(r"\bcompare|difference\s+between|distinguish|unlike|whereas\b", re.IGNORECASE)
_DEFINITION_RE = re.compile(r"\bmeans\b|\bdefined\s+as\b|\brefers\s+to\b|\bterm\b|\bcalled\b", re.IGNORECASE)
_NEGATION_RE = re.compile(r"\bnot\b|\bincorrect\b|\bfalse\b|\bwrong\b|\bdoes\s+not\b|\bexcept\b", re.IGNORECASE)
_EXCEPT_RE = re.compile(r"\bexcept\b|\ball\s+except\b", re.IGNORECASE)
_DOUBLE_NEGATION_RE = re.compile(r"\bnot\s+incorrect\b|\bnot\s+false\b|\bnot\s+untrue\b", re.IGNORECASE)
_ABSOLUTE_RE = re.compile(r"\b(always|never|only|all|must|solely|entirely|completely|none|absolute)\b", re.IGNORECASE)
_ALL_ABOVE_RE = re.compile(r"\ball\s+of\s+the\s+above\b|\bnone\s+of\s+the\s+above\b", re.IGNORECASE)
_COMBO_OPTION_RE = re.compile(
    r"\b(?:only\s+)?(?:i|ii|iii|iv|1|2|3|4)\s*(?:,|and|&|\+)\s*(?:i|ii|iii|iv|1|2|3|4)\b|"
    r"\b\d+\s*[-–]\s*[a-d]\b",
    re.IGNORECASE,
)


def _clean(value: Any) -> str:
    return _SPACE_RE.sub(" ", str(value or "").strip())


def _combined_text(row: dict[str, Any]) -> tuple[str, str, list[str]]:
    question = _clean(row.get("question_text"))
    options = [
        _clean(row.get("option_a")),
        _clean(row.get("option_b")),
        _clean(row.get("option_c")),
        _clean(row.get("option_d")),
    ]
    return question, " ".join([question, *options]), options


def _trap_for(question: str, full_text: str, pattern_tag: str) -> str | None:
    if _DOUBLE_NEGATION_RE.search(question):
        return "double-negation"
    if _EXCEPT_RE.search(question):
        return "except-not"
    if _NEGATION_RE.search(question):
        return "negation"
    if _ALL_ABOVE_RE.search(full_text):
        return "all-of-above"
    if pattern_tag in {"statement-based", "assertion-reason", "concept-application", "elimination"} and _ABSOLUTE_RE.search(question):
        return "absolute-wording"
    if pattern_tag == "statement-based" and _COMBO_OPTION_RE.search(full_text):
        return "partial-truth"
    return None


def _style_for(question: str, pattern_tag: str, trap_tag: str | None) -> str:
    if trap_tag in {"negation", "except-not", "double-negation"}:
        return "indirect"
    if _COMPARATIVE_RE.search(question):
        return "comparative"
    if _DEFINITION_RE.search(question):
        return "definitional"
    if pattern_tag in {"statement-based", "assertion-reason", "chronology", "match-the-following", "elimination"}:
        return "analytical"
    return "direct"


def _reason_and_hint(pattern_tag: str, trap_tag: str | None, skill_tag: str) -> tuple[str, str]:
    reasons = {
        "statement-based": "The examiner is testing statement validation, not plain memory.",
        "assertion-reason": "The examiner is testing whether the reason correctly explains the assertion.",
        "chronology": "The examiner is testing sequence awareness across events, dates, or ordered ideas.",
        "match-the-following": "The examiner is testing pair mapping across two lists.",
        "article-provision": "The examiner is testing exact constitutional/legal provision recall.",
        "committee-mapping": "The examiner is testing committee, report, or recommendation mapping.",
        "concept-application": "The examiner is testing whether you can apply a concept to context.",
        "elimination": "The examiner is testing option elimination under close distractors.",
        "factual-recall": "The examiner is testing direct factual recall.",
    }
    hints = {
        "statement-based": "Evaluate each statement independently, mark definitely true/false first, then eliminate option combinations.",
        "assertion-reason": "First judge Assertion and Reason separately, then check whether Reason explains Assertion.",
        "chronology": "Anchor one or two dates/events you know, then eliminate impossible sequences.",
        "match-the-following": "Lock the easiest pair first, then eliminate answer codes instead of solving every pair.",
        "article-provision": "Recall the exact Article/Section/Schedule and watch for swapped institutions or powers.",
        "committee-mapping": "Start from the committee/report you know best and use it to eliminate code options.",
        "concept-application": "Translate the example into the underlying rule before looking at options.",
        "elimination": "Remove clearly wrong options first; do not chase the perfect answer immediately.",
        "factual-recall": "Answer from memory, then verify no option is a close-name/date distractor.",
    }
    hint = hints.get(pattern_tag, "Identify the question frame first, then choose the solving method.")
    if trap_tag == "absolute-wording":
        hint += " Be suspicious of absolute words like only, all, always, and never."
    elif trap_tag in {"negation", "except-not", "double-negation"}:
        hint += " Underline the negative wording before reading the options."
    elif trap_tag == "all-of-above":
        hint += " Test each option independently before choosing all/none of the above."
    elif trap_tag == "partial-truth":
        hint += " Look for the one word that makes an otherwise correct statement wrong."
    if skill_tag == "elimination" and "eliminate" not in hint.lower():
        hint += " Use elimination before final selection."
    return reasons.get(pattern_tag, "The examiner is testing a recurring PYQ question frame."), hint


def classify_question_rule(row: dict[str, Any]) -> dict[str, Any] | None:
    """Return deterministic pattern metadata, or None when the row is ambiguous."""
    question, full_text, options = _combined_text(row)
    if not question:
        return None

    pattern_tag: str | None = None
    skill_tag = "recall"
    confidence = 0

    if _MATCH_RE.search(full_text):
        pattern_tag, skill_tag, confidence = "match-the-following", "analysis", 96
    elif _ASSERTION_REASON_RE.search(question):
        pattern_tag, skill_tag, confidence = "assertion-reason", "analysis", 96
    elif _CHRONOLOGY_RE.search(question):
        pattern_tag, skill_tag, confidence = "chronology", "analysis", 94
    elif _ARTICLE_RE.search(question):
        pattern_tag, skill_tag, confidence = "article-provision", "recall", 90
    elif _COMMITTEE_RE.search(question):
        pattern_tag, skill_tag, confidence = "committee-mapping", "recall", 88
    elif _STATEMENT_RE.search(question):
        pattern_tag = "statement-based"
        skill_tag = "elimination" if _COMBO_OPTION_RE.search(full_text) else "analysis"
        confidence = 92
    elif _WITH_REFERENCE_RE.search(question):
        pattern_tag, skill_tag, confidence = "concept-application", "application", 78
    elif _COMBO_OPTION_RE.search(full_text):
        pattern_tag, skill_tag, confidence = "elimination", "elimination", 76
    elif _DIRECT_RECALL_RE.search(question) or len(question.split()) <= 18:
        pattern_tag, skill_tag, confidence = "factual-recall", "recall", 74

    if not pattern_tag:
        return None

    trap_tag = _trap_for(question, full_text, pattern_tag)
    question_style = _style_for(question, pattern_tag, trap_tag)
    pattern_reason, solve_hint = _reason_and_hint(pattern_tag, trap_tag, skill_tag)
    return {
        "pattern_tag": pattern_tag,
        "trap_tag": trap_tag,
        "skill_tag": skill_tag,
        "question_style": question_style,
        "pattern_confidence": confidence,
        "pattern_reason": pattern_reason,
        "solve_hint": solve_hint,
        "pattern_source": "rules",
    }
