import unittest

from canonical_taxonomy import derive_canonical_taxonomy


class CanonicalTaxonomyTests(unittest.TestCase):
    def test_newtons_law_question_forces_general_science_mechanics(self):
        result = derive_canonical_taxonomy(
            "International Relations",
            "Diplomacy",
            "Which one among the following statements qualitatively explains the second law of motion? The rate of change of momentum of a body is equal to the applied force.",
        )
        self.assertEqual(result["canonical_subject"], "Science & Technology")
        self.assertEqual(result["canonical_topic_family"], "Mechanics")

    def test_carrom_inertia_question_forces_general_science_mechanics(self):
        result = derive_canonical_taxonomy(
            "International Relations",
            "Bilateral Relations",
            "A fast-moving carrom striker displaces only the bottom carrom coin from the carrom coin pile.",
        )
        self.assertEqual(result["canonical_subject"], "Science & Technology")
        self.assertEqual(result["canonical_topic_family"], "Mechanics")

    def test_telescope_lens_question_forces_general_science_optics(self):
        result = derive_canonical_taxonomy(
            "General Knowledge",
            "General",
            "In a simple astronomical telescope, the objective and the eyepiece used respectively are convergent lenses.",
        )
        self.assertEqual(result["canonical_subject"], "Science & Technology")
        self.assertEqual(result["canonical_topic_family"], "Optics")

    def test_polity_force_phrase_does_not_fall_into_mechanics(self):
        result = derive_canonical_taxonomy(
            "Polity",
            "Parliament",
            "Which constitutional amendment came into force in the year 1976?",
        )
        self.assertEqual(result["canonical_subject"], "Polity")
        self.assertEqual(result["canonical_topic_family"], "Constitutional Development")

    def test_current_affairs_light_phrase_does_not_fall_into_optics(self):
        result = derive_canonical_taxonomy(
            "Current Affairs",
            "Domestic Affairs",
            "In the light of recent judicial developments, which statement is correct?",
        )
        self.assertEqual(result["canonical_subject"], "Current Affairs")
        self.assertEqual(result["canonical_topic_family"], "Domestic Affairs")

    def test_bharatiya_nyaya_topic_forces_polity_not_mechanics(self):
        result = derive_canonical_taxonomy(
            "Science & Technology",
            "Mechanics",
            "Criminal Laws",
        )
        self.assertEqual(result["canonical_subject"], "Polity")
        self.assertEqual(result["canonical_topic_family"], "Criminal Laws")

    def test_bharatiya_sakshya_topic_forces_polity_not_mechanics(self):
        result = derive_canonical_taxonomy(
            "Science & Technology",
            "Mechanics",
            "Legal Terminology",
        )
        self.assertEqual(result["canonical_subject"], "Polity")
        self.assertEqual(result["canonical_topic_family"], "Criminal Laws")

    def test_government_order_topic_forces_polity_not_mechanics(self):
        result = derive_canonical_taxonomy(
            "Science & Technology",
            "Mechanics",
            "Government Orders",
        )
        self.assertEqual(result["canonical_subject"], "Polity")
        self.assertEqual(result["canonical_topic_family"], "Government Orders")

    def test_government_of_india_act_topic_forces_polity_not_mechanics(self):
        result = derive_canonical_taxonomy(
            "Science & Technology",
            "Mechanics",
            "Government of India Act 1935",
        )
        self.assertEqual(result["canonical_subject"], "Polity")
        self.assertEqual(result["canonical_topic_family"], "Government of India Act 1935")


if __name__ == "__main__":
    unittest.main()
