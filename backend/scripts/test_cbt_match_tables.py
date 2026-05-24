import json
import unittest

from extractor import cbt_pipeline


class TCSIONMatchTableTests(unittest.TestCase):
    def test_normalize_tcsion_match_question_uses_structured_arrays(self):
        item = {
            "question_type": "match",
            "match_left": ["Sharath Kamal", "Nikhat Zareen", "Lakshya Sen", "Seema Punia"],
            "match_right": ["Discus throw", "Badminton", "Table tennis", "Boxing"],
        }
        text, q_type = cbt_pipeline._normalize_tcsion_match_question(
            item,
            "Match the following athletes with their respective sports:",
        )
        self.assertEqual(q_type, "Match")
        self.assertIn("__MATCH__:", text)
        payload = json.loads(text.split("\n\n__MATCH__:", 1)[1])
        self.assertEqual(payload["col1"][0], "Sharath Kamal")
        self.assertEqual(payload["col2"][2], "Table tennis")

    def test_normalize_tcsion_match_question_falls_back_to_inline_recovery(self):
        item = {"question_type": "match"}
        flat = (
            "Match the following athletes with their respective sports:\n"
            "A. Sharath Kamal    1. Discus throw\n"
            "B. Nikhat Zareen    2. Badminton\n"
            "C. Lakshya Sen      3. Table tennis\n"
            "D. Seema Punia      4. Boxing"
        )
        text, q_type = cbt_pipeline._normalize_tcsion_match_question(item, flat)
        self.assertEqual(q_type, "Match")
        self.assertIn("__MATCH__:", text)


if __name__ == "__main__":
    unittest.main()
