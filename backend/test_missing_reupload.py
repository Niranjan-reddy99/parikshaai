import unittest
from unittest.mock import patch
from types import SimpleNamespace

import main
import papers


class MissingReuploadTests(unittest.TestCase):
    @patch.object(main, "_question_rows_for_exam")
    def test_missing_numbers_uses_expected_count_tail(self, mock_rows):
        mock_rows.return_value = [
            {"question_number": 1},
            {"question_number": 2},
            {"question_number": 4},
            {"question_number": 5},
        ]
        missing = main._missing_question_numbers_for_exam("Demo Exam", 2024, expected_count=6)
        self.assertEqual(missing, [3, 6])

    @patch.object(main, "_question_rows_for_exam")
    def test_missing_numbers_empty_when_no_numbered_rows(self, mock_rows):
        mock_rows.return_value = [{"question_number": None}, {"question_number": 0}]
        missing = main._missing_question_numbers_for_exam("Demo Exam", 2024, expected_count=0)
        self.assertEqual(missing, [])

    @patch.object(papers, "refresh_paper_publish_state")
    @patch.object(papers, "ensure_paper_for_upload")
    @patch.object(papers, "get_latest_paper_for_exam")
    def test_ensure_paper_for_existing_exam_backfills_legacy_rows(
        self,
        mock_latest,
        mock_ensure_upload,
        mock_refresh,
    ):
        mock_latest.return_value = None
        mock_ensure_upload.return_value = {"id": "paper-123"}

        class _FakeTable:
            def __init__(self, name):
                self.name = name
                self.updated_payload = None
                self.filters = []

            def select(self, *_args, **_kwargs):
                return self

            def eq(self, key, value):
                self.filters.append((key, value))
                return self

            def limit(self, *_args, **_kwargs):
                return self

            def update(self, payload):
                self.updated_payload = payload
                return self

            def execute(self):
                if self.name == "questions" and self.updated_payload is None:
                    return SimpleNamespace(data=[{"id": "q1"}], count=1)
                return SimpleNamespace(data=[{"id": "q1"}], count=1)

        class _FakeSB:
            def __init__(self):
                self.tables = {}

            def table(self, name):
                self.tables.setdefault(name, _FakeTable(name))
                return self.tables[name]

        fake_sb = _FakeSB()
        paper = papers.ensure_paper_for_existing_exam(
            "Demo Exam",
            2024,
            source_filename="demo.pdf",
            source_file_hash="abc",
            source_pdf_path="/tmp/demo.pdf",
            extractor_type="scanned",
            sb=fake_sb,
        )

        self.assertEqual(paper, {"id": "paper-123"})
        self.assertEqual(fake_sb.tables["questions"].updated_payload, {"paper_id": "paper-123"})
        mock_refresh.assert_called_once_with("paper-123", sb=fake_sb)


if __name__ == "__main__":
    unittest.main()
