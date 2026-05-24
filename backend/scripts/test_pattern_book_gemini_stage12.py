import sys
import tempfile
import unittest
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extractor.pattern_book_gemini_stage12 import (
    run_pattern_book_gemini_stage12,
    validate_stage12_question,
)


class PatternBookGeminiStage12Tests(unittest.TestCase):
    def test_validate_stage12_question_valid(self):
        ok, reasons, normalized = validate_stage12_question(
            {
                "question_number": "12",
                "question_text": "What is 10% of 50?",
                "option_a": "1",
                "option_b": "5",
                "option_c": "10",
                "option_d": "15",
            },
            pattern_fallback="Percentages"
        )
        self.assertTrue(ok)
        self.assertEqual(reasons, [])
        self.assertEqual(normalized["question_number"], 12)

    def test_validate_stage12_question_invalid(self):
        ok, reasons, _ = validate_stage12_question(
            {
                "question_number": None,
                "question_text": "",
                "option_a": "x",
                "option_b": "x",
                "option_c": "",
                "option_d": "!",
            },
            pattern_fallback="Percentages"
        )
        self.assertFalse(ok)
        self.assertIn("missing_or_invalid_question_number", reasons)
        self.assertIn("empty_question_text", reasons)
        self.assertIn("duplicate_options", reasons)

    def test_stage12_processes_question_and_mixed_pages_only(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = Path(tmpdir) / "pilot.pdf"
            doc = fitz.open()
            for _ in range(4):
                page = doc.new_page()
                page.insert_text((72, 72), "Sample page")
            doc.save(pdf_path)
            doc.close()

            classification_report = {
                "page_count": 4,
                "counts": {"question_page": 2, "mixed_special_page": 1, "solution_page": 1},
                "pages": [
                    {"page_number": 1, "page_type": "question_page", "detected_pattern_heading": "Percentages", "classification_source": "vision_only", "classification_confidence": 0.9},
                    {"page_number": 2, "page_type": "mixed_special_page", "detected_pattern_heading": "Percentages", "classification_source": "vision_only", "classification_confidence": 0.74},
                    {"page_number": 3, "page_type": "solution_page", "detected_pattern_heading": "Percentages", "classification_source": "vision_only", "classification_confidence": 0.88},
                    {"page_number": 4, "page_type": "question_page", "detected_pattern_heading": "Percentages", "classification_source": "vision_only", "classification_confidence": 0.91},
                ],
            }

            calls: list[tuple[str, str | None]] = []

            def fake_gemini(_img, *, heading=None, current_pattern=None, page_type="question_page"):
                calls.append((page_type, heading))
                if page_type == "mixed_special_page":
                    return [
                        {
                            "question_number": 55,
                            "question_text": "Mixed page question?",
                            "option_a": "A1",
                            "option_b": "B1",
                            "option_c": "C1",
                            "option_d": "D1",
                        },
                        {
                            "question_number": None,
                            "question_text": "",
                            "option_a": "bad",
                            "option_b": "",
                            "option_c": "bad",
                            "option_d": "!",
                        },
                    ]
                return [
                    {
                        "question_number": 1 if len(calls) == 1 else 99,
                        "question_text": "Question text?",
                        "option_a": "A",
                        "option_b": "B",
                        "option_c": "C",
                        "option_d": "D",
                    }
                ]

            report = run_pattern_book_gemini_stage12(
                str(pdf_path),
                write_report=False,
                classification_report=classification_report,
                gemini_caller=fake_gemini,
            )
            self.assertEqual(report["summary"]["pages_processed"], 3)
            self.assertEqual(report["summary"]["total_questions_extracted"], 4)
            self.assertEqual(report["summary"]["valid_extracted_questions"], 3)
            self.assertEqual(report["summary"]["review_bucket_count"], 1)
            self.assertEqual([page["page_number"] for page in report["pages_processed"]], [1, 2, 4])
            self.assertEqual(calls, [
                ("question_page", "Percentages"),
                ("mixed_special_page", "Percentages"),
                ("question_page", "Percentages"),
            ])
            self.assertEqual(len(report["valid_questions"]), 3)
            self.assertEqual(report["review_bucket"][0]["page_type"], "mixed_special_page")


if __name__ == "__main__":
    unittest.main()
