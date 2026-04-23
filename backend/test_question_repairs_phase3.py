import unittest

from question_repairs import apply_latest_answer_correction, apply_question_repair, build_ai_repair_proposals


def _question(**overrides):
    base = {
        "id": "q1",
        "paper_id": "paper-1",
        "question_text": "Original question text?",
        "option_a": "Alpha",
        "option_b": "Beta",
        "option_c": "Gamma",
        "option_d": "Delta",
        "correct_answer": "A",
        "needs_review": False,
        "answer_status": "verified",
        "explanation_status": "missing",
        "structural_status": "valid",
        "public_visibility": "visible",
        "question_number": 1,
        "exam_name": "Sample Exam",
        "exam_year": 2025,
        "is_active": True,
    }
    base.update(overrides)
    return base


class _FakeResult:
    def __init__(self, data=None):
        self.data = data


class _FakeTable:
    def __init__(self, name, db):
        self.name = name
        self.db = db
        self.filters = {}
        self.payload = None
        self.mode = None
        self._single = False

    def select(self, *args, **kwargs):
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def update(self, payload):
        self.payload = payload
        self.mode = "update"
        return self

    def single(self):
        self._single = True
        return self

    def execute(self):
        rows = [row for row in self.db[self.name] if all(row.get(k) == v for k, v in self.filters.items())]
        if self.mode == "update":
            for row in rows:
                row.update(self.payload)
            return _FakeResult(rows)
        if self._single and self.name == "questions":
            return _FakeResult(rows[0] if rows else None)
        if self._single and self.name == "question_repairs":
            return _FakeResult(rows[0] if rows else None)
        return _FakeResult(rows)


class _FakeSupabase:
    def __init__(self, question, repair):
        self.db = {
            "questions": [question],
            "question_repairs": [repair],
            "papers": [{"id": question.get("paper_id"), "publish_status": "draft"}],
        }

    def table(self, name):
        return _FakeTable(name, self.db)


class QuestionRepairsPhase3Tests(unittest.TestCase):
    def test_build_ai_repair_proposals_creates_auditable_changes(self):
        proposals = build_ai_repair_proposals(
            "q1",
            _question(),
            {
                "detected_answer": "B",
                "cleaned_question": "Cleaned question text?",
                "cleaned_options": {"B": "Better Beta"},
                "logic_steps": "Step 1",
            },
        )
        self.assertEqual(len(proposals), 2)
        repair_types = {item["repair_type"] for item in proposals}
        self.assertEqual(repair_types, {"answer_correction", "options_cleanup"})
        for proposal in proposals:
            self.assertEqual(proposal["status"], "proposed")
            self.assertEqual(proposal["question_id"], "q1")

    def test_build_ai_repair_proposals_does_not_propose_question_text_cleanup(self):
        proposals = build_ai_repair_proposals(
            "q1",
            _question(
                question_text="Consider the following statements:\n1. Alpha\n2. Beta\n3. Gamma\nWhich are correct?"
            ),
            {
                "detected_answer": "A",
                "cleaned_question": "Consider the following statements:\n1. Alpha\n2. Beta",
                "logic_steps": "Step 1",
            },
        )
        repair_types = {item["repair_type"] for item in proposals}
        self.assertNotIn("question_text_cleanup", repair_types)

    def test_apply_question_repair_updates_question_and_marks_applied(self):
        question = _question()
        repair = {
            "id": "repair-1",
            "question_id": "q1",
            "repair_type": "answer_correction",
            "status": "proposed",
            "proposed_patch": {
                "correct_answer": "B",
                "needs_review": True,
                "answer_status": "corrected",
                "explanation_status": "stale",
            },
        }
        sb = _FakeSupabase(question, repair)
        ok = apply_question_repair(repair, sb=sb)
        self.assertTrue(ok)
        stored_question = sb.db["questions"][0]
        stored_repair = sb.db["question_repairs"][0]
        self.assertEqual(stored_question["correct_answer"], "B")
        self.assertEqual(stored_question["answer_status"], "corrected")
        self.assertEqual(stored_question["explanation_status"], "stale")
        self.assertEqual(stored_repair["status"], "applied")

    def test_apply_latest_answer_correction_applies_newest_proposal(self):
        question = _question(correct_answer="A")
        older = {
            "id": "repair-1",
            "question_id": "q1",
            "repair_type": "answer_correction",
            "status": "proposed",
            "proposed_patch": {
                "correct_answer": "B",
                "needs_review": True,
                "answer_status": "corrected",
                "explanation_status": "stale",
            },
        }
        newer = {
            "id": "repair-2",
            "question_id": "q1",
            "repair_type": "answer_correction",
            "status": "proposed",
            "proposed_patch": {
                "correct_answer": "D",
                "needs_review": True,
                "answer_status": "corrected",
                "explanation_status": "stale",
            },
        }
        sb = _FakeSupabase(question, older)
        sb.db["question_repairs"].append(newer)
        ok = apply_latest_answer_correction("q1", sb=sb)
        self.assertTrue(ok)
        self.assertEqual(sb.db["questions"][0]["correct_answer"], "D")
        self.assertEqual(sb.db["question_repairs"][1]["status"], "applied")


if __name__ == "__main__":
    unittest.main()
