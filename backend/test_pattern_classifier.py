import unittest

from pattern_classifier import classify_question_rule


class PatternClassifierTests(unittest.TestCase):
    def test_match_the_following_payload(self):
        tag = classify_question_rule({
            "question_text": 'Match the following List-I with List-II. __MATCH__:{"col1":["A"],"col2":["1"]}',
            "option_a": "1-a, 2-b",
            "option_b": "1-b, 2-a",
            "option_c": "1-c, 2-d",
            "option_d": "1-d, 2-c",
        })
        self.assertEqual(tag["pattern_tag"], "match-the-following")
        self.assertEqual(tag["skill_tag"], "analysis")

    def test_statement_based_with_combo_options_uses_elimination(self):
        tag = classify_question_rule({
            "question_text": "Consider the following statements: I. Parliament can amend the Constitution. II. Fundamental Rights are absolute. Which of the above is/are correct?",
            "option_a": "I only",
            "option_b": "II only",
            "option_c": "Both I and II",
            "option_d": "Neither I nor II",
        })
        self.assertEqual(tag["pattern_tag"], "statement-based")
        self.assertEqual(tag["skill_tag"], "elimination")
        self.assertEqual(tag["trap_tag"], "absolute-wording")

    def test_chronology_ordering_question(self):
        tag = classify_question_rule({
            "question_text": "Arrange the following events in chronological order.",
            "option_a": "A, B, C, D",
            "option_b": "B, A, D, C",
            "option_c": "C, D, A, B",
            "option_d": "D, C, B, A",
        })
        self.assertEqual(tag["pattern_tag"], "chronology")
        self.assertIn("Anchor", tag["solve_hint"])

    def test_negation_trap(self):
        tag = classify_question_rule({
            "question_text": "Which of the following is NOT correct about the Vice-President?",
            "option_a": "He is elected by an electoral college.",
            "option_b": "He is ex-officio chairman of Rajya Sabha.",
            "option_c": "He is directly elected by people.",
            "option_d": "He can act as President.",
        })
        self.assertEqual(tag["trap_tag"], "negation")
        self.assertEqual(tag["question_style"], "indirect")

    def test_direct_recall_short_question(self):
        tag = classify_question_rule({
            "question_text": "Country liquor in Andhra Pradesh is brewed from the flowers of",
            "option_a": "Tendu",
            "option_b": "Mahua",
            "option_c": "Neem",
            "option_d": "Bamboo",
        })
        self.assertEqual(tag["pattern_tag"], "factual-recall")
        self.assertEqual(tag["skill_tag"], "recall")

    def test_direct_recall_does_not_treat_all_as_absolute_trap(self):
        tag = classify_question_rule({
            "question_text": "The movement for a united state for all Telugu people was called",
            "option_a": "Vishalandhra movement",
            "option_b": "Jai Andhra movement",
            "option_c": "Separate Telangana movement",
            "option_d": "Mulki movement",
        })
        self.assertEqual(tag["pattern_tag"], "factual-recall")
        self.assertIsNone(tag["trap_tag"])


if __name__ == "__main__":
    unittest.main()
