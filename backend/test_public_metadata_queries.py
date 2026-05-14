import unittest
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from public_metadata_helpers import public_row_identity
from public_metadata_helpers import build_exam_paper_manifest_from_rows
from public_metadata_helpers import prefer_current_public_manifest_rows
from public_metadata_queries import collect_public_exam_rows, collect_public_question_meta_rows, stream_public_exam_page


class _FakeResult:
    def __init__(self, data=None):
        self.data = data or []


class _FakeTable:
    def __init__(self, name: str, db: dict[str, list[dict]]):
        self.name = name
        self.db = db
        self._filters: list[tuple[str, object]] = []
        self._orders: list[tuple[str, bool]] = []
        self._range = None

    def select(self, *args, **kwargs):
        return self

    def eq(self, key, value):
        self._filters.append((key, value))
        return self

    def order(self, key, desc=False):
        self._orders.append((key, desc))
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def execute(self):
        rows = [dict(row) for row in self.db[self.name]]
        for key, value in self._filters:
            rows = [row for row in rows if row.get(key) == value]

        for key, desc in reversed(self._orders):
            rows.sort(key=lambda row: row.get(key) or "", reverse=desc)

        if self._range is not None:
            start, end = self._range
            rows = rows[start:end + 1]
        return _FakeResult(rows)


class _FakeSupabase:
    def __init__(self, questions: list[dict]):
        self.db = {"questions": questions}

    def table(self, name):
        return _FakeTable(name, self.db)


def _normalize_exam_name(exam_name: str) -> str:
    return str(exam_name or "").strip()


def _question_select_clause(base_cols, supported_cols=None):
    return ", ".join(base_cols)


def _apply_public_question_filter(query, supported_cols=None):
    return query


def _row_matches_selected_papers(row, publishable_paper_ids):
    if publishable_paper_ids is None:
        return True
    paper_id = row.get("paper_id")
    if not paper_id:
        return True
    return str(paper_id) in publishable_paper_ids


def _sanitize_public_question_row(row):
    return dict(row)


def _row_matches_search(row, search):
    if not search:
        return True
    haystack = " ".join(str(row.get(key) or "") for key in ("question", "subject", "topic", "subtopic", "concept", "type")).lower()
    return search.strip().lower() in haystack


def _merge_public_duplicate_row(existing, candidate):
    merged = dict(existing)
    if len(str(candidate.get("question") or "")) > len(str(existing.get("question") or "")):
        merged["question"] = candidate.get("question")
    return merged


