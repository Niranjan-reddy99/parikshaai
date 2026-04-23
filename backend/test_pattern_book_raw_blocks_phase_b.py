import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extractor.pattern_book_raw_blocks import (
    OCRLine,
    audit_raw_question_block,
    build_phase_c_readiness_audit,
    isolate_options_from_raw_block,
    _prepare_question_anchor_lines,
    _stabilize_blocks_by_question_number,
    _mixed_block_kind,
    extract_question_blocks_from_lines,
    extract_solution_blocks_from_lines,
)


class PatternBookRawBlocksTests(unittest.TestCase):
    def test_question_block_boundary_detection(self):
        lines = [
            OCRLine("1) A number is increased by 20%.", 10, 10, 100, 20),
            OCRLine("A) 10 B) 20 C) 30 D) 40", 12, 25, 140, 35),
            OCRLine("2) Find the percentage change.", 10, 50, 120, 60),
            OCRLine("A) 1 B) 2 C) 3 D) 4", 12, 65, 130, 75),
        ]
        blocks = extract_question_blocks_from_lines(lines, page_number=1, detected_pattern_heading="PERCENTAGES")
        self.assertEqual(len(blocks), 2)
        self.assertEqual(blocks[0]["question_number_raw"], "1")
        self.assertEqual(blocks[1]["question_number_raw"], "2")

    def test_no_paraphrasing_of_raw_question_text(self):
        lines = [
            OCRLine("1) A number is increased by 20%.", 10, 10, 100, 20),
            OCRLine("A) 10 B) 20 C) 30 D) 40", 12, 25, 140, 35),
        ]
        blocks = extract_question_blocks_from_lines(lines, page_number=1, detected_pattern_heading=None)
        self.assertIn("A number is increased by 20%.", blocks[0]["raw_block_text"])
        self.assertIn("A) 10 B) 20 C) 30 D) 40", blocks[0]["raw_block_text"])

    def test_solution_block_extraction(self):
        lines = [
            OCRLine("56. Area of rectangle = l x b", 10, 10, 120, 20),
            OCRLine("% Change = 23.04%", 12, 25, 120, 35),
            OCRLine("57. Another solution begins", 10, 50, 120, 60),
        ]
        blocks = extract_solution_blocks_from_lines(lines, page_number=21)
        self.assertEqual(len(blocks), 2)
        self.assertEqual(blocks[0]["resolved_question_number"], "56")
        self.assertTrue(blocks[0]["has_formula"])

    def test_mixed_pages_can_be_safely_withheld(self):
        # Phase B safety rule is represented by not calling question/solution extractors on mixed pages.
        # Here we just assert the helpers are pure line-based functions and do not create canonical writes.
        lines = [
            OCRLine("Type 3", 10, 10, 100, 20),
            OCRLine("1) Find the percentage profit.", 10, 30, 150, 40),
            OCRLine("Sol. 1: Profit% = gain/cost x 100", 10, 50, 180, 60),
        ]
        question_blocks = extract_question_blocks_from_lines(lines, page_number=19, detected_pattern_heading="Type 3")
        self.assertEqual(len(question_blocks), 1)
        self.assertNotIn("questions", question_blocks[0])

    def test_no_accidental_canonical_question_writes_shape(self):
        lines = [
            OCRLine("1) Sample question", 10, 10, 100, 20),
            OCRLine("A) x B) y C) z D) w", 12, 25, 140, 35),
        ]
        block = extract_question_blocks_from_lines(lines, page_number=1, detected_pattern_heading=None)[0]
        self.assertNotIn("correct_answer", block)
        self.assertNotIn("subject", block)
        self.assertIn("raw_block_text", block)
        self.assertIn("bbox", block)

    def test_noisy_numeric_token_suppression(self):
        lines = [
            OCRLine("11. (b) 12. (a) 13. (d) 14. (c)", 10, 10, 220, 20),
            OCRLine("15. (a) 16. (b) 17. (c) 18. (d)", 10, 30, 220, 40),
        ]
        prepared, suppressed, recovered = _prepare_question_anchor_lines(lines)
        self.assertEqual(len(prepared), 0)
        self.assertGreaterEqual(suppressed, 2)
        self.assertGreaterEqual(recovered, 2)

    def test_anchor_ordering_consistency(self):
        blocks = [
            {"question_number_raw": "84", "bbox": {"y0": 100, "x0": 400}},
            {"question_number_raw": "78", "bbox": {"y0": 120, "x0": 100}},
            {"question_number_raw": "79", "bbox": {"y0": 180, "x0": 120}},
        ]
        fixed, notes = _stabilize_blocks_by_question_number(blocks)
        self.assertEqual([b["question_number_raw"] for b in fixed], ["78", "79", "84"])
        self.assertIn("reordered_by_question_number", notes)

    def test_anchor_recovery_on_dense_line(self):
        lines = [
            OCRLine("118. A’s income is equal to 125% | 126. Monthly salary of Jitvik | 135. The population of a village", 10, 10, 600, 20),
        ]
        prepared, suppressed, recovered = _prepare_question_anchor_lines(lines)
        texts = [line.text for line in prepared]
        self.assertGreaterEqual(recovered, 2)
        self.assertEqual(len(texts), 3)
        self.assertTrue(texts[0].startswith("118."))
        self.assertTrue(texts[1].startswith("126."))
        self.assertTrue(texts[2].startswith("135."))

    def test_mixed_block_question_classification(self):
        lines = [
            OCRLine("145. What is the percentage increase?", 10, 10, 180, 20),
            OCRLine("A) 10% B) 20% C) 30% D) 40%", 10, 30, 220, 40),
        ]
        kind, confidence, reasons = _mixed_block_kind(lines)
        self.assertEqual(kind, "question_block")
        self.assertGreaterEqual(confidence, 0.78)
        self.assertIn("question_anchor", reasons)

    def test_mixed_block_solution_classification(self):
        lines = [
            OCRLine("Sol. 145. Ratio method:", 10, 10, 180, 20),
            OCRLine("Required % = 25 x 100 / 80", 10, 30, 220, 40),
        ]
        kind, confidence, reasons = _mixed_block_kind(lines)
        self.assertEqual(kind, "solution_block")
        self.assertGreaterEqual(confidence, 0.8)
        self.assertIn("solution_anchor", reasons)

    def test_readiness_audit_ready_block(self):
        block = {
            "page_number": 1,
            "raw_block_text": "145. What is the percentage increase?\nA) 10%\nB) 20%\nC) 30%\nD) 40%",
            "question_number_raw": "145",
            "raw_options_text": "A) 10%\nB) 20%\nC) 30%\nD) 40%",
            "extraction_confidence": 0.9,
            "merged_question_risk": False,
            "boundary_detection_note": "line_anchor_split",
            "line_count": 5,
        }
        audit = audit_raw_question_block(block)
        self.assertEqual(audit["status"], "ready_for_phase_c")
        self.assertNotIn("option_incomplete", audit["failure_reasons"])
        self.assertNotIn("strong_solution_leakage", audit["failure_reasons"])

    def test_readiness_audit_withholds_leaky_mixed_block(self):
        block = {
            "page_number": 19,
            "raw_block_text": "145. Find the percentage.\nSol. Ratio method: 25 x 100 / 80",
            "question_number_raw": "145",
            "raw_options_text": "",
            "extraction_confidence": 0.62,
            "merged_question_risk": False,
            "boundary_detection_note": "mixed_page_candidate_split",
            "line_count": 2,
            "source_page_type": "mixed_special_page",
            "mixed_block_confidence": 0.55,
        }
        audit = audit_raw_question_block(block)
        self.assertEqual(audit["status"], "withhold_for_now")
        self.assertIn("strong_solution_leakage", audit["failure_reasons"])

    def test_phase_c_readiness_audit_summary(self):
        report = {
            "page_count": 3,
            "summary": {"low_confidence_pages": [2]},
            "question_blocks": [
                {
                    "page_number": 1,
                    "raw_block_text": "1. Good block\nA) 1\nB) 2\nC) 3\nD) 4",
                    "question_number_raw": "1",
                    "raw_options_text": "A) 1\nB) 2\nC) 3\nD) 4",
                    "extraction_confidence": 0.92,
                    "merged_question_risk": False,
                    "boundary_detection_note": "line_anchor_split",
                    "line_count": 5,
                },
                {
                    "page_number": 2,
                    "raw_block_text": "2. Mixed block\nSol. shortcut 25 x 100 / 80",
                    "question_number_raw": "2",
                    "raw_options_text": "",
                    "extraction_confidence": 0.6,
                    "merged_question_risk": False,
                    "boundary_detection_note": "mixed_page_candidate_split",
                    "line_count": 2,
                    "source_page_type": "mixed_special_page",
                    "mixed_block_confidence": 0.6,
                },
            ],
            "mixed_pages": [{"page_number": 3, "note": "withheld page"}],
            "mixed_pages_processed": [{"page_number": 2, "question_blocks_recovered": 1, "solution_blocks_discarded": 2, "low_confidence": True}],
        }
        audit = build_phase_c_readiness_audit(report)
        self.assertEqual(audit["total_raw_blocks"], 2)
        self.assertEqual(audit["ready_for_phase_c_count"], 1)
        self.assertEqual(audit["withhold_for_now_count"], 1)
        page_summaries = {row["page_number"]: row for row in audit["page_readiness_summary"]}
        self.assertEqual(page_summaries[1]["page_readiness"], "ready_for_phase_c")
        self.assertEqual(page_summaries[2]["page_readiness"], "withhold_for_now")
        self.assertEqual(page_summaries[3]["page_readiness"], "withhold_for_now")
        self.assertIn("strong_solution_leakage", audit["top_failure_reason_counts"])

    def test_option_anchor_detection_and_stem_separation(self):
        block = {
            "raw_block_text": "145. What is the percentage increase?\n(a) 10%\n(b) 20%\n(c) 30%\n(d) 40%"
        }
        isolated = isolate_options_from_raw_block(block)
        self.assertTrue(isolated["stem_extracted"])
        self.assertEqual(isolated["options_recovered_count"], 4)
        self.assertEqual(list(isolated["options"].keys()), ["A", "B", "C", "D"])
        self.assertGreaterEqual(isolated["option_isolation_confidence"], 0.85)

    def test_wrapped_option_recovery(self):
        block = {
            "raw_block_text": "210. Choose the correct option\nA. first option continues\non the next line\nB. second option\nC. third option\nD. fourth option"
        }
        isolated = isolate_options_from_raw_block(block)
        self.assertEqual(isolated["options_recovered_count"], 4)
        self.assertIn("next line", isolated["options"]["A"])
        self.assertIn("wrapped_option_line", isolated["isolation_notes"])

    def test_uncertain_option_isolation_stays_withheld(self):
        block = {
            "page_number": 5,
            "raw_block_text": "88. (a) 25% (b) maybe",
            "question_number_raw": "88",
            "raw_options_text": "",
            "extraction_confidence": 0.7,
            "merged_question_risk": False,
            "boundary_detection_note": "line_anchor_split",
            "line_count": 1,
        }
        audit = audit_raw_question_block(block)
        self.assertEqual(audit["status"], "withhold_for_now")
        self.assertIn("option_isolation_low_confidence", audit["failure_reasons"])
        self.assertLess(audit["option_isolation_confidence"], 0.72)


if __name__ == "__main__":
    unittest.main()
