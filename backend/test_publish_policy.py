import importlib.util
import sys
import types
import unittest
from pathlib import Path


class _FakeQuery:
    def select(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def range(self, *args, **kwargs):
        return self

    def order(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def in_(self, *args, **kwargs):
        return self

    def update(self, *args, **kwargs):
        return self

    def delete(self, *args, **kwargs):
        return self

    def execute(self):
        return types.SimpleNamespace(data=[], count=0)


class _FakeSupabase:
    def table(self, *args, **kwargs):
        return _FakeQuery()


def _load_main_module():
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
    ):
        sys.modules.pop(mod, None)

    fake_config = types.ModuleType("config")
    fake_config.supabase = _FakeSupabase()
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

    class _FakeFastAPI:
        def __init__(self, *args, **kwargs):
            pass

        def add_middleware(self, *args, **kwargs):
            return None

        def _decorator(self, *args, **kwargs):
            def wrap(fn):
                return fn
            return wrap

        get = post = patch = delete = _decorator

    fake_fastapi.FastAPI = _FakeFastAPI
    fake_fastapi.HTTPException = _FakeHTTPException
    fake_fastapi.Header = lambda default=None, **kwargs: default
    fake_fastapi.Query = lambda default=None, **kwargs: default
    fake_fastapi.Depends = lambda dep=None: dep
    fake_fastapi.File = lambda default=None, **kwargs: default
    fake_fastapi.Form = lambda default=None, **kwargs: default

    class _FakeUploadFile:
        pass

    fake_fastapi.UploadFile = _FakeUploadFile
    sys.modules["fastapi"] = fake_fastapi

    fake_fastapi_middleware = types.ModuleType("fastapi.middleware")
    fake_fastapi_cors = types.ModuleType("fastapi.middleware.cors")

    class _FakeCORSMiddleware:
        pass

    fake_fastapi_cors.CORSMiddleware = _FakeCORSMiddleware
    sys.modules["fastapi.middleware"] = fake_fastapi_middleware
    sys.modules["fastapi.middleware.cors"] = fake_fastapi_cors

    fake_fastapi_responses = types.ModuleType("fastapi.responses")

    class _FakeResponse:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

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
    spec = importlib.util.spec_from_file_location("tested_backend_main", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


main = _load_main_module()


def _row(
    qid: str,
    qn: int | None,
    *,
    needs_review: bool = False,
    text: str = "Valid question text that is long enough?",
    options: tuple[str, str, str, str] = ("A1", "B1", "C1", "D1"),
    has_image: bool = False,
    image_url: str | None = None,
    question_type: str = "mcq",
    topic: str = "General",
):
    return {
        "id": qid,
        "exam_name": "Sample Exam",
        "exam_year": 2025,
        "question_number": qn,
        "question_text": text,
        "option_a": options[0],
        "option_b": options[1],
        "option_c": options[2],
        "option_d": options[3],
        "correct_answer": "A",
        "needs_review": needs_review,
        "has_image": has_image,
        "image_url": image_url,
        "question_type": question_type,
        "topic": topic,
    }


class PublishPolicyTests(unittest.TestCase):
    def test_publish_despite_needs_review(self):
        rows = [_row("q1", 1, needs_review=True), _row("q2", 2)]
        queue = main._build_exam_repair_queue("Sample Exam", 2025, rows, contradiction_by_qid={})
        assessment = main._paper_publish_assessment(rows, queue)
        self.assertTrue(assessment["publishable"])
        self.assertFalse(assessment["blocked"])
        self.assertEqual(assessment["hidden_question_count"], 0)
        visible_ids = main._visible_public_question_ids("Sample Exam", 2025, rows=rows)
        self.assertEqual(visible_ids, {"q1", "q2"})

    def test_publish_despite_answer_explanation_contradiction(self):
        rows = [_row("q1", 1), _row("q2", 2)]
        queue = main._build_exam_repair_queue(
            "Sample Exam",
            2025,
            rows,
            contradiction_by_qid={"q1": {"question_id": "q1"}},
        )
        assessment = main._paper_publish_assessment(rows, queue)
        self.assertTrue(assessment["publishable"])
        self.assertEqual(assessment["hidden_question_count"], 1)
        visible_ids = main._visible_public_question_ids(
            "Sample Exam",
            2025,
            rows=rows,
            contradiction_by_qid={"q1": {"question_id": "q1"}},
        )
        self.assertEqual(visible_ids, {"q2"})
        contradiction_item = next(item for item in queue if item["question_id"] == "q1")
        self.assertEqual(contradiction_item["issue_type"], "explanation regeneration")
        self.assertEqual(contradiction_item["publish_blocker"], "row")

    def test_hide_structurally_broken_rows(self):
        rows = [
            _row("q1", 1, options=("A1", "", "C1", "D1")),
            _row("q2", 2),
        ]
        queue = main._build_exam_repair_queue("Sample Exam", 2025, rows, contradiction_by_qid={})
        assessment = main._paper_publish_assessment(rows, queue)
        self.assertTrue(assessment["publishable"])
        self.assertEqual(assessment["hidden_question_count"], 1)
        visible_ids = main._visible_public_question_ids("Sample Exam", 2025, rows=rows)
        self.assertEqual(visible_ids, {"q2"})

    def test_mark_paper_reupload_needed_when_structural_failures_exceed_threshold(self):
        rows = [
            _row("q1", 1, options=("A1", "", "C1", "D1")),
            _row("q2", 2, options=("A1", "", "C1", "D1")),
            _row("q3", 3, options=("A1", "", "C1", "D1")),
            _row("q4", 4),
        ]
        queue = main._build_exam_repair_queue("Sample Exam", 2025, rows, contradiction_by_qid={})
        assessment = main._paper_publish_assessment(rows, queue)
        self.assertTrue(assessment["reupload_needed"])
        self.assertTrue(assessment["blocked"])
        self.assertFalse(assessment["publishable"])

    def test_inline_option_blob_counts_as_broken_extraction(self):
        rows = [
            _row(
                "q1",
                1,
                text="Which is correct? A) alpha B) beta C) gamma D) delta",
                options=("alpha", "beta", "gamma", "delta"),
            ),
            _row("q2", 2),
        ]
        visible_ids = main._visible_public_question_ids("Sample Exam", 2025, rows=rows)
        self.assertEqual(visible_ids, {"q2"})


if __name__ == "__main__":
    unittest.main()
