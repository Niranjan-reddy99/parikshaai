import json
from typing import Optional

from papers import normalize_exam_name


PUBLIC_IDENTITY_BY_ROW_EXAMS: set[tuple[str, int]] = {
    ("UPSC Combined Geo-Scientist Preliminary Examination", 2026),
    ("APPSC FOREST SECTION OFFICER PAPER 1 MAINS", 2025),
    ("APPSC EO GRADE 3 PAPER 1", 2025),
    ("TSPSC GROUP 2 PAPER 4", 2024),
    ("TSPSC LIBRARIAN GS", 2023),
    ("TSPSC GROUP 3 PAPER 2", 2023),
    ("TSPSC GROUP 2 PAPER 3", 2024),
    ("TSPSC GROUP 2 PAPER 1", 2024),
    ("TSPSC GROUP 1 PRELIMS", 2025),
    ("TSPSC GROUP 1 PRELIMS", 2024),
    ("TSPSC GROUP 1 PRELIMS", 2022),
    ("TSPSC AEE CIVIL GS 1", 2023),
}


def safe_cursor_to_index(cursor: Optional[str]) -> int:
    if not cursor:
        return 0
    try:
        return max(0, int(cursor))
    except Exception:
        return 0


def row_matches_search(row: dict, search: Optional[str]) -> bool:
    if not search:
        return True
    needle = search.strip().lower()
    if not needle:
        return True
    haystack = " ".join(
        str(row.get(key) or "")
        for key in ("question", "subject", "topic", "subtopic", "concept", "type")
    ).lower()
    return needle in haystack


def public_row_identity(row: dict, *, scoped_by_selector: bool = False) -> tuple[str, ...]:
    exam_name = normalize_exam_name(row.get("exam_name") or "")
    exam_year = row.get("exam_year")
    if scoped_by_selector:
        qnum = row.get("question_number")
        selector_key = "::".join([
            str(row.get("paper_id") or "").strip() or "NO_PAPER",
            str(row.get("shift_label") or "").strip() or "NO_SHIFT",
        ])
        if exam_name and isinstance(exam_year, int) and isinstance(qnum, int) and qnum > 0:
            return ("paper", selector_key, exam_name, str(exam_year), str(qnum))
        qid = (row.get("id") or "").strip()
        if qid:
            return ("paper-id", selector_key, qid)
    if exam_name and isinstance(exam_year, int) and (exam_name, exam_year) in PUBLIC_IDENTITY_BY_ROW_EXAMS:
        qid = (row.get("id") or "").strip()
        if qid:
            return ("row", qid)
    qnum = row.get("question_number")
    shift = str(row.get("shift_label") or "").strip()
    paper = str(row.get("paper_id") or "").strip()
    if shift or paper:
        qid = (row.get("id") or "").strip()
        if qid:
            return ("id", qid)
    if exam_name and isinstance(exam_year, int) and isinstance(qnum, int) and qnum > 0:
        return ("exam", exam_name, str(exam_year), str(qnum))
    qhash = (row.get("question_hash") or "").strip()
    if qhash:
        return ("hash", qhash)
    qid = (row.get("id") or "").strip()
    if qid:
        return ("id", qid)
    return ("fallback", json.dumps(row, sort_keys=True, default=str))


def build_exam_paper_manifest_from_rows(rows: list[dict], exam_name: str, exam_year: int) -> dict:
    groups: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        key = (
            str(row.get("paper_id") or "").strip() or "NO_PAPER",
            str(row.get("shift_label") or "").strip() or "NO_SHIFT",
        )
        groups.setdefault(key, []).append(row)

    papers: list[dict] = []
    for (paper_id, shift), members in sorted(groups.items(), key=lambda item: (item[0][1], item[0][0])):
        numbered = sorted(
            int(row.get("question_number"))
            for row in members
            if isinstance(row.get("question_number"), int)
        )
        papers.append({
            "paper_id": None if paper_id == "NO_PAPER" else paper_id,
            "shift_label": None if shift == "NO_SHIFT" else shift,
            "question_count": len(members),
            "first_question_number": numbered[0] if numbered else None,
            "last_question_number": numbered[-1] if numbered else None,
        })

    return {
        "exam_name": exam_name,
        "exam_year": exam_year,
        "total_count": len(rows),
        "papers": papers,
    }


def build_catalog_from_meta(rows: list[dict]) -> dict:
    commission_map: dict[str, dict[str, dict]] = {}
    for row in rows:
        exam_name = str(row.get("exam_name") or "").strip()
        exam_year = int(row.get("exam_year") or 0)
        if not exam_name or not exam_year:
            continue
        parts = exam_name.split()
        commission = parts[0].upper() if parts else "GENERAL"
        exam_type = " ".join(parts[1:]).strip() or exam_name
        commission_bucket = commission_map.setdefault(commission, {})
        exam_bucket = commission_bucket.setdefault(exam_type, {
            "years": [],
            "count": 0,
            "yearCounts": {},
            "difficulty": {"Easy": 0, "Medium": 0, "Hard": 0},
            "fullName": exam_name,
        })
        exam_bucket["count"] += 1
        exam_bucket["yearCounts"][str(exam_year)] = int(
            exam_bucket["yearCounts"].get(str(exam_year), 0)
        ) + 1
        if exam_year not in exam_bucket["years"]:
            exam_bucket["years"].append(exam_year)
            exam_bucket["years"].sort(reverse=True)
        difficulty = row.get("difficulty")
        if difficulty in exam_bucket["difficulty"]:
            exam_bucket["difficulty"][difficulty] += 1
    return {
        "total_questions": len(rows),
        "commission_map": commission_map,
    }


