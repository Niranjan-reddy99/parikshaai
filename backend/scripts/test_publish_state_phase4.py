import asyncio
import importlib.util
import sys
import types
import unittest
from pathlib import Path

import papers


class _FakeResult:
    def __init__(self, data=None, count=0):
        self.data = data
        self.count = count


class _FakeTable:
    def __init__(self, name: str, db: dict[str, list[dict]]):
        self.name = name
        self.db = db
        self._filters: list[tuple[str, object]] = []
        self._range = None
        self._limit = None
        self._order = None
        self._desc = False
        self._single = False
        self._payload = None
        self._mode = "select"

    def select(self, *args, **kwargs):
        return self

    def eq(self, key, value):
        self._filters.append((key, value))
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def limit(self, value):
        self._limit = value
        return self

    def order(self, key, desc=False):
        self._order = key
        self._desc = desc
        return self

    def single(self):
        self._single = True
        return self

    def update(self, payload):
        self._mode = "update"
        self._payload = payload
        return self

    def insert(self, payload):
        self._mode = "insert"
        self._payload = payload
        return self

    def delete(self):
        self._mode = "delete"
        return self

    def _matches(self, row):
        return all(row.get(key) == value for key, value in self._filters)

    def execute(self):
        rows = [row for row in self.db[self.name] if self._matches(row)]
        if self._mode == "insert":
            payload = self._payload or {}
            items = payload if isinstance(payload, list) else [payload]
            inserted = []
            for item in items:
                row = dict(item)
                row.setdefault("id", f"{self.name}-{len(self.db[self.name]) + 1}")
                self.db[self.name].append(row)
                inserted.append(dict(row))
            if self._single:
                return _FakeResult(inserted[0] if inserted else None, count=len(inserted))
            return _FakeResult(inserted, count=len(inserted))
        if self._mode == "update":
            updated = []
            for row in rows:
                row.update(self._payload or {})
                updated.append(dict(row))
            return _FakeResult(updated, count=len(updated))
        if self._mode == "delete":
            removed = [row for row in self.db[self.name] if self._matches(row)]
            self.db[self.name] = [row for row in self.db[self.name] if not self._matches(row)]
            return _FakeResult(removed, count=len(removed))
        if self._order:
            rows = sorted(rows, key=lambda row: row.get(self._order) or "", reverse=self._desc)
        if self._range is not None:
            start, end = self._range
            rows = rows[start:end + 1]
        if self._limit is not None:
            rows = rows[:self._limit]
        if self._single:
            return _FakeResult(rows[0] if rows else None, count=1 if rows else 0)
        return _FakeResult([dict(row) for row in rows], count=len(rows))


class _FakeSupabase:
    def __init__(self):
        self.db = {
            "papers": [],
            "questions": [],
            "jobs": [],
            "explanations": [],
            "question_repairs": [],
            "user_subscriptions": [],
            "user_attempts": [],
        }

    def table(self, name):
        if name not in self.db:
            self.db[name] = []
        return _FakeTable(name, self.db)


