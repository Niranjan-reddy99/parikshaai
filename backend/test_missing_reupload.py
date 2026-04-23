import unittest
from unittest.mock import patch

import main


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


if __name__ == "__main__":
    unittest.main()