def build_feed_from_meta(rows: list[dict]) -> dict:
    subject_map: dict[str, dict] = {}
    for row in rows:
        subject = str(row.get("subject") or "General Awareness").strip() or "General Awareness"
        topic = str(row.get("topic") or "General").strip() or "General"
        subtopic = str(row.get("subtopic") or topic).strip() or topic
        exam_name = str(row.get("exam_name") or "")
        exam_year = int(row.get("exam_year") or 0)

        subject_bucket = subject_map.setdefault(subject, {
            "subject": subject,
            "count": 0,
            "years": set(),
            "latest_exam": exam_name,
            "latest_year": exam_year,
            "topics": {},
        })
        subject_bucket["count"] += 1
        subject_bucket["years"].add(exam_year)
        if exam_year >= subject_bucket["latest_year"]:
            subject_bucket["latest_year"] = exam_year
            subject_bucket["latest_exam"] = exam_name

        topic_bucket = subject_bucket["topics"].setdefault(topic, {
            "topic": topic,
            "count": 0,
            "years": set(),
            "latest_exam": exam_name,
            "latest_year": exam_year,
            "subtopics": {},
        })
        topic_bucket["count"] += 1
        topic_bucket["years"].add(exam_year)
        if exam_year >= topic_bucket["latest_year"]:
            topic_bucket["latest_year"] = exam_year
            topic_bucket["latest_exam"] = exam_name

        subtopic_bucket = topic_bucket["subtopics"].setdefault(subtopic, {
            "subtopic": subtopic,
            "count": 0,
            "years": set(),
            "latest_exam": exam_name,
            "latest_year": exam_year,
        })
        subtopic_bucket["count"] += 1
        subtopic_bucket["years"].add(exam_year)
        if exam_year >= subtopic_bucket["latest_year"]:
            subtopic_bucket["latest_year"] = exam_year
            subtopic_bucket["latest_exam"] = exam_name

    subjects = []
    for subject_bucket in subject_map.values():
        topics = []
        for topic_bucket in subject_bucket["topics"].values():
            subtopics = sorted(
                ({
                    "subtopic": item["subtopic"],
                    "count": item["count"],
                    "year_count": len(item["years"]),
                    "latest_exam": item["latest_exam"],
                    "latest_year": item["latest_year"],
                } for item in topic_bucket["subtopics"].values()),
                key=lambda item: (-item["count"], -item["year_count"], item["subtopic"]),
            )
            topics.append({
                "topic": topic_bucket["topic"],
                "count": topic_bucket["count"],
                "year_count": len(topic_bucket["years"]),
                "latest_exam": topic_bucket["latest_exam"],
                "latest_year": topic_bucket["latest_year"],
                "subtopics": subtopics,
            })
        topics.sort(key=lambda item: (-item["count"], -item["year_count"], item["topic"]))
        subjects.append({
            "subject": subject_bucket["subject"],
            "count": subject_bucket["count"],
            "year_count": len(subject_bucket["years"]),
            "latest_exam": subject_bucket["latest_exam"],
            "latest_year": subject_bucket["latest_year"],
            "topics": topics,
        })
    subjects.sort(key=lambda item: (-item["count"], -item["year_count"], item["subject"]))
    return {
        "subjects": subjects,
        "total_questions": len(rows),
    }


def build_exam_outline(rows: list[dict], exam_name: str, exam_year: int) -> dict:
    subject_map: dict[str, dict] = {}
    for row in rows:
        subject = str(row.get("subject") or "General").strip() or "General"
        topic = str(row.get("topic") or "General").strip() or "General"
        subtopic = str(row.get("subtopic") or "").strip()
        subject_bucket = subject_map.setdefault(subject, {"subject": subject, "count": 0, "topics": {}})
        subject_bucket["count"] += 1
        topic_bucket = subject_bucket["topics"].setdefault(topic, {"topic": topic, "count": 0, "subtopics": {}})
        topic_bucket["count"] += 1
        if subtopic:
            topic_bucket["subtopics"][subtopic] = topic_bucket["subtopics"].get(subtopic, 0) + 1

    subjects = []
    for subject_bucket in subject_map.values():
        topics = []
        for topic_bucket in subject_bucket["topics"].values():
            topics.append({
                "topic": topic_bucket["topic"],
                "count": topic_bucket["count"],
                "subtopics": [
                    {"subtopic": sub_name, "count": sub_count}
                    for sub_name, sub_count in sorted(topic_bucket["subtopics"].items(), key=lambda item: (-item[1], item[0]))
                ],
            })
        topics.sort(key=lambda item: (-item["count"], item["topic"]))
        subjects.append({
            "subject": subject_bucket["subject"],
            "count": subject_bucket["count"],
            "topics": topics,
        })
    subjects.sort(key=lambda item: (-item["count"], item["subject"]))
    return {
        "exam_name": exam_name,
        "exam_year": exam_year,
        "total_count": len(rows),
        "subjects": subjects,
    }