class PublicMetadataQueryTests(unittest.TestCase):
    def test_collect_public_exam_rows_dedupes_same_shift_row_and_keeps_other_shift(self):
        supabase = _FakeSupabase([
            {
                "id": "q1-old",
                "exam_name": "Sample Exam",
                "exam_year": 2025,
                "paper_id": "paper-a",
                "shift_label": "Shift 1",
                "question_number": 1,
                "question": "Short stem",
                "subject": "Polity",
                "topic": "Constitution",
                "subtopic": "Preamble",
                "created_at": "2025-01-01T00:00:00",
            },
            {
                "id": "q1-new",
                "exam_name": "Sample Exam",
                "exam_year": 2025,
                "paper_id": "paper-a",
                "shift_label": "Shift 1",
                "question_number": 1,
                "question": "A much richer stem for the same question",
                "subject": "Polity",
                "topic": "Constitution",
                "subtopic": "Preamble",
                "created_at": "2025-01-02T00:00:00",
            },
            {
                "id": "q1-shift2",
                "exam_name": "Sample Exam",
                "exam_year": 2025,
                "paper_id": "paper-b",
                "shift_label": "Shift 2",
                "question_number": 1,
                "question": "Shift two version",
                "subject": "Polity",
                "topic": "Constitution",
                "subtopic": "Preamble",
                "created_at": "2025-01-03T00:00:00",
            },
        ])

        rows = collect_public_exam_rows(
            exam_name="Sample Exam",
            exam_year=2025,
            paper_id=None,
            shift_label=None,
            subject=None,
            topic=None,
            subtopic=None,
            difficulty=None,
            search=None,
            scoped_by_selector=True,
            normalize_exam_name=_normalize_exam_name,
            exam_qs_cache={},
            exam_qs_cache_ttl_public=600,
            now_ts=1000.0,
            public_include_all_questions=lambda: True,
            question_supported_columns=lambda: set(),
            practice_ready_mode=lambda supported_cols=None: False,
            latest_live_paper_ids=lambda **kwargs: None,
            latest_live_exam_keys=lambda **kwargs: None,
            get_publishable_paper_ids=lambda: None,
            question_select_clause=_question_select_clause,
            apply_public_question_filter=_apply_public_question_filter,
            supabase=supabase,
            row_matches_selected_papers=_row_matches_selected_papers,
            public_row_identity=public_row_identity,
            sanitize_public_question_row=_sanitize_public_question_row,
            row_matches_search=_row_matches_search,
            merge_public_duplicate_row=_merge_public_duplicate_row,
        )

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["question"], "A much richer stem for the same question")
        self.assertEqual(rows[1]["question"], "Shift two version")

    def test_collect_public_question_meta_rows_excludes_legacy_rows_when_exam_has_current_public_paper(self):
        supabase = _FakeSupabase([
            {
                "id": "legacy-row",
                "exam_name": "TSPSC LIBRARIAN GS",
                "exam_year": 2023,
                "paper_id": None,
                "shift_label": None,
                "question_number": 1,
                "subject": "History",
                "topic": "Modern History",
                "subtopic": "Congress",
                "difficulty": "Easy",
                "created_at": "2025-01-01T00:00:00",
            },
            {
                "id": "current-row",
                "exam_name": "TSPSC LIBRARIAN GS",
                "exam_year": 2023,
                "paper_id": "live-paper",
                "shift_label": "Shift 1",
                "question_number": 1,
                "subject": "History",
                "topic": "Modern History",
                "subtopic": "Congress",
                "difficulty": "Easy",
                "created_at": "2025-01-02T00:00:00",
            },
        ])

        rows = collect_public_question_meta_rows(
            supabase=supabase,
            supported_cols=set(),
            select_clause="*",
            publishable_ids={"live-paper"},
            publishable_exam_keys={("TSPSC LIBRARIAN GS", 2023)},
            apply_public_question_filter=_apply_public_question_filter,
            row_matches_selected_papers=_row_matches_selected_papers,
            public_row_identity=public_row_identity,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "current-row")

    def test_stream_public_exam_page_paginates_after_dedup(self):
        supabase = _FakeSupabase([
            {
                "id": "q1-old",
                "exam_name": "Sample Exam",
                "exam_year": 2025,
                "paper_id": "paper-a",
                "shift_label": "Shift 1",
                "question_number": 1,
                "question": "Question one old",
                "subject": "History",
                "topic": "Ancient",
                "subtopic": "Indus",
                "created_at": "2025-01-01T00:00:00",
            },
            {
                "id": "q1-new",
                "exam_name": "Sample Exam",
                "exam_year": 2025,
                "paper_id": "paper-a",
                "shift_label": "Shift 1",
                "question_number": 1,
                "question": "Question one new",
                "subject": "History",
                "topic": "Ancient",
                "subtopic": "Indus",
                "created_at": "2025-01-02T00:00:00",
            },
            {
                "id": "q2",
                "exam_name": "Sample Exam",
                "exam_year": 2025,
                "paper_id": "paper-a",
                "shift_label": "Shift 1",
                "question_number": 2,
                "question": "Question two",
                "subject": "History",
                "topic": "Medieval",
                "subtopic": "Delhi Sultanate",
                "created_at": "2025-01-03T00:00:00",
            },
            {
                "id": "q3",
                "exam_name": "Sample Exam",
                "exam_year": 2025,
                "paper_id": "paper-a",
                "shift_label": "Shift 1",
                "question_number": 3,
                "question": "Question three",
                "subject": "History",
                "topic": "Modern",
                "subtopic": "Congress",
                "created_at": "2025-01-04T00:00:00",
            },
        ])

        page = stream_public_exam_page(
            exam_name="Sample Exam",
            exam_year=2025,
            paper_id=None,
            shift_label=None,
            subject=None,
            topic=None,
            subtopic=None,
            difficulty=None,
            search=None,
            limit=1,
            offset=1,
            normalize_exam_name=_normalize_exam_name,
            public_include_all_questions=lambda: True,
            question_supported_columns=lambda: set(),
            practice_ready_mode=lambda supported_cols=None: False,
            latest_live_paper_ids=lambda **kwargs: None,
            latest_live_exam_keys=lambda **kwargs: None,
            get_publishable_paper_ids=lambda: None,
            question_select_clause=_question_select_clause,
            apply_public_question_filter=_apply_public_question_filter,
            supabase=supabase,
            row_matches_selected_papers=_row_matches_selected_papers,
            public_row_identity=public_row_identity,
            sanitize_public_question_row=_sanitize_public_question_row,
            row_matches_search=_row_matches_search,
            merge_public_duplicate_row=_merge_public_duplicate_row,
        )

        self.assertEqual(page["total"], 3)
        self.assertEqual(len(page["questions"]), 1)
        self.assertEqual(page["questions"][0]["question"], "Question two")
        self.assertTrue(page["has_more"])
        self.assertEqual(page["next_cursor"], "2")

    def test_build_exam_paper_manifest_from_rows_groups_by_paper_and_shift(self):
        manifest = build_exam_paper_manifest_from_rows(
            [
                {
                    "id": "q1",
                    "paper_id": "paper-a",
                    "shift_label": "Shift 1",
                    "question_number": 1,
                },
                {
                    "id": "q2",
                    "paper_id": "paper-a",
                    "shift_label": "Shift 1",
                    "question_number": 2,
                },
                {
                    "id": "q3",
                    "paper_id": "paper-b",
                    "shift_label": "Shift 2",
                    "question_number": 1,
                },
                {
                    "id": "q4",
                    "paper_id": None,
                    "shift_label": None,
                    "question_number": 5,
                },
            ],
            "Sample Exam",
            2025,
        )

        self.assertEqual(manifest["exam_name"], "Sample Exam")
        self.assertEqual(manifest["exam_year"], 2025)
        self.assertEqual(manifest["total_count"], 4)
        self.assertEqual(len(manifest["papers"]), 3)

        legacy_paper = next(
            paper for paper in manifest["papers"]
            if paper["paper_id"] is None and paper["shift_label"] is None
        )
        shift_one = next(
            paper for paper in manifest["papers"]
            if paper["paper_id"] == "paper-a" and paper["shift_label"] == "Shift 1"
        )
        shift_two = next(
            paper for paper in manifest["papers"]
            if paper["paper_id"] == "paper-b" and paper["shift_label"] == "Shift 2"
        )

        self.assertIsNone(legacy_paper["paper_id"])
        self.assertIsNone(legacy_paper["shift_label"])
        self.assertEqual(legacy_paper["question_count"], 1)
        self.assertEqual(legacy_paper["first_question_number"], 5)
        self.assertEqual(legacy_paper["last_question_number"], 5)

        self.assertEqual(shift_one["paper_id"], "paper-a")
        self.assertEqual(shift_one["shift_label"], "Shift 1")
        self.assertEqual(shift_one["question_count"], 2)
        self.assertEqual(shift_one["first_question_number"], 1)
        self.assertEqual(shift_one["last_question_number"], 2)

        self.assertEqual(shift_two["paper_id"], "paper-b")
        self.assertEqual(shift_two["shift_label"], "Shift 2")
        self.assertEqual(shift_two["question_count"], 1)

    def test_prefer_current_public_manifest_rows_drops_stale_groups_when_current_public_paper_exists(self):
        rows = [
            {
                "id": "legacy-1",
                "paper_id": "old-paper",
                "shift_label": "NO_SHIFT",
                "question_number": 1,
            },
            {
                "id": "legacy-2",
                "paper_id": "old-paper",
                "shift_label": "NO_SHIFT",
                "question_number": 2,
            },
            {
                "id": "current-1",
                "paper_id": "current-paper",
                "shift_label": "Shift 1",
                "question_number": 1,
            },
        ]

        filtered = prefer_current_public_manifest_rows(rows, {"current-paper"})

        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["id"], "current-1")

    def test_prefer_current_public_manifest_rows_keeps_legacy_rows_when_no_current_public_match_exists(self):
        rows = [
            {
                "id": "legacy-1",
                "paper_id": None,
                "shift_label": None,
                "question_number": 1,
            },
            {
                "id": "legacy-2",
                "paper_id": None,
                "shift_label": None,
                "question_number": 2,
            },
        ]

        filtered = prefer_current_public_manifest_rows(rows, {"current-paper"})

        self.assertEqual(filtered, rows)


if __name__ == "__main__":
    unittest.main()