def _load_main_module(fake_supabase: _FakeSupabase):
    for mod in (
        "config",
        "google",
        "google.genai",
        "google.genai.types",
        "dotenv",
        "fastapi",
        "fastapi.middleware",
        "fastapi.middleware.cors",
        "fastapi.responses",
        "pydantic",
        "tested_backend_main_phase4",
    ):
        sys.modules.pop(mod, None)

    fake_config = types.ModuleType("config")
    fake_config.supabase = fake_supabase
    fake_config.verify_firebase_token = lambda token: {"uid": "test"}
    sys.modules["config"] = fake_config

    fake_dotenv = types.ModuleType("dotenv")
    fake_dotenv.load_dotenv = lambda *args, **kwargs: None
    sys.modules["dotenv"] = fake_dotenv

    fake_fastapi = types.ModuleType("fastapi")

    class _FakeHTTPException(Exception):
        def __init__(self, status_code, detail):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    class _FakeRouter:
        def __init__(self):
            self.routes = []

    class _FakeFastAPI:
        def __init__(self, *args, **kwargs):
            self.router = _FakeRouter()

        def add_middleware(self, *args, **kwargs):
            return None

        def _decorator(self, *args, **kwargs):
            def wrap(fn):
                return fn
            return wrap

        get = post = patch = delete = on_event = middleware = exception_handler = _decorator

    class _FakeRequest:
        pass

    class _FakeResponse:
        def __init__(self):
            self.headers = {}

    class _FakeBackgroundTasks:
        pass

    fake_fastapi.FastAPI = _FakeFastAPI
    fake_fastapi.HTTPException = _FakeHTTPException
    fake_fastapi.Header = lambda default=None, **kwargs: default
    fake_fastapi.Query = lambda default=None, **kwargs: default
    fake_fastapi.Depends = lambda dep=None: dep
    fake_fastapi.File = lambda default=None, **kwargs: default
    fake_fastapi.Form = lambda default=None, **kwargs: default
    fake_fastapi.Request = _FakeRequest
    fake_fastapi.Response = _FakeResponse
    fake_fastapi.BackgroundTasks = _FakeBackgroundTasks

    class _FakeUploadFile:
        pass

    fake_fastapi.UploadFile = _FakeUploadFile
    sys.modules["fastapi"] = fake_fastapi

    fake_fastapi_middleware = types.ModuleType("fastapi.middleware")
    fake_fastapi_cors = types.ModuleType("fastapi.middleware.cors")
    fake_fastapi_gzip = types.ModuleType("fastapi.middleware.gzip")

    class _FakeCORSMiddleware:
        pass

    class _FakeGZipMiddleware:
        pass

    fake_fastapi_cors.CORSMiddleware = _FakeCORSMiddleware
    fake_fastapi_gzip.GZipMiddleware = _FakeGZipMiddleware
    sys.modules["fastapi.middleware"] = fake_fastapi_middleware
    sys.modules["fastapi.middleware.cors"] = fake_fastapi_cors
    sys.modules["fastapi.middleware.gzip"] = fake_fastapi_gzip

    fake_fastapi_responses = types.ModuleType("fastapi.responses")

    class _FakeResponse:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs
            self.headers = {}

    fake_fastapi_responses.HTMLResponse = _FakeResponse
    fake_fastapi_responses.JSONResponse = _FakeResponse
    sys.modules["fastapi.responses"] = fake_fastapi_responses

    fake_pydantic = types.ModuleType("pydantic")

    class _FakeBaseModel:
        def __init__(self, **kwargs):
            for key, value in kwargs.items():
                setattr(self, key, value)

        def model_dump(self, exclude_none=False):
            data = dict(self.__dict__)
            if exclude_none:
                data = {k: v for k, v in data.items() if v is not None}
            return data

    fake_pydantic.BaseModel = _FakeBaseModel
    fake_pydantic.Field = lambda default=None, **kwargs: default
    sys.modules["pydantic"] = fake_pydantic

    fake_google = types.ModuleType("google")
    fake_genai = types.ModuleType("google.genai")
    fake_types = types.ModuleType("google.genai.types")

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

    fake_genai.Client = _FakeClient
    fake_genai.types = fake_types
    fake_google.genai = fake_genai
    sys.modules["google"] = fake_google
    sys.modules["google.genai"] = fake_genai
    sys.modules["google.genai.types"] = fake_types

    import os
    os.environ["ADMIN_API_KEY"] = "test-admin-key"

    path = Path(__file__).with_name("main.py")
    spec = importlib.util.spec_from_file_location("tested_backend_main_phase4", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    module._meta_cache = None
    module._meta_cache_ts = 0
    return module


class PublishStatePhase4Tests(unittest.TestCase):
    def test_refresh_paper_publish_state_fully_publishable(self):
        sb = _FakeSupabase()
        paper = papers.ensure_paper_for_upload("Full Paper", 2025, sb=sb)
        sb.db["questions"].extend([
            {"id": "q1", "paper_id": paper["id"], "is_active": True, "public_visibility": "visible", "structural_status": "valid"},
            {"id": "q2", "paper_id": paper["id"], "is_active": True, "public_visibility": "visible", "structural_status": "valid"},
        ])

        papers.refresh_paper_publish_state(paper["id"], sb=sb)

        stored = next(row for row in sb.db["papers"] if row["id"] == paper["id"])
        self.assertEqual(stored["publish_status"], "publishable")
        self.assertEqual(stored["visible_question_count"], 2)
        self.assertEqual(stored["hidden_question_count"], 0)
        self.assertEqual(stored["structural_issue_count"], 0)

    def test_refresh_paper_publish_state_publishable_with_hidden_rows(self):
        sb = _FakeSupabase()
        paper = papers.ensure_paper_for_upload("Partial Paper", 2025, sb=sb)
        sb.db["questions"].extend([
            {"id": "q1", "paper_id": paper["id"], "is_active": True, "public_visibility": "visible", "structural_status": "valid"},
            {"id": "q2", "paper_id": paper["id"], "is_active": True, "public_visibility": "hidden_structural", "structural_status": "broken"},
        ])

        papers.refresh_paper_publish_state(paper["id"], sb=sb)

        stored = next(row for row in sb.db["papers"] if row["id"] == paper["id"])
        self.assertEqual(stored["publish_status"], "publishable_with_hidden_rows")
        self.assertEqual(stored["visible_question_count"], 1)
        self.assertEqual(stored["hidden_question_count"], 1)
        self.assertEqual(stored["structural_issue_count"], 1)

    def test_refresh_paper_publish_state_blocked_when_no_visible_rows(self):
        sb = _FakeSupabase()
        paper = papers.ensure_paper_for_upload("Blocked Paper", 2025, sb=sb)
        sb.db["questions"].extend([
            {"id": "q1", "paper_id": paper["id"], "is_active": True, "public_visibility": "hidden_structural", "structural_status": "broken"},
            {"id": "q2", "paper_id": paper["id"], "is_active": True, "public_visibility": "hidden_structural", "structural_status": "broken"},
        ])

        papers.refresh_paper_publish_state(paper["id"], sb=sb)

        stored = next(row for row in sb.db["papers"] if row["id"] == paper["id"])
        self.assertEqual(stored["publish_status"], "blocked")
        self.assertEqual(stored["visible_question_count"], 0)

    def test_refresh_paper_publish_state_marks_reupload_needed_over_threshold(self):
        sb = _FakeSupabase()
        paper = papers.ensure_paper_for_upload("Bad Paper", 2025, sb=sb)
        sb.db["questions"].extend([
            {"id": "q1", "paper_id": paper["id"], "is_active": True, "public_visibility": "visible", "structural_status": "valid"},
            {"id": "q2", "paper_id": paper["id"], "is_active": True, "public_visibility": "hidden_structural", "structural_status": "broken"},
            {"id": "q3", "paper_id": paper["id"], "is_active": True, "public_visibility": "hidden_structural", "structural_status": "broken"},
            {"id": "q4", "paper_id": paper["id"], "is_active": True, "public_visibility": "hidden_structural", "structural_status": "broken"},
        ])

        papers.refresh_paper_publish_state(paper["id"], sb=sb)

        stored = next(row for row in sb.db["papers"] if row["id"] == paper["id"])
        self.assertEqual(stored["publish_status"], "reupload_needed")
        self.assertEqual(stored["visible_question_count"], 1)
        self.assertEqual(stored["structural_issue_count"], 3)

    def test_public_endpoints_filter_on_stored_visibility_and_paper_status(self):
        import os
        from pathlib import Path
        old_all = os.environ.get("PUBLIC_INCLUDE_ALL_QUESTIONS")
        old_pr = os.environ.get("PUBLIC_USE_PRACTICE_READY")
        os.environ["PUBLIC_INCLUDE_ALL_QUESTIONS"] = "0"
        os.environ["PUBLIC_USE_PRACTICE_READY"] = "0"

        cache_file = Path(__file__).parent / "cache" / "public_meta_snapshot.json"
        backup_file = Path(__file__).parent / "cache" / "public_meta_snapshot.json.bak"
        has_cache = cache_file.exists()

        if has_cache:
            if backup_file.exists():
                backup_file.unlink()
            cache_file.rename(backup_file)

        try:
            sb = _FakeSupabase()
            p1 = papers.ensure_paper_for_upload("Good Exam", 2025, sb=sb)
            p2 = papers.ensure_paper_for_upload("Mixed Exam", 2025, sb=sb)
            p3 = papers.ensure_paper_for_upload("Blocked Exam", 2025, sb=sb)
            p4 = papers.ensure_paper_for_upload("Reupload Exam", 2025, sb=sb)

            sb.db["questions"].extend([
                {
                    "id": "good-visible",
                    "paper_id": p1["id"],
                    "exam_name": "Good Exam",
                    "exam_year": 2025,
                    "question_text": "Valid question one?",
                    "option_a": "A",
                    "option_b": "B",
                    "option_c": "C",
                    "option_d": "D",
                    "correct_answer": "A",
                    "subject": "History",
                    "topic": "General",
                    "subtopic": "General",
                    "difficulty": "Easy",
                    "question_type": "mcq",
                    "concept": None,
                    "question_number": 1,
                    "needs_review": True,
                    "has_image": False,
                    "image_url": None,
                    "public_visibility": "visible",
                    "structural_status": "valid",
                    "created_at": "2026-01-01T00:00:00Z",
                },
                {
                    "id": "mixed-hidden",
                    "paper_id": p2["id"],
                    "exam_name": "Mixed Exam",
                    "exam_year": 2025,
                    "question_text": "Broken question two?",
                    "option_a": "A",
                    "option_b": "",
                    "option_c": "C",
                    "option_d": "D",
                    "correct_answer": "A",
                    "subject": "Polity",
                    "topic": "General",
                    "subtopic": "General",
                    "difficulty": "Easy",
                    "question_type": "mcq",
                    "concept": None,
                    "question_number": 2,
                    "needs_review": False,
                    "has_image": False,
                    "image_url": None,
                    "public_visibility": "hidden_structural",
                    "structural_status": "broken",
                    "created_at": "2026-01-02T00:00:00Z",
                },
                {
                    "id": "mixed-visible",
                    "paper_id": p2["id"],
                    "exam_name": "Mixed Exam",
                    "exam_year": 2025,
                    "question_text": "Valid question three?",
                    "option_a": "A",
                    "option_b": "B",
                    "option_c": "C",
                    "option_d": "D",
                    "correct_answer": "B",
                    "subject": "Geography",
                    "topic": "General",
                    "subtopic": "General",
                    "difficulty": "Medium",
                    "question_type": "mcq",
                    "concept": None,
                    "question_number": 3,
                    "needs_review": False,
                    "has_image": False,
                    "image_url": None,
                    "public_visibility": "visible",
                    "structural_status": "valid",
                    "created_at": "2026-01-03T00:00:00Z",
                },
                {
                    "id": "blocked-visible",
                    "paper_id": p3["id"],
                    "exam_name": "Blocked Exam",
                    "exam_year": 2025,
                    "question_text": "Looks visible but paper is blocked?",
                    "option_a": "A",
                    "option_b": "B",
                    "option_c": "C",
                    "option_d": "D",
                    "correct_answer": "C",
                    "subject": "Economy",
                    "topic": "General",
                    "subtopic": "General",
                    "difficulty": "Hard",
                    "question_type": "mcq",
                    "concept": None,
                    "question_number": 4,
                    "needs_review": False,
                    "has_image": False,
                    "image_url": None,
                    "public_visibility": "visible",
                    "structural_status": "valid",
                    "created_at": "2026-01-04T00:00:00Z",
                },
                {
                    "id": "reupload-visible",
                    "paper_id": p4["id"],
                    "exam_name": "Reupload Exam",
                    "exam_year": 2025,
                    "question_text": "Looks visible but paper is reupload needed?",
                    "option_a": "A",
                    "option_b": "B",
                    "option_c": "C",
                    "option_d": "D",
                    "correct_answer": "D",
                    "subject": "Science",
                    "topic": "General",
                    "subtopic": "General",
                    "difficulty": "Medium",
                    "question_type": "mcq",
                    "concept": None,
                    "question_number": 5,
                    "needs_review": False,
                    "has_image": False,
                    "image_url": None,
                    "public_visibility": "visible",
                    "structural_status": "valid",
                    "created_at": "2026-01-05T00:00:00Z",
                },
            ])

            sb.table("papers").update({"publish_status": "publishable", "lifecycle_status": "ingested", "question_count": 1, "visible_question_count": 1}).eq("id", p1["id"]).execute()
            sb.table("papers").update({"publish_status": "publishable_with_hidden_rows", "lifecycle_status": "ingested", "question_count": 2, "visible_question_count": 1}).eq("id", p2["id"]).execute()
            sb.table("papers").update({"publish_status": "blocked", "lifecycle_status": "ingested", "question_count": 1, "visible_question_count": 1}).eq("id", p3["id"]).execute()
            sb.table("papers").update({"publish_status": "reupload_needed", "lifecycle_status": "ingested", "question_count": 1, "visible_question_count": 1}).eq("id", p4["id"]).execute()

            sb.table("user_subscriptions").insert({
                "firebase_uid": "test-premium",
                "plan": "pro",
                "status": "active",
            }).execute()

            main = _load_main_module(sb)
            main._read_public_meta_snapshot = lambda now: None

            user = {"uid": "test-premium"}
            list_result = asyncio.run(main.get_questions(limit=20, offset=0, _current_user=user))
            print("DEBUG returned list_result:", list_result)
            returned_ids = {row["id"] for row in list_result["questions"]}
            self.assertEqual(returned_ids, {"good-visible", "mixed-visible"})

            meta_result = asyncio.run(main.get_questions_meta(response=main.Response()))
            self.assertEqual(meta_result["total"], 2)

            question_result = asyncio.run(main.get_question_with_answer("mixed-visible", _current_user=user))
            self.assertEqual(question_result["id"], "mixed-visible")

            with self.assertRaises(main.HTTPException) as hidden_ctx:
                asyncio.run(main.get_question_with_answer("mixed-hidden", _current_user=user))
            self.assertEqual(hidden_ctx.exception.status_code, 404)

            with self.assertRaises(main.HTTPException) as blocked_ctx:
                asyncio.run(main.get_question_with_answer("blocked-visible", _current_user=user))
            self.assertEqual(blocked_ctx.exception.status_code, 404)
        finally:
            if old_all is not None:
                os.environ["PUBLIC_INCLUDE_ALL_QUESTIONS"] = old_all
            else:
                os.environ.pop("PUBLIC_INCLUDE_ALL_QUESTIONS", None)
            if old_pr is not None:
                os.environ["PUBLIC_USE_PRACTICE_READY"] = old_pr
            else:
                os.environ.pop("PUBLIC_USE_PRACTICE_READY", None)

            if has_cache and backup_file.exists():
                if cache_file.exists():
                    cache_file.unlink()
                backup_file.rename(cache_file)


if __name__ == "__main__":
    unittest.main()
