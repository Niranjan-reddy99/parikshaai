import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fitz

from extractor.pattern_book_gemini_pilot import (
    _extract_json_array,
    extract_pattern_book_question_pages_with_gemini,
    validate_gemini_mcq_object,
)


class PatternBookGeminiPilotTests(unittest.TestCase):
    def test_extract_json_array_from_markdown(self):
        raw = """```json
        [{"question_number": 1, "question_text": "Q", "option_a": "A", "option_b": "B", "option_c": "C", "option_d": "D"}]
        ```"""
        data = _extract_json_array(raw)
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["question_number"], 1)

    def test_validate_gemini_mcq_object(self):
        ok, reasons, normalized = validate_gemini_mcq_object(
            {
                "question_number": "12",
                "question_text": "What is 10% of 50?",
                "option_a": "1",
                "option_b": "5",
                "option_c": "10",
                "option_d": "15",
            }
        )
        self.assertTrue(ok)
        self.assertEqual(reasons, [])
        self.assertEqual(normalized["question_number"], 12)

    def test_invalid_mcq_object_is_reported(self):
        ok, reasons, _ = validate_gemini_mcq_object(
            {
                "question_number": None,
                "question_text": "",
                "option_a": "1",
                "option_b": "",
                "option_c": "3",
                "option_d": "4",
            }
        )
        self.assertFalse(ok)
        self.assertIn("missing_or_invalid_question_number", reasons)
        self.assertIn("empty_question_text", reasons)
        self.assertIn("missing_option_b", reasons)

    def test_only_question_pages_are_processed(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = Path(tmpdir) / "pilot.pdf"
            doc = fitz.open()
            for _ in range(3):
                page = doc.new_page()
                page.insert_text((72, 72), "Sample page")
            doc.save(pdf_path)
            doc.close()

            classification_report = {
                "page_count": 3,
                "counts": {"question_page": 2, "solution_page": 1},
                "pages": [
                    {
                        "page_number": 1,
                        "page_type": "question_page",
                        "detected_pattern_heading": "Percentages",
                        "classification_source": "vision_only",
                        "classification_confidence": 0.9,
                    },
                    {
                        "page_number": 2,
                        "page_type": "solution_page",
                        "detected_pattern_heading": "Percentages",
                        "classification_source": "vision_only",
                        "classification_confidence": 0.88,
                    },
                    {
                        "page_number": 3,
                        "page_type": "question_page",
                        "detected_pattern_heading": "Percentages",
                        "classification_source": "vision_only",
                        "classification_confidence": 0.91,
                    },
                ],
            }

            calls: list[str | None] = []

            def fake_gemini(_img, *, heading=None):
                calls.append(heading)
                if len(calls) == 1:
                    return [
                        {
                            "question_number": 1,
                            "question_text": "What is 10% of 200?",
                            "option_a": "10",
                            "option_b": "20",
                            "option_c": "30",
                            "option_d": "40",
                        }
                    ]
                return [
                    {
                        "question_number": 2,
                        "question_text": "What is 20% of 50?",
                        "option_a": "5",
                        "option_b": "10",
                        "option_c": "15",
                        "option_d": "20",
                    },
                    {
                        "question_number": None,
                        "question_text": "",
                        "option_a": "x",
                        "option_b": "",
                        "option_c": "z",
                        "option_d": "w",
                    },
                ]

            report = extract_pattern_book_question_pages_with_gemini(
                str(pdf_path),
                write_report=False,
                classification_report=classification_report,
                gemini_caller=fake_gemini,
            )
            self.assertEqual(report["summary"]["question_pages_processed"], 2)
            self.assertEqual(report["summary"]["questions_extracted"], 2)
            self.assertEqual(report["summary"]["invalid_question_objects"], 1)
            self.assertEqual(len(report["pages_processed"]), 2)
            self.assertEqual(calls, ["Percentages", "Percentages"])
            self.assertEqual(report["extracted_questions"][0]["source_page_number"], 1)
            self.assertEqual(report["extracted_questions"][1]["source_page_number"], 3)


if __name__ == "__main__":
    unittest.main()
