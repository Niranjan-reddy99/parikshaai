import unittest
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

if "google" not in sys.modules:
    google_module = types.ModuleType("google")
    genai_module = types.ModuleType("google.genai")
    genai_module.Client = object
    genai_types_module = types.ModuleType("google.genai.types")
    genai_module.types = genai_types_module
    google_module.genai = genai_module
    sys.modules["google"] = google_module
    sys.modules["google.genai"] = genai_module
    sys.modules["google.genai.types"] = genai_types_module

import main


class _FakeTopicQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def order(self, *_args, **_kwargs):
        return self

    def range(self, *_args, **_kwargs):
        return self

    def execute(self):
        return SimpleNamespace(data=self._rows)


class _FakeTopicSupabase:
    def __init__(self, rows):
        self._rows = rows

    def table(self, _name):
        return _FakeTopicQuery(self._rows)


class TopicBucketQuestionTests(unittest.TestCase):
    def setUp(self):
        main._topic_bucket_cache.clear()

    def test_safe_question_number_sort_value_handles_malformed_values(self):
        self.assertEqual(main._safe_question_number_sort_value(4), 4)
        self.assertEqual(main._safe_question_number_sort_value("12"), 12)
        self.assertEqual(main._safe_question_number_sort_value("Q12"), 10**9)
        self.assertEqual(main._safe_question_number_sort_value(None), 10**9)

    @patch.object(main, "public_row_identity", side_effect=lambda row: (row["id"],))
    @patch.object(main, "_sanitize_public_question_row", side_effect=lambda row: row)
    @patch.object(main, "_apply_public_question_filter", side_effect=lambda query, _cols: query)
    @patch.object(main, "_question_select_clause", return_value="*")
    @patch.object(main, "_question_supported_columns", return_value={"id", "subject", "topic", "exam_name", "exam_year", "question_number"})
    @patch.object(main, "_public_include_all_questions", return_value=True)
    @patch.object(main, "_practice_ready_mode", return_value=False)
    def test_topic_bucket_questions_ignores_malformed_question_numbers_in_sort(
        self,
        _mock_practice_ready,
        _mock_public_all,
        _mock_supported_cols,
        _mock_select_clause,
        _mock_public_filter,
        _mock_sanitize,
        _mock_identity,
    ):
        fake_rows = [
            {
                "id": "bad-qnum",
                "subject": "History",
                "topic": "Modern History",
                "exam_name": "Demo Exam",
                "exam_year": 2024,
                "question_number": "Q12A",
            },
            {
                "id": "good-qnum",
                "subject": "History",
                "topic": "Modern History",
                "exam_name": "Demo Exam",
                "exam_year": 2024,
                "question_number": 3,
            },
        ]

        with patch.object(main, "supabase", _FakeTopicSupabase(fake_rows)):
            result = main._topic_bucket_questions(
                subject="History",
                topic="Modern History",
                admin_mode=False,
                limit=20,
                offset=0,
            )

        self.assertEqual(result["total"], 2)
        self.assertEqual([row["id"] for row in result["questions"]], ["good-qnum", "bad-qnum"])


if __name__ == "__main__":
    unittest.main()
