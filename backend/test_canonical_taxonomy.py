import unittest

from canonical_taxonomy import derive_canonical_taxonomy


class CanonicalTaxonomyTests(unittest.TestCase):
    def test_newtons_law_question_forces_general_science_mechanics(self):
        result = derive_canonical_taxonomy(
            "International Relations",
            "Diplomacy",
            "Which one among the following statements qualitatively explains the second law of motion? The rate of change of momentum of a body is equal to the applied force.",
        )
        self.assertEqual(result["canonical_subject"], "General Science")
        self.assertEqual(result["canonical_topic_family"], "Mechanics")

    def test_carrom_inertia_question_forces_general_science_mechanics(self):
        result = derive_canonical_taxonomy(
            "International Relations",
            "Bilateral Relations",
            "A fast-moving carrom striker displaces only the bottom carrom coin from the carrom coin pile.",
        )
        self.assertEqual(result["canonical_subject"], "General Science")
        self.assertEqual(result["canonical_topic_family"], "Mechanics")

    def test_telescope_lens_question_forces_general_science_optics(self):
        result = derive_canonical_taxonomy(
            "History",
            "Modern History",
            "In a simple astronomical telescope, the objective and the eyepiece used respectively are convergent lenses.",
        )
        self.assertEqual(result["canonical_subject"], "General Science")
        self.assertEqual(result["canonical_topic_family"], "Optics")


if __name__ == "__main__":
    unittest.main()
