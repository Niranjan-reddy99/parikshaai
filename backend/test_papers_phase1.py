import unittest

import papers


class _FakeResult:
    def __init__(self, data=None):
        self.data = data or []


class _FakeTable:
    def __init__(self, name: str, db: dict):
        self.name = name
        self.db = db
        self._filters = {}
        self._order = None
        self._desc = False
        self._limit = None
        self._range = None
        self._payload = None

    def select(self, *args, **kwargs):
        return self

    def eq(self, key, value):
        self._filters[key] = value
        return self

    def order(self, key, desc=False):
        self._order = key
        self._desc = desc
        return self

    def limit(self, value):
        self._limit = value
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def insert(self, payload):
        self._payload = payload
        self._mode = "insert"
        return self

    def update(self, payload):
        self._payload = payload
        self._mode = "update"
        return self

    def execute(self):
        rows = [row for row in self.db[self.name] if all(row.get(k) == v for k, v in self._filters.items())]
        if getattr(self, "_mode", None) == "insert":
            payload = self._payload
            if isinstance(payload, dict):
                row = dict(payload)
                row.setdefault("id", f"{self.name}-{len(self.db[self.name]) + 1}")
                self.db[self.name].append(row)
                return _FakeResult([row])
            inserted = []
            for item in payload:
                row = dict(item)
                row.setdefault("id", f"{self.name}-{len(self.db[self.name]) + 1}")
                self.db[self.name].append(row)
                inserted.append(row)
            return _FakeResult(inserted)
        if self._payload is not None:
            for row in rows:
                row.update(self._payload)
            return _FakeResult(rows)
        if self._order:
            rows = sorted(rows, key=lambda row: row.get(self._order), reverse=self._desc)
        if self._range is not None:
            start, end = self._range
            rows = rows[start:end + 1]
        if self._limit is not None:
            rows = rows[:self._limit]
        return _FakeResult(rows)


class _FakeSupabase:
    def __init__(self):
        self.db = {"papers": [], "jobs": [], "questions": []}

    def table(self, name):
        return _FakeTable(name, self.db)


class PapersPhase1Tests(unittest.TestCase):
    def test_build_paper_key_normalizes_exam_identity(self):
        self.assertEqual(
            papers.build_paper_key("  TSPSC   GROUP 1 PRELIMS  ", 2025),
            "tspsc group 1 prelims::2025",
        )

    def test_build_paper_insert_payload_starts_first_version(self):
        payload = papers.build_paper_insert_payload(
            "UPSC Prelims",
            2024,
            source_filename="paper.pdf",
            extractor_type="digital_mcq",
        )
        self.assertEqual(payload["upload_version"], 1)
        self.assertEqual(payload["paper_key"], "upsc prelims::2024")
        self.assertEqual(payload["extractor_type"], "universal")
        self.assertIsNone(payload["supersedes_paper_id"])

    def test_build_paper_insert_payload_rolls_version_forward_for_replacement(self):
        latest = {"id": "paper-old", "upload_version": 2}
        payload = papers.build_paper_insert_payload(
            "UPSC Prelims",
            2024,
            latest_paper=latest,
            supersede_latest=True,
        )
        self.assertEqual(payload["upload_version"], 3)
        self.assertEqual(payload["supersedes_paper_id"], "paper-old")

    def test_ensure_paper_for_upload_creates_versioned_replacement(self):
        sb = _FakeSupabase()
        first = papers.ensure_paper_for_upload(
            "UPSC Prelims",
            2024,
            source_filename="v1.pdf",
            extractor_type="digital_mcq",
            sb=sb,
        )
        second = papers.ensure_paper_for_upload(
            "UPSC Prelims",
            2024,
            source_filename="v2.pdf",
            extractor_type="appsc_boxed",
            supersede_latest=True,
            sb=sb,
        )
        self.assertEqual(first["upload_version"], 1)
        self.assertEqual(second["upload_version"], 2)
        self.assertEqual(second["supersedes_paper_id"], first["id"])
        latest = papers.get_latest_paper_for_exam("UPSC Prelims", 2024, sb=sb)
        self.assertEqual(latest["id"], second["id"])
        replaced = next(row for row in sb.db["papers"] if row["id"] == first["id"])
        self.assertEqual(replaced["lifecycle_status"], "replaced")
        self.assertEqual(replaced["replacement_paper_id"], second["id"])

    def test_sync_paper_question_counts_updates_totals(self):
        sb = _FakeSupabase()
        paper = papers.ensure_paper_for_upload("Sample Exam", 2025, sb=sb)
        sb.db["questions"].extend([
            {"id": "q1", "paper_id": paper["id"], "is_active": True, "public_visibility": "visible", "structural_status": "valid"},
            {"id": "q2", "paper_id": paper["id"], "is_active": True, "public_visibility": "hidden_structural", "structural_status": "broken"},
            {"id": "q3", "paper_id": paper["id"], "is_active": True, "public_visibility": "visible", "structural_status": "valid"},
        ])
        papers.sync_paper_question_counts(paper["id"], sb=sb)
        stored = next(row for row in sb.db["papers"] if row["id"] == paper["id"])
        self.assertEqual(stored["question_count"], 3)
        self.assertEqual(stored["visible_question_count"], 2)
        self.assertEqual(stored["hidden_question_count"], 1)
        self.assertEqual(stored["publish_status"], "publishable_with_hidden_rows")


if __name__ == "__main__":
    unittest.main()
