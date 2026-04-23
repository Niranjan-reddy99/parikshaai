from __future__ import annotations

import argparse
import re
from typing import Any

from canonical_taxonomy import derive_canonical_taxonomy
from config import supabase
from pipeline import CostTracker, tag_questions, _question_supported_columns, _quality_update_payload
from row_quality import merge_quality_fields


SUBJECT_PATTERNS: list[tuple[re.Pattern[str], set[str]]] = [
    (
        re.compile(
            r"\bnewton'?s laws?|laws? of motion|momentum|angular momentum|inertia|friction|force|acceleration|velocity|displacement|mass|projectile|work|energy|power|carrom|telescope|microscope|lens|mirror|optics|light|wave|electric current|voltage|resistance|magnet|atom|molecule|acid|base|chemical reaction|photosynthesis|respiration|cell division|genetics|thermodynamics\b",
            re.IGNORECASE,
        ),
        {"General Science", "Science & Technology"},
    ),
    (
        re.compile(
            r"\bconstitution|fundamental rights|directive principles|judiciary|supreme court|high court|parliament|lok sabha|rajya sabha|preamble|president|prime minister|governor|constitutional amendment|article\s+\d+\b",
            re.IGNORECASE,
        ),
        {"Polity"},
    ),
    (
        re.compile(
            r"\bgdp|gnp|inflation|repo rate|reverse repo|crr|slr|budget|fiscal deficit|monetary policy|national income|msme|industry|industrial|manufacturing|sez|special economic zone|poverty|unemployment|tax|banking|rbi\b",
            re.IGNORECASE,
        ),
        {"Economy"},
    ),
    (
        re.compile(
            r"\bindus|harappa|vedic|maurya|gupta|mughal|ashoka|buddh|jain|gandhi|gandhian|quit india|non-cooperation|civil disobedience|satavahana|kakatiya|history of telangana|telangana movement\b",
            re.IGNORECASE,
        ),
        {"History"},
    ),
    (
        re.compile(
            r"\bmonsoon|rainfall|river|tributary|basin|soil|plateau|mountain|delta|desert|cyclone|latitude|longitude|mineral resources|agro-climatic\b",
            re.IGNORECASE,
        ),
        {"Geography"},
    ),
    (
        re.compile(
            r"\bpollution|ecosystem|biodiversity|climate change|global warming|greenhouse|wildlife|endangered|conservation|ecology|forest cover|ozone layer\b",
            re.IGNORECASE,
        ),
        {"Environment"},
    ),
    (
        re.compile(
            r"\bunited nations|security council|imf|world bank|wto|nato|asean|brics|quad|bilateral relations|foreign policy|multilateral|geopolitics\b",
            re.IGNORECASE,
        ),
        {"International Relations"},
    ),
    (
        re.compile(
            r"\bseating arrangement|blood relation|syllogism|coding[- ]decoding|direction sense|analogy|series\b",
            re.IGNORECASE,
        ),
        {"Logical Reasoning", "Mental Ability"},
    ),
    (
        re.compile(
            r"\btime and work|time,? speed and distance|profit and loss|simple interest|compound interest|ratio|proportion|percentage|average|permutation|combination|probability|number system\b",
            re.IGNORECASE,
        ),
        {"Quantitative Aptitude", "Mathematics"},
    ),
]


def _iter_rows(limit: int | None = None) -> list[dict[str, Any]]:
    supported_cols = _question_supported_columns(supabase)
    select_cols = [
        "id",
        "question_text",
        "option_a",
        "option_b",
        "option_c",
        "option_d",
        "question_type",
        "subject",
        "topic",
        "subtopic",
        "difficulty",
    ]
    if "explanation_status" in supported_cols:
        select_cols.append("explanation_status")

    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        result = (
            supabase.table("questions")
            .select(", ".join(select_cols))
            .eq("is_active", True)
            .range(offset, offset + 499)
            .execute()
        )
        batch = result.data or []
        if not batch:
            break
        rows.extend(batch)
        if limit and len(rows) >= limit:
            return rows[:limit]
        if len(batch) < 500:
            break
        offset += 500
    return rows


def _combined_text(row: dict[str, Any]) -> str:
    return " ".join(
        str(row.get(key) or "")
        for key in ("question_text", "option_a", "option_b", "option_c", "option_d", "subject", "topic", "subtopic")
    )


def _is_suspect(row: dict[str, Any]) -> bool:
    subject = str(row.get("subject") or "").strip()
    combined = _combined_text(row)
    if not combined.strip():
        return False
    for pattern, allowed_subjects in SUBJECT_PATTERNS:
        if pattern.search(combined) and subject not in allowed_subjects:
            return True
    return False


def _load_suspects(limit: int | None = None) -> list[dict[str, Any]]:
    return [row for row in _iter_rows(limit=limit) if _is_suspect(row)]


def run(limit: int | None = None) -> dict[str, int]:
    rows = _load_suspects(limit=limit)
    if not rows:
        return {"selected": 0, "updated": 0}

    tracker = CostTracker()
    tag_input = [
        {
            "question_text": row.get("question_text"),
            "option_a": row.get("option_a"),
            "option_b": row.get("option_b"),
            "option_c": row.get("option_c"),
            "option_d": row.get("option_d"),
            "question_type": row.get("question_type"),
            "id_db": row["id"],
        }
        for row in rows
    ]
    tagged = tag_questions(tag_input, "subject-mismatch-retag", tracker=tracker)
    supported_cols = _question_supported_columns(supabase)
    updated = 0
    by_id = {row["id"]: row for row in rows}

    for item in tagged:
        current = by_id[item["id_db"]]
        patch = {
            "subject": item.get("subject") or current.get("subject") or "General Awareness",
            "topic": item.get("topic") or current.get("topic") or "General",
            "subtopic": item.get("subtopic") or current.get("subtopic"),
            "difficulty": item.get("difficulty") or current.get("difficulty") or "Medium",
        }
        canonical = derive_canonical_taxonomy(patch["subject"], patch["topic"], patch["subtopic"])
        patch["subject"] = canonical["canonical_subject"]
        patch["topic"] = canonical["canonical_topic_family"]
        patch["subtopic"] = canonical["canonical_subtopic_family"]
        for key, value in canonical.items():
            if key in supported_cols:
                patch[key] = value
        merged = merge_quality_fields(
            current,
            patch,
            explanation_present=current.get("explanation_status") == "generated",
            explanation_contradiction=current.get("explanation_status") == "contradiction",
        )
        payload = _quality_update_payload(patch, merged, supported_cols)
        supabase.table("questions").update(payload).eq("id", item["id_db"]).execute()
        updated += 1

    tracker.print_summary()
    return {"selected": len(rows), "updated": updated}


def main() -> None:
    parser = argparse.ArgumentParser(description="AI-retag rows whose subject conflicts with obvious content keywords.")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    print(run(limit=args.limit))


if __name__ == "__main__":
    main()
