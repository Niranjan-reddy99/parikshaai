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
        self.assertEqual(tag["pattern_tag"], "statement-elimination")
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

    def test_chronology_beats_option_letter_statement_pattern(self):
        tag = classify_question_rule({
            "question_text": "Arrange the following committees on electoral reforms in India in chronological order : A. Tarkunde Committee B. Dinesh Goswami Committee C. Indrajit Gupta Committee",
            "option_a": "A, B, C",
            "option_b": "B, A, C",
            "option_c": "C, B, A",
            "option_d": "A, C, B",
        })
        self.assertEqual(tag["pattern_tag"], "chronology")

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

    def test_grammar_error_question(self):
        tag = classify_question_rule({
            "question_text": "Identify the part of the sentence that contains a grammatical error.",
            "option_a": "He do not",
            "option_b": "like coffee",
            "option_c": "in the morning",
            "option_d": "No error",
        })
        self.assertEqual(tag["pattern_tag"], "grammar-error-detection")
        self.assertEqual(tag["skill_tag"], "language-usage")
        self.assertEqual(tag["question_style"], "language")

    def test_fill_in_the_blank_question(self):
        tag = classify_question_rule({
            "question_text": "Select the most appropriate option to fill in the blank: He has been working here ___ 2020.",
            "option_a": "for",
            "option_b": "since",
            "option_c": "from",
            "option_d": "by",
        })
        self.assertEqual(tag["pattern_tag"], "fill-in-the-blank")
        self.assertEqual(tag["question_style"], "language")

    def test_fill_blank_beats_general_grammar_wording(self):
        tag = classify_question_rule({
            "question_text": "Select the grammatically correct option to fill in the blank. I don't need to tell you my reasons, ___?",
            "option_a": "do I",
            "option_b": "don't I",
            "option_c": "need I",
            "option_d": "am I",
        })
        self.assertEqual(tag["pattern_tag"], "fill-in-the-blank")

    def test_para_jumble_question(self):
        tag = classify_question_rule({
            "question_text": "Arrange the sentences of a paragraph in a meaningful and coherent order.",
            "option_a": "PQRS",
            "option_b": "QPRS",
            "option_c": "RSPQ",
            "option_d": "SRQP",
        })
        self.assertEqual(tag["pattern_tag"], "para-jumble")
        self.assertEqual(tag["skill_tag"], "sequencing")

    def test_coding_decoding_question(self):
        tag = classify_question_rule({
            "question_text": "In a certain code language, TREE is coded as USFF. How is BOOK coded?",
            "option_a": "CPPL",
            "option_b": "ANNJ",
            "option_c": "CPPK",
            "option_d": "DPPL",
        })
        self.assertEqual(tag["pattern_tag"], "coding-decoding")
        self.assertEqual(tag["question_style"], "reasoning")

    def test_ranking_order_question(self):
        tag = classify_question_rule({
            "question_text": "Ravi is ranked 12th from the top and 18th from the bottom. How many students are there?",
            "option_a": "28",
            "option_b": "29",
            "option_c": "30",
            "option_d": "31",
        })
        self.assertEqual(tag["pattern_tag"], "ranking-order")
        self.assertEqual(tag["trap_tag"], "sequence-confusion")

    def test_gcd_lcm_question(self):
        tag = classify_question_rule({
            "question_text": "Find the LCM of 12, 18 and 24.",
            "option_a": "36",
            "option_b": "48",
            "option_c": "72",
            "option_d": "96",
        })
        self.assertEqual(tag["pattern_tag"], "gcd-lcm-calculation")
        self.assertEqual(tag["skill_tag"], "calculation")

    def test_sex_ratio_is_not_arithmetic_by_keyword_only(self):
        tag = classify_question_rule({
            "question_text": "Which of the following census recorded the lowest sex ratio in India?",
            "subject": "Quantitative Aptitude",
            "topic": "Ratio and Proportion",
            "subtopic": "Sex Ratio",
            "option_a": "1981",
            "option_b": "1991",
            "option_c": "2001",
            "option_d": "2011",
        })
        self.assertEqual(tag["pattern_tag"], "factual-recall")

    def test_scheme_current_affairs_question(self):
        tag = classify_question_rule({
            "question_text": "Which ministry recently launched the PM-SHRI scheme?",
            "option_a": "Ministry of Education",
            "option_b": "Ministry of Finance",
            "option_c": "Ministry of Rural Development",
            "option_d": "Ministry of Home Affairs",
        })
        self.assertEqual(tag["pattern_tag"], "scheme-current-affairs")
        self.assertEqual(tag["question_style"], "direct")


if __name__ == "__main__":
    unittest.main()
