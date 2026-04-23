import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extractor.pattern_book_classifier import (
    PageSnapshot,
    VisionSnapshot,
    classify_page_snapshot,
    resolve_page_classification,
)


def _snapshot(
    text: str,
    *,
    page_number: int = 1,
    top_text: str | None = None,
    block_x_positions: list[float] | None = None,
    image_count: int = 0,
    drawing_count: int = 0,
):
    return PageSnapshot(
        page_number=page_number,
        raw_text=text,
        top_text=top_text if top_text is not None else text,
        block_x_positions=block_x_positions or [72.0, 78.0, 84.0],
        image_count=image_count,
        drawing_count=drawing_count,
        text_block_count=len(block_x_positions or [72.0, 78.0, 84.0]),
    )


class PatternBookClassifierTests(unittest.TestCase):
    def test_answer_key_page_detection(self):
        snapshot = _snapshot(
            "Answer Key\n1-A 2-C 3-B 4-D 5-A 6-B 7-C 8-D 9-A 10-B 11-C 12-D"
        )
        result = classify_page_snapshot(snapshot)
        self.assertEqual(result.page_type, "answer_key_page")
        self.assertGreaterEqual(result.classification_confidence, 0.8)

    def test_solution_page_detection(self):
        snapshot = _snapshot(
            "Solutions\nSol. 1: Percentage increase = 25%.\nShortcut method: multiply by 4/5.\n"
            "Solution 2: Therefore answer is 60."
        )
        result = classify_page_snapshot(snapshot)
        self.assertEqual(result.page_type, "solution_page")
        self.assertEqual(result.detected_pattern_heading, "Solutions")

    def test_question_page_detection(self):
        snapshot = _snapshot(
            "PERCENTAGES\n"
            "1) A number is increased by 20%. What is the new value?\n"
            "A) 96 B) 108 C) 120 D) 144\n"
            "2) If x increases by 25%, find the result.\n"
            "A) 10 B) 20 C) 30 D) 40",
            top_text="PERCENTAGES\nType 1",
            block_x_positions=[72.0, 76.0, 80.0, 86.0],
        )
        result = classify_page_snapshot(snapshot)
        self.assertEqual(result.page_type, "question_page")
        self.assertEqual(result.detected_pattern_heading, "PERCENTAGES")

    def test_mixed_or_noisy_handling(self):
        noisy = _snapshot("@FreemeBhaii\nFREE PDF HALL\nTG @Exams_Pdfss")
        noisy_result = classify_page_snapshot(noisy)
        self.assertEqual(noisy_result.page_type, "ignore_noisy_page")

        mixed = _snapshot(
            "Type 3\n1) Find the percentage profit.\nA) 10 B) 20 C) 30 D) 40\n"
            "Sol. 1: Profit% = gain/cost x 100\nShortcut trick: use ratio form."
        )
        mixed_result = classify_page_snapshot(mixed)
        self.assertEqual(mixed_result.page_type, "mixed_special_page")

    def test_escalates_noisy_page_to_vision(self):
        noisy = _snapshot(
            "@FreemeBhaii\nFREE PDF HALL\nTG @Exams_Pdfss",
            image_count=1,
            drawing_count=12,
            block_x_positions=[],
        )
        result = resolve_page_classification(
            noisy,
            page=None,
            vision_provider=lambda _page: VisionSnapshot(
                raw_text="Chapter - 1: Percentage\n1) Find the value.\nA) 10 B) 20 C) 30 D) 40\n2) ...\nA) 1 B) 2 C) 3 D) 4",
                top_text="Chapter - 1: Percentage",
                layout_type="two_column",
                column_count=2,
                has_diagram=False,
                dark_pixel_ratio=0.11,
            ),
        )
        self.assertTrue(result.escalated_to_vision)
        self.assertEqual(result.classification_source, "vision_only")
        self.assertEqual(result.page_type, "question_page")
        self.assertGreaterEqual(result.vision_confidence, 0.72)

    def test_hybrid_when_text_and_vision_agree(self):
        snapshot = _snapshot(
            "PERCENTAGES\n1) A question\nA) 1 B) 2 C) 3 D) 4\n2) Another question\nA) 5 B) 6 C) 7 D) 8",
            top_text="PERCENTAGES",
            image_count=1,
        )
        result = resolve_page_classification(
            snapshot,
            page=None,
            vision_provider=lambda _page: VisionSnapshot(
                raw_text="Chapter - 1: Percentage\n1) A question\nA) 1 B) 2 C) 3 D) 4\n2) Another question\nA) 5 B) 6 C) 7 D) 8",
                top_text="Chapter - 1: Percentage",
                layout_type="two_column",
                column_count=2,
                has_diagram=False,
                dark_pixel_ratio=0.09,
            ),
        )
        self.assertEqual(result.classification_source, "hybrid")
        self.assertEqual(result.page_type, "question_page")
        self.assertIn("text: question_blocks", " ".join(result.classification_reasons))
        self.assertIn("vision:", " ".join(result.classification_reasons))

    def test_debug_fields_present(self):
        snapshot = _snapshot(
            "@FreemeBhaii\nFREE PDF HALL",
            image_count=1,
            drawing_count=10,
            block_x_positions=[],
        )
        result = resolve_page_classification(
            snapshot,
            page=None,
            vision_provider=lambda _page: VisionSnapshot(
                raw_text="Solutions\nSol. 56: ...\nAlternate Method: ...",
                top_text="Solutions",
                layout_type="single_column",
                column_count=1,
                has_diagram=False,
                dark_pixel_ratio=0.1,
            ),
        )
        self.assertIsInstance(result.classification_reasons, list)
        self.assertIn(result.classification_source, {"text_only", "vision_only", "hybrid"})
        self.assertIsInstance(result.escalated_to_vision, bool)
        self.assertIsInstance(result.text_confidence, float)
        self.assertIsInstance(result.vision_confidence, float)


if __name__ == "__main__":
    unittest.main()
