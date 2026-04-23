"""
Recover question_text rows that were likely shortened by old explanation-time cleanup.

Strategy:
1. Read live questions from Supabase.
2. Group by source_pdf and match that PDF to a local file.
3. Load the extractor page caches for that PDF hash.
4. For each numbered question, compare current DB text vs cached extracted text.
5. Restore only high-confidence truncation cases where the cached text is
   substantially longer and clearly contains the current text.

This is intentionally conservative to avoid rewriting legitimate cleaned text.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from config import supabase
from pipeline import parse_questions_local
from papers import refresh_paper_publish_state
from row_quality import merge_quality_fields
import fitz


ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / "cache"
DOWNLOADS_DIR = Path("/Users/niranjan/Downloads")
TMP_ROOT = Path("/var/folders")
_DOWNLOAD_PDFS = sorted(DOWNLOADS_DIR.glob("*.pdf"))
_STOPWORDS = {
    "and", "the", "paper", "question", "questions", "exam", "general", "studies",
    "preliminary", "prelims", "prelims.", "prelims-", "prelims_", "prelims2023",
    "final", "key", "master", "set", "copy", "with", "for", "of", "i", "ii", "iii",
}


def _norm(text: str) -> str:
    return " ".join((text or "").split()).strip().lower()


def _find_local_pdf(source_pdf: str) -> Path | None:
    if not source_pdf:
        return None
    direct = Path(source_pdf)
    if direct.exists():
        return direct

    basename = Path(source_pdf).name
    candidates = [
        DOWNLOADS_DIR / basename,
        Path.cwd() / basename,
        ROOT.parent / basename,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate

    if TMP_ROOT.exists():
        matches = list(TMP_ROOT.glob(f"**/{basename}"))
        if matches:
            return matches[0]
    return None


def _tokenize(value: str) -> set[str]:
    if not value:
        return set()
    tokens = {
        token
        for token in re.findall(r"[a-z0-9]+", value.lower())
        if len(token) >= 2 and token not in _STOPWORDS
    }
    return tokens


def _candidate_exam_strings(row: dict[str, Any]) -> list[str]:
    exam_name = str(row.get("exam_name") or "")
    exam_year = row.get("exam_year")
    source_pdf = str(row.get("source_pdf") or "")
    base = Path(source_pdf).stem if source_pdf else ""
    values = [exam_name, base]
    if exam_year:
        values.extend([f"{exam_name} {exam_year}", f"{base} {exam_year}"])
    return [v for v in values if v]


def _score_pdf_candidate(row: dict[str, Any], pdf_path: Path) -> int:
    filename = pdf_path.stem.lower()
    filename_tokens = _tokenize(filename)
    score = 0

    for candidate in _candidate_exam_strings(row):
        candidate_tokens = _tokenize(candidate)
        overlap = len(candidate_tokens & filename_tokens)
        score = max(score, overlap * 10)

    exam_name = str(row.get("exam_name") or "").lower()
    exam_year = row.get("exam_year")
    if exam_year and str(exam_year) in filename:
        score += 8

    direct_hints = {
        "combined geo-scientist": ["cgspe", "geo", "scientist"],
        "upsc cds": ["cdse", "cds"],
        "cisf": ["cisf"],
        "group 4": ["group4", "gp_iv", "paper_1_master", "group-4"],
        "group 3": ["group3", "gr3", "group-3"],
        "group 2": ["group2", "gr2", "group-2"],
        "dao": ["dao"],
        "aee": ["aee"],
        "eo": ["eo"],
        "tpbo": ["tpbo"],
        "librarian": ["librarian"],
        "fsi": ["fso"],
    }
    for phrase, hints in direct_hints.items():
        if phrase in exam_name and any(hint in filename for hint in hints):
            score += 25

    return score


def _find_pdf_by_exam(row: dict[str, Any]) -> Path | None:
    scored: list[tuple[int, Path]] = []
    for candidate in _DOWNLOAD_PDFS:
        score = _score_pdf_candidate(row, candidate)
        if score > 0:
            scored.append((score, candidate))
    if not scored:
        return None
    scored.sort(key=lambda item: (-item[0], len(item[1].name)))
    best_score, best_path = scored[0]
    return best_path if best_score >= 18 else None


def _pdf_hash_prefix(pdf_path: Path) -> str:
    return hashlib.sha256(pdf_path.read_bytes()).hexdigest()[:16]


def _cache_candidates_for_pdf(pdf_path: Path) -> list[Path]:
    prefix = _pdf_hash_prefix(pdf_path)
    patterns = [
        f"univ_*_{prefix}_p*.json",
        f"vision_*_{prefix}_p*.json",
    ]
    files: list[Path] = []
    for pattern in patterns:
        files.extend(sorted(CACHE_DIR.glob(pattern)))
    return files


def _extract_text_from_cached_item(item: dict[str, Any]) -> str:
    return (
        str(item.get("question_text") or "").strip()
        or str(item.get("question") or "").strip()
    )


def _load_cache_question_map(pdf_path: Path) -> dict[int, str]:
    best: dict[int, str] = {}
    for cache_file in _cache_candidates_for_pdf(pdf_path):
        try:
            data = json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, list):
            continue
        for item in data:
            if not isinstance(item, dict):
                continue
            qn = item.get("question_number")
            if not isinstance(qn, int):
                continue
            text = _extract_text_from_cached_item(item)
            if len(text) > len(best.get(qn, "")):
                best[qn] = text
    return best


def _load_pdf_question_map(pdf_path: Path) -> dict[int, str]:
    try:
        doc = fitz.open(pdf_path)
    except Exception:
        return {}

    pages: list[str] = []
    try:
        for page in doc:
            text = page.get_text("text").strip()
            if text:
                pages.append(text)
    finally:
        doc.close()

    if not pages:
        return {}

    try:
        questions = parse_questions_local(pages)
    except Exception:
        return {}

    best: dict[int, str] = {}
    for item in questions:
        qn = item.get("question_number")
        text = str(item.get("question_text") or "").strip()
        if isinstance(qn, int) and text and len(text) > len(best.get(qn, "")):
            best[qn] = text
    return best


def _looks_truncated(current_text: str, cached_text: str) -> bool:
    current = _norm(current_text)
    cached = _norm(cached_text)
    if not current or not cached:
        return False
    if current == cached:
        return False
    if len(cached) < len(current) + 30:
        return False
    if current in cached:
        return True

    current_compact = current.replace(" ", "")
    cached_compact = cached.replace(" ", "")
    if current_compact and current_compact in cached_compact and len(cached_compact) > len(current_compact) + 40:
        return True

    prefix_len = min(len(current), len(cached), 80)
    if prefix_len >= 30 and current[:prefix_len] == cached[:prefix_len] and len(cached) > len(current) + 40:
        return True
    return False


def _fetch_questions(exam_name: str | None, exam_year: int | None) -> list[dict[str, Any]]:
    offset = 0
    rows: list[dict[str, Any]] = []
    while True:
        q = (
            supabase.table("questions")
            .select("id,exam_name,exam_year,source_pdf,question_number,question_text,option_a,option_b,option_c,option_d,correct_answer,needs_review,is_active")
            .not_.is_("source_pdf", "null")
            .range(offset, offset + 999)
        )
        if exam_name:
            q = q.eq("exam_name", exam_name)
        if exam_year is not None:
            q = q.eq("exam_year", exam_year)
        res = q.execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def audit_rows(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    by_source: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        source_pdf = row.get("source_pdf")
        if source_pdf and isinstance(row.get("question_number"), int):
            by_source[source_pdf].append(row)

    recoveries: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    exams = Counter()
    missing_pdfs = Counter()
    missing_caches = Counter()
    fuzzy_pdf_matches = Counter()
    recovered_from_cache = Counter()
    recovered_from_pdf = Counter()

    for source_pdf, source_rows in by_source.items():
        pdf_path = _find_local_pdf(source_pdf)
        matched_by = "source_pdf"
        if not pdf_path and source_rows:
            pdf_path = _find_pdf_by_exam(source_rows[0])
            matched_by = "exam_guess" if pdf_path else "missing"
        if not pdf_path:
            for row in source_rows:
                missing_pdfs[f"{row['exam_name']} {row['exam_year']}"] += 1
            continue

        if matched_by == "exam_guess":
            for row in source_rows:
                fuzzy_pdf_matches[f"{row['exam_name']} {row['exam_year']}"] += 1

        cache_map = _load_cache_question_map(pdf_path)
        pdf_map: dict[int, str] = {}
        if not cache_map:
            for row in source_rows:
                missing_caches[f"{row['exam_name']} {row['exam_year']}"] += 1
            pdf_map = _load_pdf_question_map(pdf_path)

        for row in source_rows:
            qn = row["question_number"]
            cached_text = cache_map.get(qn)
            source_kind = "cache"
            if not cached_text:
                cached_text = pdf_map.get(qn)
                source_kind = "pdf"
            if not cached_text:
                unresolved.append(row)
                continue
            current_text = str(row.get("question_text") or "")
            if _looks_truncated(current_text, cached_text):
                exam_key = f"{row['exam_name']} {row['exam_year']}"
                exams[exam_key] += 1
                if source_kind == "cache":
                    recovered_from_cache[exam_key] += 1
                else:
                    recovered_from_pdf[exam_key] += 1
                recoveries.append({
                    "id": row["id"],
                    "exam_name": row.get("exam_name"),
                    "exam_year": row.get("exam_year"),
                    "question_number": qn,
                    "source_pdf": source_pdf,
                    "matched_pdf": str(pdf_path),
                    "source_kind": source_kind,
                    "old_text": current_text,
                    "new_text": cached_text,
                })

    summary = {
        "total_rows_scanned": len(rows),
        "recoverable": len(recoveries),
        "recoverable_by_exam": dict(exams),
        "recoverable_from_cache_by_exam": dict(recovered_from_cache),
        "recoverable_from_pdf_by_exam": dict(recovered_from_pdf),
        "fuzzy_pdf_match_by_exam": dict(fuzzy_pdf_matches),
        "missing_local_pdf_by_exam": dict(missing_pdfs),
        "missing_cache_by_exam": dict(missing_caches),
        "unresolved_with_number": len(unresolved),
    }
    return recoveries, summary


def apply_recoveries(recoveries: list[dict[str, Any]]) -> dict[str, Any]:
    restored = 0
    failed: list[dict[str, Any]] = []

    for item in recoveries:
        qid = item["id"]
        try:
            qr = supabase.table("questions").select("*").eq("id", qid).single().execute()
            current = qr.data
            if not current:
                failed.append({"id": qid, "reason": "missing-question"})
                continue

            patch = {
                "question_text": item["new_text"],
                "needs_review": True,
            }
            if "explanation_status" in current:
                patch["explanation_status"] = "missing"
            merged = merge_quality_fields(
                current,
                patch,
                explanation_present=False,
                explanation_contradiction=False,
            )
            update_row = dict(patch)
            for key in ("structural_status", "answer_status", "explanation_status", "public_visibility", "primary_issue_code", "issue_codes"):
                if key in current:
                    update_row[key] = merged[key]

            supabase.table("explanations").delete().eq("question_id", qid).execute()
            supabase.table("questions").update(update_row).eq("id", qid).execute()
            restored += 1
        except Exception as e:
            failed.append({"id": qid, "reason": str(e)})

    return {
        "restored": restored,
        "failed": failed,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exam-name")
    parser.add_argument("--exam-year", type=int)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    rows = _fetch_questions(args.exam_name, args.exam_year)
    recoveries, summary = audit_rows(rows)
    print(json.dumps(summary, indent=2, ensure_ascii=False))

    if recoveries:
        preview = [
            {
                "exam": f"{r['exam_name']} {r['exam_year']}",
                "question_number": r["question_number"],
                "old_len": len(r["old_text"]),
                "new_len": len(r["new_text"]),
                "source_pdf": r["source_pdf"],
                "matched_pdf": r["matched_pdf"],
                "source_kind": r["source_kind"],
            }
            for r in recoveries[:25]
        ]
        print(json.dumps({"preview": preview}, indent=2, ensure_ascii=False))

    if args.apply:
        result = apply_recoveries(recoveries)
        print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
