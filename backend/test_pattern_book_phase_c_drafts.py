import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extractor.pattern_book_phase_c_drafts import build_pattern_book_normalized_draft


class PatternBookPhaseCDraftTests(unittest.TestCase):
    def test_only_ready_blocks_are_normalized(self):
        report = {
            "pdf_path": "/tmp/ssc.pdf",
            "page_count": 2,
            "summary": {},
            "question_blocks": [
                {
                    "page_number": 1,
                    "raw_block_text": "1. What is 10% of 200?\nA. 10\nB. 20\nC. 30\nD. 40",
                    "question_number_raw": "1",
                    "raw_options_text": "",
                    "extraction_confidence": 0.9,
                    "boundary_detection_note": "line_anchor_split",
                    "detected_pattern_heading": "Percentages",
                    "bbox": {"x0": 10, "y0": 10, "x1": 100, "y1": 100},
                },
                {
                    "page_number": 1,
                    "raw_block_text": "2. Broken block\nSol. shortcut",
                    "question_number_raw": "2",
                    "raw_options_text": "",
                    "extraction_confidence": 0.6,
                    "boundary_detection_note": "mixed_page_candidate_split",
                    "source_page_type": "mixed_special_page",
                    "mixed_block_confidence": 0.55,
                    "bbox": {"x0": 10, "y0": 110, "x1": 100, "y1": 200},
                },
            ],
            "phase_c_readiness_audit": {
                "ready_for_phase_c_count": 1,
                "needs_manual_review_count": 0,
                "withhold_for_now_count": 1,
                "block_readiness": [
                    {"page_number": 1, "question_number_raw": "1", "status": "ready_for_phase_c"},
                    {"page_number": 1, "question_number_raw": "2", "status": "withhold_for_now"},
                ],
            },
        }
        out = build_pattern_book_normalized_draft(report, write_report=False)
        self.assertEqual(out["summary"]["blocks_considered_for_normalization"], 1)
        self.assertEqual(out["summary"]["normalized_blocks_count"], 1)
        self.assertEqual(len(out["normalized_questions"]), 1)
        self.assertEqual(out["normalized_questions"][0]["question_number"], 1)

    def test_normalized_question_shape_and_source_refs(self):
        report = {
            "pdf_path": "/tmp/ssc.pdf",
            "page_count": 1,
            "summary": {},
            "question_blocks": [
                {
                    "page_number": 3,
                    "raw_block_text": "145. What is the percentage increase?\n(a) 10%\n(b) 20%\n(c) 30%\n(d) 40%",
                    "question_number_raw": "145",
                    "raw_options_text": "",
                    "extraction_confidence": 0.88,
                    "boundary_detection_note": "line_anchor_split",
                    "source_page_type": "question_page",
                    "detected_pattern_heading": "Chapter - 1: Percentage",
                    "bbox": {"x0": 12, "y0": 20, "x1": 300, "y1": 220},
                }
            ],
            "phase_c_readiness_audit": {
                "ready_for_phase_c_count": 1,
                "needs_manual_review_count": 0,
                "withhold_for_now_count": 0,
                "block_readiness": [
                    {"page_number": 3, "question_number_raw": "145", "status": "ready_for_phase_c"},
                ],
            },
        }
        out = build_pattern_book_normalized_draft(report, write_report=False)
        q = out["normalized_questions"][0]
        self.assertEqual(q["question_number"], 145)
        self.assertEqual(q["question_text"], "What is the percentage increase?")
        self.assertEqual(q["option_a"], "10%")
        self.assertEqual(q["option_b"], "20%")
        self.assertEqual(q["option_c"], "30%")
        self.assertEqual(q["option_d"], "40%")
        self.assertEqual(q["source_page_number"], 3)
        self.assertTrue(q["source_block_id"].startswith("p3_q145_"))
        self.assertEqual(q["source_page_type"], "question_page")

    def test_no_public_or_canonical_fields_added(self):
        report = {
            "pdf_path": "/tmp/ssc.pdf",
            "page_count": 1,
            "summary": {},
            "question_blocks": [
                {
                    "page_number": 1,
                    "raw_block_text": "1. Sample?\nA. one\nB. two\nC. three\nD. four",
                    "question_number_raw": "1",
                    "raw_options_text": "",
                    "extraction_confidence": 0.91,
                    "boundary_detection_note": "line_anchor_split",
                    "bbox": {"x0": 1, "y0": 2, "x1": 3, "y1": 4},
                }
            ],
            "phase_c_readiness_audit": {
                "ready_for_phase_c_count": 1,
                "needs_manual_review_count": 0,
                "withhold_for_now_count": 0,
                "block_readiness": [
                    {"page_number": 1, "question_number_raw": "1", "status": "ready_for_phase_c"},
                ],
            },
        }
        out = build_pattern_book_normalized_draft(report, write_report=False)
        q = out["normalized_questions"][0]
        self.assertNotIn("correct_answer", q)
        self.assertNotIn("public_visibility", q)
        self.assertNotIn("subject", q)
        self.assertNotIn("explanation", q)


if __name__ == "__main__":
    unittest.main()
