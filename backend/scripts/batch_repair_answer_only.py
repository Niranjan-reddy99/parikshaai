"""Batch-repair papers that are mostly blocked by answer review.

Workflow per paper:
1. Validate answers for needs_review rows.
2. Generate any missing explanations.
3. Validate answers again in case explanation sync re-flags rows.
4. Print final quality report.
"""
from __future__ import annotations

from main import _exam_quality_report
from pipeline import generate_explanations_bulk, validate_answers_bulk


TARGETS: list[tuple[str, int]] = [
    ("APPSC GROUP 1 PRELIMS", 2019),
    ("TSPSC GROUP 1 PRELIMS", 2022),
    ("TSPSC AEE GS", 2023),
    ("TSPSC EO GS", 2023),
    ("TSPSC GROUP 3 PAPER 1", 2023),
    ("TSPSC GROUP 4 PAPER 1", 2023),
    ("UPSC CDS 2 GS", 2025),
    ("UPSC CISF AC(EXE) LDCE", 2026),
]


def main() -> None:
    for exam_name, exam_year in TARGETS:
        print("\n" + "=" * 80)
        print(f"[batch] {exam_name} {exam_year}")

        before = _exam_quality_report(exam_name, exam_year)
        print(
            f"[before] publishable={before['publishable']} "
            f"needs_review={before['review']['needs_review']} "
            f"explanations={before['explanations']['generated']}/{before['question_count']}"
        )

        validated_1 = validate_answers_bulk(exam_name, exam_year)
        print(f"[validate-1] {validated_1}")

        generated = generate_explanations_bulk(exam_name, exam_year)
        print(f"[explanations] {generated}")

        validated_2 = validate_answers_bulk(exam_name, exam_year)
        print(f"[validate-2] {validated_2}")

        after = _exam_quality_report(exam_name, exam_year)
        print(
            f"[after] publishable={after['publishable']} "
            f"needs_review={after['review']['needs_review']} "
            f"explanations={after['explanations']['generated']}/{after['question_count']} "
            f"reasons={after['reasons']}"
        )


if __name__ == "__main__":
    main()
