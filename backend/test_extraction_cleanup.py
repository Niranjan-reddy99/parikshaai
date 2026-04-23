import unittest

from extraction_cleanup import clean_and_dedupe_questions, clean_extracted_question


def _question(**overrides):
    base = {
        "question_number": 7,
        "question_text": "Which one of the following is correct?",
        "option_a": "Alpha",
        "option_b": "Beta",
        "option_c": "Gamma",
        "option_d": "Delta",
        "correct_answer": "",
        "needs_review": True,
    }
    base.update(overrides)
    return base


class ExtractionCleanupTests(unittest.TestCase):
    def test_prefers_english_row_over_hindi_duplicate(self):
        rows = [
            _question(
                question_text="निम्नलिखित में से कौन-सा सही है ?",
                option_a="क",
                option_b="ख",
                option_c="ग",
                option_d="घ",
            ),
            _question(),
        ]
        deduped = clean_and_dedupe_questions(rows)
        self.assertEqual(len(deduped), 1)
        self.assertEqual(deduped[0]["question_text"], "Which one of the following is correct?")

    def test_prefers_real_mcq_over_instruction_duplicate(self):
        rows = [
            _question(
                question_text="Before you proceed to mark in the Answer Sheet the response to various items in the Test Booklet, you have to fill in some particulars.",
                option_a="",
                option_b="",
                option_c="",
                option_d="",
            ),
            _question(),
        ]
        deduped = clean_and_dedupe_questions(rows)
        self.assertEqual(len(deduped), 1)
        self.assertEqual(deduped[0]["option_a"], "Alpha")

    def test_strips_regional_script_from_mixed_text(self):
        cleaned = clean_extracted_question(
            _question(
                question_text="Earth rotates around its axis. पृथ्वी अपनी धुरी पर घूमती है।",
                option_a="24 hours चौबीस घंटे",
                option_b="12 hours",
                option_c="48 hours",
                option_d="7 days",
            )
        )
        self.assertIsNotNone(cleaned)
        self.assertNotIn("पृथ्वी", cleaned["question_text"])
        self.assertNotIn("चौबीस", cleaned["option_a"])


if __name__ == "__main__":
    unittest.main()
