import unittest

from row_quality import derive_quality_fields, infer_issue_codes, merge_quality_fields


def _row(**overrides):
    base = {
        "id": "q1",
        "exam_name": "Sample Exam",
        "exam_year": 2025,
        "question_number": 1,
        "question_text": "This is a valid question text with enough length?",
        "option_a": "Option A",
        "option_b": "Option B",
        "option_c": "Option C",
        "option_d": "Option D",
        "correct_answer": "A",
        "needs_review": False,
        "is_active": True,
        "question_type": "mcq",
        "subject": "Polity",
        "topic": "Fundamental Rights",
        "has_image": False,
        "image_url": None,
    }
    base.update(overrides)
    return base


class RowQualityPhase2Tests(unittest.TestCase):
    def test_valid_verified_row_is_public_and_visible(self):
        quality = derive_quality_fields(_row())
        self.assertEqual(quality["structural_status"], "valid")
        self.assertEqual(quality["answer_status"], "verified")
        self.assertEqual(quality["explanation_status"], "missing")
        self.assertEqual(quality["tagging_status"], "partial")
        self.assertEqual(quality["public_visibility"], "visible")
        self.assertIn("missing-subtopic-tag", quality["issue_codes"])
        self.assertFalse(quality["review_required"])

    def test_needs_review_becomes_ai_inferred_without_structural_break(self):
        quality = derive_quality_fields(_row(needs_review=True))
        self.assertEqual(quality["structural_status"], "valid")
        self.assertEqual(quality["answer_status"], "ai_inferred")
        self.assertIn("answer-review", quality["issue_codes"])

    def test_incomplete_options_become_structural_break_and_hidden(self):
        quality = derive_quality_fields(_row(option_b=""))
        self.assertEqual(quality["structural_status"], "broken")
        self.assertEqual(quality["public_visibility"], "hidden_structural")
        self.assertIn("incomplete-options", quality["issue_codes"])

    def test_explanation_contradiction_marks_explanation_status_only(self):
        quality = derive_quality_fields(_row(), explanation_present=True, explanation_contradiction=True)
        self.assertEqual(quality["explanation_status"], "contradiction")
        self.assertEqual(quality["public_visibility"], "hidden_quality")

    def test_merge_quality_fields_can_promote_answer_status(self):
        merged = merge_quality_fields(_row(needs_review=True), {"needs_review": False, "correct_answer": "B"})
        self.assertEqual(merged["answer_status"], "verified")
        self.assertEqual(merged["structural_status"], "valid")

    def test_match_payload_failure_is_structural_issue(self):
        reasons = infer_issue_codes(_row(question_type="match", question_text="Match the following\n\n__MATCH__:{bad json"))
        self.assertIn("invalid-match-payload", reasons)

    def test_missing_answer_option_is_invalid_and_hidden(self):
        quality = derive_quality_fields(_row(option_a=""))
        self.assertEqual(quality["answer_status"], "invalid")
        self.assertEqual(quality["public_visibility"], "hidden_structural")
        self.assertIn("answer-option-missing", quality["issue_codes"])


if __name__ == "__main__":
    unittest.main()
