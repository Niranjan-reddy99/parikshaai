"""
UPSC AI Strategy Engine — FastAPI Backend
Admin-Only Architecture: No public upload. Users only consume data.

Endpoints:
  PUBLIC (no auth):
    GET  /health          — API status
    GET  /questions       — Filtered + paginated questions
    GET  /questions/{id}  — Single question with answer
    GET  /explanation/{id}— Lazy-loaded explanation
    GET  /practice        — Random questions for practice
    GET  /stats           — Dashboard statistics
  
  AUTH REQUIRED (Firebase token):
    POST /attempt         — Record user attempt
  
  ADMIN ONLY (API key):
    POST   /admin/upload-pdf       — Upload + process PDF
    PATCH  /admin/questions/{id}    — Toggle is_active / edit
    DELETE /admin/questions/{id}    — Hard delete
    GET    /admin/questions         — All questions (including inactive)
"""
import patch_print
import concurrent.futures as _cf
import hashlib
import os
import secrets
import json
import time
import tempfile
import threading
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
load_dotenv()

from google import genai as _genai_main
from google.genai import types as _gtypes
from functools import lru_cache
_GENAI_EXECUTOR = _cf.ThreadPoolExecutor(max_workers=4, thread_name_prefix="main-genai")
# Bounded pool for PDF processing jobs — prevents EAGAIN when many uploads arrive simultaneously
_JOB_EXECUTOR = _cf.ThreadPoolExecutor(max_workers=4, thread_name_prefix="job")
_UPLOAD_PDF_DIR = Path(__file__).parent / "uploads" / "pdfs"
_UPLOAD_PDF_DIR.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def _get_main_genai_client():
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    use_vertex_value = (os.getenv("GOOGLE_GENAI_USE_VERTEXAI") or "").strip().lower()
    force_vertex = use_vertex_value in {"1", "true", "yes"}
    force_api_key = use_vertex_value in {"0", "false", "no"}
    use_vertex = force_vertex or (bool(os.getenv("GOOGLE_CLOUD_PROJECT")) and not force_api_key)
    if api_key and not use_vertex:
        return _genai_main.Client(api_key=api_key)
    raw_credentials = (
        os.getenv("GOOGLE_APPLICATION_CREDENTIALS_JSON")
        or os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    )
    if raw_credentials and not os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
        import stat as _stat
        fd, _cred_path = tempfile.mkstemp(suffix=".json")
        os.fchmod(fd, _stat.S_IRUSR | _stat.S_IWUSR)  # 0o600 — owner only
        with os.fdopen(fd, "w", encoding="utf-8") as _f:
            _f.write(raw_credentials)
        credentials_path = Path(_cred_path)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(credentials_path)
    return _genai_main.Client(
        vertexai=True,
        project=os.getenv("GOOGLE_CLOUD_PROJECT"),
        location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
    )


def _persist_uploaded_pdf(content: bytes, storage_key: str, original_filename: str) -> str:
    suffix = Path(original_filename or "upload.pdf").suffix.lower()
    if suffix != ".pdf":
        suffix = ".pdf"
    safe_key = re.sub(r"[^a-zA-Z0-9_.-]", "_", storage_key)
    target = _UPLOAD_PDF_DIR / f"{safe_key}{suffix}"
    if not target.exists() or target.stat().st_size != len(content):
        target.write_bytes(content)
    return str(target.resolve())


def _resolve_job_pdf_path(job_row: dict) -> str:
    candidates: list[str] = []
    direct = str(job_row.get("pdf_path") or "").strip()
    if direct:
        candidates.append(direct)

    paper_id = job_row.get("paper_id")
    if paper_id:
        try:
            paper_res = (
                supabase.table("papers")
                .select("source_pdf_path")
                .eq("id", paper_id)
                .limit(1)
                .execute()
            )
            paper_rows = paper_res.data or []
            if paper_rows:
                source_pdf = str(paper_rows[0].get("source_pdf_path") or "").strip()
                if source_pdf:
                    candidates.append(source_pdf)
        except Exception:
            pass

    for path in candidates:
        if path and os.path.exists(path):
            return path
    return direct

from fastapi import BackgroundTasks, FastAPI, HTTPException, Header, Query, Depends, UploadFile, File, Form, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel, Field

from config import supabase, verify_firebase_token
from extractor.pattern_book_classifier import classify_pattern_book_pdf
from extractor.pattern_book_gemini_pilot import extract_pattern_book_question_pages_with_gemini
from extractor.pattern_book_gemini_stage12 import run_pattern_book_gemini_stage12
from extractor.pattern_book_phase_c_drafts import build_pattern_book_normalized_draft
from extractor.pattern_book_raw_blocks import build_phase_c_readiness_audit
from extraction_cleanup import clean_extracted_question
from canonical_taxonomy import apply_canonical_taxonomy, derive_canonical_taxonomy
from papers import (
    ensure_paper_for_existing_exam,
    ensure_paper_for_upload,
    get_latest_paper_for_exam,
    latest_live_exam_keys,
    latest_live_paper_ids,
    link_job_to_paper,
    mark_paper_lifecycle,
    normalize_exam_name,
    paper_id_for_job,
    public_paper_ids,
    recompute_practice_ready_for_all,
    recompute_practice_ready_for_exam,
    refresh_paper_publish_state,
    refresh_question_publish_state,
    resolve_paper_id,
    sync_paper_question_counts,
)
from row_quality import merge_quality_fields
from freeze_admin_catalog import freeze_current_admin_catalog
from public_metadata_helpers import (
    build_catalog_from_meta,
    build_exam_outline,
    build_exam_paper_manifest_from_rows,
    build_feed_from_meta,
    prefer_current_public_manifest_rows,
    public_row_identity,
    row_matches_search,
    safe_cursor_to_index,
)
from public_metadata_queries import collect_public_exam_rows
from public_metadata_queries import collect_public_question_meta_rows
from public_metadata_queries import build_exam_paper_manifest
from public_metadata_queries import stream_public_exam_page

# ── App ──────────────────────────────────────────────────
app = FastAPI(
    title="UPSC AI Strategy Engine API",
    version="2.0.0",
    description="Admin-managed exam platform. Users consume questions, admin manages content.",
)


@app.on_event("startup")
async def _pre_warm_firebase_keys():
    """Firebase key warm-up is handled at import time in config.py."""
    pass

_cors_origins = (
    os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://localhost:4000,http://127.0.0.1:4000,http://localhost:4001,http://127.0.0.1:4001",
    )
    .split(",")
)
_cors_origin_regex = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"^https://.*\.up\.railway\.app$",
).strip() or None

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Admin-Key"],
)

# ── Rate limiting (in-memory sliding window, Priority 6) ─────────────────────
import collections
_rate_limit_store: dict[str, collections.deque] = {}
_RL_WINDOW_S = 60
_RL_MAX_PUBLIC = 120   # req/min for unauthenticated public endpoints
_RL_MAX_AUTH   = 300   # req/min for authenticated users

_RL_CLEANUP_COUNTER = 0
_RL_CLEANUP_INTERVAL = 500  # clean stale IPs every N requests

class _RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Ignore browser preflight noise and localhost admin traffic.
        # The admin UI fans out many parallel fetches (especially explanations),
        # and counting OPTIONS + authenticated admin reads against the same
        # per-IP bucket causes false 429s during normal use.
        if request.method == "OPTIONS":
            return await call_next(request)

        now = time.time()
        # In production behind Railway/Render/Nginx the real client IP arrives
        # via X-Forwarded-For. Fall back to the direct connection host only when
        # no forwarding header is present (local dev).
        forwarded_for = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        ip = forwarded_for or (request.client.host if request.client else "unknown")
        is_localhost = ip in {"127.0.0.1", "::1", "localhost"}
        is_admin_request = request.url.path.startswith("/admin/")
        admin_key = request.headers.get("x-admin-key")
        if is_localhost and is_admin_request and admin_key and secrets.compare_digest(admin_key, os.getenv("ADMIN_API_KEY") or ""):
            return await call_next(request)

        # Periodically evict IPs that have had no requests in the last window —
        # prevents the dict from growing unbounded with unique IPs over days of traffic.
        global _RL_CLEANUP_COUNTER
        _RL_CLEANUP_COUNTER += 1
        if _RL_CLEANUP_COUNTER >= _RL_CLEANUP_INTERVAL:
            _RL_CLEANUP_COUNTER = 0
            cutoff = now - _RL_WINDOW_S * 2
            stale = [k for k, dq in _rate_limit_store.items() if not dq or dq[-1] < cutoff]
            for k in stale:
                del _rate_limit_store[k]

        key = ip
        limit = _RL_MAX_AUTH if request.headers.get("Authorization") else _RL_MAX_PUBLIC
        dq = _rate_limit_store.setdefault(key, collections.deque())
        while dq and now - dq[0] > _RL_WINDOW_S:
            dq.popleft()
        if len(dq) >= limit:
            return JSONResponse({"detail": "Rate limit exceeded. Try again in a minute."}, status_code=429)
        dq.append(now)
        return await call_next(request)

app.add_middleware(_RateLimitMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1000)

_raw_admin_key = os.getenv("ADMIN_API_KEY")
if not _raw_admin_key:
    raise RuntimeError("ADMIN_API_KEY env var is not set — refusing to start without it")
ADMIN_API_KEY = _raw_admin_key
ADMIN_EMAILS = {
    email.strip().lower()
    for email in os.getenv("ADMIN_EMAILS", "").split(",")
    if email.strip()
}


def _admin_disable_paper_locks() -> bool:
    return os.getenv("ADMIN_DISABLE_PAPER_LOCKS", "").strip().lower() in {"1", "true", "yes", "on"}

# ── In-process metadata cache ─────────────────────────────
# /questions/meta is called on every user login. Cache the result for
# 2 minutes so 100 simultaneous logins = 1 Supabase query, not 100.
_meta_cache: dict | None = None
_meta_cache_ts: float = 0.0
_META_CACHE_TTL = 900  # seconds
_catalog_cache: dict | None = None
_catalog_cache_ts: float = 0.0
_feed_cache: dict | None = None
_feed_cache_ts: float = 0.0
_meta_snapshot_lock = threading.Lock()
_meta_warm_thread: threading.Thread | None = None
_PUBLIC_META_CACHE_FILE = Path(__file__).parent / "cache" / "public_meta_snapshot.json"
_admin_meta_cache: list | None = None
_admin_meta_cache_ts: float = 0.0
_practice_ready_present_cache: bool | None = None
_practice_ready_present_cache_ts: float = 0.0
_ADMIN_META_CACHE_TTL = 30  # seconds — shorter so admin sees fresh data sooner
_publish_gate_cache: dict | None = None
_publish_gate_cache_ts: float = 0.0
_PUBLISH_GATE_TTL = 120  # seconds
_topic_bucket_cache: dict[tuple[bool, str, str], tuple[float, list[dict]]] = {}
_TOPIC_BUCKET_CACHE_TTL = 600  # 10 minutes — topics change rarely during a session
_topic_first_page_cache: dict[tuple[str, str, int], tuple[float, dict]] = {}
_TOPIC_FIRST_PAGE_CACHE_TTL = 900  # 15 minutes — first topic page is the critical UX path
# Per-exam question cache — keyed by (exam_name, exam_year, is_admin).
# Avoids hitting Supabase on every exam open; TTL 5 min (admin) / 10 min (public).
_exam_qs_cache: dict[tuple[str, int, bool], tuple[float, list[dict]]] = {}
_EXAM_QS_CACHE_TTL_ADMIN  = 300   # 5 min
_EXAM_QS_CACHE_TTL_PUBLIC = 600   # 10 min

_stats_cache: dict | None = None
_stats_cache_ts: float = 0.0
_STATS_CACHE_TTL = 300  # 5 minutes

# Leaderboard cache — keyed by (commissions_str, time_filter).
# Avoids a full user_attempts table scan on every request; TTL 2 min.
_leaderboard_cache: dict[tuple[str, str], tuple[float, dict]] = {}
_LEADERBOARD_CACHE_TTL = 120  # 2 minutes

# Free-papers cache — frozenset of (exam_name_lower, year) pairs accessible on free plan.
# Derived from catalog snapshot; refreshed every 15 min.
_free_papers_cache: frozenset | None = None
_free_papers_cache_ts: float = 0.0
_FREE_PAPERS_CACHE_TTL = 900  # 15 min

# Per-user subscription cache — avoids a Supabase hit on every paginated question fetch.
_subscription_cache: dict[str, tuple[float, dict]] = {}
_SUBSCRIPTION_CACHE_TTL = 300  # 5 min

_REUPLOAD_STRUCTURAL_THRESHOLD_MIN = 3
_REUPLOAD_STRUCTURAL_THRESHOLD_PCT = 0.05
_question_supported_columns_cache: set[str] | None = None
# Cached set of publishable paper IDs — avoids hitting papers table on every /questions call.
_publishable_paper_ids_cache: set[str] | None = None
_publishable_paper_ids_cache_ts: float = 0.0

_free_paper_ids_cache: set[str] | None = None
_free_paper_ids_cache_ts: float = 0.0
_FREE_PAPER_IDS_TTL = 300  # 5 min
_PUBLISHABLE_PAPER_IDS_TTL = 60  # seconds

_DEVANAGARI_RE = re.compile(r'[\u0900-\u097F]')
_TELUGU_RE = re.compile(r'[\u0C00-\u0C7F]')
_MATCH_CODE_OPT_RE = re.compile(
    r'^\s*(?:'
    r'(?:\d+\s*[-–]\s*[A-D](?:\s*,\s*\d+\s*[-–]\s*[A-D]){1,7})'
    r'|'
    r'(?:[A-D]\s*[-–]\s*\d+(?:\s*,\s*[A-D]\s*[-–]\s*\d+){1,7})'
    r')\s*$',
    re.IGNORECASE,
)

def _public_include_all_questions() -> bool:
    raw = os.getenv("PUBLIC_INCLUDE_ALL_QUESTIONS", "0").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def _get_publishable_paper_ids() -> set[str]:
    """Return cached set of latest live paper IDs. Refreshes every 60 s."""
    global _publishable_paper_ids_cache, _publishable_paper_ids_cache_ts
    if _public_include_all_questions():
        return set()
    now = time.time()
    if _publishable_paper_ids_cache is not None and (now - _publishable_paper_ids_cache_ts) < _PUBLISHABLE_PAPER_IDS_TTL:
        return _publishable_paper_ids_cache
    ids = latest_live_paper_ids(sb=supabase)
    _publishable_paper_ids_cache = ids
    _publishable_paper_ids_cache_ts = now
    return ids


def _invalidate_meta_cache() -> None:
    global _meta_cache, _meta_cache_ts, _catalog_cache, _catalog_cache_ts, _feed_cache, _feed_cache_ts, _admin_meta_cache, _admin_meta_cache_ts, _publish_gate_cache, _publish_gate_cache_ts, _topic_bucket_cache, _topic_first_page_cache, _publishable_paper_ids_cache, _publishable_paper_ids_cache_ts, _exam_qs_cache, _practice_ready_present_cache, _practice_ready_present_cache_ts, _stats_cache, _stats_cache_ts, _leaderboard_cache
    with _meta_snapshot_lock:
        _meta_cache = None
        _meta_cache_ts = 0.0
        _catalog_cache = None
        _catalog_cache_ts = 0.0
        _feed_cache = None
        _feed_cache_ts = 0.0
        _admin_meta_cache = None
        _admin_meta_cache_ts = 0.0
        _publish_gate_cache = None
        _publish_gate_cache_ts = 0.0
        _topic_bucket_cache = {}
        _topic_first_page_cache = {}
        _publishable_paper_ids_cache = None
        _publishable_paper_ids_cache_ts = 0.0
        _exam_qs_cache = {}
        _practice_ready_present_cache = None
        _practice_ready_present_cache_ts = 0.0
        _stats_cache = None
        _stats_cache_ts = 0.0
        _leaderboard_cache = {}
    try:
        _PUBLIC_META_CACHE_FILE.unlink(missing_ok=True)
    except Exception:
        pass
    _schedule_public_meta_warm("invalidate")


def _meta_cache_control_header() -> str:
    return "public, max-age=300, stale-while-revalidate=1800"


def _write_public_meta_snapshot(payload: dict) -> None:
    try:
        _PUBLIC_META_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = _PUBLIC_META_CACHE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload), encoding="utf-8")
        tmp.replace(_PUBLIC_META_CACHE_FILE)
    except Exception:
        pass


def _read_public_meta_snapshot(now: float) -> dict[str, Any] | None:
    if not _PUBLIC_META_CACHE_FILE.exists():
        return None
    try:
        payload = json.loads(_PUBLIC_META_CACHE_FILE.read_text(encoding="utf-8"))
        if not isinstance(payload.get("questions_meta"), dict):
            return None
        if not isinstance(payload.get("catalog"), dict):
            return None
        if not isinstance(payload.get("feed"), dict):
            return None
        return payload
    except Exception:
        return None


def _hydrate_public_meta_caches(payload: dict) -> None:
    global _meta_cache, _meta_cache_ts, _catalog_cache, _catalog_cache_ts, _feed_cache, _feed_cache_ts
    ts = float(payload.get("ts") or time.time())
    _meta_cache = payload["questions_meta"]
    _meta_cache_ts = ts
    _catalog_cache = payload["catalog"]
    _catalog_cache_ts = ts
    _feed_cache = payload["feed"]
    _feed_cache_ts = ts


def _get_public_meta_snapshot() -> dict[str, Any]:
    global _meta_cache, _meta_cache_ts, _catalog_cache, _catalog_cache_ts, _feed_cache, _feed_cache_ts

    now = time.time()
    if (
        _meta_cache is not None and
        _catalog_cache is not None and
        _feed_cache is not None
    ):
        return {
            "ts": min(_meta_cache_ts, _catalog_cache_ts, _feed_cache_ts),
            "questions_meta": _meta_cache,
            "catalog": _catalog_cache,
            "feed": _feed_cache,
        }

    with _meta_snapshot_lock:
        now = time.time()
        if (
            _meta_cache is not None and
            _catalog_cache is not None and
            _feed_cache is not None
        ):
            return {
                "ts": min(_meta_cache_ts, _catalog_cache_ts, _feed_cache_ts),
                "questions_meta": _meta_cache,
                "catalog": _catalog_cache,
                "feed": _feed_cache,
            }

        persisted = _read_public_meta_snapshot(now)
        if persisted is not None:
            _hydrate_public_meta_caches(persisted)
            return persisted

        rows = _collect_public_question_meta_rows()
        payload = {
            "ts": now,
            "questions_meta": {"questions": rows, "total": len(rows)},
            "catalog": build_catalog_from_meta(rows),
            "feed": build_feed_from_meta(rows),
        }
        _hydrate_public_meta_caches(payload)
        _write_public_meta_snapshot(payload)
        return payload


def _warm_public_meta_snapshot() -> None:
    try:
        _get_public_meta_snapshot()
        print("[startup] Public metadata snapshot warmed")
    except Exception as exc:
        print(f"[startup] Public metadata warm failed: {exc}")


def _schedule_public_meta_warm(reason: str = "manual") -> None:
    global _meta_warm_thread
    if os.getenv("PUBLIC_META_EAGER_REFRESH", "1").strip().lower() in {"0", "false", "no", "off"}:
        return
    if _meta_warm_thread is not None and _meta_warm_thread.is_alive():
        return

    def _runner() -> None:
        global _meta_warm_thread
        try:
            _warm_public_meta_snapshot()
            print(f"[meta] Public metadata snapshot refreshed ({reason})")
        finally:
            _meta_warm_thread = None

    _meta_warm_thread = threading.Thread(
        target=_runner,
        name=f"warm-public-meta-{reason}",
        daemon=True,
    )
    _meta_warm_thread.start()


def _question_supported_columns() -> set[str]:
    global _question_supported_columns_cache
    if _question_supported_columns_cache is not None:
        return _question_supported_columns_cache

    fallback = {
        "question_text", "option_a", "option_b", "option_c", "option_d",
        "correct_answer", "correct_answers", "subject", "topic", "subtopic", "difficulty",
        "canonical_subject", "canonical_topic_family", "canonical_subtopic_family",
        "question_type", "concept", "exam_name", "exam_year", "source_pdf",
        "paper_id", "question_hash", "question_number", "is_active",
        "needs_review", "has_image", "image_url", "shift_label",
        "updated_at",
        "test_date", "test_time", "exam_section", "passage",
        "structural_status", "answer_status", "explanation_status",
        "tagging_status", "review_required", "confidence_score",
        "public_visibility", "practice_ready", "primary_issue_code", "issue_codes",
    }
    try:
        data = supabase.table("questions").select("*").limit(1).execute().data or []
        _question_supported_columns_cache = set(data[0].keys()) if data else fallback
    except Exception:
        _question_supported_columns_cache = fallback
    return _question_supported_columns_cache


def _question_select_clause(base_cols: list[str], supported_cols: set[str] | None = None) -> str:
    supported = supported_cols or _question_supported_columns()
    # Always include 'id' regardless of caller list.
    cols = [c for c in base_cols if c in supported or c == "id"]
    for optional in ("canonical_subject", "canonical_topic_family", "canonical_subtopic_family"):
        if optional in supported and optional not in cols:
            cols.append(optional)
    return ", ".join(cols)


def _practice_ready_mode(supported_cols: set[str] | None = None) -> bool:
    supported = supported_cols or _question_supported_columns()
    if _public_include_all_questions() or ("practice_ready" not in supported):
        return False

    raw = os.getenv("PUBLIC_USE_PRACTICE_READY", "auto").strip().lower()
    if raw in {"0", "false", "no", "off"}:
        return False

    global _practice_ready_present_cache, _practice_ready_present_cache_ts
    now = time.time()
    if _practice_ready_present_cache is not None and (now - _practice_ready_present_cache_ts) < 60:
        present = _practice_ready_present_cache
    else:
        present = False
        try:
            res = (
                supabase.table("questions")
                .select("id")
                .eq("practice_ready", True)
                .limit(1)
                .execute()
            )
            present = bool(res.data)
        except Exception:
            present = False
        _practice_ready_present_cache = present
        _practice_ready_present_cache_ts = now

    if raw in {"1", "true", "yes", "on"}:
        return present
    return present


def _apply_public_question_filter(query, supported_cols: set[str] | None = None):
    supported = supported_cols or _question_supported_columns()
    if _public_include_all_questions():
        if "is_active" in supported:
            return query.eq("is_active", True)
        return query
    if _practice_ready_mode(supported):
        return query.eq("practice_ready", True)
    if "is_active" in supported:
        query = query.eq("is_active", True)
    return query


def _row_is_public(row: dict, supported_cols: set[str] | None = None) -> bool:
    supported = supported_cols or _question_supported_columns()
    if _public_include_all_questions():
        return row.get("is_active", True) is True
    if "public_visibility" in supported and row.get("public_visibility") == "hidden_structural":
        return False
    if _practice_ready_mode(supported):
        return row.get("practice_ready") is True
    if "is_active" in supported:
        return row.get("is_active", True) is True
    return True


def _filter_question_write_payload(payload: dict, supported_cols: set[str] | None = None) -> dict:
    supported = supported_cols or _question_supported_columns()
    return {key: value for key, value in payload.items() if key in supported}


def _topic_first_page_questions(
    *,
    subject: str,
    topic: str,
    limit: int,
) -> dict:
    cache_key = (subject.strip(), topic.strip(), limit)
    now = time.time()
    cached = _topic_first_page_cache.get(cache_key)
    if cached and (now - cached[0]) <= _TOPIC_FIRST_PAGE_CACHE_TTL:
        result = dict(cached[1])
        result["cache"] = "first-page-hit"
        return result

    t0 = time.perf_counter()
    supported_cols = _question_supported_columns()
    base_cols = [
        "id", "question_text", "option_a", "option_b", "option_c", "option_d",
        "correct_answer", "correct_answers", "answer_status", "subject", "topic", "subtopic", "difficulty", "exam_name", "exam_year",
        "question_type", "concept", "question_number", "needs_review", "has_image", "image_url", "paper_id", "practice_ready", "updated_at",
        "pattern_tag", "trap_tag", "skill_tag", "question_style", "pattern_confidence", "pattern_reason", "solve_hint",
    ]
    if "is_active" in supported_cols and "is_active" not in base_cols:
        base_cols.append("is_active")
    if "public_visibility" in supported_cols and "public_visibility" not in base_cols:
        base_cols.append("public_visibility")
    select_clause = _question_select_clause(base_cols, supported_cols)

    has_canonical_subject = "canonical_subject" in supported_cols
    has_canonical_topic = "canonical_topic_family" in supported_cols
    subject_col = "canonical_subject" if has_canonical_subject else "subject"
    topic_col = "canonical_topic_family" if has_canonical_topic else "topic"

    practice_mode = _practice_ready_mode(supported_cols)
    publishable_paper_ids = None if (_public_include_all_questions() or practice_mode) else latest_live_paper_ids(sb=supabase)
    query_start = time.perf_counter()
    fetch_limit = max(limit * 4, 80)
    q = _apply_public_question_filter(supabase.table("questions").select(select_clause), supported_cols)
    q = q.eq(subject_col, subject.strip()).eq(topic_col, topic.strip())
    if "updated_at" in supported_cols:
        q = q.order("updated_at", desc=True)
    q = q.order("created_at", desc=True).range(0, fetch_limit - 1)
    result = q.execute()
    query_ms = (time.perf_counter() - query_start) * 1000

    sanitize_start = time.perf_counter()
    questions: list[dict] = []
    seen_keys: set[tuple[str, ...]] = set()
    for row in result.data or []:
        if not _row_matches_selected_papers(row, publishable_paper_ids):
            continue
        row_key = public_row_identity(row)
        if row_key in seen_keys:
            continue
        sanitized = _sanitize_public_question_row(row)
        if sanitized is None:
            continue
        if sanitized.get("subject") != subject or sanitized.get("topic") != topic:
            continue
        seen_keys.add(row_key)
        questions.append(sanitized)
        if len(questions) >= limit:
            break
    sanitize_ms = (time.perf_counter() - sanitize_start) * 1000

    has_more = len(result.data or []) >= fetch_limit or len(questions) >= limit
    response = {
        "questions": questions[:limit],
        "total": max(len(questions), limit + 1 if has_more else len(questions)),
        "limit": limit,
        "offset": 0,
        "has_more": has_more,
        "cache": "first-page-miss",
    }
    _topic_first_page_cache[cache_key] = (now, response)
    total_ms = (time.perf_counter() - t0) * 1000
    if total_ms >= 250:
        print(
            "[topic-questions] first-page "
            f"subject={subject!r} topic={topic!r} rows={len(questions)} "
            f"query_ms={query_ms:.1f} sanitize_ms={sanitize_ms:.1f} total_ms={total_ms:.1f}"
        )
    return response


def _topic_bucket_questions(
    *,
    subject: str,
    topic: str,
    admin_mode: bool,
    limit: int,
    offset: int,
) -> dict:
    t0 = time.perf_counter()
    cache_key = (admin_mode, subject.strip(), topic.strip())
    cached = _topic_bucket_cache.get(cache_key)
    now = time.time()
    if cached and (now - cached[0]) <= _TOPIC_BUCKET_CACHE_TTL:
        cached_rows = cached[1]
        page = cached_rows[offset: offset + limit]
        return {
            "questions": page,
            "total": len(cached_rows),
            "limit": limit,
            "offset": offset,
            "has_more": (offset + len(page)) < len(cached_rows),
        }

    supported_cols = _question_supported_columns()
    base_cols = [
        "id", "question_text", "option_a", "option_b", "option_c", "option_d",
        "correct_answer", "correct_answers", "answer_status", "subject", "topic", "subtopic", "difficulty", "exam_name", "exam_year",
        "question_type", "concept", "question_number", "needs_review", "has_image", "image_url", "paper_id", "practice_ready", "updated_at",
        "pattern_tag", "trap_tag", "skill_tag", "question_style", "pattern_confidence", "pattern_reason", "solve_hint",
    ]
    if "is_active" in supported_cols and "is_active" not in base_cols:
        base_cols.append("is_active")
    if "public_visibility" in supported_cols and "public_visibility" not in base_cols:
        base_cols.append("public_visibility")
    select_clause = _question_select_clause(base_cols, supported_cols)

    # Use canonical columns for DB-level filtering when available (same approach as /practice)
    has_canonical_subject = "canonical_subject" in supported_cols
    has_canonical_topic = "canonical_topic_family" in supported_cols
    subject_col = "canonical_subject" if has_canonical_subject else "subject"
    topic_col = "canonical_topic_family" if has_canonical_topic else "topic"

    practice_mode = _practice_ready_mode(supported_cols)
    publishable_paper_ids = None if (admin_mode or _public_include_all_questions() or practice_mode) else latest_live_paper_ids(sb=supabase)
    all_data: list[dict] = []
    seen_keys: set[tuple[str, ...]] = set()
    scan_offset = 0
    query_ms = 0.0
    sanitize_ms = 0.0
    while True:
        q = supabase.table("questions").select(select_clause)
        if admin_mode:
            if "is_active" in supported_cols:
                q = q.eq("is_active", True)
        else:
            q = _apply_public_question_filter(q, supported_cols)
        # DB-level filter — avoids full table scan; only fetch rows matching this topic
        q = q.eq(subject_col, subject.strip()).eq(topic_col, topic.strip())
        if "updated_at" in supported_cols:
            q = q.order("updated_at", desc=True)
        q = q.order("created_at", desc=True).range(scan_offset, scan_offset + 999)
        query_start = time.perf_counter()
        result = q.execute()
        query_ms += (time.perf_counter() - query_start) * 1000
        batch = result.data or []
        if not batch:
            break

        sanitize_start = time.perf_counter()
        for row in batch:
            if not admin_mode and publishable_paper_ids is not None and str(row.get("paper_id")) not in publishable_paper_ids:
                continue
            row_key = public_row_identity(row)
            if row_key in seen_keys:
                continue
            sanitized = _sanitize_public_question_row(row)
            if sanitized is None:
                continue
            # Guard: canonical taxonomy may remap edge cases; final values must match
            if sanitized.get("subject") != subject or sanitized.get("topic") != topic:
                continue
            seen_keys.add(row_key)
            all_data.append(sanitized)
        sanitize_ms += (time.perf_counter() - sanitize_start) * 1000

        if len(batch) < 1000:
            break
        scan_offset += 1000

    sort_start = time.perf_counter()
    all_data.sort(
        key=lambda row: (
            -(int(row.get("year") or row.get("exam_year") or 0)),
            str(row.get("exam") or row.get("exam_name") or ""),
            _safe_question_number_sort_value(row.get("question_number")),
            str(row.get("id") or ""),
        )
    )
    sort_ms = (time.perf_counter() - sort_start) * 1000
    _topic_bucket_cache[cache_key] = (now, all_data)

    total = len(all_data)
    page = all_data[offset: offset + limit]
    total_ms = (time.perf_counter() - t0) * 1000
    if total_ms >= 250:
        print(
            "[topic-questions] full-bucket "
            f"subject={subject!r} topic={topic!r} rows={total} offset={offset} "
            f"query_ms={query_ms:.1f} sanitize_ms={sanitize_ms:.1f} sort_ms={sort_ms:.1f} total_ms={total_ms:.1f}"
        )
    return {
        "questions": page,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + len(page)) < total,
    }


def _safe_question_number_sort_value(value) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.isdigit():
            return int(stripped)
    return 10**9


def _row_matches_selected_papers(row: dict, selected_paper_ids: Optional[set[str]]) -> bool:
    if _practice_ready_mode():
        return True
    if selected_paper_ids is None:
        return True
    paper_id = row.get("paper_id")
    if not paper_id:
        # Keep legacy rows that predate the papers table so they do not vanish
        # from the public catalog.
        return True
    return str(paper_id) in selected_paper_ids


def _collect_public_exam_rows(
    *,
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
    paper_id: Optional[str] = None,
    shift_label: Optional[str] = None,
    subject: Optional[str] = None,
    topic: Optional[str] = None,
    subtopic: Optional[str] = None,
    difficulty: Optional[str] = None,
    search: Optional[str] = None,
    scoped_by_selector: bool = False,
) -> list[dict]:
    return collect_public_exam_rows(
        exam_name=exam_name,
        exam_year=exam_year,
        paper_id=paper_id,
        shift_label=shift_label,
        subject=subject,
        topic=topic,
        subtopic=subtopic,
        difficulty=difficulty,
        search=search,
        scoped_by_selector=scoped_by_selector,
        normalize_exam_name=normalize_exam_name,
        exam_qs_cache=_exam_qs_cache,
        exam_qs_cache_ttl_public=_EXAM_QS_CACHE_TTL_PUBLIC,
        now_ts=time.time(),
        public_include_all_questions=_public_include_all_questions,
        question_supported_columns=_question_supported_columns,
        practice_ready_mode=_practice_ready_mode,
        latest_live_paper_ids=latest_live_paper_ids,
        latest_live_exam_keys=latest_live_exam_keys,
        get_publishable_paper_ids=_get_publishable_paper_ids,
        question_select_clause=_question_select_clause,
        apply_public_question_filter=_apply_public_question_filter,
        supabase=supabase,
        row_matches_selected_papers=_row_matches_selected_papers,
        public_row_identity=public_row_identity,
        sanitize_public_question_row=_sanitize_public_question_row,
        row_matches_search=row_matches_search,
        merge_public_duplicate_row=_merge_public_duplicate_row,
    )


def _get_free_paper_ids() -> set[str]:
    """Retrieve and cache the set of paper IDs belonging to free exams."""
    global _free_paper_ids_cache, _free_paper_ids_cache_ts
    now = time.time()
    if _free_paper_ids_cache is not None and (now - _free_paper_ids_cache_ts) < _FREE_PAPER_IDS_TTL:
        return _free_paper_ids_cache
    try:
        free_keys = _get_free_papers_set()
        if not free_keys:
            return set()
        res = supabase.table("papers").select("id, exam_name, exam_year").execute()
        rows = res.data or []
        ids = set()
        for r in rows:
            name = str(r.get("exam_name") or "").strip().lower()
            year = int(r.get("exam_year") or 0)
            if (name, year) in free_keys:
                ids.add(str(r["id"]))
        _free_paper_ids_cache = ids
        _free_paper_ids_cache_ts = now
        return ids
    except Exception as e:
        print(f"WARN _get_free_paper_ids failed: {e}")
        return set()


def _stream_public_exam_page(
    *,
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
    paper_id: Optional[str] = None,
    shift_label: Optional[str] = None,
    subject: Optional[str] = None,
    topic: Optional[str] = None,
    subtopic: Optional[str] = None,
    difficulty: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
    allowed_paper_ids_override: Optional[set[str]] = None,
) -> dict:
    return stream_public_exam_page(
        exam_name=exam_name,
        exam_year=exam_year,
        paper_id=paper_id,
        shift_label=shift_label,
        subject=subject,
        topic=topic,
        subtopic=subtopic,
        difficulty=difficulty,
        search=search,
        limit=limit,
        offset=offset,
        normalize_exam_name=normalize_exam_name,
        public_include_all_questions=_public_include_all_questions,
        question_supported_columns=_question_supported_columns,
        practice_ready_mode=_practice_ready_mode,
        latest_live_paper_ids=latest_live_paper_ids,
        latest_live_exam_keys=latest_live_exam_keys,
        get_publishable_paper_ids=lambda: allowed_paper_ids_override if allowed_paper_ids_override is not None else _get_publishable_paper_ids(),
        question_select_clause=_question_select_clause,
        apply_public_question_filter=_apply_public_question_filter,
        supabase=supabase,
        row_matches_selected_papers=_row_matches_selected_papers,
        public_row_identity=public_row_identity,
        sanitize_public_question_row=_sanitize_public_question_row,
        row_matches_search=row_matches_search,
        merge_public_duplicate_row=_merge_public_duplicate_row,
    )


def _build_exam_paper_manifest(exam_name: str, exam_year: int) -> dict:
    manifest = build_exam_paper_manifest(
        exam_name=exam_name,
        exam_year=exam_year,
        collect_public_exam_rows=_collect_public_exam_rows,
        build_exam_paper_manifest_from_rows=build_exam_paper_manifest_from_rows,
    )
    current_public_ids = public_paper_ids(
        exam_name=exam_name,
        exam_year=exam_year,
        sb=supabase,
    )
    filtered_rows = prefer_current_public_manifest_rows(
        _collect_public_exam_rows(
            exam_name=exam_name,
            exam_year=exam_year,
            scoped_by_selector=True,
        ),
        current_public_ids,
    )
    if len(filtered_rows) == manifest.get("total_count", 0):
        return manifest
    return build_exam_paper_manifest_from_rows(filtered_rows, exam_name, exam_year)


def _collect_public_question_meta_rows() -> list[dict]:
    supported_cols = _question_supported_columns()
    include_all_or_practice = _public_include_all_questions() or _practice_ready_mode(supported_cols)
    publishable_ids = None if include_all_or_practice else _get_publishable_paper_ids()
    publishable_exam_keys = None if include_all_or_practice else latest_live_exam_keys(sb=supabase)
    
    base_cols = [
        "id", "exam_name", "exam_year", "subject", "topic", "subtopic", "difficulty", "paper_id",
        "question_number", "question_hash", "created_at", "practice_ready", "shift_label",
        "canonical_subject", "canonical_topic_family", "canonical_subtopic_family",
    ]
    if "public_visibility" in supported_cols:
        base_cols.append("public_visibility")

    select_clause = _question_select_clause(base_cols, supported_cols)
    return collect_public_question_meta_rows(
        supabase=supabase,
        supported_cols=supported_cols,
        select_clause=select_clause,
        publishable_ids=publishable_ids,
        publishable_exam_keys=publishable_exam_keys,
        apply_public_question_filter=_apply_public_question_filter,
        row_matches_selected_papers=_row_matches_selected_papers,
        public_row_identity=public_row_identity,
    )


def _dedupe_admin_meta_rows(rows: list[dict]) -> list[dict]:
    grouped: dict[tuple[str, int], list[dict]] = {}
    passthrough: list[dict] = []
    for row in rows:
        exam_name = str(row.get("exam_name") or "").strip()
        exam_year = int(row.get("exam_year") or 0)
        if exam_name and exam_year > 0:
            grouped.setdefault((exam_name, exam_year), []).append(row)
        else:
            passthrough.append(row)

    deduped: list[dict] = []
    for (exam_name, exam_year), candidates in grouped.items():
        deduped.extend(_dedupe_exam_rows_for_admin_session(candidates, exam_name, exam_year))
    deduped.extend(passthrough)
    return deduped


def _dedupe_exam_rows_for_admin_session(
    rows: list[dict],
    exam_name: str,
    exam_year: int,
) -> list[dict]:
    normalized_exam_name = normalize_exam_name(exam_name)
    latest_paper = get_latest_paper_for_exam(normalized_exam_name, int(exam_year), sb=supabase)
    selected_paper_id = str((latest_paper or {}).get("id") or "")

    grouped: dict[tuple[object, ...], list[dict]] = {}
    for row in rows:
        qnum = row.get("question_number")
        # Scope the dedup key by paper_id + shift_label so that questions
        # from different shifts (e.g. AP High Court Shift 1 vs Shift 2)
        # sharing the same question_number are NOT incorrectly collapsed.
        paper_scope = str(row.get("paper_id") or "").strip() or str(row.get("shift_label") or "").strip() or ""
        if isinstance(qnum, int) and qnum > 0:
            key = ("qnum", paper_scope, qnum) if paper_scope else ("qnum", qnum)
        else:
            key = ("id", str(row.get("id") or ""))
        grouped.setdefault(key, []).append(row)

    def _pick_best(candidates: list[dict]) -> dict:
        def _sort_key(item: dict) -> tuple[int, int, int, str, str]:
            paper_match = 1 if selected_paper_id and str(item.get("paper_id") or "") == selected_paper_id else 0
            structurally_valid = 0 if str(item.get("structural_status") or "") == "broken" else 1
            visible = 1 if str(item.get("public_visibility") or "") == "visible" else 0
            created = str(item.get("created_at") or "")
            qid = str(item.get("id") or "")
            return (paper_match, structurally_valid, visible, created, qid)

        return sorted(candidates, key=_sort_key, reverse=True)[0]

    deduped = [_pick_best(candidates) for candidates in grouped.values() if candidates]
    return sorted(
        deduped,
        key=lambda item: (
            item.get("question_number") is None,
            item.get("question_number") if isinstance(item.get("question_number"), int) else 10**9,
            str(item.get("created_at") or ""),
        ),
    )


def _regional_script_ratio(text: str) -> float:
    alpha = [c for c in text if c.isalpha()]
    if not alpha:
        return 0.0
    regional = sum(1 for c in alpha if _DEVANAGARI_RE.match(c) or _TELUGU_RE.match(c))
    return regional / len(alpha)


def _question_publish_issue(q: dict) -> Optional[str]:
    reasons = _row_base_reasons(q)
    structural = [r for r in reasons if r in _STRUCTURAL_ROW_REASONS]
    return structural[0] if structural else None


def _structural_failure_threshold(question_count: int) -> int:
    scaled = int(question_count * _REUPLOAD_STRUCTURAL_THRESHOLD_PCT)
    if (question_count * _REUPLOAD_STRUCTURAL_THRESHOLD_PCT) > scaled:
        scaled += 1
    return max(_REUPLOAD_STRUCTURAL_THRESHOLD_MIN, scaled)


def _compute_publish_gate() -> dict:
    global _publish_gate_cache, _publish_gate_cache_ts
    now = time.time()
    if _publish_gate_cache is not None and (now - _publish_gate_cache_ts) < _PUBLISH_GATE_TTL:
        return _publish_gate_cache

    rows: list[dict] = []
    offset = 0
    while True:
        r = supabase.table("questions").select(
            "id, exam_name, exam_year, question_number, needs_review, correct_answer, "
            "question_text, option_a, option_b, option_c, option_d, question_type, topic"
        ).eq("is_active", True).range(offset, offset + 999).execute()
        batch = r.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    grouped: dict[tuple[str, int], list[dict]] = {}
    for row in rows:
        key = (str(row.get("exam_name") or ""), int(row.get("exam_year") or 0))
        grouped.setdefault(key, []).append(row)

    publishable_keys: set[tuple[str, int]] = set()
    reports: list[dict] = []
    for (exam_name, exam_year), exam_rows in grouped.items():
        queue = _build_exam_repair_queue(exam_name, exam_year, exam_rows, contradiction_by_qid={})
        assessment = _paper_publish_assessment(exam_rows, queue)
        reason_set = sorted({
            reason
            for item in queue
            if item["publish_blocker"] in {"row", "paper"}
            for reason in item.get("reasons", [])
        })
        bad_samples = [
            f"Q{item['question_number'] if item.get('question_number') is not None else '?'}:{item['issue_type']}"
            for item in queue
            if item["publish_blocker"] in {"row", "paper"}
        ][:20]
        report = {
            "exam_name": exam_name,
            "exam_year": exam_year,
            "question_count": len(exam_rows),
            "publishable": assessment["publishable"],
            "likely_publishable_with_hidden_rows": assessment["likely_publishable_with_hidden_rows"],
            "reupload_needed": assessment["reupload_needed"],
            "visible_question_count": assessment["visible_question_count"],
            "hidden_question_count": assessment["hidden_question_count"],
            "reasons": reason_set,
            "samples": bad_samples[:20],
        }
        reports.append(report)
        if assessment["publishable"]:
            publishable_keys.add((exam_name, exam_year))

    # Include latest paper records that currently have zero active questions.
    # Without this, failed/fully-blocked uploads disappear from the admin
    # review UI because the gate is built only from active question rows.
    try:
        paper_rows = (
            supabase.table("papers")
            .select(
                "exam_name, exam_year, question_count, visible_question_count, "
                "hidden_question_count, publish_status, lifecycle_status, upload_version"
            )
            .execute()
            .data
            or []
        )
        latest_papers: dict[tuple[str, int], dict] = {}
        for paper in paper_rows:
            if paper.get("lifecycle_status") in {"replaced", "archived"}:
                continue
            key = (str(paper.get("exam_name") or ""), int(paper.get("exam_year") or 0))
            current = latest_papers.get(key)
            if current is None or int(paper.get("upload_version") or 0) > int(current.get("upload_version") or 0):
                latest_papers[key] = paper

        existing_keys = {(r["exam_name"], r["exam_year"]) for r in reports}
        for (exam_name, exam_year), paper in latest_papers.items():
            if (exam_name, exam_year) in existing_keys:
                continue
            reports.append({
                "exam_name": exam_name,
                "exam_year": exam_year,
                "question_count": int(paper.get("question_count") or 0),
                "publishable": False,
                "likely_publishable_with_hidden_rows": False,
                "reupload_needed": paper.get("publish_status") == "reupload_needed",
                "visible_question_count": int(paper.get("visible_question_count") or 0),
                "hidden_question_count": int(paper.get("hidden_question_count") or 0),
                "reasons": ["no-active-questions"],
                "samples": [],
            })
    except Exception:
        pass

    result = {
        "publishable_keys": publishable_keys,
        "reports": sorted(reports, key=lambda x: (x["publishable"], x["exam_year"], x["exam_name"])),
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }
    _publish_gate_cache = result
    _publish_gate_cache_ts = now
    return result


def _publishable_exam_keys() -> set[tuple[str, int]]:
    return _compute_publish_gate()["publishable_keys"]


def _resolve_admin_exam_name(exam_name: str, exam_year: int) -> str:
    normalized_name = normalize_exam_name(exam_name)
    if not normalized_name:
        return normalized_name

    try:
        latest_exact = get_latest_paper_for_exam(normalized_name, exam_year, sb=supabase)
        if latest_exact:
            return normalized_name

        paper_rows = (
            supabase.table("papers")
            .select(
                "exam_name, exam_year, upload_version, visible_question_count, question_count, lifecycle_status"
            )
            .eq("exam_year", int(exam_year))
            .execute()
            .data
            or []
        )
    except Exception:
        return normalized_name

    normalized_lower = normalized_name.lower()

    def _match_score(row: dict[str, Any]) -> tuple[int, int, int, int, int]:
        stored_name = normalize_exam_name(str(row.get("exam_name") or ""))
        stored_lower = stored_name.lower()
        exact = 1 if stored_lower == normalized_lower else 0
        contains = 1 if (normalized_lower in stored_lower or stored_lower in normalized_lower) else 0
        visible = int(row.get("visible_question_count") or 0)
        total = int(row.get("question_count") or 0)
        version = int(row.get("upload_version") or 0)
        return (exact, contains, visible, total, version)

    candidates = []
    for row in paper_rows:
        if str(row.get("lifecycle_status") or "") in {"archived", "replaced"}:
            continue
        stored_name = normalize_exam_name(str(row.get("exam_name") or ""))
        stored_lower = stored_name.lower()
        if (
            stored_lower == normalized_lower
            or normalized_lower in stored_lower
            or stored_lower in normalized_lower
        ):
            candidates.append(row)

    if not candidates:
        return normalized_name

    best = max(candidates, key=_match_score)
    return normalize_exam_name(str(best.get("exam_name") or normalized_name))


def _question_rows_for_exam(
    exam_name: str,
    exam_year: int,
    *,
    is_active: Optional[bool] = True,
    latest_only: bool = False,
) -> list[dict]:
    rows: list[dict] = []
    selected_paper_ids: set[str] | None = None
    normalized_name = _resolve_admin_exam_name(exam_name, exam_year)
    if latest_only:
        latest_paper = get_latest_paper_for_exam(
            normalized_name,
            exam_year,
            sb=supabase,
        )
        if latest_paper and latest_paper.get("id"):
            selected_paper_ids = {str(latest_paper["id"])}
    offset = 0
    while True:
        q = supabase.table("questions").select(
            "id, exam_name, exam_year, question_number, needs_review, correct_answer, "
            "question_text, option_a, option_b, option_c, option_d, question_type, topic, "
            "subject, subtopic, difficulty, concept, passage, has_image, image_url, is_active, paper_id"
        ).eq("exam_name", normalized_name).eq("exam_year", exam_year)
        if is_active is not None:
            q = q.eq("is_active", is_active)
        r = q.range(offset, offset + 999).execute()
        batch = r.data or []
        if selected_paper_ids is not None:
            batch = [
                row for row in batch
                if row.get("paper_id") and str(row.get("paper_id")) in selected_paper_ids
            ]
        rows.extend(batch)
        if len(r.data or []) < 1000:
            break
        offset += 1000
    return rows


def _missing_question_numbers_for_exam(
    exam_name: str,
    exam_year: int,
    *,
    expected_count: int = 0,
) -> list[int]:
    rows = _question_rows_for_exam(exam_name, exam_year)
    numbered = sorted(
        int(q["question_number"])
        for q in rows
        if isinstance(q.get("question_number"), int) and int(q.get("question_number")) > 0
    )
    numbered_set = set(numbered)
    max_seen = max(numbered, default=0)
    upper_bound = max(max_seen, int(expected_count or 0))
    if upper_bound <= 0:
        return []
    return [n for n in range(1, upper_bound + 1) if n not in numbered_set]


def _repair_target_numbers_for_exam(
    exam_name: str,
    exam_year: int,
    *,
    expected_count: int = 0,
) -> list[int]:
    from pipeline import is_row_usable_for_recovery

    rows = _question_rows_for_exam(exam_name, exam_year, is_active=None)
    # Brand new uploads may provide expected_count, but that must not force the
    # request into "repair existing paper" mode when there is nothing in the DB
    # yet for this exam-year. Repair mode is only valid when an exam already
    # exists and has real rows to repair.
    if not rows:
        return []
    active_numbers = {
        int(q["question_number"])
        for q in rows
        if q.get("is_active") is True
        and isinstance(q.get("question_number"), int)
        and int(q.get("question_number")) > 0
    }
    usable_active_numbers = {
        int(q["question_number"])
        for q in rows
        if q.get("is_active") is True
        and isinstance(q.get("question_number"), int)
        and int(q.get("question_number")) > 0
        and is_row_usable_for_recovery(q)
    }
    all_numbered = {
        int(q["question_number"])
        for q in rows
        if isinstance(q.get("question_number"), int)
        and int(q.get("question_number")) > 0
    }
    upper_bound = max(max(all_numbered, default=0), int(expected_count or 0))
    if upper_bound <= 0:
        return []
    # Reupload repair should target:
    # 1. completely missing/inactive numbered rows
    # 2. active but structurally broken rows (for example a match-table question
    #    that was stored without a usable __MATCH__ payload)
    return [
        n for n in range(1, upper_bound + 1)
        if n not in active_numbers or n not in usable_active_numbers
    ]


def _count_explanations(question_ids: list[str]) -> int:
    total = 0
    for i in range(0, len(question_ids), 50):
        chunk = question_ids[i:i+50]
        if not chunk:
            continue
        r = supabase.table("explanations").select("question_id", count="exact").in_("question_id", chunk).execute()
        total += int(r.count or 0)
    return total


def _explanation_coverage_summary(rows: list[dict]) -> dict:
    valid_answer = {"A", "B", "C", "D"}
    all_ids = [str(row.get("id") or "") for row in rows if row.get("id")]
    eligible_ids = [
        str(row.get("id") or "")
        for row in rows
        if row.get("id")
        and str(row.get("correct_answer") or "").strip().upper() in valid_answer
        and not bool(row.get("needs_review"))
    ]
    all_generated = _count_explanations(all_ids)
    eligible_generated = _count_explanations(eligible_ids) if eligible_ids else 0
    eligible_total = len(eligible_ids)
    return {
        "generated": all_generated,
        "missing": max(0, len(all_ids) - all_generated),
        "coverage_pct": round((all_generated / max(len(all_ids), 1)) * 100, 1),
        "eligible_total": eligible_total,
        "eligible_generated": eligible_generated,
        "eligible_missing": max(0, eligible_total - eligible_generated),
        "eligible_coverage_pct": round((eligible_generated / max(eligible_total, 1)) * 100, 1),
        "unverified_or_invalid": max(0, len(all_ids) - eligible_total),
    }


def _explanation_contradicts_answer(explanation: str, correct_answer: str) -> bool:
    """Return True when explanation text clearly points to a different option."""
    text = str(explanation or "").strip()
    answer = str(correct_answer or "").strip().upper()
    if not text or answer not in {"A", "B", "C", "D"}:
        return False

    patterns = {
        "A": re.compile(r"\b(?:correct answer|answer)\s*(?:is|:)\s*A\b", re.I),
        "B": re.compile(r"\b(?:correct answer|answer)\s*(?:is|:)\s*B\b", re.I),
        "C": re.compile(r"\b(?:correct answer|answer)\s*(?:is|:)\s*C\b", re.I),
        "D": re.compile(r"\b(?:correct answer|answer)\s*(?:is|:)\s*D\b", re.I),
    }
    implied = [letter for letter, pattern in patterns.items() if pattern.search(text)]
    return len(implied) == 1 and implied[0] != answer


def _canonical_student_question_count(exam_name: str, exam_year: int) -> int:
    """
    Count the exact deduped student-facing rows for one exam-year.

    This is the canonical count that should match the public/admin-on selector,
    even when raw latest-paper visibility differs due to duplicate numbers or
    structurally-hidden placeholder rows.
    """
    try:
        return len(_collect_public_exam_rows(exam_name=exam_name, exam_year=exam_year))
    except Exception:
        return 0


def _exam_quality_report(exam_name: str, exam_year: int) -> dict:
    rows = _question_rows_for_exam(exam_name, exam_year)
    if not rows:
        return {
            "exam_name": exam_name,
            "exam_year": exam_year,
            "question_count": 0,
            "publishable": False,
            "reasons": ["no-active-questions"],
        }

    gate = _compute_publish_gate()
    gate_map = {(r["exam_name"], r["exam_year"]): r for r in gate["reports"]}
    gate_report = gate_map.get((exam_name, exam_year), {})
    contradiction_by_qid = _contradiction_map(exam_name, exam_year)
    repair_queue = _build_exam_repair_queue(exam_name, exam_year, rows, contradiction_by_qid=contradiction_by_qid)
    publish_assessment = _paper_publish_assessment(rows, repair_queue)

    numbered = sorted(int(q["question_number"]) for q in rows if isinstance(q.get("question_number"), int))
    numbered_set = set(numbered)
    max_seen = max(numbered) if numbered else 0
    missing_numbers = [n for n in range(1, max_seen + 1) if n not in numbered_set] if max_seen else []
    duplicate_numbers = sorted({n for n in numbered if numbered.count(n) > 1})
    unnumbered_count = sum(1 for q in rows if not isinstance(q.get("question_number"), int))
    needs_review_count = sum(1 for q in rows if q.get("needs_review") is True)
    invalid_answer_count = sum(1 for q in rows if str(q.get("correct_answer") or "").strip().upper() not in {"A", "B", "C", "D"})
    generic_subject_count = sum(1 for q in rows if (q.get("subject") or "").strip() in {"General Knowledge", "Unclassified", ""})
    generic_topic_count = sum(1 for q in rows if (q.get("topic") or "").strip() in {"General", "Unclassified", ""})
    empty_subtopic_count = sum(1 for q in rows if not (q.get("subtopic") or "").strip())
    explanation_summary = _explanation_coverage_summary(rows)
    canonical_count = _canonical_student_question_count(exam_name, exam_year)

    return {
        "exam_name": exam_name,
        "exam_year": exam_year,
        "question_count": canonical_count or len(rows),
        "raw_question_count": len(rows),
        "publishable": bool(gate_report.get("publishable")),
        "likely_publishable_with_hidden_rows": publish_assessment["likely_publishable_with_hidden_rows"],
        "reupload_needed": publish_assessment["reupload_needed"],
        "canonical_student_question_count": canonical_count,
        "visible_question_count": publish_assessment["visible_question_count"],
        "hidden_question_count": publish_assessment["hidden_question_count"],
        "reasons": gate_report.get("reasons", []),
        "samples": gate_report.get("samples", []),
        "numbering": {
            "numbered": len(numbered),
            "unnumbered": unnumbered_count,
            "max_seen": max_seen,
            "missing_count": len(missing_numbers),
            "missing_numbers": missing_numbers[:25],
            "duplicate_count": len(duplicate_numbers),
            "duplicate_numbers": duplicate_numbers[:25],
        },
        "review": {
            "needs_review": needs_review_count,
            "verified_answers": len(rows) - needs_review_count,
            "invalid_answers": invalid_answer_count,
        },
        "tagging": {
            "generic_subjects": generic_subject_count,
            "generic_topics": generic_topic_count,
            "empty_subtopics": empty_subtopic_count,
        },
        "explanations": {
            **explanation_summary,
        },
        "repair_queue_summary": {
            "rows": len(repair_queue),
            "paper_blockers": publish_assessment["paper_blocker_count"],
            "row_blockers": publish_assessment["row_blocker_count"],
            "structural_failure_count": publish_assessment["structural_failure_count"],
            "structural_failure_threshold": publish_assessment["structural_failure_threshold"],
            "contradictions": len(contradiction_by_qid),
        },
    }


def _iter_active_questions(
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        q = supabase.table("questions").select(
            "id, exam_name, exam_year, question_number, question_text, "
            "option_a, option_b, option_c, option_d, correct_answer, needs_review"
        ).eq("is_active", True)
        if exam_name:
            q = q.eq("exam_name", exam_name)
        if exam_year is not None:
            q = q.eq("exam_year", exam_year)
        r = q.range(offset, offset + 999).execute()
        batch = r.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def _find_explanation_answer_mismatches(
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
) -> list[dict]:
    """Heuristic audit: explanation text explicitly points to a different option.

    We only flag rows where the explanation clearly mentions exactly one option's
    text and that option conflicts with the stored correct_answer.
    """
    rows = _iter_active_questions(exam_name=exam_name, exam_year=exam_year)
    if not rows:
        return []

    ids = [row["id"] for row in rows]
    explanation_map: dict[str, str] = {}
    for i in range(0, len(ids), 50):
        chunk = ids[i:i+50]
        er = supabase.table("explanations").select("question_id, explanation").in_("question_id", chunk).execute()
        for item in (er.data or []):
            qid = item.get("question_id")
            explanation = item.get("explanation")
            if qid and explanation:
                explanation_map[qid] = explanation

    mismatches: list[dict] = []
    for row in rows:
        explanation = explanation_map.get(row["id"])
        if not explanation:
            continue

        answer = str(row.get("correct_answer") or "").strip().upper()
        if answer not in {"A", "B", "C", "D"}:
            continue

        option_map = {
            "A": str(row.get("option_a") or "").strip(),
            "B": str(row.get("option_b") or "").strip(),
            "C": str(row.get("option_c") or "").strip(),
            "D": str(row.get("option_d") or "").strip(),
        }
        explanation_lc = explanation.lower()
        mentioned_letters: list[str] = []
        for letter, option_text in option_map.items():
            if len(option_text) >= 3 and option_text.lower() in explanation_lc:
                mentioned_letters.append(letter)

        mentioned_letters = sorted(set(mentioned_letters))
        if len(mentioned_letters) == 1 and mentioned_letters[0] != answer:
            wrong_letter = mentioned_letters[0]
            mismatches.append({
                "question_id": row["id"],
                "exam_name": row.get("exam_name"),
                "exam_year": row.get("exam_year"),
                "question_number": row.get("question_number"),
                "correct_answer": answer,
                "explanation_implies": wrong_letter,
                "correct_option_text": option_map.get(answer, ""),
                "implied_option_text": option_map.get(wrong_letter, ""),
                "explanation_excerpt": explanation[:240],
            })
    return mismatches


_ANSWER_RELATED_REASONS = {"needs-review", "invalid-answer"}
_STRUCTURAL_REASONS = {
    "missing-question-numbers",
    "duplicate-question-numbers",
    "unnumbered-questions",
    "invalid-match-payload",
    "incomplete-match-columns",
    "incomplete-match-stem",
    "regional-script",
    "short-or-empty-text",
    "no-active-questions",
}
_IMAGE_REPAIR_REASONS = {"image-dependent"}
_STRUCTURAL_ROW_REASONS = {
    "invalid-match-payload",
    "incomplete-match-columns",
    "image-dependent-review",
    "regional-script",
    "short-or-empty-text",
    "incomplete-options",
    "broken-extraction",
    "unnumbered-questions",
}
_QUEUE_ISSUE_ORDER = {
    "numbering/data repair": 0,
    "structural manual review": 1,
    "image/manual review": 2,
    "answer verification": 3,
    "explanation regeneration": 4,
}
_IMAGE_RE = re.compile(
    r"\b(?:bar\s+graph|pie\s+chart|bar\s+chart|line\s+graph|histogram|"
    r"(?:the\s+)?(?:graph|chart|figure|diagram|picture|map)\s+(?:below|above|given|shown|following)|"
    r"(?:following|given|below)\s+(?:graph|chart|figure|diagram|table|map)|"
    r"refer\s+to\s+the|data\s+given\s+(?:below|above)|study\s+the\s+(?:following\s+)?"
    r"(?:graph|chart|figure|table|diagram)|from\s+the\s+(?:graph|chart|figure|table)|"
    r"dice|venn\s+diagram)\b",
    re.IGNORECASE,
)
_INLINE_OPTION_RE = re.compile(r'(?:^|\s)(?:A[\).]|B[\).]|C[\).]|D[\).])\s+', re.IGNORECASE)
_STATEMENT_STYLE_STEM_RE = re.compile(
    r'(?:which\s+(?:\w+\s+)?of\s+the\s+following\s+statements|read\s+the\s+statements|arrange\s+the\s+following|'
    r'which\s+of\s+the\s+above|select\s+the\s+correct\s+option|select\s+the\s+correct\s+pair|'
    r'chronological\s+order|jumbled\s+order|meaningful\s+sentences|synonyms?|antonyms?|statements?\s+\d)',
    re.IGNORECASE,
)


def _question_is_image_dependent(row: dict) -> bool:
    if row.get("has_image") or row.get("image_url"):
        return True
    text = " ".join(
        str(row.get(key) or "")
        for key in ("question_text", "option_a", "option_b", "option_c", "option_d")
    )
    return bool(_IMAGE_RE.search(text))


def _has_inline_option_blob(text: str) -> bool:
    return len(_INLINE_OPTION_RE.findall(text or "")) >= 2


def _is_statement_style_question(text: str, filled_opts: list[str]) -> bool:
    if len(_INLINE_OPTION_RE.findall(text or "")) < 2 or len(filled_opts) < 4:
        return False
    if not _STATEMENT_STYLE_STEM_RE.search(text or ""):
        return False
    return all(len(opt.strip()) <= 120 for opt in filled_opts)


def _sanitize_public_question_row(row: dict) -> Optional[dict]:
    supported = _question_supported_columns()
    if not _public_include_all_questions():
        if "public_visibility" in supported and row.get("public_visibility") == "hidden_structural":
            return None
    cleaned = clean_extracted_question({
        "question_text": row.get("question_text"),
        "option_a": row.get("option_a"),
        "option_b": row.get("option_b"),
        "option_c": row.get("option_c"),
        "option_d": row.get("option_d"),
        "passage": row.get("passage"),
        "question_number": row.get("question_number"),
        "correct_answer": row.get("correct_answer"),
        "correct_answers": row.get("correct_answers"),
        "needs_review": row.get("needs_review"),
    })
    sanitized = apply_canonical_taxonomy(dict(row))
    if cleaned:
        for key in ("question_text", "option_a", "option_b", "option_c", "option_d", "passage"):
            if key in cleaned:
                sanitized[key] = cleaned[key]
        return sanitized

    raw_text = str(row.get("question_text") or "").strip()
    filled_opts = sum(
        1
        for key in ("option_a", "option_b", "option_c", "option_d")
        if str(row.get(key) or "").strip()
    )
    if len(raw_text) < 2 and filled_opts < 2:
        return None
    # Fallback: keep active rows even when cleanup decides the extraction is weak.
    # This restores the older "good enough to practice" catalog behavior instead
    # of silently dropping borderline rows from the public app.
    return sanitized


def _prefer_richer_public_value(current, candidate):
    current_text = str(current or "").strip()
    candidate_text = str(candidate or "").strip()
    if not candidate_text:
        return current
    if not current_text:
        return candidate
    return candidate if len(candidate_text) > len(current_text) else current


def _merge_public_duplicate_row(existing: dict, candidate: dict) -> dict:
    merged = dict(existing)
    for key in (
        "question_text",
        "passage",
        "option_a",
        "option_b",
        "option_c",
        "option_d",
        "correct_answer",
        "answer_status",
        "subject",
        "topic",
        "subtopic",
        "difficulty",
        "concept",
        "question_type",
        "image_url",
    ):
        if not str(merged.get(key) or "").strip():
            merged[key] = candidate.get(key)

    if not merged.get("has_image") and candidate.get("has_image"):
        merged["has_image"] = True
    existing_answers = existing.get("correct_answers") if isinstance(existing.get("correct_answers"), list) else []
    candidate_answers = candidate.get("correct_answers") if isinstance(candidate.get("correct_answers"), list) else []
    if not existing_answers and candidate_answers:
        merged["correct_answers"] = candidate_answers
    elif existing_answers:
        merged["correct_answers"] = existing_answers
    if not merged.get("question_number") and candidate.get("question_number"):
        merged["question_number"] = candidate.get("question_number")
    if not merged.get("shift_label") and candidate.get("shift_label"):
        merged["shift_label"] = candidate.get("shift_label")
    if not merged.get("paper_id") and candidate.get("paper_id"):
        merged["paper_id"] = candidate.get("paper_id")
    if not merged.get("exam_name") and candidate.get("exam_name"):
        merged["exam_name"] = candidate.get("exam_name")
    if not merged.get("exam_year") and candidate.get("exam_year"):
        merged["exam_year"] = candidate.get("exam_year")

    merged["needs_review"] = bool(existing.get("needs_review")) or bool(candidate.get("needs_review"))
    return merged


def _row_base_reasons(row: dict) -> list[str]:
    text = (row.get("question_text") or "").strip()
    opts = [
        (row.get("option_a") or "").strip(),
        (row.get("option_b") or "").strip(),
        (row.get("option_c") or "").strip(),
        (row.get("option_d") or "").strip(),
    ]
    filled_opts = [o for o in opts if o]
    exam_name = str(row.get("exam_name") or "")
    is_upsc_like = any(k in exam_name.lower() for k in ("upsc", "cisf", "nda", "cds"))
    reasons: list[str] = []

    if not text or len(text) < 15:
        reasons.append("short-or-empty-text")
    image_dependent = _question_is_image_dependent(row)
    if len(filled_opts) < 4:
        if image_dependent:
            reasons.append("image-dependent-review")
        else:
            reasons.append("incomplete-options")
    if image_dependent and len(filled_opts) == 0:
        reasons.append("image-dependent-review")
    if row.get("needs_review") is True:
        reasons.append("answer-review")
    if str(row.get("correct_answer") or "").strip().upper() not in ("A", "B", "C", "D"):
        reasons.append("invalid-answer")
    if _has_inline_option_blob(text) and len(filled_opts) >= 4 and not _is_statement_style_question(text, filled_opts):
        reasons.append("broken-extraction")
    if not is_upsc_like and _regional_script_ratio(" ".join([text] + filled_opts)) >= 0.12:
        reasons.append("regional-script")
    if _sanitize_public_question_row(row) is None:
        reasons.append("broken-extraction")

    is_match_like = (
        str(row.get("question_type") or "").lower() == "match"
        or "match the following" in text.lower()
        or str(row.get("topic") or "").strip().lower() == "matching"
    )
    if is_match_like:
        if "__MATCH__:" in text:
            try:
                payload = json.loads(re.split(r'\n*__MATCH__:', text, 1)[1])
                col1 = payload.get("col1") or []
                col2 = payload.get("col2") or []
                if not col1 or not col2:
                    reasons.append("incomplete-match-columns")
            except Exception:
                reasons.append("invalid-match-payload")
        else:
            intro = re.sub(r'(?i)^match\s+the\s+following[:\s-]*', '', text).strip()
            intro_alnum = len(re.sub(r'[^A-Za-z0-9]+', '', intro))
            all_code_opts = len(filled_opts) == 4 and all(_MATCH_CODE_OPT_RE.match(o) for o in filled_opts)
            has_match_structure = bool(re.search(
                r'\b(?:column|list\s+i|list\s+ii|a\.|b\.|c\.|d\.|1\.|2\.|3\.|4\.)',
                text,
                re.IGNORECASE,
            ))
            if all_code_opts and (intro_alnum < 24 or not has_match_structure):
                reasons.append("incomplete-match-stem")

    return sorted(set(reasons))


def _exam_numbering_reasons(rows: list[dict]) -> tuple[list[str], list[str]]:
    reasons: list[str] = []
    samples: list[str] = []
    numbered = [int(q["question_number"]) for q in rows if isinstance(q.get("question_number"), int)]
    mostly_numbered = len(numbered) >= max(5, int(len(rows) * 0.8))
    if not mostly_numbered:
        return reasons, samples
    if len(numbered) != len(rows):
        reasons.append("unnumbered-questions")
        missing_qids = [q for q in rows if not isinstance(q.get("question_number"), int)]
        for row in missing_qids[:10]:
            samples.append(f"Q?:unnumbered-questions")
    dupes = sorted({n for n in numbered if numbered.count(n) > 1})
    if dupes:
        reasons.append("duplicate-question-numbers")
        samples.append(f"dupes:{','.join(map(str, dupes[:10]))}")
    missing = [n for n in range(1, max(numbered) + 1) if n not in set(numbered)]
    if missing:
        reasons.append("missing-question-numbers")
        samples.append(f"missing:{','.join(map(str, missing[:10]))}")
    return reasons, samples


def _contradiction_map(
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
) -> dict[str, dict]:
    return {
        item["question_id"]: item
        for item in _find_explanation_answer_mismatches(exam_name=exam_name, exam_year=exam_year)
    }


def _classify_row_queue_issue(reasons: list[str]) -> tuple[str, str, str, str]:
    reason_set = set(reasons)
    if {"unnumbered-questions", "duplicate-question-numbers", "missing-question-numbers"} & reason_set:
        return ("numbering/data repair", "critical", "none", "P3")
    if {"invalid-match-payload", "incomplete-match-columns", "incomplete-match-stem", "regional-script", "short-or-empty-text", "incomplete-options", "broken-extraction"} & reason_set:
        return ("structural manual review", "critical", "row", "P0")
    if "image-dependent-review" in reason_set:
        return ("image/manual review", "medium", "row", "P1")
    if "answer-explanation-contradiction" in reason_set:
        return ("explanation regeneration", "high", "row", "P1")
    if {"answer-review", "invalid-answer"} & reason_set:
        return ("answer verification", "medium", "none", "P3")
    return ("answer verification", "low", "none", "P3")


def _build_exam_repair_queue(
    exam_name: str,
    exam_year: int,
    rows: list[dict],
    contradiction_by_qid: Optional[dict[str, dict]] = None,
) -> list[dict]:
    contradiction_by_qid = contradiction_by_qid or {}
    numbering_reasons, _ = _exam_numbering_reasons(rows)
    queue: list[dict] = []
    duplicate_numbers: set[int] = set()
    numbered = [int(q["question_number"]) for q in rows if isinstance(q.get("question_number"), int)]
    duplicate_numbers = {n for n in numbered if numbered.count(n) > 1}
    missing_numbers = set()
    if numbered:
        missing_numbers = {n for n in range(1, max(numbered) + 1) if n not in set(numbered)}

    for row in rows:
        reasons = _row_base_reasons(row)
        qid = row.get("id")
        if qid in contradiction_by_qid:
            reasons.append("answer-explanation-contradiction")
        if "unnumbered-questions" in numbering_reasons and not isinstance(row.get("question_number"), int):
            reasons.append("unnumbered-questions")
        if isinstance(row.get("question_number"), int) and row["question_number"] in duplicate_numbers:
            reasons.append("duplicate-question-numbers")
        reasons = sorted(set(reasons))
        if not reasons:
            continue
        issue_type, severity, publish_blocker, priority = _classify_row_queue_issue(reasons)
        queue.append({
            "exam": f"{exam_name} {exam_year}",
            "exam_name": exam_name,
            "exam_year": exam_year,
            "question_number": row.get("question_number"),
            "question_id": qid,
            "question_text": row.get("question_text") or "",
            "option_a": row.get("option_a") or "",
            "option_b": row.get("option_b") or "",
            "option_c": row.get("option_c") or "",
            "option_d": row.get("option_d") or "",
            "correct_answer": row.get("correct_answer") or "",
            "subject": row.get("subject") or "",
            "topic": row.get("topic") or "",
            "subtopic": row.get("subtopic") or "",
            "difficulty": row.get("difficulty") or "",
            "question_type": row.get("question_type") or "",
            "concept": row.get("concept") or "",
            "passage": row.get("passage") or "",
            "has_image": bool(row.get("has_image")),
            "image_url": row.get("image_url"),
            "is_active": bool(row.get("is_active")),
            "needs_review": bool(row.get("needs_review")),
            "issue_type": issue_type,
            "severity": severity,
            "publish_blocker": publish_blocker,
            "repair_path": issue_type,
            "priority": priority,
            "safe_to_hide": publish_blocker == "row",
            "reasons": reasons,
        })

    # Missing-number gaps are audit-only queue items without a specific row.
    if "missing-question-numbers" in numbering_reasons:
        for missing_qn in sorted(missing_numbers):
            queue.append({
                "exam": f"{exam_name} {exam_year}",
                "exam_name": exam_name,
                "exam_year": exam_year,
                "question_number": missing_qn,
                "question_id": None,
                "question_text": "",
                "option_a": "",
                "option_b": "",
                "option_c": "",
                "option_d": "",
                "correct_answer": "",
                "subject": "",
                "topic": "",
                "subtopic": "",
                "difficulty": "",
                "question_type": "",
                "concept": "",
                "passage": "",
                "has_image": False,
                "image_url": None,
                "is_active": False,
                "needs_review": True,
                "issue_type": "numbering/data repair",
                "severity": "critical",
                "publish_blocker": "none",
                "repair_path": "numbering/data repair",
                "priority": "P0",
                "safe_to_hide": False,
                "reasons": ["missing-question-numbers"],
            })

    queue.sort(
        key=lambda item: (
            _QUEUE_ISSUE_ORDER.get(item["issue_type"], 99),
            item["question_number"] is None,
            item["question_number"] if isinstance(item["question_number"], int) else 10**9,
            item["question_id"] or "",
        )
    )
    return queue


def _paper_publish_assessment(rows: list[dict], queue: list[dict]) -> dict:
    structural_row_blockers = [
        item for item in queue
        if item["publish_blocker"] == "row"
        and item["issue_type"] in {"numbering/data repair", "structural manual review", "image/manual review"}
    ]
    threshold = _structural_failure_threshold(len(rows))
    reupload_needed = len(structural_row_blockers) >= threshold
    paper_blockers = [
        item for item in queue
        if item["publish_blocker"] == "paper"
    ]
    if reupload_needed:
        paper_blockers = paper_blockers + structural_row_blockers
    row_blockers = [item for item in queue if item["publish_blocker"] == "row"]
    visible_rows = [row for row in rows if not any(
        item.get("question_id") == row.get("id") and item["publish_blocker"] == "row"
        for item in queue
    )]
    if _admin_disable_paper_locks():
        return {
            "publishable": bool(rows),
            "likely_publishable_with_hidden_rows": bool(rows) and bool(row_blockers),
            "blocked": False,
            "reupload_needed": False,
            "visible_question_count": len(visible_rows),
            "hidden_question_count": len(row_blockers),
            "paper_blocker_count": 0,
            "row_blocker_count": len(row_blockers),
            "structural_failure_count": len(structural_row_blockers),
            "structural_failure_threshold": threshold,
        }
    likely_publishable_with_hidden_rows = bool(rows) and not paper_blockers and bool(row_blockers)
    return {
        "publishable": bool(rows) and not paper_blockers,
        "likely_publishable_with_hidden_rows": likely_publishable_with_hidden_rows,
        "blocked": bool(paper_blockers),
        "reupload_needed": reupload_needed,
        "visible_question_count": len(visible_rows),
        "hidden_question_count": len(row_blockers),
        "paper_blocker_count": len(paper_blockers),
        "row_blocker_count": len(row_blockers),
        "structural_failure_count": len(structural_row_blockers),
        "structural_failure_threshold": threshold,
    }


def _visible_public_question_ids(
    exam_name: str,
    exam_year: int,
    rows: Optional[list[dict]] = None,
    contradiction_by_qid: Optional[dict[str, dict]] = None,
) -> set[str]:
    exam_rows = rows if rows is not None else _question_rows_for_exam(exam_name, exam_year)
    contradiction_by_qid = contradiction_by_qid or _contradiction_map(exam_name, exam_year)
    queue = _build_exam_repair_queue(
        exam_name,
        exam_year,
        exam_rows,
        contradiction_by_qid=contradiction_by_qid,
    )
    hidden_ids = {
        item["question_id"]
        for item in queue
        if item["publish_blocker"] == "row" and item.get("question_id")
    }
    return {
        str(row["id"])
        for row in exam_rows
        if str(row.get("id")) not in hidden_ids
    }


def _question_has_explanation_contradiction(question_id: str, exam_name: Optional[str] = None, exam_year: Optional[int] = None) -> bool:  # noqa: ARG001
    # Fetch only this question's explanation + answer — no full-exam scan needed.
    try:
        qr = supabase.table("questions").select(
            "correct_answer"
        ).eq("id", question_id).limit(1).execute()
        if not qr.data:
            return False
        row = qr.data[0]
        er = supabase.table("explanations").select("explanation").eq("question_id", question_id).limit(1).execute()
        if not er.data:
            return False
        explanation = (er.data[0].get("explanation") or "").strip()
        if not explanation:
            return False
        answer = str(row.get("correct_answer") or "").strip().upper()
        if answer not in {"A", "B", "C", "D"}:
            return False
        return _explanation_contradicts_answer(explanation, answer)
    except Exception:
        return False


def _repair_decision_for_exam(
    exam_name: str,
    exam_year: int,
    rows: list[dict],
    reasons: list[str],
    explanation_count: Optional[int] = None,
    mismatches: Optional[list[dict]] = None,
) -> dict:
    reason_set = set(reasons)
    needs_review_rows = [row for row in rows if row.get("needs_review") is True]
    image_review_rows = [row for row in needs_review_rows if _question_is_image_dependent(row)]
    mismatch_items = mismatches if mismatches is not None else _find_explanation_answer_mismatches(exam_name, exam_year)
    mismatch_count = len(mismatch_items)
    explanation_count = explanation_count if explanation_count is not None else _count_explanations([q["id"] for q in rows])
    missing_explanations = max(0, len(rows) - explanation_count)

    structural_reasons = sorted(reason_set & _STRUCTURAL_REASONS)
    answer_reasons = sorted(reason_set & _ANSWER_RELATED_REASONS)

    if not reason_set:
        return {
            "category": "publishable",
            "summary": "No publish blockers detected.",
            "recommended_actions": [],
            "counts": {
                "needs_review": 0,
                "image_dependent_reviews": 0,
                "answer_explanation_mismatches": mismatch_count,
                "missing_explanations": missing_explanations,
            },
        }

    image_only = (
        bool(answer_reasons)
        and not structural_reasons
        and len(needs_review_rows) > 0
        and len(image_review_rows) == len(needs_review_rows)
    )
    answer_only = bool(answer_reasons) and not structural_reasons and not image_only

    if image_only:
        return {
            "category": "image-dependent",
            "summary": "Blocked rows depend on diagrams, charts, maps, or image-only data.",
            "recommended_actions": [
                "manual review queue",
                "or image-aware extraction flow",
                "do not auto-approve",
            ],
            "counts": {
                "needs_review": len(needs_review_rows),
                "image_dependent_reviews": len(image_review_rows),
                "answer_explanation_mismatches": mismatch_count,
                "missing_explanations": missing_explanations,
            },
        }

    if answer_only:
        return {
            "category": "answer-related",
            "summary": "Blocked only by untrusted answers or answer/explanation disagreement.",
            "recommended_actions": [
                "targeted answer verification",
                "explanation cleanup/regeneration for changed rows",
                "publish approved rows",
            ],
            "counts": {
                "needs_review": len(needs_review_rows),
                "image_dependent_reviews": len(image_review_rows),
                "answer_explanation_mismatches": mismatch_count,
                "missing_explanations": missing_explanations,
            },
        }

    if structural_reasons and not answer_reasons:
        return {
            "category": "extraction-structure-related",
            "summary": "Blocked by numbering, payload, language, or extraction-shape issues.",
            "recommended_actions": [
                "parser fix or remap fix",
                "maybe paper re-ingestion",
                "keep paper blocked until fixed",
            ],
            "counts": {
                "needs_review": len(needs_review_rows),
                "image_dependent_reviews": len(image_review_rows),
                "answer_explanation_mismatches": mismatch_count,
                "missing_explanations": missing_explanations,
            },
        }

    return {
        "category": "mixed",
        "summary": "Blocked by both structural issues and answer-review issues.",
        "recommended_actions": [
            "fix extraction structure first",
            "then run targeted answer verification",
            "then cleanup/regenerate explanations for changed rows",
        ],
        "counts": {
            "needs_review": len(needs_review_rows),
            "image_dependent_reviews": len(image_review_rows),
            "answer_explanation_mismatches": mismatch_count,
            "missing_explanations": missing_explanations,
        },
    }


# ── Startup: reset stuck jobs ─────────────────────────────────────────────
# If uvicorn was killed mid-run, jobs stay "processing" forever.
# Auto-requeueing them caused fresh sessions to immediately resume stale work,
# so on startup we now fail them explicitly and require an intentional retry.
try:
    _stuck_jobs = (
        supabase.table("jobs")
        .select("id, pdf_path, paper_id, exam_name, exam_year")
        .eq("status", "processing")
        .execute()
        .data or []
    )
    for _sj in _stuck_jobs:
        _sjid = _sj["id"]
        try:
            supabase.table("jobs").update({
                "status": "failed",
                "progress": 0,
                "error_log": "Server restarted mid-job — marked failed to avoid stale auto-resume. Retry intentionally or re-upload.",
            }).eq("id", _sjid).execute()
            print(f"[startup] Job {_sjid[:8]}: marked failed instead of auto-requeue")
        except Exception as _re:
            supabase.table("jobs").update({
                "status": "failed",
                "error_log": f"Server restarted — could not reset stale job cleanly ({_re}). Please retry or re-upload.",
                "progress": 0,
            }).eq("id", _sjid).execute()
            print(f"[startup] Job {_sjid[:8]}: reset failed — {_re}")

    if not _stuck_jobs:
        pass  # no stuck jobs on clean start
except Exception as _e:
    print(f"[startup] Could not handle stuck jobs: {_e}")

try:
    _schedule_public_meta_warm("startup")
except Exception as _e:
    print(f"[startup] Could not schedule public metadata warm: {_e}")


# ── Dependencies ─────────────────────────────────────────

# Firebase token cache — avoids a Google network round-trip on every request.
# Tokens are valid for 1 hour; we cache decoded claims for 5 minutes.
_token_cache: dict[str, tuple[float, dict]] = {}
_TOKEN_CACHE_TTL = 300  # 5 minutes
_token_cache_lock = threading.Lock()

def _verify_firebase_token_cached(token: str) -> dict:
    now = time.time()
    with _token_cache_lock:
        cached = _token_cache.get(token)
        if cached and (now - cached[0]) < _TOKEN_CACHE_TTL:
            return cached[1]
    claims = verify_firebase_token(token)  # network call to Google
    with _token_cache_lock:
        _token_cache[token] = (now, claims)
        # Evict stale entries if cache grows too large
        if len(_token_cache) > 10000:
            cutoff = now - _TOKEN_CACHE_TTL
            stale = [k for k, v in _token_cache.items() if v[0] < cutoff]
            for k in stale:
                del _token_cache[k]
    return claims


def get_current_user(authorization: str = Header(None)) -> dict:
    """Verify Firebase ID token. Runs in threadpool (sync) to avoid blocking the event loop."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing Authorization header")
    token = authorization.split("Bearer ")[1]
    try:
        return _verify_firebase_token_cached(token)
    except ValueError as e:
        raise HTTPException(401, str(e))


def optional_user(authorization: str = Header(None)) -> dict:
    """Like get_current_user but returns {} instead of 401 for missing/invalid tokens.
    Use on endpoints that are public but benefit from knowing who the user is."""
    if not authorization or not authorization.startswith("Bearer "):
        return {}
    token = authorization.split("Bearer ")[1]
    try:
        return _verify_firebase_token_cached(token)
    except ValueError:
        return {}


async def verify_admin(
    x_admin_key: str = Header(None),
    authorization: str = Header(None),
):
    """Allow either backend-only API key auth or Firebase-authenticated admins."""
    if x_admin_key and ADMIN_API_KEY and secrets.compare_digest(x_admin_key, ADMIN_API_KEY):
        return {"auth_mode": "api_key"}

    if authorization and authorization.startswith("Bearer "):
        token = authorization.split("Bearer ", 1)[1].strip()
        if not token:
            raise HTTPException(403, "Missing admin bearer token")
        try:
            claims = verify_firebase_token(token)
        except ValueError as e:
            raise HTTPException(401, str(e))

        email = str(claims.get("email") or "").strip().lower()
        if not ADMIN_EMAILS:
            raise HTTPException(
                403,
                "ADMIN_EMAILS is not configured on the backend.",
            )
        if not email or email not in ADMIN_EMAILS:
            raise HTTPException(403, "Signed-in user is not allowed to access admin routes.")
        return claims

    raise HTTPException(403, "Invalid admin authentication")


@app.get("/admin/me")
def admin_me(claims: dict = Depends(verify_admin)):
    """Lightweight probe used by the frontend to check if the signed-in user is admin."""
    return {"is_admin": True, "email": claims.get("email", "")}


@app.post("/admin/pattern-book/classify-pages", dependencies=[Depends(verify_admin)])
async def admin_classify_pattern_book_pages(
    file: Optional[UploadFile] = File(None),
    pdf_path: str = Form(""),
):
    """
    Pilot-only page classification for pattern-book PDFs.
    Produces a report artifact and returns per-page classification metadata.
    """
    tmp_path: str | None = None
    target_path = pdf_path.strip()

    if file is not None:
        filename = (file.filename or "").lower()
        if not filename.endswith(".pdf"):
            raise HTTPException(400, "Only PDF files accepted")
        content = await file.read()
        if not content:
            raise HTTPException(400, "Uploaded PDF is empty")
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        target_path = tmp_path

    if not target_path:
        raise HTTPException(400, "Provide either a PDF upload or pdf_path")

    _allowed_base = (Path(__file__).parent / "uploads").resolve()
    path_obj = Path(target_path).resolve()
    if not str(path_obj).startswith(str(_allowed_base)) and path_obj != Path(tmp_path or "").resolve():
        raise HTTPException(400, "Invalid pdf_path")
    if not path_obj.exists():
        raise HTTPException(404, "PDF not found")

    try:
        report = classify_pattern_book_pdf(str(path_obj), write_report=True)
        return {
            "pdf_path": report["pdf_path"],
            "page_count": report["page_count"],
            "counts": report["counts"],
            "report_path": report.get("report_path"),
            "pages": report["pages"],
        }
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[ERROR] Pattern-book page classification failed: {exc}")
        raise HTTPException(500, "Pattern-book page classification failed")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.post("/admin/pattern-book/extract-raw-blocks", dependencies=[Depends(verify_admin)])
async def admin_extract_pattern_book_raw_blocks(
    file: Optional[UploadFile] = File(None),
    pdf_path: str = Form(""),
):
    """
    Phase B pilot: extract raw question/solution blocks only.
    Never writes canonical questions.
    """
    tmp_path: str | None = None
    target_path = pdf_path.strip()

    if file is not None:
        filename = (file.filename or "").lower()
        if not filename.endswith(".pdf"):
            raise HTTPException(400, "Only PDF files accepted")
        content = await file.read()
        if not content:
            raise HTTPException(400, "Uploaded PDF is empty")
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        target_path = tmp_path

    if not target_path:
        raise HTTPException(400, "Provide either a PDF upload or pdf_path")

    _allowed_base = (Path(__file__).parent / "uploads").resolve()
    path_obj = Path(target_path).resolve()
    if not str(path_obj).startswith(str(_allowed_base)) and path_obj != Path(tmp_path or "").resolve():
        raise HTTPException(400, "Invalid pdf_path")
    if not path_obj.exists():
        raise HTTPException(404, "PDF not found")

    try:
        from extractor.pattern_book_raw_blocks import extract_pattern_book_raw_blocks

        report = extract_pattern_book_raw_blocks(str(path_obj), write_report=True)
        return report
    except HTTPException:
        raise
    except Exception as exc:
        print(f"[ERROR] Pattern-book raw block extraction failed: {exc}")
        raise HTTPException(500, "Pattern-book raw block extraction failed")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


def _load_latest_or_named_json_artifact(directory: Path, filename: str = "") -> dict:
    directory.mkdir(parents=True, exist_ok=True)
    if filename:
        target = directory / Path(filename).name
        if not target.exists():
            raise HTTPException(404, "Report not found")
    else:
        candidates = sorted(directory.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not candidates:
            raise HTTPException(404, f"No reports found in {directory.name}")
        target = candidates[0]
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(500, f"Invalid report JSON: {target.name}") from exc


@app.get("/admin/pattern-book/raw-report", dependencies=[Depends(verify_admin)])
async def admin_get_pattern_book_raw_report(filename: str = Query("")):
    report_dir = Path(__file__).resolve().parent / "cache" / "pattern_book_raw_blocks"
    return _load_latest_or_named_json_artifact(report_dir, filename)


@app.get("/admin/pattern-book/classification-report", dependencies=[Depends(verify_admin)])
async def admin_get_pattern_book_classification_report(filename: str = Query("")):
    report_dir = Path(__file__).resolve().parent / "cache" / "pattern_book_reports"
    return _load_latest_or_named_json_artifact(report_dir, filename)


@app.get("/admin/pattern-book/readiness-audit", dependencies=[Depends(verify_admin)])
async def admin_get_pattern_book_readiness_audit(filename: str = Query("")):
    report_dir = Path(__file__).resolve().parent / "cache" / "pattern_book_raw_blocks"
    report = _load_latest_or_named_json_artifact(report_dir, filename)
    audit = report.get("phase_c_readiness_audit")
    if not audit:
        audit = build_phase_c_readiness_audit(report)
    return {
        "report_path": report.get("report_path"),
        "pdf_path": report.get("pdf_path"),
        "page_count": report.get("page_count"),
        "summary": report.get("summary", {}),
        "phase_c_readiness_audit": audit,
    }


@app.post("/admin/pattern-book/build-normalized-draft", dependencies=[Depends(verify_admin)])
async def admin_build_pattern_book_normalized_draft(filename: str = Query("")):
    report_dir = Path(__file__).resolve().parent / "cache" / "pattern_book_raw_blocks"
    report = _load_latest_or_named_json_artifact(report_dir, filename)
    return build_pattern_book_normalized_draft(report, write_report=True)


@app.get("/admin/pattern-book/normalized-draft", dependencies=[Depends(verify_admin)])
async def admin_get_pattern_book_normalized_draft(filename: str = Query("")):
    report_dir = Path(__file__).resolve().parent / "cache" / "pattern_book_normalized_drafts"
    return _load_latest_or_named_json_artifact(report_dir, filename)


@app.post("/admin/pattern-book/gemini-question-pilot", dependencies=[Depends(verify_admin)])
async def admin_build_pattern_book_gemini_question_pilot(
    pdf_path: str = Form(""),
    file: UploadFile | None = File(default=None),
):
    target_path = pdf_path.strip()
    tmp_path = None
    try:
        if file is not None:
            if not (file.filename or "").lower().endswith(".pdf"):
                raise HTTPException(400, "Only PDF files accepted")
            content = await file.read()
            if not content:
                raise HTTPException(400, "Uploaded PDF is empty")
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            target_path = tmp_path

        if not target_path:
            raise HTTPException(400, "Provide either a PDF upload or pdf_path")

        _allowed_base = (Path(__file__).parent / "uploads").resolve()
        path_obj = Path(target_path).resolve()
        if not path_obj.is_relative_to(_allowed_base) and path_obj != Path(tmp_path or "").resolve():
            raise HTTPException(400, "Invalid pdf_path")
        if not path_obj.exists():
            raise HTTPException(404, "PDF not found")

        return extract_pattern_book_question_pages_with_gemini(str(path_obj), write_report=True)
    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)


@app.get("/admin/pattern-book/gemini-question-pilot", dependencies=[Depends(verify_admin)])
async def admin_get_pattern_book_gemini_question_pilot(filename: str = Query("")):
    report_dir = Path(__file__).resolve().parent / "cache" / "pattern_book_gemini_pilot"
    return _load_latest_or_named_json_artifact(report_dir, filename)


@app.post("/admin/pattern-book/gemini-stage12", dependencies=[Depends(verify_admin)])
async def admin_build_pattern_book_gemini_stage12(
    pdf_path: str = Form(""),
    file: UploadFile | None = File(default=None),
):
    target_path = pdf_path.strip()
    tmp_path = None
    try:
        if file is not None:
            if not (file.filename or "").lower().endswith(".pdf"):
                raise HTTPException(400, "Only PDF files accepted")
            content = await file.read()
            if not content:
                raise HTTPException(400, "Uploaded PDF is empty")
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            target_path = tmp_path

        if not target_path:
            raise HTTPException(400, "Provide either a PDF upload or pdf_path")

        _allowed_base = (Path(__file__).parent / "uploads").resolve()
        path_obj = Path(target_path).resolve()
        if not path_obj.is_relative_to(_allowed_base) and path_obj != Path(tmp_path or "").resolve():
            raise HTTPException(400, "Invalid pdf_path")
        if not path_obj.exists():
            raise HTTPException(404, "PDF not found")

        return run_pattern_book_gemini_stage12(str(path_obj), write_report=True)
    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)


@app.get("/admin/pattern-book/gemini-stage12", dependencies=[Depends(verify_admin)])
async def admin_get_pattern_book_gemini_stage12(filename: str = Query("")):
    report_dir = Path(__file__).resolve().parent / "cache" / "pattern_book_gemini_stage12"
    return _load_latest_or_named_json_artifact(report_dir, filename)


# ══════════════════════════════════════════════════════════
# PUBLIC ENDPOINTS (No auth — questions are shared data)
# ══════════════════════════════════════════════════════════

@app.get("/health")
def health():
    try:
        r = supabase.table("questions").select("id", count="exact").limit(1).execute()
        return {"status": "ok", "questions_count": r.count, "time": datetime.now(timezone.utc).isoformat()}
    except Exception:
        return {"status": "error", "database": "unreachable"}


# ══════════════════════════════════════════════════════════════════════ #
# PATTERN PRACTICE — SSC/CGL Pattern Book APIs
# ══════════════════════════════════════════════════════════════════════ #

@app.get("/pattern-books")
def list_pattern_books():
    """List all ingested pattern books (SSC CGL chapters etc.)."""
    try:
        res = supabase.table("pattern_books").select("*").order("created_at").execute()
        return res.data or []
    except Exception as e:
        print(f"[ERROR] Pattern books unavailable: {e}")
        raise HTTPException(503, "Pattern books unavailable")


@app.get("/pattern-books/{book_id}/questions")
async def get_pattern_questions(book_id: str):
    """All questions for a given pattern book, ordered in book flow."""
    try:
        res = (
            supabase.table("pattern_questions")
            .select("*")
            .eq("book_id", book_id)
            .order("source_page")
            .order("question_number")
            .execute()
        )
        return res.data or []
    except Exception as e:
        print(f"[ERROR] Pattern questions unavailable: {e}")
        raise HTTPException(503, "Pattern questions unavailable")


@app.post("/admin/pattern-books/ingest", dependencies=[Depends(verify_admin)])
async def ingest_pattern_book_from_cache(
    title:       str = Query(...),
    chapter:     str = Query(default="Chapter 1: Percentage"),
    exam_target: str = Query(default="SSC CGL"),
    source_file: str = Query(default="SSC_CGL PERCENTAGES.pdf"),
):
    """One-shot: ingest stage12 cache → pattern_books + pattern_questions tables."""
    from pathlib import Path as Pth
    import json as _json
    stage12_dir = Pth(__file__).parent / "cache" / "pattern_book_gemini_stage12"
    files = list(stage12_dir.glob("*.json"))
    if not files:
        raise HTTPException(404, "No stage12 cache found. Run extraction first.")
    data = _json.loads(files[0].read_text())
    qs   = data.get("valid_questions", [])
    if not qs:
        raise HTTPException(400, "No valid questions in cache.")
    book_res = supabase.table("pattern_books").upsert(
        {"title": title, "chapter": chapter, "exam_target": exam_target,
         "source_file": source_file, "question_count": len(qs)},
        on_conflict="title").execute()
    book_id = book_res.data[0]["id"]
    supabase.table("pattern_questions").delete().eq("book_id", book_id).execute()
    rows = [{
        "book_id": book_id,
        "question_number": q.get("question_number"),
        "question_text": (q.get("question_text") or "").strip(),
        "option_a": (q.get("option_a") or "").strip(),
        "option_b": (q.get("option_b") or "").strip(),
        "option_c": (q.get("option_c") or "").strip(),
        "option_d": (q.get("option_d") or "").strip(),
        "correct_answer": q.get("correct_answer"),
        "difficulty": "Medium",
        "pattern_tag": chapter,
        "source_page": q.get("source_page_number"),
    } for q in qs]
    for i in range(0, len(rows), 50):
        supabase.table("pattern_questions").insert(rows[i:i+50]).execute()
    supabase.table("pattern_books").update({"question_count": len(rows)}).eq("id", book_id).execute()
    return {"status": "ingested", "book_id": book_id, "question_count": len(rows)}


_ANSWER_FIELDS = ("correct_answer", "correct_answers")


def _strip_answer_fields(questions: list[dict]) -> list[dict]:
    """Remove correct_answer / correct_answers from public bulk responses."""
    if not questions:
        return questions
    return [{k: v for k, v in q.items() if k not in _ANSWER_FIELDS} for q in questions]


@app.get("/questions")
async def get_questions(
    subject: Optional[str] = Query(None),
    topic: Optional[str] = Query(None),
    subtopic: Optional[str] = Query(None),
    exam_name: Optional[str] = Query(None),
    exam_year: Optional[int] = Query(None),
    paper_id: Optional[str] = Query(None),
    shift_label: Optional[str] = Query(None),
    difficulty: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    cursor: Optional[str] = Query(None),
    response: Response = None,
    _current_user: dict = Depends(get_current_user),
):
    """Fetch filtered + paginated questions. Answers are NOT included here —
    use GET /questions/{id} after the user selects, or POST /reveal-answers after exam submission."""
    _require_exam_access(_current_user, exam_name, exam_year)

    # Check subscription for topic practice/search gating
    allowed_paper_ids = None
    is_premium = False
    if isinstance(_current_user, dict):
        uid = _current_user.get("uid")
        if uid:
            sub = _get_subscription_cached(uid)
            is_premium = sub.get("is_premium", False)
    if not is_premium:
        allowed_paper_ids = _get_free_paper_ids()

    try:
        start = safe_cursor_to_index(cursor) if cursor else offset
        page_data = _stream_public_exam_page(
            exam_name=exam_name,
            exam_year=exam_year,
            paper_id=paper_id,
            shift_label=shift_label,
            subject=subject,
            topic=topic,
            subtopic=subtopic,
            difficulty=difficulty,
            search=search,
            limit=limit,
            offset=start,
            allowed_paper_ids_override=allowed_paper_ids,
        )
        # Strip correct answers from bulk response — revealed lazily per question
        if isinstance(page_data, dict) and "questions" in page_data:
            page_data = dict(page_data)
            page_data["questions"] = _strip_answer_fields(page_data["questions"])
        if response is not None and not search:
            response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=600"
        return page_data
    except Exception as e:
        print(f"[ERROR] Database error: {e}")
        raise HTTPException(500, "Database error")


@app.get("/questions/meta")
async def get_questions_meta(response: Response):
    """Lightweight question metadata for navigation, feed, and dashboard.
    Returns only id, exam_name, exam_year, subject, topic, subtopic, difficulty.
    Cached in-process for 2 minutes — 100 concurrent logins = 1 Supabase query."""
    try:
        snapshot = _get_public_meta_snapshot()
        response.headers["Cache-Control"] = _meta_cache_control_header()
        return snapshot["questions_meta"]
    except Exception as e:
        print(f"[ERROR] Database error: {e}")
        raise HTTPException(500, "Database error")


@app.get("/meta/catalog")
async def get_catalog_summary(response: Response):
    try:
        snapshot = _get_public_meta_snapshot()
        response.headers["Cache-Control"] = _meta_cache_control_header()
        return snapshot["catalog"]
    except Exception as e:
        print(f"[ERROR] Catalog summary error: {e}")
        raise HTTPException(500, "Catalog summary error")


@app.get("/meta/feed")
async def get_feed_summary(response: Response):
    try:
        snapshot = _get_public_meta_snapshot()
        response.headers["Cache-Control"] = _meta_cache_control_header()
        return snapshot["feed"]
    except Exception as e:
        print(f"[ERROR] Feed summary error: {e}")
        raise HTTPException(500, "Feed summary error")


@app.get("/meta/exam-outline")
async def get_exam_outline(
    exam_name: str = Query(...),
    exam_year: int = Query(...),
    paper_id: Optional[str] = Query(None),
    shift_label: Optional[str] = Query(None),
):
    try:
        rows = _collect_public_exam_rows(
            exam_name=exam_name,
            exam_year=exam_year,
            paper_id=paper_id,
            shift_label=shift_label,
        )
        return build_exam_outline(rows, normalize_exam_name(exam_name), exam_year)
    except Exception as e:
        print(f"[ERROR] Exam outline error: {e}")
        raise HTTPException(500, "Exam outline error")


@app.get("/meta/exam-papers")
async def get_exam_papers(
    exam_name: str = Query(...),
    exam_year: int = Query(...),
):
    try:
        return _build_exam_paper_manifest(normalize_exam_name(exam_name), exam_year)
    except Exception as e:
        print(f"[ERROR] Exam papers error: {e}")
        raise HTTPException(500, "Exam papers error")


@app.get("/questions/{question_id}")
async def get_question_with_answer(question_id: str, _current_user: dict = Depends(get_current_user)):
    """Single question WITH correct answer (after user submits)."""
    try:
        supported_cols = _question_supported_columns()
        select_clause = _question_select_clause([
            "id", "question_text", "option_a", "option_b", "option_c", "option_d",
            "correct_answer", "correct_answers", "answer_status", "subject", "topic", "subtopic", "difficulty",
            "exam_name", "exam_year", "question_type", "concept", "question_number", "needs_review", "has_image", "image_url", "paper_id", "public_visibility", "practice_ready",
            "pattern_tag", "trap_tag", "skill_tag", "question_style", "pattern_confidence", "pattern_reason", "solve_hint",
        ], supported_cols)
        r = supabase.table("questions").select(
            select_clause
        ).eq("id", question_id).single().execute()

        if not r.data:
            raise HTTPException(404, "Question not found")

        # Enforce premium access gating
        _require_exam_access(_current_user, r.data.get("exam_name"), r.data.get("exam_year"))

        if not _row_is_public(r.data, supported_cols):
            raise HTTPException(404, "Question not found")
        if (not _public_include_all_questions()) and (not _practice_ready_mode(supported_cols)) and not _row_matches_selected_papers(
            r.data,
            latest_live_paper_ids(
                exam_name=r.data.get("exam_name"),
                exam_year=r.data.get("exam_year"),
                sb=supabase,
            ),
        ):
            raise HTTPException(404, "Question not found")
        sanitized = _sanitize_public_question_row(r.data)
        if sanitized is None:
            raise HTTPException(404, "Question not found")
        return sanitized
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Database error: {e}")
        raise HTTPException(500, "Database error")


@app.post("/reveal-answers")
async def reveal_answers(body: dict, _current_user: dict = Depends(get_current_user)):
    """Batch reveal correct answers after exam submission.
    Accepts {question_ids: [str, ...]} (max 300).
    Returns {answers: {id: {correct_answer, correct_answers, answer_status, needs_review}}}.
    Only returns rows that pass the public visibility check."""
    try:
        question_ids = body.get("question_ids") or []
        if not isinstance(question_ids, list) or len(question_ids) == 0:
            raise HTTPException(400, "question_ids must be a non-empty list")
        if len(question_ids) > 300:
            raise HTTPException(400, "Maximum 300 question_ids per request")

        # Fetch only answer fields
        r = supabase.table("questions").select(
            "id, correct_answer, correct_answers, answer_status, needs_review, "
            "is_active, public_visibility, practice_ready, paper_id, exam_name, exam_year"
        ).in_("id", question_ids).execute()

        supported_cols = _question_supported_columns()
        answers: dict = {}
        for row in (r.data or []):
            if not _row_is_public(row, supported_cols):
                continue
            qid = row.get("id")
            if not qid:
                continue
            answers[qid] = {
                "correct_answer": str(row.get("correct_answer") or "").strip().upper() or None,
                "correct_answers": row.get("correct_answers") or [],
                "answer_status": row.get("answer_status") or "",
                "needs_review": bool(row.get("needs_review")),
            }
        return {"answers": answers}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Database error: {e}")
        raise HTTPException(500, "Database error")


@app.get("/explanation/{question_id}")
def get_explanation(question_id: str, _current_user: dict = Depends(get_current_user)):
    """
    Lazy-loaded explanation + Real-time Answer Consistency.
    If the Reasoning Engine finds a corrected answer, it is returned here
    to sync the frontend UI state.
    """
    try:
        supported_cols = _question_supported_columns()
        # Single query — fetch all needed columns at once instead of two separate queries
        qr_select = [
            "exam_name", "exam_year", "paper_id", "practice_ready",
            "id", "question_text", "option_a", "option_b", "option_c", "option_d",
            "correct_answer", "correct_answers", "answer_status", "needs_review", "question_number",
        ]
        if "public_visibility" in supported_cols:
            qr_select.append("public_visibility")
        if "is_active" in supported_cols:
            qr_select.append("is_active")
        qr = supabase.table("questions").select(", ".join(qr_select)).eq("id", question_id).single().execute()
        if not qr.data:
            raise HTTPException(404, "Question not found")

        # Enforce premium access gating
        _require_exam_access(_current_user, qr.data.get("exam_name"), qr.data.get("exam_year"))

        if not _row_is_public(qr.data, supported_cols):
            raise HTTPException(404, "Question not found")
        if (not _public_include_all_questions()) and (not _practice_ready_mode(supported_cols)) and not _row_matches_selected_papers(
            qr.data,
            latest_live_paper_ids(
                exam_name=qr.data.get("exam_name"),
                exam_year=qr.data.get("exam_year"),
                sb=supabase,
            ),
        ):
            raise HTTPException(404, "Question not found")
        question_row = qr  # reuse the same query result — no second DB call needed
        if not question_row.data or _sanitize_public_question_row(question_row.data) is None:
            raise HTTPException(404, "Question not found")
        answer_status = str(question_row.data.get("answer_status") or "").strip().lower()
        correct_answers = question_row.data.get("correct_answers") or []
        if answer_status == "deleted":
            return _explanation_unavailable_payload(
                question_id,
                source="deleted-question",
                verified_answer=question_row.data.get("correct_answer"),
                verified_answers=correct_answers,
                answer_status=answer_status,
                needs_review=False,
            )
        if isinstance(correct_answers, list) and len(correct_answers) > 1:
            return _explanation_unavailable_payload(
                question_id,
                source="multiple-correct-answers",
                verified_answer=question_row.data.get("correct_answer"),
                verified_answers=correct_answers,
                answer_status="multiple",
                needs_review=False,
            )
        result = None
        try:
            from pipeline import generate_single_explanation
            result = generate_single_explanation(question_id)
        except Exception as e:
            print(f"WARN get_explanation generation failed for {question_id}: {e}")
            return _explanation_unavailable_payload(
                question_id,
                source="unavailable-error",
                verified_answer=question_row.data.get("correct_answer"),
                verified_answers=correct_answers,
                answer_status=answer_status or None,
                needs_review=bool(question_row.data.get("needs_review")),
            )
        if not result:
            return _explanation_unavailable_payload(
                question_id,
                source="unavailable-error",
                verified_answer=question_row.data.get("correct_answer"),
                verified_answers=correct_answers,
                answer_status=answer_status or None,
                needs_review=bool(question_row.data.get("needs_review")),
            )
        if _question_has_explanation_contradiction(
            question_id,
            exam_name=qr.data.get("exam_name"),
            exam_year=qr.data.get("exam_year"),
        ):
            return _explanation_unavailable_payload(
                question_id,
                source="hidden-contradiction",
                verified_answer=result.get("verified_answer"),
                verified_answers=result.get("verified_answers"),
                answer_status=result.get("answer_status"),
                needs_review=result.get("needs_review"),
            )
        
        # Returns: {question_id, explanation, source, verified_answer, needs_review}
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR in get_explanation({question_id}): {e}")
        return _explanation_unavailable_payload(question_id, source="unavailable-error")


class _BatchExplRequest(BaseModel):
    question_ids: list[str]


def _explanation_unavailable_payload(
    question_id: str,
    *,
    source: str = "unavailable-error",
    verified_answer: Optional[str] = None,
    verified_answers: Optional[list[str]] = None,
    answer_status: Optional[str] = None,
    needs_review: Optional[bool] = None,
) -> dict:
    return {
        "question_id": question_id,
        "explanation": "",
        "source": source,
        "verified_answer": verified_answer,
        "verified_answers": verified_answers,
        "answer_status": answer_status,
        "needs_review": needs_review,
    }


@app.post("/explanations/batch")
def get_explanations_batch(body: _BatchExplRequest, _current_user: dict = Depends(get_current_user)):
    """Return already-generated explanations for up to 50 questions in one DB query.
    IDs with no explanation yet are omitted from the response — caller fetches those individually."""
    ids = list(dict.fromkeys(body.question_ids))[:50]  # dedup + cap
    if not ids:
        return {}
    try:
        rows = supabase.table("explanations").select("question_id, explanation, source").in_("question_id", ids).execute()
        q_rows = supabase.table("questions").select("id, correct_answer, needs_review").in_("id", ids).execute()
        q_map = {str(r["id"]): r for r in (q_rows.data or []) if r.get("id")}
        safe: dict[str, str] = {}
        for r in (rows.data or []):
            qid = str(r.get("question_id") or "")
            text = str(r.get("explanation") or "").strip()
            if not qid or not text:
                continue
            q = q_map.get(qid) or {}
            source = str(r.get("source") or "")
            answer_now_verified = not bool(q.get("needs_review", False))
            stale_unverified = answer_now_verified and "unverified-answer" in source
            contradictory = bool(
                q.get("correct_answer") and _explanation_contradicts_answer(text, str(q.get("correct_answer") or ""))
            )
            flagged = "[FLAG: verify answer]" in text
            if stale_unverified or contradictory or flagged:
                continue
            safe[qid] = text
        return safe
    except Exception as e:
        print(f"WARN get_explanations_batch failed: {e}")
        return {}


@app.post("/admin/explanations/batch", dependencies=[Depends(verify_admin)])
def admin_get_explanations_batch(body: _BatchExplRequest):
    """Admin version — same as public batch but skips visibility checks."""
    ids = list(dict.fromkeys(body.question_ids))[:50]
    if not ids:
        return {}
    try:
        rows = supabase.table("explanations").select("question_id, explanation, source").in_("question_id", ids).execute()
        q_rows = supabase.table("questions").select("id, correct_answer, needs_review").in_("id", ids).execute()
        q_map = {str(r["id"]): r for r in (q_rows.data or []) if r.get("id")}
        safe: dict[str, str] = {}
        for r in (rows.data or []):
            qid = str(r.get("question_id") or "")
            text = str(r.get("explanation") or "").strip()
            if not qid or not text:
                continue
            q = q_map.get(qid) or {}
            source = str(r.get("source") or "")
            answer_now_verified = not bool(q.get("needs_review", False))
            stale_unverified = answer_now_verified and "unverified-answer" in source
            contradictory = bool(
                q.get("correct_answer") and _explanation_contradicts_answer(text, str(q.get("correct_answer") or ""))
            )
            flagged = "[FLAG: verify answer]" in text
            if stale_unverified or contradictory or flagged:
                continue
            safe[qid] = text
        return safe
    except Exception as e:
        print(f"WARN admin_get_explanations_batch failed: {e}")
        return {}


# ── Flag a question (public, rate-limited by unique user+question pair) ───────

class FlagRequest(BaseModel):
    flag_type: str = Field(..., pattern=r"^(wrong_answer|poor_quality|outdated|duplicate)$")
    note: Optional[str] = None
    user_id: Optional[str] = None


_AUTO_HIDE_FLAG_THRESHOLD = 3


@app.post("/questions/{question_id}/flag")
async def flag_question(question_id: str, body: FlagRequest, _current_user: dict = Depends(get_current_user)):
    """
    Submit a quality flag for a question. Authenticated users supply their uid in
    body.user_id. At threshold flags the question is auto-soft-hidden pending review.
    """
    try:
        # Verify question exists and is accessible
        # Fetch all needed columns in one query — paper_id included to avoid a second query later
        qr = supabase.table("questions").select("id, flag_count, is_active, paper_id").eq("id", question_id).limit(1).execute()
        if not (qr.data or []):
            raise HTTPException(404, "Question not found")
        row = qr.data[0]

        # Prevent duplicate flag from same user on same question
        if body.user_id:
            dup = supabase.table("question_flags").select("id") \
                .eq("question_id", question_id).eq("user_id", body.user_id).limit(1).execute()
            if dup.data:
                return {"status": "already_flagged", "question_id": question_id}

        # Insert flag
        supabase.table("question_flags").insert({
            "question_id": question_id,
            "user_id": body.user_id,
            "flag_type": body.flag_type,
            "note": body.note,
        }).execute()

        # Increment flag_count (best-effort; column may not exist yet in older DBs)
        try:
            new_count = int(row.get("flag_count") or 0) + 1
            update_payload: dict = {"flag_count": new_count}
            if new_count >= _AUTO_HIDE_FLAG_THRESHOLD and row.get("is_active", True):
                update_payload["is_active"] = False
                update_payload["needs_review"] = True
            supabase.table("questions").update(update_payload).eq("id", question_id).execute()

            # Refresh paper publish state if hidden — reuse paper_id from first query
            if not update_payload.get("is_active", True) and row.get("paper_id"):
                try:
                    refresh_paper_publish_state(row["paper_id"], sb=supabase)
                except Exception:
                    pass
        except Exception:
            pass  # flag_count column might not exist yet

        return {"status": "flagged", "question_id": question_id}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Flag error: {e}")
        raise HTTPException(500, "Flag error")


@app.get("/practice")
async def get_practice_questions(
    subject: Optional[str] = Query(None),
    topic: Optional[str] = Query(None),
    difficulty: Optional[str] = Query(None),
    count: int = Query(10, ge=1, le=50),
    _current_user: dict = Depends(get_current_user),
):
    """
    Random questions for practice mode.
    Returns WITHOUT correct_answer — user must submit to see answer.
    
    Flow: GET /practice → user answers → GET /questions/{id} → GET /explanation/{id} → POST /attempt
    """
    try:
        supported_cols = _question_supported_columns()
        publishable_paper_ids = None if (_public_include_all_questions() or _practice_ready_mode(supported_cols)) else latest_live_paper_ids(sb=supabase)
        has_canonical_subject = "canonical_subject" in supported_cols
        has_canonical_topic = "canonical_topic_family" in supported_cols
        subject_col = "canonical_subject" if has_canonical_subject else "subject"
        topic_col = "canonical_topic_family" if has_canonical_topic else "topic"
        select_clause = _question_select_clause([
            "id", "question_text", "option_a", "option_b", "option_c", "option_d",
            "correct_answers", "answer_status", "subject", "topic", "subtopic", "difficulty", "exam_name", "exam_year", "has_image", "image_url", "paper_id", "practice_ready",
            "pattern_tag", "trap_tag", "skill_tag", "question_style", "pattern_confidence", "pattern_reason", "solve_hint",
        ], supported_cols)
        q = _apply_public_question_filter(supabase.table("questions").select(select_clause), supported_cols)

        if subject and has_canonical_subject:
            q = q.eq(subject_col, subject)
        if topic and has_canonical_topic:
            q = q.eq(topic_col, topic)
        if difficulty:
            q = q.eq("difficulty", difficulty)

        q = q.limit(max(count * 10, 200))
        result = q.execute()
        questions = []
        for row in result.data or []:
            if not _row_matches_selected_papers(row, publishable_paper_ids):
                continue
            sanitized = _sanitize_public_question_row(row)
            if sanitized is not None:
                if subject and sanitized.get("subject") != subject:
                    continue
                if topic and sanitized.get("topic") != topic:
                    continue
                questions.append(sanitized)

        import random
        random.shuffle(questions)
        return {"questions": questions[:count], "count": min(len(questions), count)}
    except Exception as e2:
        raise HTTPException(500, f"Database error: {e2}")


@app.get("/topic-questions")
async def get_questions_by_topic(
    subject: str = Query(...),
    topic: str = Query(...),
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    response: Response = None,
    _current_user: dict = Depends(get_current_user),
):
    try:
        if offset == 0 and limit <= 100:
            result = _topic_first_page_questions(
                subject=subject,
                topic=topic,
                limit=limit,
            )
        else:
            result = _topic_bucket_questions(
                subject=subject,
                topic=topic,
                admin_mode=False,
                limit=limit,
                offset=offset,
            )
        # Strip correct answers from bulk response
        if isinstance(result, dict) and "questions" in result:
            result = dict(result)
            result["questions"] = _strip_answer_fields(result["questions"])
        if response is not None:
            response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=600"
        return result
    except Exception as e:
        print(f"[ERROR] Database error: {e}")
        raise HTTPException(500, "Database error")


@app.get("/stats")
def get_stats():
    """Dashboard statistics — cached in-process for 5 minutes."""
    global _stats_cache, _stats_cache_ts
    now = time.time()
    if _stats_cache is not None and (now - _stats_cache_ts) < _STATS_CACHE_TTL:
        return _stats_cache
    try:
        supported_cols = _question_supported_columns()
        publishable_paper_ids = None if (_public_include_all_questions() or _practice_ready_mode(supported_cols)) else latest_live_paper_ids(sb=supabase)
        all_rows: list[dict] = []
        offset = 0
        while True:
            r = _apply_public_question_filter(supabase.table("questions").select(
                "id, subject, difficulty, exam_year, exam_name, paper_id, "
                "needs_review, question_number, practice_ready"
            ), supported_cols).range(offset, offset + 999).execute()
            batch = r.data or []
            for row in batch:
                if not _row_matches_selected_papers(row, publishable_paper_ids):
                    continue
                sanitized = _sanitize_public_question_row(row)
                if sanitized is None:
                    continue
                all_rows.append(sanitized)
            if len(batch) < 1000:
                break
            offset += 1000

        total = len(all_rows)
        sc: dict[str, int] = {}
        for q in all_rows:
            s = q["subject"]
            sc[s] = sc.get(s, 0) + 1
        subjects = [{"subject": k, "count": v} for k, v in sorted(sc.items(), key=lambda x: x[1], reverse=True)]

        diff = {"Easy": 0, "Medium": 0, "Hard": 0}
        for q in all_rows:
            level = q.get("difficulty")
            if level in diff:
                diff[level] += 1

        years = sorted(set(q["exam_year"] for q in all_rows), reverse=True)
        exams = sorted(set(q["exam_name"] for q in all_rows))

        result = {
            "total_questions": total,
            "subjects": subjects,
            "difficulty_distribution": diff,
            "exam_years": years,
            "exam_names": exams,
        }
        _stats_cache = result
        _stats_cache_ts = time.time()
        return result
    except Exception as e:
        print(f"[ERROR] Stats error: {e}")
        raise HTTPException(500, "Stats error")


# ══════════════════════════════════════════════════════════
# AUTH ENDPOINT (Firebase token required)
# ══════════════════════════════════════════════════════════

class AttemptCreate(BaseModel):
    question_id: str
    selected_answer: str = Field(..., pattern="^[A-D]$")
    is_correct: bool
    time_taken_seconds: Optional[int] = None
    exam_name: Optional[str] = None
    subject: Optional[str] = None
    topic: Optional[str] = None
    subtopic: Optional[str] = None
    pattern_tag: Optional[str] = None
    mode: Optional[str] = "practice"


_LEADERBOARD_KNOWN_COMMISSIONS = (
    "TSPSC", "APPSC", "UPSC", "UPPSC", "MPPSC", "BPSC", "RPSC", "MPSC",
    "KPSC", "TNPSC", "SSC", "IBPS", "RRB", "NABARD", "TSLPRB",
    "APSLPRB", "APHC", "TSHC",
)
_LEADERBOARD_SPECIAL_COMMISSIONS = (
    ("AP HIGH COURT", "APHC"),
    ("ANDHRA PRADESH HIGH COURT", "APHC"),
    ("TS HIGH COURT", "TSHC"),
    ("TELANGANA HIGH COURT", "TSHC"),
)
_LEADERBOARD_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _parse_leaderboard_commission(exam_name: str) -> str:
    trimmed = str(exam_name or "").strip()
    upper = trimmed.upper()
    for prefix, commission in _LEADERBOARD_SPECIAL_COMMISSIONS:
        if upper.startswith(prefix):
            return commission
    for commission in _LEADERBOARD_KNOWN_COMMISSIONS:
        if upper.startswith(commission):
            return commission
    parts = trimmed.split()
    return parts[0].upper() if parts else "GENERAL"


def _parse_leaderboard_scope(raw: str | None) -> list[str]:
    if not raw:
        return []
    seen: set[str] = set()
    ordered: list[str] = []
    for item in raw.split(","):
        commission = str(item or "").strip().upper()
        if not commission or commission in seen:
            continue
        seen.add(commission)
        ordered.append(commission)
    return ordered


def _leaderboard_start_dt(time_filter: str) -> datetime | None:
    now = datetime.now(timezone.utc)
    if time_filter == "all-time":
        return None
    if time_filter == "monthly":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if time_filter == "weekly":
        week_start = now.date() - timedelta(days=now.weekday())
        return datetime.combine(week_start, datetime.min.time(), tzinfo=timezone.utc)
    raise HTTPException(400, "Invalid time_filter. Use all-time, monthly, or weekly.")


def _coerce_attempted_at(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
    if hasattr(value, "astimezone"):
        try:
            coerced = value.astimezone(timezone.utc)
            if isinstance(coerced, datetime):
                return coerced
        except Exception:
            return None
    return None


def _compute_attempt_streak(daily_activity: dict[str, int]) -> int:
    if not daily_activity:
        return 0
    active_dates = set(daily_activity.keys())
    cursor = datetime.now(timezone.utc).date()
    streak = 0
    while cursor.isoformat() in active_dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def _fallback_leaderboard_name(uid: str) -> str:
    suffix = (uid or "user")[:4].upper()
    return f"Aspirant {suffix}"


def _resolve_leaderboard_names(user_ids: list[str]) -> dict[str, str]:
    from firebase_admin import auth as firebase_auth

    unique_ids = [uid for uid in user_ids if uid]
    if not unique_ids:
        return {}
    names: dict[str, str] = {}
    # Batch lookup — one Firebase call for all users instead of one per user
    try:
        identifiers = [firebase_auth.UidIdentifier(uid) for uid in unique_ids]
        result = firebase_auth.get_users(identifiers)
        for record in result.users:
            names[record.uid] = (
                str(record.display_name or "").strip()
                or str(record.email or "").split("@")[0].strip()
                or _fallback_leaderboard_name(record.uid)
            )
    except Exception:
        pass
    # Fill in any that failed or weren't returned
    for uid in unique_ids:
        if uid not in names:
            names[uid] = _fallback_leaderboard_name(uid)
    return names


def _format_leaderboard_entry(
    agg: dict,
    names_by_uid: dict[str, str],
    current_uid: str,
) -> dict:
    attempted = int(agg.get("attempted") or 0)
    correct = int(agg.get("correct") or 0)
    accuracy = round((correct / attempted) * 100) if attempted > 0 else 0
    return {
        "rank": int(agg.get("rank") or 0),
        "name": names_by_uid.get(agg["user_id"], _fallback_leaderboard_name(agg["user_id"])),
        "exam": agg.get("top_exam") or "No attempts yet",
        "commission": agg.get("top_commission") or "GENERAL",
        "score": int(agg.get("score") or 0),
        "accuracy": accuracy,
        "streak": int(agg.get("streak") or 0),
        "attempts": attempted,
        "correct": correct,
        "is_me": agg["user_id"] == current_uid,
    }


@app.get("/leaderboard")
def get_leaderboard(
    commissions: str | None = Query(default=None),
    time_filter: str = Query(default="all-time"),
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(get_current_user),
):
    """Return a commission-scoped leaderboard derived from real user attempts."""
    current_uid = str(user.get("uid") or "").strip()
    if not current_uid:
        raise HTTPException(401, "Invalid user")

    selected_commissions = _parse_leaderboard_scope(commissions)
    start_dt = _leaderboard_start_dt(time_filter)

    # Cache the expensive DB scan (same data for all users viewing same scope).
    # Per-user parts (my_rank, my_entry) are derived from the cached list cheaply.
    cache_key = (commissions or "", time_filter)
    now_ts = time.time()
    cached_lb = _leaderboard_cache.get(cache_key)

    if cached_lb and (now_ts - cached_lb[0]) < _LEADERBOARD_CACHE_TTL:
        aggregates: dict[str, dict] = cached_lb[1]["aggregates"]
        commission_set: set[str] = cached_lb[1]["commission_set"]
        ranked: list[dict] = cached_lb[1]["ranked"]
    else:
        try:
            aggregates = {}
            commission_set = set()
            offset = 0
            while True:
                query = supabase.table("user_attempts").select(
                    "firebase_uid, is_correct, exam_name, attempted_at"
                )
                if start_dt is not None:
                    query = query.gte("attempted_at", start_dt.isoformat())
                response = query.range(offset, offset + 999).execute()
                rows = response.data or []
                if not rows:
                    break
                for item in rows:
                    uid = str(item.get("firebase_uid") or "").strip()
                    if not uid:
                        continue
                    exam_name = str(item.get("exam_name") or "").strip()
                    commission = _parse_leaderboard_commission(exam_name) if exam_name else "GENERAL"
                    if selected_commissions and commission not in selected_commissions:
                        continue
                    attempted_at_raw = item.get("attempted_at")
                    attempted_at = None
                    if isinstance(attempted_at_raw, str) and attempted_at_raw.strip():
                        try:
                            attempted_at = datetime.fromisoformat(
                                attempted_at_raw.replace("Z", "+00:00")
                            ).astimezone(timezone.utc)
                        except Exception:
                            attempted_at = None
                    attempted_at = attempted_at or datetime.now(timezone.utc)
                    is_correct = bool(item.get("is_correct"))
                    agg = aggregates.setdefault(uid, {
                        "user_id": uid,
                        "attempted": 0,
                        "correct": 0,
                        "score": 0,
                        "daily_activity": {},
                        "exam_counts": {},
                        "commission_counts": {},
                        "latest_attempt_at": _LEADERBOARD_EPOCH,
                    })
                    agg["attempted"] += 1
                    agg["correct"] += 1 if is_correct else 0
                    agg["score"] += 10 if is_correct else 2
                    if exam_name:
                        agg["exam_counts"][exam_name] = int(agg["exam_counts"].get(exam_name, 0)) + 1
                    agg["commission_counts"][commission] = int(agg["commission_counts"].get(commission, 0)) + 1
                    date_key = attempted_at.date().isoformat()
                    agg["daily_activity"][date_key] = int(agg["daily_activity"].get(date_key, 0)) + 1
                    if attempted_at > agg["latest_attempt_at"]:
                        agg["latest_attempt_at"] = attempted_at
                    commission_set.add(commission)
                if len(rows) < 1000:
                    break
                offset += 1000

            ranked = []
            for agg in aggregates.values():
                exam_counts = agg.get("exam_counts") or {}
                commission_counts = agg.get("commission_counts") or {}
                top_exam = max(
                    exam_counts.items(),
                    key=lambda pair: (pair[1], pair[0]),
                    default=("No attempts yet", 0),
                )[0]
                top_commission = max(
                    commission_counts.items(),
                    key=lambda pair: (pair[1], pair[0]),
                    default=((selected_commissions[0] if selected_commissions else "GENERAL"), 0),
                )[0]
                attempted = int(agg.get("attempted") or 0)
                correct = int(agg.get("correct") or 0)
                agg["top_exam"] = top_exam
                agg["top_commission"] = top_commission
                agg["accuracy"] = (correct / attempted) if attempted > 0 else 0.0
                agg["streak"] = _compute_attempt_streak(agg.get("daily_activity") or {})
                ranked.append(agg)

            ranked.sort(
                key=lambda agg: (
                    -int(agg.get("score") or 0),
                    -float(agg.get("accuracy") or 0.0),
                    -int(agg.get("attempted") or 0),
                    -(agg.get("latest_attempt_at") or _LEADERBOARD_EPOCH).timestamp(),
                    str(agg.get("user_id") or ""),
                )
            )
            for index, agg in enumerate(ranked, start=1):
                agg["rank"] = index

            _leaderboard_cache[cache_key] = (time.time(), {
                "aggregates": aggregates,
                "commission_set": commission_set,
                "ranked": ranked,
            })
        except Exception as _lb_exc:
            print(f"WARN leaderboard DB scan failed for user={current_uid}: {_lb_exc}")
            fallback_commission = selected_commissions[0] if selected_commissions else "GENERAL"
            fallback_name = str(user.get("name") or user.get("displayName") or "").strip() or _fallback_leaderboard_name(current_uid)
            return {
                "time_filter": time_filter,
                "scope_commissions": selected_commissions,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "total_aspirants": 1,
                "exams_covered": max(len(selected_commissions), 1),
                "has_more": False,
                "entries": [{"rank": 1, "name": fallback_name, "exam": "No attempts yet",
                             "commission": fallback_commission, "score": 0, "accuracy": 0,
                             "streak": 0, "attempts": 0, "correct": 0, "is_me": True}],
                "my_rank": 1,
                "my_entry": {"rank": 1, "name": fallback_name, "exam": "No attempts yet",
                             "commission": fallback_commission, "score": 0, "accuracy": 0,
                             "streak": 0, "attempts": 0, "correct": 0, "is_me": True},
                "warning": "Leaderboard is temporarily using fallback mode.",
            }

    # Per-user section — runs from cached data, zero DB cost
    try:
        aggregates.setdefault(current_uid, {
            "user_id": current_uid, "attempted": 0, "correct": 0, "score": 0,
            "daily_activity": {}, "exam_counts": {}, "commission_counts": {},
            "latest_attempt_at": _LEADERBOARD_EPOCH,
            "top_exam": "No attempts yet",
            "top_commission": selected_commissions[0] if selected_commissions else "GENERAL",
            "accuracy": 0.0, "streak": 0, "rank": len(ranked) + 1,
        })

        my_rank = 0
        my_agg: dict | None = None
        for agg in ranked:
            if agg["user_id"] == current_uid:
                my_rank = agg["rank"]
                my_agg = agg
                break

        top_entries = ranked[:limit]
        visible_user_ids = [str(agg["user_id"]) for agg in top_entries]
        if my_agg is not None and my_agg["user_id"] not in visible_user_ids:
            visible_user_ids.append(my_agg["user_id"])

        names_by_uid = _resolve_leaderboard_names(visible_user_ids)
        current_name = str(user.get("name") or user.get("displayName") or "").strip()
        if current_name:
            names_by_uid[current_uid] = current_name

        return {
            "time_filter": time_filter,
            "scope_commissions": selected_commissions,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "total_aspirants": len(ranked),
            "exams_covered": len(commission_set) if commission_set else max(len(selected_commissions), 1),
            "has_more": len(ranked) > limit,
            "entries": [
                _format_leaderboard_entry(agg, names_by_uid, current_uid)
                for agg in top_entries
            ],
            "my_rank": my_rank or 1,
            "my_entry": _format_leaderboard_entry(my_agg or ranked[0], names_by_uid, current_uid) if ranked else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"WARN leaderboard fallback for user={current_uid}: {e}")
        fallback_commission = selected_commissions[0] if selected_commissions else "GENERAL"
        fallback_name = str(user.get("name") or user.get("displayName") or "").strip() or _fallback_leaderboard_name(current_uid)
        return {
            "time_filter": time_filter,
            "scope_commissions": selected_commissions,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "total_aspirants": 1,
            "exams_covered": max(len(selected_commissions), 1),
            "has_more": False,
            "entries": [{"rank": 1, "name": fallback_name, "exam": "No attempts yet",
                         "commission": fallback_commission, "score": 0, "accuracy": 0,
                         "streak": 0, "attempts": 0, "correct": 0, "is_me": True}],
            "my_rank": 1,
            "my_entry": {"rank": 1, "name": fallback_name, "exam": "No attempts yet",
                         "commission": fallback_commission, "score": 0, "accuracy": 0,
                         "streak": 0, "attempts": 0, "correct": 0, "is_me": True},
            "warning": "Leaderboard is temporarily using fallback mode.",
        }


@app.post("/attempt")
def record_attempt(attempt: AttemptCreate, user: dict = Depends(get_current_user)):
    """Store user attempt in Supabase, with Firestore as best-effort secondary."""
    import traceback as _tb
    persisted = False
    warning: str | None = None
    attempt_id: str | None = None
    attempted_at = datetime.now(timezone.utc).isoformat()
    uid = user.get("uid", "unknown")

    # Secure correctness evaluation on server-side
    server_is_correct = False
    try:
        q_res = supabase.table("questions").select("correct_answer", "correct_answers").eq("id", attempt.question_id).execute()
        if q_res.data:
            q_row = q_res.data[0]
            correct_answer = str(q_row.get("correct_answer") or "").strip().upper()
            correct_answers = q_row.get("correct_answers") or []
            sel = str(attempt.selected_answer).strip().upper()
            if correct_answers:
                norm_answers = {str(ans).strip().upper() for ans in correct_answers}
                server_is_correct = sel in norm_answers
            else:
                server_is_correct = (sel == correct_answer)
        else:
            server_is_correct = attempt.is_correct
    except Exception as e:
        print(f"WARN record_attempt correctness check failed: {e}")
        server_is_correct = attempt.is_correct

    try:
        res = supabase.table("user_attempts").insert({
            "firebase_uid": uid,
            "question_id": attempt.question_id,
            "selected_answer": attempt.selected_answer,
            "is_correct": server_is_correct,
            "time_taken_s": int(attempt.time_taken_seconds or 0),
            "exam_name": attempt.exam_name,
            "subject": attempt.subject,
            "topic": attempt.topic,
            "subtopic": attempt.subtopic,
            "pattern_tag": attempt.pattern_tag,
            "mode": attempt.mode or "practice",
            "attempted_at": attempted_at,
        }).execute()
        inserted = res.data or []
        if inserted:
            attempt_id = str(inserted[0].get("id") or "")
        persisted = True
    except BaseException as e:
        print(f"WARN record_attempt supabase failed uid={uid}: {type(e).__name__}: {e}\n{_tb.format_exc()}")
        warning = "Attempt was not persisted to the leaderboard store."

    try:
        from firebase_admin import firestore
        db = firestore.client()
        ref = db.collection("attempts").document()
        ref.set({
            "userId": uid,
            "questionId": attempt.question_id,
            "selectedAnswer": attempt.selected_answer,
            "isCorrect": server_is_correct,
            "timeTakenSeconds": attempt.time_taken_seconds,
            "examName": attempt.exam_name,
            "subject": attempt.subject,
            "attemptedAt": firestore.SERVER_TIMESTAMP,
        })
    except BaseException as e:
        print(f"WARN record_attempt firestore failed uid={uid}: {type(e).__name__}: {e}")

    if persisted:
        return {"status": "recorded", "attemptId": attempt_id, "isCorrect": server_is_correct}

    return {
        "status": "deferred",
        "attemptId": None,
        "isCorrect": server_is_correct,
        "warning": warning or "Attempt was not persisted server-side.",
    }


@app.get("/progress/me")
def get_my_progress(user: dict = Depends(get_current_user)):
    """Return dashboard-ready progress for the authenticated user."""
    from firebase_admin import firestore

    try:
        db = firestore.client()
        docs = db.collection("attempts").where("userId", "==", user["uid"]).stream()
        attempts = [doc.to_dict() or {} for doc in docs]

        by_subject: dict[str, dict[str, int]] = {}
        total_answered = 0
        xp = 0
        daily_activity: dict[str, int] = {}
        recent_attempts: list[dict[str, object]] = []

        def _attempt_date_str(item: dict) -> str:
            stamp = item.get("attemptedAt")
            if hasattr(stamp, "date"):
                return stamp.date().isoformat()
            return datetime.now(timezone.utc).date().isoformat()

        def _attempt_sort_key(item: dict) -> datetime:
            stamp = item.get("attemptedAt")
            if hasattr(stamp, "astimezone"):
                return stamp.astimezone(timezone.utc)
            return datetime.now(timezone.utc)

        attempts.sort(key=_attempt_sort_key, reverse=True)

        for item in attempts:
            subject = str(item.get("subject") or "Unknown")
            is_correct = bool(item.get("isCorrect"))
            total_answered += 1
            xp += 10 if is_correct else 2

            if subject not in by_subject:
                by_subject[subject] = {"correct": 0, "total": 0}
            by_subject[subject]["total"] += 1
            if is_correct:
                by_subject[subject]["correct"] += 1

            date_key = _attempt_date_str(item)
            daily_activity[date_key] = daily_activity.get(date_key, 0) + 1

        for item in attempts[:20]:
            recent_attempts.append({
                "q": str(item.get("examName") or item.get("subject") or "Attempt"),
                "correct": bool(item.get("isCorrect")),
                "subject": str(item.get("subject") or "Unknown"),
                "topic": str(item.get("examName") or ""),
                "time": (
                    f"{int(item.get('timeTakenSeconds') or 0)}s"
                    if item.get("timeTakenSeconds") is not None
                    else "saved"
                ),
            })

        streak = 0
        active_dates = sorted(daily_activity.keys(), reverse=True)
        today = datetime.now(timezone.utc).date()
        for idx, date_key in enumerate(active_dates):
            expected = (today - timedelta(days=idx)).isoformat()
            if date_key == expected:
                streak += 1
            else:
                break

        return {
            "bySubject": by_subject,
            "streak": streak,
            "lastActiveDate": active_dates[0] if active_dates else "",
            "xp": xp,
            "totalAnswered": total_answered,
            "recentAttempts": recent_attempts,
            "dailyActivity": daily_activity,
        }
    except Exception as e:
        print(f"[ERROR] Failed to load progress: {e}")
        raise HTTPException(500, "Failed to load progress")


# ══════════════════════════════════════════════════════════
# USER STATS — Supabase-backed (Priority 3)
# ══════════════════════════════════════════════════════════

class SyncLocalPayload(BaseModel):
    by_subject: dict = {}
    streak: int = 0
    last_active_date: str = ""
    xp: int = 0
    total_answered: int = 0
    daily_activity: dict = {}


# ── Subscription helpers ────────────────────────────────────────────────────────

def _get_subscription(firebase_uid: str) -> dict:
    """Fetch and auto-expire subscription row. Returns normalized dict."""
    try:
        r = supabase.table("user_subscriptions").select("*").eq("firebase_uid", firebase_uid).limit(1).execute()
        if not r.data:
            return {"plan": "free", "status": "active", "is_premium": False, "plan_expires_at": None}
        sub = r.data[0]
        plan   = str(sub.get("plan") or "free").lower()
        status = str(sub.get("status") or "active").lower()
        expires_at = sub.get("plan_expires_at")
        if plan != "free" and expires_at:
            from datetime import datetime, timezone
            expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
            if expiry < datetime.now(timezone.utc):
                plan = "free"
                status = "expired"
                try:
                    supabase.table("user_subscriptions").update({
                        "plan": "free", "status": "expired",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }).eq("firebase_uid", firebase_uid).execute()
                except Exception:
                    pass
        is_premium = (plan != "free") and (status == "active")
        return {"plan": plan, "status": status, "is_premium": is_premium, "plan_expires_at": expires_at}
    except Exception as e:
        print(f"WARN _get_subscription({firebase_uid}): {e}")
        return {"plan": "free", "status": "active", "is_premium": False, "plan_expires_at": None}


def _get_subscription_cached(firebase_uid: str) -> dict:
    """_get_subscription with a 5-min in-process cache to avoid a DB hit on every question page."""
    global _subscription_cache
    now = time.time()
    cached = _subscription_cache.get(firebase_uid)
    if cached and (now - cached[0]) < _SUBSCRIPTION_CACHE_TTL:
        return cached[1]
    result = _get_subscription(firebase_uid)
    _subscription_cache[firebase_uid] = (now, result)
    # Evict stale entries occasionally to prevent unbounded growth.
    if len(_subscription_cache) > 5000:
        cutoff = now - _SUBSCRIPTION_CACHE_TTL
        stale = [k for k, v in _subscription_cache.items() if v[0] < cutoff]
        for k in stale:
            del _subscription_cache[k]
    return result


def _get_free_papers_set() -> frozenset:
    """Return a frozenset of (exam_name_lower, year) pairs free for all authenticated users.
    One paper per commission = first exam type in catalog + its latest year (mirrors frontend logic)."""
    global _free_papers_cache, _free_papers_cache_ts
    now = time.time()
    if _free_papers_cache is not None and (now - _free_papers_cache_ts) < _FREE_PAPERS_CACHE_TTL:
        return _free_papers_cache
    try:
        snapshot = _get_public_meta_snapshot()
        commission_map: dict = snapshot["catalog"].get("commission_map", {})
        free_set: set[tuple[str, int]] = set()
        for exams in commission_map.values():
            if not exams:
                continue
            first_key = next(iter(exams), None)
            if not first_key:
                continue
            info = exams[first_key]
            years = info.get("years") or []
            full_name = str(info.get("fullName") or "").strip()
            if not full_name or not years:
                continue
            free_set.add((full_name.lower(), max(years)))
        _free_papers_cache = frozenset(free_set)
        _free_papers_cache_ts = now
        return _free_papers_cache
    except Exception as exc:
        print(f"WARN _get_free_papers_set: {exc}")
        return frozenset()


def _require_exam_access(user: dict, exam_name: str | None, exam_year: int | None) -> None:
    """Raise 403 if this user cannot access the requested exam paper.
    Free users may only access one paper per commission (first exam type, latest year).
    Anonymous users (no uid) can only access free papers."""
    if not exam_name or not exam_year:
        return
    # Dev bypass: localhost with no real auth infrastructure can skip gating
    if os.getenv("DISABLE_EXAM_GATING", "").lower() in ("1", "true", "yes"):
        return
    uid = user.get("uid") if isinstance(user, dict) else None
    if uid:
        sub = _get_subscription_cached(uid)
        if sub.get("is_premium"):
            return
    if (exam_name.lower(), exam_year) in _get_free_papers_set():
        return
    if not uid:
        raise HTTPException(401, "Login required to access this exam.")
    raise HTTPException(403, "This paper requires a premium subscription.")


@app.get("/user/subscription")
def get_user_subscription(user: dict = Depends(get_current_user)):
    return _get_subscription(user["uid"])


class _GrantPremiumBody(BaseModel):
    firebase_uid: str
    plan: str = "pro"
    days: int = 30


@app.post("/admin/grant-premium", dependencies=[Depends(verify_admin)])
def admin_grant_premium(body: _GrantPremiumBody):
    from datetime import datetime, timezone, timedelta
    expires_at = (datetime.now(timezone.utc) + timedelta(days=body.days)).isoformat()
    supabase.table("user_subscriptions").upsert({
        "firebase_uid": body.firebase_uid,
        "plan": body.plan,
        "status": "active",
        "plan_expires_at": expires_at,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="firebase_uid").execute()
    # Evict from cache so user sees premium immediately on next request
    _subscription_cache.pop(body.firebase_uid, None)
    return {"status": "granted", "firebase_uid": body.firebase_uid, "plan": body.plan, "expires_at": expires_at}


class _RevokePremiumBody(BaseModel):
    firebase_uid: str


@app.post("/admin/revoke-premium", dependencies=[Depends(verify_admin)])
def admin_revoke_premium(body: _RevokePremiumBody):
    from datetime import datetime, timezone
    supabase.table("user_subscriptions").upsert({
        "firebase_uid": body.firebase_uid,
        "plan": "free",
        "status": "active",
        "plan_expires_at": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }, on_conflict="firebase_uid").execute()
    # Evict from cache so revocation takes effect immediately on next request
    _subscription_cache.pop(body.firebase_uid, None)
    return {"status": "revoked", "firebase_uid": body.firebase_uid}


# ── User stats ──────────────────────────────────────────────────────────────────

@app.get("/user/stats")
def get_user_stats(user: dict = Depends(get_current_user)):
    """Return cached Supabase stats, falling back to Firestore if cache is cold."""
    uid = user["uid"]
    try:
        row = supabase.table("user_stats_cache").select("*").eq("firebase_uid", uid).maybe_single().execute()
        if row.data:
            d = row.data
            return {
                "bySubject": d.get("by_subject") or {},
                "streak": d.get("streak", 0),
                "lastActiveDate": str(d.get("last_active") or ""),
                "xp": d.get("xp", 0),
                "totalAnswered": d.get("total_answered", 0),
                "dailyActivity": d.get("daily_activity") or {},
            }
    except Exception:
        pass
    # Cache miss — fall back to Firestore progress endpoint data
    return {"bySubject": {}, "streak": 0, "lastActiveDate": "", "xp": 0, "totalAnswered": 0, "dailyActivity": {}}


@app.post("/user/sync-local")
def sync_local_stats(payload: SyncLocalPayload, user: dict = Depends(get_current_user)):
    """Upsert localStorage stats into the Supabase cache table."""
    uid = user["uid"]
    last_active = None
    if payload.last_active_date:
        try:
            from datetime import date
            last_active = date.fromisoformat(payload.last_active_date).isoformat()
        except Exception:
            pass
    try:
        supabase.table("user_stats_cache").upsert({
            "firebase_uid": uid,
            "by_subject": payload.by_subject,
            "streak": payload.streak,
            "last_active": last_active,
            "xp": payload.xp,
            "total_answered": payload.total_answered,
            "daily_activity": payload.daily_activity,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="firebase_uid").execute()
        return {"status": "synced"}
    except Exception as e:
        print(f"[ERROR] Sync failed: {e}")
        raise HTTPException(500, "Sync failed")


@app.get("/user/weakness-report")
def get_weakness_report(user: dict = Depends(get_current_user)):
    """Return per-subject, per-topic, and per-pattern accuracy sorted weakest-first.

    Pattern tags are resolved from the questions table, so this works correctly
    for all attempts made before pattern tagging was introduced.
    """
    uid = user["uid"]

    # Step 1: pull last 500 attempts (include question_id for tag resolution)
    try:
        res = supabase.table("user_attempts") \
            .select("question_id, subject, topic, subtopic, pattern_tag, is_correct") \
            .eq("firebase_uid", uid) \
            .order("attempted_at", desc=True) \
            .limit(500) \
            .execute()
        rows: list[dict] = res.data or []
    except Exception:
        rows = []

    # Step 2: resolve pattern_tag from questions for attempts that predate tagging
    unresolved_ids = [
        r["question_id"] for r in rows
        if r.get("question_id") and not r.get("pattern_tag")
    ]
    tag_map: dict[str, str | None] = {}
    for i in range(0, len(unresolved_ids), 100):
        chunk = unresolved_ids[i:i + 100]
        try:
            q_res = supabase.table("questions") \
                .select("id, pattern_tag") \
                .in_("id", chunk) \
                .execute()
            for q in (q_res.data or []):
                tag_map[q["id"]] = q.get("pattern_tag")
        except Exception:
            pass

    by_subject: dict[str, dict] = {}
    by_topic: dict[str, dict] = {}
    by_pattern: dict[str, dict] = {}

    for r in rows:
        correct = bool(r.get("is_correct"))
        subject = r.get("subject") or "General"
        topic = r.get("topic") or "General"
        subtopic = r.get("subtopic") or ""
        # Use stored attempt tag first; fall back to current question tag
        pattern = r.get("pattern_tag") or tag_map.get(r.get("question_id") or "") or ""

        s = by_subject.setdefault(subject, {"correct": 0, "total": 0})
        s["total"] += 1
        if correct:
            s["correct"] += 1

        topic_key = f"{subject}::{topic}"
        t = by_topic.setdefault(topic_key, {"subject": subject, "topic": topic, "subtopic": subtopic, "correct": 0, "total": 0})
        t["total"] += 1
        if correct:
            t["correct"] += 1

        if pattern:
            p = by_pattern.setdefault(pattern, {"pattern_tag": pattern, "correct": 0, "total": 0})
            p["total"] += 1
            if correct:
                p["correct"] += 1

    def _accuracy(c: int, t: int) -> float:
        return round(c / t * 100, 1) if t > 0 else 0.0

    subject_report = sorted(
        [{"subject": s, "accuracy": _accuracy(v["correct"], v["total"]), "total": v["total"], "correct": v["correct"]}
         for s, v in by_subject.items() if v["total"] >= 3],
        key=lambda x: x["accuracy"]
    )
    topic_report = sorted(
        [{"subject": v["subject"], "topic": v["topic"], "subtopic": v["subtopic"],
          "accuracy": _accuracy(v["correct"], v["total"]), "total": v["total"], "correct": v["correct"]}
         for v in by_topic.values() if v["total"] >= 2],
        key=lambda x: x["accuracy"]
    )
    pattern_report = sorted(
        [{"pattern_tag": v["pattern_tag"], "accuracy": _accuracy(v["correct"], v["total"]),
          "total": v["total"], "correct": v["correct"]}
         for v in by_pattern.values() if v["total"] >= 2],
        key=lambda x: x["accuracy"]
    )

    return {
        "weaknesses": subject_report,
        "topic_weaknesses": topic_report[:10],
        "pattern_weaknesses": pattern_report,
    }


@app.get("/admin/pattern-tag-values", dependencies=[Depends(verify_admin)])
def admin_get_pattern_tag_values():
    return {
        "pattern_tags": PATTERN_TAG_VALUES,
        "trap_tags": TRAP_TAG_VALUES,
        "skill_tags": SKILL_TAG_VALUES,
        "question_styles": QUESTION_STYLE_VALUES,
    }


# ══════════════════════════════════════════════════════════
# SRS — SM-2 Spaced Repetition (Priority 4)
# ══════════════════════════════════════════════════════════

class SrsReviewPayload(BaseModel):
    question_id: str
    quality: int = Field(..., ge=0, le=5)  # SM-2: 0=blackout, 5=perfect


def _sm2_next(interval: int, ease: float, reps: int, quality: int) -> tuple[int, float, int]:
    """SM-2 algorithm: returns (new_interval_days, new_ease, new_reps)."""
    if quality < 3:
        return 1, max(1.3, ease - 0.2), 0
    new_ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    new_ease = max(1.3, new_ease)
    new_reps = reps + 1
    if new_reps == 1:
        new_interval = 1
    elif new_reps == 2:
        new_interval = 6
    else:
        new_interval = round(interval * new_ease)
    return new_interval, round(new_ease, 3), new_reps


@app.get("/user/srs-queue")
def get_srs_queue(limit: int = 20, user: dict = Depends(get_current_user)):
    """Return questions due for SRS review today (due_date <= today)."""
    uid = user["uid"]
    today = datetime.now(timezone.utc).date().isoformat()
    try:
        rows = (
            supabase.table("srs_schedule")
            .select("question_id, due_date, interval_days, ease_factor, repetitions")
            .eq("firebase_uid", uid)
            .lte("due_date", today)
            .order("due_date")
            .limit(limit)
            .execute()
            .data or []
        )
        if not rows:
            return {"due": [], "count": 0}

        qids = [r["question_id"] for r in rows]
        questions = (
            supabase.table("questions")
            .select("id,question_text,option_a,option_b,option_c,option_d,subject,topic,exam_name,exam_year")
            .in_("id", qids)
            .execute()
            .data or []
        )
        qmap = {q["id"]: q for q in questions}
        due = []
        for r in rows:
            q = qmap.get(r["question_id"])
            if q:
                due.append({**q, "srs_interval": r["interval_days"], "srs_reps": r["repetitions"]})
        return {"due": due, "count": len(due)}
    except Exception as e:
        print(f"[ERROR] SRS queue error: {e}")
        raise HTTPException(500, "SRS queue error")


@app.post("/user/srs-review")
def submit_srs_review(payload: SrsReviewPayload, user: dict = Depends(get_current_user)):
    """Process an SRS review and schedule the next due date."""
    uid = user["uid"]
    try:
        row = (
            supabase.table("srs_schedule")
            .select("interval_days, ease_factor, repetitions")
            .eq("firebase_uid", uid)
            .eq("question_id", payload.question_id)
            .maybe_single()
            .execute()
        )
        if row.data:
            interval = row.data["interval_days"]
            ease = row.data["ease_factor"]
            reps = row.data["repetitions"]
        else:
            interval, ease, reps = 1, 2.5, 0

        new_interval, new_ease, new_reps = _sm2_next(interval, ease, reps, payload.quality)
        from datetime import date, timedelta
        due = (date.today() + timedelta(days=new_interval)).isoformat()

        supabase.table("srs_schedule").upsert({
            "firebase_uid": uid,
            "question_id": payload.question_id,
            "due_date": due,
            "interval_days": new_interval,
            "ease_factor": new_ease,
            "repetitions": new_reps,
            "last_quality": payload.quality,
        }, on_conflict="firebase_uid,question_id").execute()

        return {"next_due": due, "interval_days": new_interval, "ease_factor": new_ease}
    except Exception as e:
        print(f"[ERROR] SRS review error: {e}")
        raise HTTPException(500, "SRS review error")


# ══════════════════════════════════════════════════════════
# BOOKMARKS (Priority 5)
# ══════════════════════════════════════════════════════════

class BookmarkPayload(BaseModel):
    question_id: str
    note: Optional[str] = None


@app.post("/user/bookmark")
def add_bookmark(payload: BookmarkPayload, user: dict = Depends(get_current_user)):
    uid = user["uid"]
    try:
        supabase.table("bookmarks").upsert(
            {"firebase_uid": uid, "question_id": payload.question_id, "note": payload.note},
            on_conflict="firebase_uid,question_id",
        ).execute()
        return {"status": "bookmarked"}
    except Exception as e:
        print(f"[ERROR] Bookmark failed: {e}")
        raise HTTPException(500, "Bookmark failed")


@app.delete("/user/bookmark/{question_id}")
def remove_bookmark(question_id: str, user: dict = Depends(get_current_user)):
    uid = user["uid"]
    try:
        supabase.table("bookmarks").delete().eq("firebase_uid", uid).eq("question_id", question_id).execute()
        return {"status": "removed"}
    except Exception as e:
        print(f"[ERROR] Remove bookmark failed: {e}")
        raise HTTPException(500, "Remove bookmark failed")


@app.get("/user/bookmarks")
def list_bookmarks(limit: int = 50, user: dict = Depends(get_current_user)):
    uid = user["uid"]
    try:
        rows = (
            supabase.table("bookmarks")
            .select("question_id, note, created_at")
            .eq("firebase_uid", uid)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
            .data or []
        )
        if not rows:
            return {"bookmarks": []}

        qids = [r["question_id"] for r in rows]
        questions = (
            supabase.table("questions")
            .select("id,question_text,option_a,option_b,option_c,option_d,correct_answer,subject,topic,exam_name,exam_year")
            .in_("id", qids)
            .execute()
            .data or []
        )
        qmap = {q["id"]: q for q in questions}
        note_map = {r["question_id"]: r.get("note") for r in rows}
        bookmarks = []
        for r in rows:
            q = qmap.get(r["question_id"])
            if q:
                bookmarks.append({**q, "bookmark_note": note_map.get(r["question_id"])})
        return {"bookmarks": bookmarks}
    except Exception as e:
        print(f"[ERROR] List bookmarks failed: {e}")
        raise HTTPException(500, "List bookmarks failed")


# ══════════════════════════════════════════════════════════
# ADMIN ENDPOINTS (API key required)
# ══════════════════════════════════════════════════════════

@app.post("/admin/tag-patterns", dependencies=[Depends(verify_admin)])
def admin_tag_patterns(
    paper_id: Optional[str] = None,
    limit: int = 500,
):
    """Run pattern intelligence tagging on untagged questions (synchronous, small batches)."""
    from pattern_tagger import run_pattern_tagger
    result = run_pattern_tagger(paper_id=paper_id, limit=limit)
    return result


# Global state for the background bulk tagger.
_bulk_tag_job: dict = {
    "running": False, "tagged": 0, "total": 0, "errors": 0,
    "started_at": None, "finished_at": None, "error": None,
}


@app.post("/admin/tag-patterns-all", dependencies=[Depends(verify_admin)])
def admin_tag_patterns_all(limit: int = 12000, force: bool = False):
    """Kick off background pattern tagging for ALL untagged questions.
    Returns immediately — poll GET /admin/tag-patterns-status for progress."""
    from datetime import datetime, timezone
    global _bulk_tag_job
    if _bulk_tag_job.get("running"):
        return {"status": "already_running", **_bulk_tag_job}

    # Set running=True BEFORE starting the thread so the immediate fetchStatus
    # poll from the frontend sees running=True with no race window.
    _bulk_tag_job = {
        "running": True, "tagged": 0, "total": 0, "errors": 0,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None, "error": None,
    }

    def _run() -> None:
        global _bulk_tag_job
        import io
        import traceback as _tb
        import sys as _sys
        from auto_tag_patterns import run as _tag_run
        from datetime import datetime, timezone
        from pathlib import Path as _Path

        # Route all print() output from the tagger to a log file so the background
        # thread never writes to uvicorn's non-blocking stdout (which raises EAGAIN/
        # BlockingIOError [Errno 35] on macOS when the pipe buffer is full).
        _log_path = _Path(__file__).parent / "cache" / "pattern_tags" / "tagger_stdout.log"
        _log_path.parent.mkdir(parents=True, exist_ok=True)
        with _log_path.open("a", encoding="utf-8", buffering=1) as _log_f:
            _old_stdout, _old_stderr = _sys.stdout, _sys.stderr
            _sys.stdout = _log_f
            _sys.stderr = _log_f
            try:
                result = _tag_run(
                    exam_name=None, exam_year=None,
                    limit=limit, force=force, dry_run=False, paper_id=None,
                )
                _bulk_tag_job.update({
                    "running": False,
                    "tagged": result.get("tagged", 0),
                    "total": result.get("candidates", 0),
                    "errors": result.get("errors", 0),
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as _e:
                # Full traceback goes to the log file (stdout is redirected to _log_f)
                print(f"[ERROR] bulk-pattern-tagger failed: {type(_e).__name__}: {_e}\n{_tb.format_exc()}")
                _bulk_tag_job.update({
                    "running": False,
                    "error": f"{type(_e).__name__}: {_e}",
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                })
            finally:
                _sys.stdout = _old_stdout
                _sys.stderr = _old_stderr

    threading.Thread(target=_run, daemon=True, name="bulk-pattern-tagger").start()
    return {"status": "started", **_bulk_tag_job}


@app.get("/admin/tag-patterns-status", dependencies=[Depends(verify_admin)])
def admin_tag_patterns_status():
    """Return current status of the background bulk pattern tagger plus live untagged count."""
    try:
        r = supabase.table("questions").select("id", count="exact").eq("is_active", True).is_("pattern_tag", "null").execute()
        untagged = r.count or 0
    except Exception:
        untagged = -1
    return {**_bulk_tag_job, "untagged_remaining": untagged}


@app.post("/admin/upload-pdf", dependencies=[Depends(verify_admin)])
def admin_upload_pdf(
    file: UploadFile = File(...),
    exam_name: str = Form(...),
    exam_year: int = Form(...),
    series: str = Form(""),
    use_vision: bool = Form(False),
    is_cbt: bool = Form(False),
    shift_label_override: str = Form(""),
    answer_key_file: Optional[UploadFile] = File(None),
    expected_count: int = Form(0),
    force_replace: bool = Form(False),
    clear_cache: bool = Form(False),
    repair_missing_only: bool = Form(False),
):
    """
    Admin uploads a PDF → Async Job is created and queued.
    Uses threading.Thread instead of BackgroundTasks so tasks
    survive uvicorn --reload restarts.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files accepted")
    _pdf_content = file.file.read()
    file.file.seek(0)
    if not _pdf_content[:4] == b"%PDF":
        raise HTTPException(400, "Invalid PDF file")

    # Normalize exam_name: collapse multiple spaces, strip edges, preserve original casing
    exam_name = normalize_exam_name(exam_name)
    existing_missing_numbers = _repair_target_numbers_for_exam(
        exam_name,
        exam_year,
        expected_count=expected_count,
    )
    missing_reupload_mode = bool(repair_missing_only and existing_missing_numbers) and not force_replace

    content = file.file.read()

    MAX_SIZE = 100 * 1024 * 1024  # 100 MB
    if len(content) > MAX_SIZE:
        raise HTTPException(413, f"File too large ({len(content)//1024//1024} MB). Max allowed: 100 MB.")
    file_hash = hashlib.sha256(content).hexdigest()

    # ── Multi-billion Dollar Deduction & Overwrite Intelligence ─────────────
    # 1. File Hash Check (prevents same file twice)
    existing_job = supabase.table("jobs").select("id, status, exam_name, exam_year").eq("file_hash", file_hash).execute()
    if existing_job.data:
        if not force_replace and not missing_reupload_mode:
            job = existing_job.data[0]
            # A job stuck in 'processing' almost certainly means the daemon thread
            # was killed by a server reload (uvicorn --reload). Treat it the same
            # as 'failed' so we can restart it — do NOT return 409.
            # Only block genuinely running jobs (progress recently updated within 5 min).
            import datetime as _dt
            updated_at_str = job.get("updated_at") or ""
            is_stale_processing = False
            if job["status"] == "processing":
                try:
                    updated = _dt.datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))
                    age_mins = (_dt.datetime.now(_dt.timezone.utc) - updated).total_seconds() / 60
                    is_stale_processing = age_mins > 5  # no progress in 5+ minutes → thread is dead
                except Exception:
                    is_stale_processing = True  # assume stale if can't parse

            if job["status"] in ["completed", "pending"] or (
                job["status"] == "processing" and not is_stale_processing
            ):
                existing_exam = f"{job.get('exam_name', '')} {job.get('exam_year', '')}".strip()
                return JSONResponse(status_code=409, content={
                    "error": "duplicate_file",
                    "message": f"This PDF was already uploaded as '{existing_exam}'. Re-processing it will create a new entry under '{exam_name} {exam_year}'.",
                    "job_id": job["id"],
                    "existing_exam_name": job.get("exam_name", ""),
                    "existing_exam_year": job.get("exam_year", ""),
                })
            # Stale processing job — reset it so the update below can restart it
            if is_stale_processing:
                print(f"[upload] Stale processing job {job['id']} (last update {updated_at_str[:19]}), resetting to failed for restart")
                supabase.table("jobs").update({
                    "status": "failed",
                    "error_log": "Thread died (server reload). Will be restarted."
                }).eq("id", job["id"]).execute()
        # If we ARE forcing replace, retrying a failed job, or running a missing-question repair,
        # do NOT hard-delete the previous file-hash jobs. The frontend may still
        # be polling them, and deleting the row causes fake 404 failures in the
        # upload modal. Archive them instead so the poller can fail gracefully.
        for job in existing_job.data:
            try:
                supabase.table("jobs").update({
                    "status": "failed",
                    "error_log": "Superseded by a newer upload for the same PDF/file hash.",
                }).eq("id", job["id"]).execute()
            except Exception:
                pass

    # 2. Exam Name + Year Check (prevents same exam with different PDF)
    existing_q = supabase.table("questions").select("id").eq("exam_name", exam_name).eq("exam_year", exam_year).limit(1).execute()
    if existing_q.data and not force_replace and not missing_reupload_mode:
        return JSONResponse(status_code=409, content={
            "error": "exam_exists",
            "message": f"'{exam_name} {exam_year}' already exists in the database.",
            "exam_name": exam_name,
            "exam_year": exam_year
        })

    # If force_replace is on, archive old questions for this exam+year
    if force_replace:
        print(f"  📦 Archiving old questions for {exam_name} {exam_year} (Force Replace)...")
        supabase.table("questions").update({"is_active": False}).eq("exam_name", exam_name).eq("exam_year", exam_year).execute()
        # Also clean up old jobs for this specific name/year to avoid UI confusion
        supabase.table("jobs").update({"status": "failed"}).eq("exam_name", exam_name).eq("exam_year", exam_year).execute()

    # Gap-repair uploads must bypass stale extraction caches; otherwise we can
    # silently replay the same bad 143-question result without touching the
    # broken pages again.
    clear_cache = bool(clear_cache or missing_reupload_mode)

    # If clear_cache is on, delete per-page / per-paper cache files for this PDF
    # so it re-extracts fresh across universal, CBT, and regex/vision flows.
    if clear_cache:
        from pathlib import Path as _Path
        cache_dir = _Path(__file__).parent / "cache"
        patterns = [
            f"univ_{file_hash[:16]}_p*.json",
            f"univ_v*_{file_hash[:16]}_p*.json",
            f"vision_{file_hash[:16]}_p*.json",
            f"cbt_v*_ans_{file_hash[:16]}_p*.json",
            f"tcsion_v*_{file_hash[:16]}_p*.json",
            f"aphc_v*_{file_hash[:16]}_p*.json",   # AP High Court per-page vision cache
            f"pages_v*_{file_hash}.json",
            f"vision_qs_{file_hash}.json",
            f"processed/{file_hash}.json",
        ]
        cleared = 0
        for pattern in patterns:
            for f in cache_dir.glob(pattern):
                f.unlink()
                cleared += 1
        print(f"  🗑️  Cleared {cleared} cache pages for PDF {file_hash[:16]}")

    # Persist upload to a durable app-managed path so retries and restarts can reopen it.
    # Use a per-upload key, not just the content hash, so separate jobs never
    # contend over the same on-disk artifact.
    storage_key = f"{file_hash}_{int(time.time() * 1000)}"
    tmp_path = _persist_uploaded_pdf(content, storage_key, file.filename)

    try:
        # Parse answer key synchronously if provided
        answer_key_map: dict | None = None
        if answer_key_file and answer_key_file.filename:
            ak_content = answer_key_file.file.read()
            if ak_content:
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as ak_tmp:
                    ak_tmp.write(ak_content)
                    ak_tmp_path = ak_tmp.name
                try:
                    from extractor.answer_key_parser import parse_answer_key
                    answer_key_map = parse_answer_key(ak_tmp_path, expected_count=expected_count)
                    print(f"[upload] Answer key parsed: {len(answer_key_map)} answers")
                except Exception as e:
                    print(f"[upload] Answer key parse failed: {e}")
                finally:
                    os.unlink(ak_tmp_path)

        # ── Smart Routing with explicit admin overrides ──
        from extractor.router import detect_format, ExamFormat
        detected_format = detect_format(tmp_path, source_filename=file.filename)
        route_format = detected_format
        if is_cbt:
            route_format = ExamFormat.TCSION_CBT
            print("  🧭 Admin override: forcing CBT pipeline")
        elif use_vision:
            route_format = ExamFormat.APPSC_BOXED
            print("  🧭 Admin override: forcing visual/final-key pipeline")

        print(f"  🧠 Smart Router detected format: {detected_format} | route={route_format}")

        if missing_reupload_mode:
            paper = ensure_paper_for_existing_exam(
                exam_name,
                exam_year,
                source_filename=file.filename,
                source_file_hash=file_hash,
                source_pdf_path=tmp_path,
                extractor_type=route_format,
                sb=supabase,
            )
            if not paper:
                raise HTTPException(500, "Could not find the existing paper to repair missing questions.")
        else:
            paper = ensure_paper_for_upload(
                exam_name,
                exam_year,
                source_filename=file.filename,
                source_file_hash=file_hash,
                source_pdf_path=tmp_path,
                extractor_type=route_format,
                supersede_latest=force_replace,
                sb=supabase,
            )

        # Create or reuse pending job in Supabase.
        # jobs.file_hash is unique, so reuploads of the same PDF must reuse the
        # existing row instead of trying to insert a second row with the same
        # hash.
        initial_status = "pending"
        initial_progress = 1 if missing_reupload_mode else 0
        initial_error_log = (
            f"Repair queued for target numbers: {existing_missing_numbers[:20]}"
            if missing_reupload_mode
            else "Upload queued"
        )
        job_payload = {
            "paper_id": paper["id"],
            "filename": file.filename,
            "file_hash": file_hash,
            "exam_name": exam_name,
            "exam_year": exam_year,
            "status": initial_status,
            "progress": initial_progress,
            "error_log": initial_error_log,
            "pdf_path": tmp_path,
        }
        existing_jobs = existing_job.data or []
        if existing_jobs:
            reusable_job = existing_jobs[0]
            job_id = reusable_job["id"]
            supabase.table("jobs").update(job_payload).eq("id", job_id).execute()
        else:
            job_res = supabase.table("jobs").insert(job_payload).execute()
            if not job_res.data:
                raise HTTPException(500, "Failed to create job in database")
            job_id = job_res.data[0]["id"]

        link_job_to_paper(paper["id"], job_id, sb=supabase)

        if missing_reupload_mode:
            if route_format in [ExamFormat.TCSION_CBT, ExamFormat.TELEGRAM_CBT]:
                from extractor.cbt_pipeline import process_cbt_missing_questions_job_background
                fn, fn_args = process_cbt_missing_questions_job_background, (job_id, tmp_path, exam_name, exam_year, existing_missing_numbers)
            else:
                from pipeline import process_missing_questions_job_background
                fn, fn_args = process_missing_questions_job_background, (job_id, tmp_path, exam_name, exam_year, existing_missing_numbers, answer_key_map)
        elif route_format in [ExamFormat.TCSION_CBT, ExamFormat.TELEGRAM_CBT]:
            from extractor.cbt_pipeline import process_cbt_job_background
            fn, fn_args = process_cbt_job_background, (job_id, tmp_path, exam_name, exam_year, shift_label_override or None, expected_count, force_replace)
        elif route_format == ExamFormat.APPSC_BOXED:
            from extractor.vision_extractor import process_vision_job_background
            fn, fn_args = process_vision_job_background, (job_id, tmp_path, exam_name, exam_year, series)
        else:
            from extractor.universal_extractor import process_universal_job_background
            fn, fn_args = process_universal_job_background, (
                job_id,
                tmp_path,
                exam_name,
                exam_year,
                answer_key_map,
                expected_count,
                force_replace,
            )

        for _attempt in range(3):
            try:
                future = _JOB_EXECUTOR.submit(fn, *fn_args)
                break
            except OSError as _oe:
                if _oe.errno == 35 and _attempt < 2:
                    import time as _t; _t.sleep(0.5)
                    continue
                raise
        # Capture locals for the closure — the answer key must be injected
        # after the job completes regardless of which pipeline ran. Previously
        # CBT and Vision pipelines never received answer_key_map, so any key
        # uploaded alongside them was silently dropped. This callback is the
        # single authoritative injection point for all pipeline types.
        _ak_map = answer_key_map
        _ak_exam = exam_name
        _ak_year = exam_year
        _ak_job = job_id
        _ak_paper_id = paper["id"]

        def _on_done(f):
            exc = f.exception()
            if exc:
                print(f"[job {_ak_job[:8]}] crashed: {exc}")
            elif _ak_map:
                try:
                    from pipeline import inject_answers as _inject
                    _inject(_ak_map, _ak_exam, _ak_year)
                    print(f"[job {_ak_job[:8]}] Post-job answer key injection complete")
                except Exception as _e:
                    print(f"[job {_ak_job[:8]}] Post-job inject_answers failed: {_e}")
            _invalidate_meta_cache()
            # Auto-tag pattern intelligence for all questions in this new paper.
            if not exc:
                def _auto_tag():
                    try:
                        from auto_tag_patterns import run as _tag_run
                        result = _tag_run(
                            exam_name=None, exam_year=None,
                            limit=500, force=False, dry_run=False, paper_id=_ak_paper_id,
                        )
                        print(f"[job {_ak_job[:8]}] Auto-tagged {result.get('tagged', 0)} pattern tags for paper {_ak_paper_id[:8]}")
                    except Exception as _e2:
                        print(f"[job {_ak_job[:8]}] Auto-tag patterns failed: {_e2}")
                threading.Thread(target=_auto_tag, daemon=True, name=f"auto-tag-{_ak_job[:8]}").start()

        future.add_done_callback(_on_done)
        print(f"[upload] Submitted job {job_id[:8]} to pool (active workers ≤4)")

        return {
            "status": "queued",
            "job_id": job_id,
            "message": (
                f"Gap repair queued for missing questions {existing_missing_numbers[:20]}"
                if missing_reupload_mode
                else "File uploaded successfully. Processing in background."
            ),
            "missing_reupload_mode": missing_reupload_mode,
            "target_missing_numbers": existing_missing_numbers[:50] if missing_reupload_mode else [],
            "clear_cache_applied": clear_cache,
            "route_format": str(route_format),
            "paper_id": paper["id"],
        }
    except Exception as e:
        import traceback as _tb
        print(f"[upload] ERROR queuing job: {e}")
        print(_tb.format_exc())
        if tmp_path.startswith(tempfile.gettempdir()) and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise HTTPException(500, "Error queuing job")


@app.post("/admin/upload-pattern-book", dependencies=[Depends(verify_admin)])
def admin_upload_pattern_book(
    file: UploadFile = File(...),
    exam_name: str = Form(...),
    exam_year: int = Form(...),
    series: str = Form(""),
    force_replace: bool = Form(False),
):
    """
    Admin uploads an SSC content / pattern-book PDF.
    This route extracts practice questions into pattern_books + pattern_questions
    instead of the public question-paper pipeline.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files accepted")
    _pb_magic = file.file.read(4)
    file.file.seek(0)
    if _pb_magic != b"%PDF":
        raise HTTPException(400, "Invalid PDF file")

    exam_name = normalize_exam_name(exam_name)
    chapter = normalize_exam_name(series) or exam_name
    book_title = (
        f"{exam_name} — {chapter} ({exam_year})"
        if chapter.lower() != exam_name.lower()
        else f"{exam_name} ({exam_year})"
    )
    exam_target = "SSC CGL" if "ssc" in exam_name.lower() else exam_name

    content = file.file.read()
    max_size = 100 * 1024 * 1024
    if len(content) > max_size:
        raise HTTPException(413, f"File too large ({len(content)//1024//1024} MB). Max allowed: 100 MB.")

    file_hash = hashlib.sha256(content).hexdigest()
    existing_job = supabase.table("jobs").select("id, status, exam_name, exam_year").eq("file_hash", file_hash).execute()
    if existing_job.data:
        active = next((job for job in existing_job.data if str(job.get("status") or "") in {"pending", "processing", "completed"}), None)
        if active and not force_replace:
            existing_exam = f"{active.get('exam_name', '')} {active.get('exam_year', '')}".strip()
            return JSONResponse(
                status_code=409,
                content={
                    "error": "duplicate_file",
                    "message": f"This PDF was already uploaded as '{existing_exam}'. Re-upload only if you intend to replace that SSC content import.",
                    "job_id": active["id"],
                    "existing_exam_name": active.get("exam_name", ""),
                    "existing_exam_year": active.get("exam_year", ""),
                },
            )
        for job in existing_job.data:
            try:
                supabase.table("jobs").update({
                    "status": "failed",
                    "error_log": "Superseded by a newer SSC content import for the same PDF/file hash.",
                }).eq("id", job["id"]).execute()
            except Exception:
                pass

    tmp_path = _persist_uploaded_pdf(content, f"{file_hash}_{int(time.time() * 1000)}", file.filename)

    try:
        job_payload = {
            "paper_id": None,
            "filename": file.filename,
            "file_hash": file_hash,
            "exam_name": book_title,
            "exam_year": exam_year,
            "status": "pending",
            "progress": 0,
            "error_log": "SSC content import queued",
            "pdf_path": tmp_path,
        }
        if existing_job.data:
            job_id = existing_job.data[0]["id"]
            supabase.table("jobs").update(job_payload).eq("id", job_id).execute()
        else:
            job_res = supabase.table("jobs").insert(job_payload).execute()
            if not job_res.data:
                raise HTTPException(500, "Failed to create pattern-book job in database")
            job_id = job_res.data[0]["id"]

        from extractor.pattern_book_pipeline import process_pattern_book_job_background

        future = _JOB_EXECUTOR.submit(
            process_pattern_book_job_background,
            job_id,
            tmp_path,
            book_title,
            exam_year,
            chapter,
            exam_target,
            file.filename,
        )

        def _on_done(f):
            if f.exception():
                print(f"[pattern-book {job_id[:8]}] crashed: {f.exception()}")
            _invalidate_meta_cache()

        future.add_done_callback(_on_done)
        print(f"[pattern-book] Submitted job {job_id[:8]} to pool")

        return {
            "status": "queued",
            "job_id": job_id,
            "message": "SSC content PDF uploaded successfully. Extracting questions for Pattern Practice in background.",
            "route_format": "pattern_book",
            "review_supported": False,
            "book_title": book_title,
            "chapter": chapter,
        }
    except Exception as e:
        import traceback as _tb
        print(f"[pattern-book] ERROR queuing job: {e}")
        print(_tb.format_exc())
        if tmp_path.startswith(tempfile.gettempdir()) and os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise HTTPException(500, "Error queuing SSC content job")

@app.post("/admin/inject-answers", dependencies=[Depends(verify_admin)])
def admin_inject_answers(
    exam_name: str = Form(...),
    exam_year: int = Form(...),
    answer_key_file: UploadFile = File(...),
    expected_count: int = Form(150),
):
    """
    Inject answers from a standalone answer key PDF into an already-uploaded exam.
    Useful when the question paper was uploaded earlier without an answer key.
    Matches by question_number within the given exam_name + exam_year.
    """
    if not answer_key_file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files accepted for answer key")

    ak_content = answer_key_file.file.read()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as ak_tmp:
        ak_tmp.write(ak_content)
        ak_tmp_path = ak_tmp.name

    try:
        from extractor.answer_key_parser import parse_answer_key
        from pipeline import inject_answers
        answer_map = parse_answer_key(ak_tmp_path, expected_count=expected_count)
        if not answer_map:
            raise HTTPException(422, "Could not extract any answers from the PDF. Check the format.")
        result = inject_answers(answer_map, exam_name.strip(), exam_year)
        _invalidate_meta_cache()
        return {
            "status": "ok",
            "answers_parsed": len(answer_map),
            "questions_updated": result["updated"],
            "exam": f"{exam_name} {exam_year}",
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Answer key injection failed: {e}")
        raise HTTPException(500, "Answer key injection failed")
    finally:
        os.unlink(ak_tmp_path)


@app.get("/admin/status", response_class=HTMLResponse, dependencies=[Depends(verify_admin)])
def admin_status_page():
    """Visual progress dashboard — open in browser, auto-refreshes every 5s."""
    try:
        r = supabase.table("jobs").select("*").order("created_at", desc=True).limit(20).execute()
        jobs = r.data or []
    except Exception as e:
        jobs = []

    rows = ""
    for job in jobs:
        prog = job.get("progress", 0)
        status = job.get("status", "unknown")
        color = {"completed": "#10b981", "processing": "#6366f1", "pending": "#f59e0b", "failed": "#ef4444"}.get(status, "#94a3b8")
        bar_color = color
        icon = {"completed": "✅", "processing": "⏳", "pending": "🕐", "failed": "❌"}.get(status, "•")
        error_row = f'<div style="color:#ef4444;font-size:12px;margin-top:4px;">⚠️ {job.get("error_log","")}</div>' if job.get("error_log") else ""
        rows += f"""
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div>
              <span style="font-weight:700;font-size:15px;">{icon} {job.get('filename','?')}</span>
              <span style="margin-left:12px;color:#64748b;font-size:13px;">{job.get('exam_name','')} · {job.get('exam_year','')}</span>
            </div>
            <span style="background:{color};color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;">{status.upper()}</span>
          </div>
          <div style="background:#f1f5f9;border-radius:99px;height:10px;overflow:hidden;">
            <div style="background:{bar_color};width:{prog}%;height:100%;border-radius:99px;transition:width 0.5s;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:12px;color:#94a3b8;">
            <span>Progress</span><span style="font-weight:700;color:{color};">{prog}%</span>
          </div>
          {error_row}
          <div style="font-size:11px;color:#cbd5e1;margin-top:6px;">ID: {job.get('id','')} · Updated: {job.get('updated_at','')[:19].replace('T',' ')}</div>
        </div>"""

    if not rows:
        rows = '<div style="text-align:center;color:#94a3b8;padding:40px;">No jobs yet. Upload a PDF from the docs page.</div>'

    html = f"""<!DOCTYPE html>
<html><head>
  <title>Upload Status</title>
  <meta http-equiv="refresh" content="5">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;margin:0;padding:24px;}}
  h1{{font-size:22px;font-weight:800;color:#0f172a;margin-bottom:4px;}}
  p{{color:#64748b;font-size:13px;margin-bottom:24px;}}</style>
</head><body>
  <h1>📄 PDF Upload Status</h1>
  <p>Auto-refreshes every 5 seconds · <a href="/docs" style="color:#6366f1;">Back to API Docs</a></p>
  {rows}
</body></html>"""
    return HTMLResponse(content=html)


@app.get("/admin/jobs", dependencies=[Depends(verify_admin)])
def admin_list_jobs(
    limit: int = Query(50, ge=1, le=100),
    include_quality: bool = Query(False, description="Attach a lightweight quality summary for completed jobs"),
):
    """List all upload jobs and their statuses."""
    try:
        r = supabase.table("jobs").select("*").order("created_at", desc=True).limit(limit).execute()
        jobs = r.data or []
        if include_quality:
            # Use the already-cached publish gate (one scan for ALL exams) instead of
            # calling _exam_quality_report() per job (which triggers 4 DB queries per exam).
            try:
                gate = _compute_publish_gate()
                gate_map = {(r["exam_name"], r["exam_year"]): r for r in gate.get("reports", [])}
            except Exception:
                gate_map = {}
            for job in jobs:
                if job.get("exam_name") and job.get("exam_year") and str(job.get("status")) in {"completed", "failed", "archived"}:
                    key = (str(job["exam_name"]), int(job["exam_year"]))
                    report = gate_map.get(key, {})
                    job["quality_report"] = {
                        "exam_name": job["exam_name"],
                        "exam_year": int(job["exam_year"]),
                        "publishable": bool(report.get("publishable")),
                        "question_count": report.get("question_count", 0),
                        "reasons": report.get("reasons", []),
                        "samples": report.get("samples", []),
                    }
        return {"jobs": jobs}
    except Exception as e:
        print(f"[ERROR] Database error: {e}")
        raise HTTPException(500, "Database error")

@app.get("/admin/jobs/{job_id}", dependencies=[Depends(verify_admin)])
def admin_get_job(
    job_id: str,
    include_quality: bool = Query(False, description="Attach the heavy exam quality report for completed jobs"),
):
    """Poll a specific job's real-time progress."""
    try:
        import time as _time
        rows = None
        for _attempt in range(3):
            try:
                rows = supabase.table("jobs").select("*").eq("id", job_id).limit(1).execute().data or []
                break
            except Exception:
                if _attempt == 2:
                    raise
                _time.sleep(0.5)
        if not rows:
            raise HTTPException(404, "Job not found")
        job = rows[0]
        # Keep live polling lightweight. Computing a full quality report on every
        # 1-second poll makes uploads appear stuck because the poll endpoint does
        # heavy exam-wide analysis while the worker is trying to progress.
        if (
            include_quality
            and
            job.get("exam_name")
            and job.get("exam_year")
            and str(job.get("status")) in {"completed", "failed", "archived"}
        ):
            try:
                job["quality_report"] = _exam_quality_report(job["exam_name"], int(job["exam_year"]))
            except Exception:
                job["quality_report"] = None
        return job
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Database error: {e}")
        raise HTTPException(500, "Database error")


@app.get("/admin/exam-quality", dependencies=[Depends(verify_admin)])
def admin_exam_quality(
    exam_name: str = Query(..., description="Exact exam name as stored in DB"),
    exam_year: int = Query(..., description="Exam year"),
):
    """Detailed quality report for a single exam upload."""
    try:
        return _exam_quality_report(exam_name, exam_year)
    except Exception as e:
        print(f"[ERROR] Quality report error: {e}")
        raise HTTPException(500, "Quality report error")


@app.get("/admin/publish-readiness", dependencies=[Depends(verify_admin)])
def admin_publish_readiness():
    """Exam-level publish gate report for admin review."""
    try:
        gate = _compute_publish_gate()
        reports = []
        publishable_with_hidden_rows = 0
        for report in gate["reports"]:
            exam_name = report["exam_name"]
            exam_year = report["exam_year"]
            rows = _question_rows_for_exam(exam_name, exam_year)
            contradiction_by_qid = _contradiction_map(exam_name, exam_year)
            queue = _build_exam_repair_queue(exam_name, exam_year, rows, contradiction_by_qid=contradiction_by_qid)
            assessment = _paper_publish_assessment(rows, queue)
            canonical_count = _canonical_student_question_count(exam_name, exam_year)
            enriched = dict(report)
            enriched.update({
                "question_count": canonical_count or int(report.get("question_count") or 0),
                "raw_question_count": int(report.get("question_count") or 0),
                "canonical_student_question_count": canonical_count,
                "likely_publishable_with_hidden_rows": assessment["likely_publishable_with_hidden_rows"],
                "reupload_needed": assessment["reupload_needed"],
                "visible_question_count": assessment["visible_question_count"],
                "hidden_question_count": assessment["hidden_question_count"],
                "paper_blocker_count": assessment["paper_blocker_count"],
                "row_blocker_count": assessment["row_blocker_count"],
            })
            reports.append(enriched)
            if assessment["likely_publishable_with_hidden_rows"]:
                publishable_with_hidden_rows += 1
        return {
            "computed_at": gate["computed_at"],
            "publishable_exams": sum(1 for r in reports if r["publishable"]),
            "blocked_exams": sum(1 for r in reports if not r["publishable"]),
            "likely_publishable_with_hidden_rows": publishable_with_hidden_rows,
            "reupload_needed_exams": sum(1 for r in reports if r.get("reupload_needed")),
            "reports": reports,
        }
    except Exception as e:
        print(f"[ERROR] Publish readiness error: {e}")
        raise HTTPException(500, "Publish readiness error")


@app.get("/admin/repair-queue", dependencies=[Depends(verify_admin)])
async def admin_repair_queue(
    exam_name: Optional[str] = Query(None),
    exam_year: Optional[int] = Query(None),
):
    """Structured per-row repair queue with hide/block guidance."""
    try:
        if exam_name:
            exam_name = _resolve_admin_exam_name(exam_name, int(exam_year or 0)) if exam_year is not None else normalize_exam_name(exam_name)
        exam_scoped = bool(exam_name and exam_year is not None)
        if exam_scoped:
            exams = [(exam_name, exam_year)]
        else:
            gate = _compute_publish_gate()
            exams = [(r["exam_name"], r["exam_year"]) for r in gate["reports"]]

        items: list[dict] = []
        exam_reports: list[dict] = []
        for current_exam_name, current_exam_year in exams:
            active_rows = _question_rows_for_exam(
                current_exam_name,
                current_exam_year,
                is_active=True,
                latest_only=exam_scoped,
            )
            audit_rows = _question_rows_for_exam(
                current_exam_name,
                current_exam_year,
                is_active=None,
                latest_only=exam_scoped,
            )
            if not active_rows and not audit_rows:
                continue
            # Content Audit for a specific paper should open quickly. Full
            # contradiction scanning pulls explanations and is comparatively
            # expensive; keep it for global audits, but skip it on single-paper
            # admin views where structural/manual repair is the primary goal.
            contradiction_by_qid = {} if exam_scoped else _contradiction_map(current_exam_name, current_exam_year)
            queue = _build_exam_repair_queue(
                current_exam_name,
                current_exam_year,
                audit_rows,
                contradiction_by_qid=contradiction_by_qid,
            )
            assessment = _paper_publish_assessment(active_rows, queue)
            explanation_summary = _explanation_coverage_summary(active_rows)
            verified_answer_count = sum(1 for row in active_rows if not bool(row.get("needs_review")))
            items.extend(queue)
            exam_reports.append({
                "exam": f"{current_exam_name} {current_exam_year}",
                "exam_name": current_exam_name,
                "exam_year": current_exam_year,
                "verified_answer_count": verified_answer_count,
                "explanations": explanation_summary,
                **assessment,
            })

        items.sort(
            key=lambda item: (
                item["exam_year"],
                item["exam_name"],
                _QUEUE_ISSUE_ORDER.get(item["issue_type"], 99),
                item["question_number"] is None,
                item["question_number"] if isinstance(item["question_number"], int) else 10**9,
            )
        )
        return {
            "total": len(items),
            "items": items,
            "papers": exam_reports,
        }
    except Exception as e:
        print(f"[ERROR] Repair queue error: {e}")
        raise HTTPException(500, "Repair queue error")


@app.post("/admin/retry-job/{job_id}", dependencies=[Depends(verify_admin)])
def admin_retry_job(job_id: str):
    """
    Retry a stuck or failed universal-mode job without re-uploading the PDF.
    Requires the original tmp PDF file to still exist on disk (it persists until server restart).
    """
    try:
        r = supabase.table("jobs").select("*").eq("id", job_id).single().execute()
        if not r.data:
            raise HTTPException(404, "Job not found")
        job = r.data
        status = str(job.get("status") or "").strip().lower()
        if status == "completed":
            raise HTTPException(400, "Job already completed successfully")
        if status.startswith("processing") or status in {"pending", "queued", "retrying"}:
            raise HTTPException(
                409,
                "Job is still running. Retry is disabled for active jobs to prevent mixed pipeline corruption."
            )
        if status not in {"failed", "cancelled", "stopped"}:
            raise HTTPException(400, f"Retry not allowed for job status '{job.get('status')}'")
        pdf_path = _resolve_job_pdf_path(job)
        if not pdf_path or not os.path.exists(pdf_path):
            raise HTTPException(
                400,
                "Original PDF no longer on disk (server was restarted). "
                "Please re-upload the file — all pages already cached will be free."
            )
        # Reset job state
        supabase.table("jobs").update({
            "status": "pending", "progress": 0, "error_log": None
        }).eq("id", job_id).execute()
        mark_paper_lifecycle(job.get("paper_id"), "processing", last_job_id=job_id, sb=supabase)

        exam_name  = job["exam_name"]
        exam_year  = job["exam_year"]
        from extractor.router import detect_format, ExamFormat
        detected = detect_format(pdf_path, source_filename=job.get("filename"))
        if detected in (ExamFormat.TCSION_CBT, ExamFormat.TELEGRAM_CBT):
            from extractor.cbt_pipeline import process_cbt_job_background
            fn, fn_args = process_cbt_job_background, (job_id, pdf_path, exam_name, exam_year, None, 0)
        elif detected == ExamFormat.APPSC_BOXED:
            from extractor.vision_extractor import process_vision_job_background
            fn, fn_args = process_vision_job_background, (job_id, pdf_path, exam_name, exam_year, "")
        else:
            from extractor.universal_extractor import process_universal_job_background
            fn, fn_args = process_universal_job_background, (job_id, pdf_path, exam_name, exam_year, None, 0, False)
        future = _JOB_EXECUTOR.submit(fn, *fn_args)
        def _on_done(f):
            if f.exception():
                print(f"[retry {job_id[:8]}] crashed: {f.exception()}")
            _invalidate_meta_cache()
            
        future.add_done_callback(_on_done)
        return {"job_id": job_id, "status": "retrying", "message": "Job restarted — cached pages are free"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Retry failed: {e}")
        raise HTTPException(500, "Retry failed")


@app.post("/admin/practice-ready/rebuild", dependencies=[Depends(verify_admin)])
def admin_rebuild_practice_ready(
    exam_name: Optional[str] = Query(None),
    exam_year: Optional[int] = Query(None),
):
    """Rebuild the canonical practice-ready question set."""
    try:
        if bool(exam_name) != bool(exam_year is not None):
            raise HTTPException(400, "Provide both exam_name and exam_year, or neither.")
        if exam_name and exam_year is not None:
            result = recompute_practice_ready_for_exam(exam_name, exam_year, sb=supabase)
        else:
            result = recompute_practice_ready_for_all(sb=supabase)
        _invalidate_meta_cache()
        return {"status": "ok", **result}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Practice-ready rebuild failed: {e}")
        raise HTTPException(500, "Practice-ready rebuild failed")


@app.post("/admin/catalog/freeze-current", dependencies=[Depends(verify_admin)])
def admin_freeze_current_catalog(label: Optional[str] = Query(None)):
    """Freeze the current deduped Admin ON dataset as the public practice-ready set and save a snapshot."""
    try:
        result = freeze_current_admin_catalog(snapshot_label=label)
        _invalidate_meta_cache()
        return {"status": "ok", **result}
    except Exception as e:
        print(f"[ERROR] Catalog freeze failed: {e}")
        raise HTTPException(500, "Catalog freeze failed")


@app.post("/admin/jobs/{job_id}/reset", dependencies=[Depends(verify_admin)])
def admin_reset_job(job_id: str):
    """Force-reset a stuck/stale job to 'failed' so it can be re-uploaded."""
    r = supabase.table("jobs").select("id,status,progress").eq("id", job_id).single().execute()
    if not r.data:
        raise HTTPException(404, "Job not found")
    supabase.table("jobs").update({
        "status": "failed",
        "error_log": "Manually reset — please re-upload the PDF.",
    }).eq("id", job_id).execute()
    return {"job_id": job_id, "previous_status": r.data["status"], "reset_to": "failed"}


PATTERN_TAG_VALUES = [
    "statement-based", "assertion-reason", "chronology", "match-the-following",
    "factual-recall", "concept-application", "elimination", "article-provision",
    "committee-mapping", "statement-elimination", "grammar-error-detection",
    "fill-in-the-blank", "para-jumble", "coding-decoding", "ranking-order",
    "gcd-lcm-calculation", "arithmetic-calculation", "data-interpretation",
    "map-location", "date-event-recall", "scheme-current-affairs",
    "vocabulary-usage",
]
TRAP_TAG_VALUES = [
    "absolute-wording", "negation", "except-not", "all-of-above", "double-negation",
    "partial-truth", "close-dates", "similar-names", "formula-confusion",
    "code-pair-confusion", "tense-agreement", "sequence-confusion",
    "unit-conversion", "option-pairing",
]
SKILL_TAG_VALUES = [
    "elimination", "recall", "inference", "application", "analysis",
    "sequencing", "calculation", "language-usage", "pattern-recognition", "mapping",
]
QUESTION_STYLE_VALUES = [
    "direct", "indirect", "analytical", "comparative", "definitional",
    "language", "quantitative", "reasoning",
]


class QuestionUpdate(BaseModel):
    is_active: Optional[bool] = None
    needs_review: Optional[bool] = None
    question_text: Optional[str] = None
    option_a: Optional[str] = None
    option_b: Optional[str] = None
    option_c: Optional[str] = None
    option_d: Optional[str] = None
    subject: Optional[str] = None
    topic: Optional[str] = None
    subtopic: Optional[str] = None
    difficulty: Optional[str] = None
    correct_answer: Optional[str] = Field(None, pattern="^[A-D]$")
    correct_answers: Optional[list[str]] = None
    answer_status: Optional[str] = None
    has_image: Optional[bool] = None
    image_url: Optional[str] = None
    pattern_tag: Optional[str] = None
    trap_tag: Optional[str] = None
    skill_tag: Optional[str] = None
    question_style: Optional[str] = None
    pattern_confidence: Optional[int] = None
    pattern_reason: Optional[str] = None
    solve_hint: Optional[str] = None


@app.patch("/admin/questions/{question_id}", dependencies=[Depends(verify_admin)])
def admin_update_question(question_id: str, update: QuestionUpdate, background_tasks: BackgroundTasks):
    """Admin direct edit — update only the fields provided, return immediately."""
    data = update.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(400, "No fields to update")
    data["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Derive canonical taxonomy fields from whatever subject/topic/subtopic was sent
    if {"subject", "topic", "subtopic"} & set(data.keys()):
        try:
            supported_cols = _question_supported_columns()
            canonical = derive_canonical_taxonomy(
                data.get("subject", ""),
                data.get("topic", ""),
                data.get("subtopic", ""),
            )
            for key, value in canonical.items():
                if key in supported_cols:
                    data[key] = value
        except Exception:
            pass

    try:
        supabase.table("questions").update(data).eq("id", question_id).execute()
    except Exception as e:
        print(f"[ERROR] DB update failed: {e}")
        raise HTTPException(500, "DB update failed")

    # Manual edits can fix a row enough to make it publicly visible again.
    # Recompute quality fields so `public_visibility` tracks the repaired state.
    try:
        current_res = supabase.table("questions").select("*").eq("id", question_id).limit(1).execute()
        current_rows = current_res.data or []
        if current_rows:
            current_q = current_rows[0]
            explanation_present = False
            try:
                exp_res = supabase.table("explanations").select("id").eq("question_id", question_id).limit(1).execute()
                explanation_present = bool(exp_res.data)
            except Exception:
                explanation_present = False

            quality_merged = merge_quality_fields(
                current_q,
                explanation_present=explanation_present,
                explanation_contradiction=False,
            )
            # If an admin has manually saved a complete row and explicitly cleared
            # review, trust that approval over brittle shape heuristics (for
            # example match-the-following rows without synthetic __MATCH__ payloads).
            explicit_answer_status = str(current_q.get("answer_status") or "").strip().lower()
            has_manual_answer_state = (
                str(current_q.get("correct_answer") or "").strip().upper() in {"A", "B", "C", "D"}
                or explicit_answer_status == "deleted"
                or (
                    explicit_answer_status == "multiple"
                    and len(current_q.get("correct_answers") or []) >= 2
                )
            )
            manual_publish_ready = (
                current_q.get("is_active") is True
                and current_q.get("needs_review") is not True
                and len(str(current_q.get("question_text") or "").strip()) >= 15
                and all(len(str(current_q.get(k) or "").strip()) > 0 for k in ("option_a", "option_b", "option_c", "option_d"))
                and has_manual_answer_state
            )
            if manual_publish_ready:
                answer_status = quality_merged.get("answer_status")
                if explicit_answer_status in {"deleted", "multiple"}:
                    answer_status = explicit_answer_status
                quality_merged.update({
                    "structural_status": "valid",
                    "answer_status": answer_status or "verified",
                    "review_required": False,
                    "public_visibility": "visible",
                })
            quality_patch = _filter_question_write_payload({
                "structural_status": quality_merged.get("structural_status"),
                "answer_status": quality_merged.get("answer_status"),
                "explanation_status": quality_merged.get("explanation_status"),
                "tagging_status": quality_merged.get("tagging_status"),
                "review_required": quality_merged.get("review_required"),
                "confidence_score": quality_merged.get("confidence_score"),
                "public_visibility": quality_merged.get("public_visibility"),
                "primary_issue_code": quality_merged.get("primary_issue_code"),
                "issue_codes": quality_merged.get("issue_codes"),
            })
            if quality_patch:
                supabase.table("questions").update(quality_patch).eq("id", question_id).execute()
    except Exception:
        pass

    # If the correct answer changed, the existing explanation is now wrong — delete it
    # so it regenerates fresh on the next user access.
    if {"correct_answer", "correct_answers", "answer_status"} & set(data.keys()):
        try:
            supabase.table("explanations").delete().eq("question_id", question_id).execute()
        except Exception:
            pass

    _invalidate_meta_cache()
    background_tasks.add_task(_bg_sync_question_paper, question_id)
    return {"status": "updated", "question_id": question_id, "updated_fields": list(data.keys())}


def _bg_sync_question_paper(question_id: str) -> None:
    try:
        res = supabase.table("questions").select("paper_id, exam_name, exam_year").eq("id", question_id).limit(1).execute()
        current = (res.data or [{}])[0]
        paper_id = current.get("paper_id")
        if paper_id:
            sync_paper_question_counts(paper_id, sb=supabase)
        elif current.get("exam_name") and current.get("exam_year"):
            recompute_practice_ready_for_exam(
                str(current.get("exam_name") or ""),
                int(current.get("exam_year") or 0),
                sb=supabase,
            )
    except Exception:
        pass


class ImageUpload(BaseModel):
    base64_image: str

@app.post("/admin/questions/{question_id}/image", dependencies=[Depends(verify_admin)])
def admin_upload_question_image(question_id: str, payload: ImageUpload):
    """Admin endpoint to crop and upload an image for a question."""
    import base64
    import uuid
    import time as _time

    print(f"[admin-image] upload request for question {question_id}")

    if not payload.base64_image:
        raise HTTPException(400, "base64_image is required")

    header, encoded = payload.base64_image.split(",", 1) if "," in payload.base64_image else ("", payload.base64_image)
    try:
        image_data = base64.b64decode(encoded)
    except Exception:
        raise HTTPException(400, "Invalid base64 image data")

    file_ext = "jpeg" if ("jpeg" in header or "jpg" in header) else "png"
    file_name = f"admin_crops/{question_id}_{uuid.uuid4().hex[:8]}.{file_ext}"
    print(f"[admin-image] uploading {len(image_data)} bytes as {file_name}")

    last_err: Exception | None = None
    for attempt in range(3):
        try:
            supabase.storage.from_("question-images").upload(
                path=file_name,
                file=image_data,
                file_options={"content-type": f"image/{file_ext}", "upsert": "true"},
            )
            break
        except Exception as e:
            last_err = e
            print(f"[admin-image] storage upload attempt {attempt+1} failed: {e}")
            if attempt < 2:
                _time.sleep(1.5 ** attempt)
    else:
        raise HTTPException(500, f"Storage upload failed after 3 attempts: {last_err}")

    image_url = supabase.storage.from_("question-images").get_public_url(file_name)
    print(f"[admin-image] uploaded → {image_url}")

    for attempt in range(3):
        try:
            supabase.table("questions").update({
                "has_image": True,
                "image_url": image_url,
            }).eq("id", question_id).execute()
            break
        except Exception as e:
            last_err = e
            print(f"[admin-image] db update attempt {attempt+1} failed: {e}")
            if attempt < 2:
                _time.sleep(1.5 ** attempt)
    else:
        raise HTTPException(500, f"DB update failed after 3 attempts: {last_err}")

    print(f"[admin-image] done for {question_id}")
    return {"status": "success", "image_url": image_url}


@app.delete("/admin/questions/{question_id}", dependencies=[Depends(verify_admin)])
async def admin_delete_question(question_id: str):
    """Hard delete a question (prefer PATCH is_active=false instead)."""
    try:
        current_res = supabase.table("questions").select("paper_id, exam_name, exam_year").eq("id", question_id).single().execute()
        current = current_res.data or {}
        r = supabase.table("questions").delete().eq("id", question_id).execute()
        if current.get("paper_id"):
            sync_paper_question_counts(current.get("paper_id"), sb=supabase)
        elif current.get("exam_name") and current.get("exam_year"):
            recompute_practice_ready_for_exam(
                str(current.get("exam_name") or ""),
                int(current.get("exam_year") or 0),
                sb=supabase,
            )
        _invalidate_meta_cache()
        return {"status": "deleted", "question_id": question_id}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Delete error: {e}")
        raise HTTPException(500, "Delete error")


@app.patch("/admin/rename-exam", dependencies=[Depends(verify_admin)])
def admin_rename_exam(
    old_name: str = Query(..., description="Current exam_name"),
    new_name: str = Query(..., description="New exam_name"),
    exam_year: int = Query(..., description="Exam year"),
):
    """Rename an exam — updates exam_name on all matching questions."""
    new_name = new_name.strip()
    if not new_name:
        raise HTTPException(400, "new_name cannot be empty")
    try:
        resolved_old_name = _resolve_admin_exam_name(old_name, exam_year)
        r = (
            supabase.table("questions")
            .update({"exam_name": new_name})
            .eq("exam_name", resolved_old_name)
            .eq("exam_year", exam_year)
            .execute()
        )
        supabase.table("papers").update({
            "exam_name": new_name,
            "display_name": new_name,
            "paper_key": f"{new_name.lower()}::{exam_year}",
        }).eq("exam_name", resolved_old_name).eq("exam_year", exam_year).execute()
        _invalidate_meta_cache()
        return {
            "status": "renamed",
            "updated": len(r.data or []),
            "old_name": resolved_old_name,
            "new_name": new_name,
        }
    except Exception as e:
        print(f"[ERROR] Rename error: {e}")
        raise HTTPException(500, "Rename error")


@app.post("/admin/publish-paper", dependencies=[Depends(verify_admin)])
def admin_publish_paper(
    exam_name: str = Query(..., description="Exact exam name as stored in DB"),
    exam_year: int = Query(..., description="Exam year"),
):
    """Explicit admin publish action for the latest paper in an exam/year bucket."""
    try:
        target_exam_name = _resolve_admin_exam_name(exam_name, exam_year)
        paper_id = resolve_paper_id(exam_name=target_exam_name, exam_year=exam_year, sb=supabase)
        if not paper_id:
            raise HTTPException(404, "Could not find a paper for this exam.")

        sync_paper_question_counts(paper_id, sb=supabase)

        active_rows = _question_rows_for_exam(
            target_exam_name,
            exam_year,
            is_active=True,
            latest_only=True,
        )
        audit_rows = _question_rows_for_exam(
            target_exam_name,
            exam_year,
            is_active=None,
            latest_only=True,
        )
        queue = _build_exam_repair_queue(
            target_exam_name,
            exam_year,
            audit_rows,
            contradiction_by_qid={},
        )
        assessment = _paper_publish_assessment(active_rows, queue)
        recomputed_publish_status = "blocked"
        if assessment["reupload_needed"]:
            recomputed_publish_status = "reupload_needed"
        elif assessment["publishable"] and assessment["hidden_question_count"] > 0:
            recomputed_publish_status = "publishable_with_hidden_rows"
        elif assessment["publishable"]:
            recomputed_publish_status = "publishable"

        try:
            supabase.table("papers").update({
                "question_count": len(audit_rows),
                "visible_question_count": assessment["visible_question_count"],
                "hidden_question_count": assessment["hidden_question_count"],
                "publish_status": recomputed_publish_status,
                "lifecycle_status": "ingested" if audit_rows else "processing",
            }).eq("id", paper_id).execute()
        except Exception:
            pass

        paper_res = (
            supabase.table("papers")
            .select(
                "id, exam_name, exam_year, publish_status, lifecycle_status, "
                "visible_question_count, hidden_question_count, question_count"
            )
            .eq("id", paper_id)
            .limit(1)
            .execute()
        )
        rows = paper_res.data or []
        if not rows:
            raise HTTPException(404, "Paper not found after publish refresh.")

        paper = rows[0]
        publish_status = recomputed_publish_status or str(paper.get("publish_status") or "")
        paper["publish_status"] = publish_status
        paper["visible_question_count"] = assessment["visible_question_count"]
        paper["hidden_question_count"] = assessment["hidden_question_count"]
        paper["question_count"] = len(audit_rows)
        lifecycle_status = str(paper.get("lifecycle_status") or "")

        if publish_status not in {"publishable", "publishable_with_hidden_rows"}:
            raise HTTPException(
                409,
                f"Paper is not ready for public publish yet (status: {publish_status or 'unknown'}).",
            )

        if lifecycle_status != "ingested":
            mark_paper_lifecycle(paper_id, "ingested", publish_status=publish_status, sb=supabase)
            paper["lifecycle_status"] = "ingested"

        explanation_summary = _explanation_coverage_summary(
            _question_rows_for_exam(target_exam_name, exam_year, is_active=True, latest_only=True)
        )

        _invalidate_meta_cache()
        return {
            "status": "published",
            "paper": paper,
            "explanations": explanation_summary,
            "message": (
                "Paper published to the learner app."
                if publish_status == "publishable"
                else "Paper published to the learner app with some rows still hidden."
            ),
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Publish error: {e}")
        raise HTTPException(500, "Publish error")


@app.post("/admin/add-blank-question", dependencies=[Depends(verify_admin)])
async def admin_add_blank_question(req: dict):
    """Add a blank question for manual correction of missing numbers."""
    try:
        supported_cols = _question_supported_columns()
        target_paper_id = resolve_paper_id(exam_name=req.get("exam_name", ""), exam_year=req.get("exam_year", 2024), sb=supabase)
        new_q = {
            "exam_name": req.get("exam_name", ""),
            "exam_year": req.get("exam_year", 2024),
            "paper_id": target_paper_id,
            "question_number": req.get("question_number", 1),
            "question_text": req.get("question_text") or "New Blank Question",
            "option_a": req.get("option_a") or "Option A",
            "option_b": req.get("option_b") or "Option B",
            "option_c": req.get("option_c") or "Option C",
            "option_d": req.get("option_d") or "Option D",
            "correct_answer": req.get("correct_answer") or "A",
            "subject": req.get("subject") or "General Knowledge",
            "topic": req.get("topic") or "General",
            "subtopic": req.get("subtopic") or "",
            "difficulty": req.get("difficulty") or "Medium",
            "question_type": req.get("question_type") or "mcq",
            "concept": req.get("concept") or "",
            "passage": req.get("passage") or "",
            "is_active": True,
            "needs_review": bool(req.get("needs_review", True)),
            "question_hash": f"manual_{int(time.time())}_{req.get('question_number', 1)}"
        }
        merged = merge_quality_fields(new_q, explanation_present=False)
        new_q.update(_filter_question_write_payload(merged, supported_cols))
        new_q = _filter_question_write_payload(new_q, supported_cols)
        r = supabase.table("questions").insert([new_q]).execute()
        sync_paper_question_counts(target_paper_id, sb=supabase)
        _invalidate_meta_cache()
        return {"status": "success", "data": r.data}
    except Exception as e:
        print(f"[ERROR] Error adding question: {e}")
        raise HTTPException(500, "Error adding question")

@app.delete("/admin/delete-exam", dependencies=[Depends(verify_admin)])
def admin_delete_exam(
    exam_name: str = Query(...),
    exam_year: int = Query(...),
):
    """Delete all questions for an exam (use with care)."""
    try:
        pr = supabase.table("papers").select("id").eq("exam_name", exam_name).eq("exam_year", exam_year).execute()
        paper_ids = [row["id"] for row in (pr.data or [])]
        r = supabase.table("questions").delete().eq("exam_name", exam_name).eq("exam_year", exam_year).execute()
        for pid in paper_ids:
            refresh_paper_publish_state(pid, sb=supabase)
        _invalidate_meta_cache()
        return {"status": "deleted", "removed": len(r.data or []), "exam_name": exam_name}
    except Exception as e:
        print(f"[ERROR] Delete error: {e}")
        raise HTTPException(500, "Delete error")


@app.post("/admin/retag", dependencies=[Depends(verify_admin)])
def admin_retag(
    exam_name: str = Query(..., description="Exact exam name as stored in DB"),
    exam_year: int = Query(..., description="Exam year"),
):
    """
    Re-run subject/topic/difficulty tagging for all questions in an exam.
    Use when questions show as 'Unclassified' after upload.
    Cost: ~₹0.20 per 150 questions (cached after first run, so repeat calls are free).
    """
    try:
        from pipeline import retag_exam
        result = retag_exam(exam_name, exam_year)
        return result
    except Exception as e:
        print(f"[ERROR] Retag error: {e}")
        raise HTTPException(500, "Retag error")


@app.post("/admin/retag-all", dependencies=[Depends(verify_admin)])
def admin_retag_all():
    """
    Re-tag every active exam+year in the DB with the v7 canonical topic taxonomy.
    First run costs AI tokens; subsequent runs hit the tag cache (free).
    Run this after normalize-taxonomy to fix topic fragmentation.
    """
    try:
        from pipeline import retag_all_exams
        result = retag_all_exams()
        return result
    except Exception as e:
        print(f"[ERROR] Retag-all error: {e}")
        raise HTTPException(500, "Retag-all error")


@app.post("/admin/normalize-taxonomy", dependencies=[Depends(verify_admin)])
def admin_normalize_taxonomy():
    """
    One-shot migration: renames legacy subject values across the entire DB to match
    the v7 canonical taxonomy (e.g. 'General Science' → 'Science & Technology',
    'Environment' → 'Environment & Ecology', 'Mental Ability' → 'Logical Reasoning').
    Safe to run multiple times.
    """
    try:
        from pipeline import normalize_subject_taxonomy
        result = normalize_subject_taxonomy()
        return result
    except Exception as e:
        print(f"[ERROR] Taxonomy normalization error: {e}")
        raise HTTPException(500, "Taxonomy normalization error")


@app.post("/admin/generate-explanations", dependencies=[Depends(verify_admin)])
def admin_generate_explanations(
    exam_name: str = Query(..., description="Exact exam name as stored in DB"),
    exam_year: int = Query(..., description="Exam year"),
):
    """
    Bulk-generate explanations for all questions in an exam that don't have one yet.
    Only generates for questions that have a correct_answer set.
    Cost: ~₹0.22 per 150 questions (cached after first run — repeat calls are free).
    """
    try:
        from pipeline import generate_explanations_bulk
        target_exam_name = _resolve_admin_exam_name(exam_name, exam_year)
        result = generate_explanations_bulk(target_exam_name, exam_year)
        coverage = _explanation_coverage_summary(
            _question_rows_for_exam(target_exam_name, exam_year, is_active=True, latest_only=True)
        )
        _invalidate_meta_cache()
        return {
            **result,
            "coverage": coverage,
            "message": (
                f"Generated {result.get('generated', 0)} explanation(s). "
                f"{coverage['eligible_generated']}/{coverage['eligible_total']} verified questions now have explanations."
            ),
        }
    except Exception as e:
        print(f"[ERROR] Explanation generation error: {e}")
        raise HTTPException(500, "Explanation generation error")


@app.post("/admin/validate-answers", dependencies=[Depends(verify_admin)])
def admin_validate_answers(
    exam_name: str = Query(..., description="Exact exam name as stored in DB"),
    exam_year: int = Query(..., description="Exam year"),
):
    """
    Use gemini-2.5-flash (best model) to determine correct answers for all questions
    with needs_review=True (AI-guessed or missing answers). Verified answer-key answers
    (needs_review=False) are never touched.
    Cost: ~₹2–5 per 125 questions — runs on GCP Vertex AI credits.
    """
    try:
        from pipeline import validate_answers_bulk
        result = validate_answers_bulk(exam_name, exam_year)
        _invalidate_meta_cache()
        return result
    except Exception as e:
        print(f"[ERROR] Answer validation error: {e}")
        raise HTTPException(500, "Answer validation error")


@app.post("/admin/fix-explanation-mismatches", dependencies=[Depends(verify_admin)])
def admin_fix_explanation_mismatches(
    exam_name: Optional[str] = Query(None, description="Filter by exam name (omit for all exams)"),
    dry_run: bool = Query(False, description="If true, only count affected — do not delete"),
):
    """
    Delete cached explanations for questions where correct_answer was overridden
    by AI during bulk explanation generation (needs_review=true + has explanation).
    After deletion, explanations regenerate lazily using the verified correct answer.
    """
    try:
        q = supabase.table("questions").select("id, correct_answer, exam_name").eq("needs_review", True)
        if exam_name:
            q = q.eq("exam_name", exam_name)
        qr = q.execute()
        flagged_ids = [row["id"] for row in (qr.data or [])]

        if not flagged_ids:
            return {"deleted": 0, "dry_run": dry_run, "message": "No needs_review questions found"}

        # Find which of those have cached explanations
        expl_r = supabase.table("explanations").select("question_id").in_("question_id", flagged_ids).execute()
        to_delete = [row["question_id"] for row in (expl_r.data or [])]

        if dry_run:
            return {
                "dry_run": True,
                "needs_review_questions": len(flagged_ids),
                "explanations_to_delete": len(to_delete),
                "message": "Run with dry_run=false to actually delete",
            }

        # Delete in chunks of 50 (Supabase IN filter limit)
        deleted = 0
        for i in range(0, len(to_delete), 50):
            chunk = to_delete[i:i+50]
            supabase.table("explanations").delete().in_("question_id", chunk).execute()
            supabase.table("questions").update({"explanation_status": "missing"}).in_("id", chunk).execute()
            deleted += len(chunk)

        _invalidate_meta_cache()
        return {
            "deleted": deleted,
            "dry_run": False,
            "message": f"Deleted {deleted} stale explanations. They will regenerate correctly on next user access.",
        }
    except Exception as e:
        print(f"[ERROR] Error: {e}")
        raise HTTPException(500, "Error")


def _is_cbt_answer_verification_candidate(row: dict, paper_by_id: dict[str, dict]) -> bool:
    if row.get("needs_review") is not True:
        return False
    answer = str(row.get("correct_answer") or "").strip().upper()
    if answer not in {"A", "B", "C", "D"}:
        return False

    paper = paper_by_id.get(str(row.get("paper_id") or ""))
    extractor_type = str((paper or {}).get("extractor_type") or "").strip().lower()
    shift_label = str(row.get("shift_label") or "").strip()
    exam_name = str(row.get("exam_name") or "").strip().lower()

    return (
        extractor_type == "cbt"
        or bool(shift_label)
        or "cbt" in exam_name
        or " shift " in f" {exam_name} "
    )


def _collect_cbt_answer_verification_candidates(
    *,
    exam_name: Optional[str] = None,
    exam_year: Optional[int] = None,
) -> tuple[list[dict], dict[str, dict]]:
    rows: list[dict] = []
    offset = 0
    while True:
        query = (
            supabase.table("questions")
            .select(
                "id, paper_id, exam_name, exam_year, shift_label, needs_review, "
                "correct_answer, question_text, option_a, option_b, option_c, option_d, "
                "question_type, question_number, subject, topic, subtopic, difficulty, "
                "has_image, image_url, is_active, structural_status, answer_status, "
                "explanation_status, tagging_status, review_required, confidence_score, "
                "public_visibility, primary_issue_code, issue_codes"
            )
            .eq("is_active", True)
            .eq("needs_review", True)
        )
        if exam_name:
            query = query.eq("exam_name", exam_name)
        if exam_year is not None:
            query = query.eq("exam_year", int(exam_year))

        batch = query.range(offset, offset + 999).execute().data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    paper_ids = sorted({str(row.get("paper_id") or "").strip() for row in rows if row.get("paper_id")})
    paper_by_id: dict[str, dict] = {}
    for i in range(0, len(paper_ids), 500):
        chunk = paper_ids[i:i + 500]
        paper_rows = (
            supabase.table("papers")
            .select("id, extractor_type")
            .in_("id", chunk)
            .execute()
            .data
            or []
        )
        for paper in paper_rows:
            paper_by_id[str(paper.get("id") or "")] = paper

    candidates = [row for row in rows if _is_cbt_answer_verification_candidate(row, paper_by_id)]
    return candidates, paper_by_id


@app.post("/admin/verify-cbt-answers", dependencies=[Depends(verify_admin)])
def admin_verify_cbt_answers(
    exam_name: Optional[str] = Query(None, description="Optional exact exam filter"),
    exam_year: Optional[int] = Query(None, description="Optional exact year filter (requires exam_name)"),
    dry_run: bool = Query(True, description="Preview matching rows without updating them"),
):
    """
    Promote CBT/shift-based rows from needs_review=true to verified when the paper
    already contains a concrete A/B/C/D answer. This intentionally skips the
    broader non-CBT ai_inferred backlog.
    """
    try:
        if exam_year is not None and not exam_name:
            raise HTTPException(400, "Provide exam_name together with exam_year.")

        candidates, paper_by_id = _collect_cbt_answer_verification_candidates(
            exam_name=exam_name,
            exam_year=exam_year,
        )

        from collections import Counter

        by_exam = Counter(
            (str(row.get("exam_name") or ""), int(row.get("exam_year") or 0))
            for row in candidates
        )
        by_source = Counter()
        for row in candidates:
            paper = paper_by_id.get(str(row.get("paper_id") or ""))
            extractor_type = str((paper or {}).get("extractor_type") or "").strip().lower()
            if extractor_type == "cbt":
                by_source["extractor_type=cbt"] += 1
            elif str(row.get("shift_label") or "").strip():
                by_source["shift_label"] += 1
            else:
                by_source["exam_name_marker"] += 1

        preview = [
            {"exam_name": exam, "exam_year": year, "count": count}
            for (exam, year), count in sorted(
                by_exam.items(),
                key=lambda item: (-item[1], item[0][0], item[0][1]),
            )
        ]

        if dry_run:
            return {
                "dry_run": True,
                "candidate_count": len(candidates),
                "candidate_sources": dict(by_source),
                "exams": preview,
            }

        supported = _question_supported_columns()
        touched_exam_keys: set[tuple[str, int]] = set()
        updated = 0
        for row in candidates:
            quality_merged = merge_quality_fields(
                row,
                {"needs_review": False},
                explanation_present=str(row.get("explanation_status") or "") == "generated",
                explanation_contradiction=str(row.get("explanation_status") or "") == "contradiction",
            )
            patch = _filter_question_write_payload({
                "needs_review": False,
                "structural_status": quality_merged.get("structural_status"),
                "answer_status": quality_merged.get("answer_status"),
                "explanation_status": quality_merged.get("explanation_status"),
                "tagging_status": quality_merged.get("tagging_status"),
                "review_required": quality_merged.get("review_required"),
                "confidence_score": quality_merged.get("confidence_score"),
                "public_visibility": quality_merged.get("public_visibility"),
                "primary_issue_code": quality_merged.get("primary_issue_code"),
                "issue_codes": quality_merged.get("issue_codes"),
            }, supported)
            supabase.table("questions").update(patch).eq("id", row["id"]).execute()
            touched_exam_keys.add((str(row.get("exam_name") or ""), int(row.get("exam_year") or 0)))
            updated += 1

        for current_exam_name, current_exam_year in sorted(touched_exam_keys):
            if current_exam_name and current_exam_year > 0:
                recompute_practice_ready_for_exam(current_exam_name, current_exam_year, sb=supabase)

        _invalidate_meta_cache()
        return {
            "dry_run": False,
            "updated": updated,
            "candidate_sources": dict(by_source),
            "exams": preview,
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] CBT verification update failed: {e}")
        raise HTTPException(500, "CBT verification update failed")


@app.get("/admin/explanation-mismatches", dependencies=[Depends(verify_admin)])
def admin_list_explanation_mismatches(
    exam_name: Optional[str] = Query(None),
    exam_year: Optional[int] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
):
    """List rows where explanation text appears to contradict stored answer."""
    try:
        mismatches = _find_explanation_answer_mismatches(exam_name=exam_name, exam_year=exam_year)
        return {
            "total": len(mismatches),
            "limit": limit,
            "items": mismatches[:limit],
        }
    except Exception as e:
        print(f"[ERROR] Explanation mismatch audit error: {e}")
        raise HTTPException(500, "Explanation mismatch audit error")


@app.post("/admin/repair-explanation-mismatches", dependencies=[Depends(verify_admin)])
async def admin_repair_explanation_mismatches(
    exam_name: Optional[str] = Query(None),
    exam_year: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    dry_run: bool = Query(False),
):
    """Force re-verification/regeneration for explanation-answer mismatch rows."""
    try:
        mismatches = _find_explanation_answer_mismatches(exam_name=exam_name, exam_year=exam_year)[:limit]
        if dry_run:
            return {"dry_run": True, "count": len(mismatches), "items": mismatches}
        if not mismatches:
            return {"repaired": 0, "attempted": 0, "failed": []}

        from pipeline import generate_single_explanation
        from question_repairs import apply_latest_answer_correction

        repaired = 0
        answer_repairs_applied = 0
        failed: list[dict] = []
        for item in mismatches:
            qid = item["question_id"]
            try:
                supabase.table("explanations").delete().eq("question_id", qid).execute()
                supabase.table("questions").update({"needs_review": True, "explanation_status": "missing"}).eq("id", qid).execute()
                result = generate_single_explanation(qid)
                if not result:
                    failed.append({
                        "question_id": qid,
                        "question_number": item.get("question_number"),
                    })
                    continue

                # If the explanation run proposed a corrected answer, apply it and
                # regenerate once so the stored answer and explanation align.
                try:
                    answer_changed = apply_latest_answer_correction(qid, sb=supabase)
                except Exception:
                    answer_changed = False
                if answer_changed:
                    answer_repairs_applied += 1
                    supabase.table("explanations").delete().eq("question_id", qid).execute()
                    supabase.table("questions").update({"explanation_status": "missing"}).eq("id", qid).execute()
                    second_pass = generate_single_explanation(qid)
                    if not second_pass:
                        failed.append({
                            "question_id": qid,
                            "question_number": item.get("question_number"),
                        })
                        continue
                repaired += 1
            except Exception:
                failed.append({
                    "question_id": qid,
                    "question_number": item.get("question_number"),
                })

        _invalidate_meta_cache()
        return {
            "repaired": repaired,
            "attempted": len(mismatches),
            "answer_repairs_applied": answer_repairs_applied,
            "failed": failed,
        }
    except Exception as e:
        print(f"[ERROR] Repair explanation mismatch error: {e}")
        raise HTTPException(500, "Repair explanation mismatch error")


@app.get("/admin/question-repairs", dependencies=[Depends(verify_admin)])
async def admin_list_question_repairs(
    exam_name: Optional[str] = Query(None),
    exam_year: Optional[int] = Query(None),
    status: Optional[str] = Query("proposed"),
    limit: int = Query(200, ge=1, le=1000),
):
    """List auditable repair proposals generated by explanation-time AI."""
    try:
        q = supabase.table("question_repairs").select("*")
        if status:
            q = q.eq("status", status)
        repairs_res = q.order("created_at", desc=True).limit(limit).execute()
        repairs = repairs_res.data or []

        if exam_name or exam_year is not None:
            question_ids = [item.get("question_id") for item in repairs if item.get("question_id")]
            if question_ids:
                qr = supabase.table("questions").select("id, exam_name, exam_year, question_number").in_("id", question_ids).execute()
                qmap = {row["id"]: row for row in (qr.data or [])}
                filtered = []
                for item in repairs:
                    qrow = qmap.get(item.get("question_id"))
                    if not qrow:
                        continue
                    if exam_name and qrow.get("exam_name") != exam_name:
                        continue
                    if exam_year is not None and qrow.get("exam_year") != exam_year:
                        continue
                    enriched = dict(item)
                    enriched["exam_name"] = qrow.get("exam_name")
                    enriched["exam_year"] = qrow.get("exam_year")
                    enriched["question_number"] = qrow.get("question_number")
                    filtered.append(enriched)
                repairs = filtered
            else:
                repairs = []

        return {"total": len(repairs), "items": repairs[:limit]}
    except Exception as e:
        print(f"[ERROR] Question repair list error: {e}")
        raise HTTPException(500, "Question repair list error")


@app.post("/admin/apply-question-repair/{repair_id}", dependencies=[Depends(verify_admin)])
async def admin_apply_question_repair(repair_id: str):
    """Explicitly apply a recorded question repair proposal."""
    try:
        rr = supabase.table("question_repairs").select("*").eq("id", repair_id).single().execute()
        repair = rr.data
        if not repair:
            raise HTTPException(404, "Repair proposal not found")
        if repair.get("status") == "applied":
            return {"repair_id": repair_id, "status": "already_applied"}

        from question_repairs import apply_question_repair

        ok = apply_question_repair(repair, sb=supabase)
        if not ok:
            raise HTTPException(400, "Repair proposal could not be applied")
        _invalidate_meta_cache()
        return {"repair_id": repair_id, "status": "applied"}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Apply question repair error: {e}")
        raise HTTPException(500, "Apply question repair error")


@app.post("/admin/ai-detect-answers", dependencies=[Depends(verify_admin)])
def admin_ai_detect_answers(
    exam_name: str = Query(...),
    exam_year: Optional[int] = Query(None),
    dry_run: bool = Query(False),
):
    """
    Use Gemini to detect correct answers for questions that have no answer key.
    Batches 25 questions per API call. Cost: ~₹0.10-0.20 per 100 questions.
    Stores detected answers with needs_review=true for human spot-check.
    """
    import asyncio, time as _time

    try:
        q = supabase.table("questions").select(
            "id, question_number, question_text, option_a, option_b, option_c, option_d, correct_answer"
        ).eq("exam_name", exam_name).eq("is_active", True)
        if exam_year:
            q = q.eq("exam_year", exam_year)
        qr = q.execute()
        all_qs = qr.data or []

        # Only process questions with missing/unknown answers
        pending = [q for q in all_qs if (q.get("correct_answer") or "").strip().upper() not in ("A","B","C","D")]

        if dry_run:
            return {"total": len(all_qs), "missing_answers": len(pending), "dry_run": True,
                    "estimated_cost_inr": round(len(pending) * 0.002, 3)}

        if not pending:
            return {"updated": 0, "message": "All questions already have answers"}

        from google.genai import types as _gtypes
        try:
            genai_client = _get_main_genai_client()
        except Exception as e:
            print(f"[ERROR] AI client unavailable: {e}")
            raise HTTPException(503, "AI client unavailable")

        BATCH = 25
        updated = 0
        errors = 0

        for i in range(0, len(pending), BATCH):
            batch = pending[i:i+BATCH]
            lines = []
            for idx, q in enumerate(batch):
                lines.append(
                    f"{idx+1}. {q['question_text']}\n"
                    f"   A) {q.get('option_a','')}  B) {q.get('option_b','')}  "
                    f"C) {q.get('option_c','')}  D) {q.get('option_d','')}"
                )
            prompt = (
                "You are an expert on Indian competitive exams (UPSC, SSC, State PSC).\n"
                "For each question below, determine the single correct answer.\n"
                "Return ONLY a JSON array: [{\"id\": 1, \"answer\": \"A\"}, ...]\n"
                "No explanation. No markdown. Just the JSON array.\n\n"
                + "\n\n".join(lines)
            )

            for attempt in range(3):
                try:
                    fut = _GENAI_EXECUTOR.submit(
                        genai_client.models.generate_content,
                        model="publishers/google/models/gemini-2.5-flash",
                        contents=prompt,
                        config=_gtypes.GenerateContentConfig(temperature=0.0, max_output_tokens=512),
                    )
                    try:
                        resp = fut.result(timeout=45)
                    except _cf.TimeoutError:
                        if attempt == 2:
                            errors += len(batch)
                        else:
                            _time.sleep(5)
                        continue
                    raw = (resp.text or "").strip()
                    if raw.startswith("```"):
                        import re as _re
                        raw = _re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
                    items = json.loads(raw)
                    for item in items:
                        idx = int(item.get("id", 0)) - 1
                        ans = str(item.get("answer", "")).strip().upper()[:1]
                        if 0 <= idx < len(batch) and ans in "ABCD":
                            q = batch[idx]
                            supabase.table("questions").update(
                                {"correct_answer": ans, "needs_review": True, "answer_status": "ai_inferred"}
                            ).eq("id", q["id"]).execute()
                            updated += 1
                    break
                except Exception as e:
                    if attempt == 2:
                        errors += len(batch)
                    else:
                        _time.sleep(5 * (attempt + 1))

            _time.sleep(1)  # rate limit buffer between batches

        _invalidate_meta_cache()
        return {
            "updated": updated,
            "errors": errors,
            "total_pending": len(pending),
            "message": f"AI detected answers for {updated} questions (needs_review=true). Verify a sample before publishing.",
        }
    except Exception as e:
        print(f"[ERROR] Error: {e}")
        raise HTTPException(500, "Error")


@app.delete("/admin/explanations", dependencies=[Depends(verify_admin)])
def admin_delete_explanations(
    exam_name: str = Query(..., description="Exam name to clear explanations for"),
    dry_run: bool = Query(False),
):
    """
    Delete ALL cached explanations for an exam so they regenerate lazily
    with the verified correct answer. Use when answer key was injected after
    explanations were already generated.
    """
    try:
        # Get all question IDs for this exam
        qr = supabase.table("questions").select("id").eq("exam_name", exam_name).eq("is_active", True).execute()
        q_ids = [r["id"] for r in (qr.data or [])]
        if not q_ids:
            return {"deleted": 0, "message": f"No questions found for exam: {exam_name}"}

        # Count existing explanations
        count = 0
        for i in range(0, len(q_ids), 50):
            chunk = q_ids[i:i+50]
            er = supabase.table("explanations").select("question_id", count="exact").in_("question_id", chunk).execute()
            count += er.count or 0

        if dry_run:
            return {"dry_run": True, "questions": len(q_ids), "explanations_to_delete": count}

        deleted = 0
        supported = _question_supported_columns()
        for i in range(0, len(q_ids), 50):
            chunk = q_ids[i:i+50]
            supabase.table("explanations").delete().in_("question_id", chunk).execute()
            if "explanation_status" in supported:
                supabase.table("questions").update({"explanation_status": "missing"}).in_("id", chunk).execute()
            deleted += len(chunk)

        _invalidate_meta_cache()
        return {"deleted": deleted, "message": f"Cleared all explanations for '{exam_name}'. They regenerate on next user access."}
    except Exception as e:
        print(f"[ERROR] Error: {e}")
        raise HTTPException(500, "Error")


@app.get("/admin/cost-log", dependencies=[Depends(verify_admin)])
def admin_cost_log():
    """Return the full cost history from cache/cost_log.json."""
    from pathlib import Path
    log_path = Path(__file__).parent / "cache" / "cost_log.json"
    if not log_path.exists():
        return {"runs": [], "total_inr": 0}
    try:
        runs = json.loads(log_path.read_text())
        total = round(sum(r.get("total_inr", 0) for r in runs), 4)
        return {"runs": list(reversed(runs)), "total_inr": total}
    except Exception as e:
        print(f"[ERROR] Could not read cost log: {e}")
        raise HTTPException(500, "Could not read cost log")


@app.get("/admin/questions", dependencies=[Depends(verify_admin)])
async def admin_list_all_questions(
    exam_name: Optional[str] = Query(None),
    exam_year: Optional[int] = Query(None),
    is_active: Optional[bool] = Query(None),
    distinct_question_numbers: bool = Query(True),
    latest_only: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    limit: int = Query(50, ge=1, le=10000),
    offset: int = Query(0, ge=0),
):
    """Admin view: see ALL questions including deactivated ones."""
    global _exam_qs_cache
    try:
        if exam_name:
            exam_name = _resolve_admin_exam_name(exam_name, int(exam_year or 0)) if exam_year is not None else normalize_exam_name(exam_name)
        page_size = page_size or limit
        start = offset if offset > 0 else (page - 1) * page_size
        fetch_size = page_size
        selected_paper_ids: set[str] | None = None
        if latest_only and exam_name and exam_year:
            latest_paper = get_latest_paper_for_exam(exam_name, exam_year, sb=supabase)
            if latest_paper and latest_paper.get("id"):
                selected_paper_ids = {str(latest_paper["id"])}
        # Per-exam cache: only when fetching a full exam at once (offset=0, limit large, is_active=True)
        use_cache = (
            exam_name and exam_year and start == 0 and fetch_size >= 1000 and is_active is not False and not latest_only
        )
        cache_key = (exam_name or "", exam_year or 0, True)
        if use_cache:
            cached_ts, cached_rows = _exam_qs_cache.get(cache_key, (0.0, []))
            if cached_rows and (time.time() - cached_ts) < _EXAM_QS_CACHE_TTL_ADMIN:
                page_rows = cached_rows[start: start + fetch_size]
                return {
                    "questions": page_rows,
                    "total_count": len(cached_rows),
                    "page": page,
                    "page_size": page_size,
                    "has_more": (start + len(page_rows)) < len(cached_rows),
                    "limit": fetch_size,
                    "offset": start,
                    "total": len(cached_rows),
                }

        supported_cols = _question_supported_columns()
        cols = _question_select_clause([
            "id", "question_text", "question_number", "option_a", "option_b", "option_c", "option_d",
            "correct_answer", "subject", "topic", "subtopic", "difficulty", "concept",
            "question_type", "exam_year", "exam_name", "passage", "shift_label", "has_image", "image_url",
            "is_active", "needs_review", "paper_id", "structural_status", "public_visibility",
            "pattern_tag", "trap_tag", "skill_tag", "question_style", "pattern_confidence", "pattern_reason", "solve_hint",
            "created_at",
        ], supported_cols)

        # Fetch all rows so admin pagination can return an accurate total_count.
        all_rows: list[dict] = []
        scan_offset = 0
        while True:
            q = supabase.table("questions").select(cols)
            if exam_name:
                q = q.eq("exam_name", exam_name)
            if exam_year:
                q = q.eq("exam_year", exam_year)
            if is_active is not None:
                q = q.eq("is_active", is_active)
            q = q.order("question_number", desc=False).order("created_at", desc=False)
            q = q.range(scan_offset, scan_offset + 999)
            result = q.execute()
            raw_batch = result.data or []
            batch = raw_batch
            if selected_paper_ids is not None:
                batch = [
                    row for row in batch
                    if row.get("paper_id") and str(row.get("paper_id")) in selected_paper_ids
                ]
            all_rows.extend(batch)
            if len(raw_batch) < 1000:
                break
            scan_offset += 1000

        should_dedupe = bool(
            distinct_question_numbers
            and exam_name
            and exam_year
            and is_active is not False
        )
        if should_dedupe:
            all_rows = _dedupe_exam_rows_for_admin_session(all_rows, exam_name, exam_year)

        if use_cache and all_rows:
            _exam_qs_cache[cache_key] = (time.time(), all_rows)

        total_count = len(all_rows)
        page_rows = all_rows[start: start + fetch_size]
        return {
            "questions": page_rows,
            "total_count": total_count,
            "page": page,
            "page_size": page_size,
            "has_more": (start + len(page_rows)) < total_count,
            "limit": fetch_size,
            "offset": start,
            "total": total_count,
        }
    except Exception as e:
        print(f"[ERROR] Database error: {e}")
        raise HTTPException(500, "Database error")


@app.get("/admin/questions/{question_id}", dependencies=[Depends(verify_admin)])
async def admin_get_question(question_id: str):
    """Admin view: fetch a single question even if it is blocked from public endpoints."""
    try:
        r = supabase.table("questions").select("*").eq("id", question_id).limit(1).execute()
        rows = r.data or []
        if not rows:
            raise HTTPException(404, "Question not found")
        return rows[0]
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Database error: {e}")
        raise HTTPException(500, "Database error")


@app.get("/admin/flags", dependencies=[Depends(verify_admin)])
def admin_get_flags(min_flags: int = Query(1, ge=1), limit: int = Query(100, le=500)):
    """Return questions with flags, sorted by flag_count descending, with all flag details."""
    try:
        # Fetch questions that have been flagged
        flags_res = supabase.table("question_flags") \
            .select("id, question_id, user_id, flag_type, note, created_at") \
            .order("created_at", desc=True) \
            .limit(limit * 5) \
            .execute()
        flags = flags_res.data or []

        # Group by question_id
        from collections import defaultdict
        by_question: dict = defaultdict(list)
        for f in flags:
            by_question[f["question_id"]].append(f)

        # Filter questions with enough flags
        question_ids = [qid for qid, fs in by_question.items() if len(fs) >= min_flags]
        if not question_ids:
            return {"flags": [], "total": 0}

        # Fetch question details
        q_res = supabase.table("questions") \
            .select("id, question_text, exam_name, exam_year, subject, topic, flag_count, is_active, needs_review") \
            .in_("id", question_ids[:limit]) \
            .execute()
        q_rows = {r["id"]: r for r in (q_res.data or [])}

        result = []
        for qid in question_ids[:limit]:
            q = q_rows.get(qid)
            if not q:
                continue
            result.append({
                "question_id": qid,
                "question_text": (q.get("question_text") or "")[:200],
                "exam_name": q.get("exam_name"),
                "exam_year": q.get("exam_year"),
                "subject": q.get("subject"),
                "topic": q.get("topic"),
                "flag_count": len(by_question[qid]),
                "is_active": q.get("is_active"),
                "needs_review": q.get("needs_review"),
                "flags": by_question[qid],
            })

        result.sort(key=lambda x: x["flag_count"], reverse=True)
        return {"flags": result, "total": len(result)}
    except Exception as e:
        print(f"[ERROR] Flags fetch error: {e}")
        raise HTTPException(500, "Flags fetch error")


@app.post("/admin/flags/{flag_id}/resolve", dependencies=[Depends(verify_admin)])
def admin_resolve_flag(flag_id: str, action: str = Query(..., pattern=r"^(dismiss|hide)$")):
    """
    Resolve a flag.
    action=dismiss: delete the flag, leave question visible.
    action=hide:    delete the flag, soft-hide the question (is_active=False).
    """
    try:
        flag_res = supabase.table("question_flags").select("question_id").eq("id", flag_id).limit(1).execute()
        if not (flag_res.data or []):
            raise HTTPException(404, "Flag not found")
        question_id = flag_res.data[0]["question_id"]

        supabase.table("question_flags").delete().eq("id", flag_id).execute()

        if action == "hide":
            supabase.table("questions").update({
                "is_active": False,
                "needs_review": True,
            }).eq("id", question_id).execute()
            try:
                paper_res = supabase.table("questions").select("paper_id").eq("id", question_id).limit(1).execute()
                if paper_res.data:
                    refresh_paper_publish_state(paper_res.data[0].get("paper_id"), sb=supabase)
            except Exception:
                pass

        # Recalculate flag_count
        try:
            remaining = supabase.table("question_flags").select("id", count="exact") \
                .eq("question_id", question_id).execute()
            new_count = remaining.count or 0
            supabase.table("questions").update({"flag_count": new_count}).eq("id", question_id).execute()
        except Exception:
            pass

        return {"status": "resolved", "action": action, "question_id": question_id}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Resolve error: {e}")
        raise HTTPException(500, "Resolve error")


@app.post("/admin/flags/dismiss-all/{question_id}", dependencies=[Depends(verify_admin)])
def admin_dismiss_all_flags(question_id: str):
    """Dismiss all flags for a question (mark as reviewed, keep visible)."""
    try:
        supabase.table("question_flags").delete().eq("question_id", question_id).execute()
        supabase.table("questions").update({
            "flag_count": 0,
            "needs_review": False,
        }).eq("id", question_id).execute()
        return {"status": "dismissed", "question_id": question_id}
    except Exception as e:
        print(f"[ERROR] Dismiss error: {e}")
        raise HTTPException(500, "Dismiss error")


@app.get("/admin/explanation/{question_id}", dependencies=[Depends(verify_admin)])
def admin_get_explanation(question_id: str):
    """Admin view: fetch or generate explanation for blocked/review papers."""
    try:
        qr = supabase.table("questions").select("id, correct_answer, needs_review").eq("id", question_id).eq("is_active", True).single().execute()
        if not qr.data:
            raise HTTPException(404, "Question not found")
        result = None
        try:
            from pipeline import generate_single_explanation
            result = generate_single_explanation(question_id)
        except Exception as e:
            print(f"WARN admin_get_explanation generation failed for {question_id}: {e}")
            return _explanation_unavailable_payload(
                question_id,
                source="unavailable-error",
                verified_answer=qr.data.get("correct_answer"),
                needs_review=bool(qr.data.get("needs_review")),
            )
        if not result:
            return _explanation_unavailable_payload(
                question_id,
                source="unavailable-error",
                verified_answer=qr.data.get("correct_answer"),
                needs_review=bool(qr.data.get("needs_review")),
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"ERROR in admin_get_explanation({question_id}): {e}")
        return _explanation_unavailable_payload(question_id, source="unavailable-error")


@app.get("/admin/questions-meta", dependencies=[Depends(verify_admin)])
@app.get("/admin/questions/meta", dependencies=[Depends(verify_admin)])
async def admin_questions_meta(is_active: Optional[bool] = Query(True)):
    """Admin metadata view: includes blocked/review papers for audit and cleanup."""
    global _admin_meta_cache, _admin_meta_cache_ts
    if is_active is True and _admin_meta_cache is not None and (time.time() - _admin_meta_cache_ts) < _ADMIN_META_CACHE_TTL:
        return {"questions": _admin_meta_cache, "total": len(_admin_meta_cache)}
    try:
        all_data: list[dict] = []
        offset = 0
        while True:
            q = supabase.table("questions").select(
                "id, exam_name, exam_year, subject, topic, subtopic, difficulty, needs_review, is_active, paper_id, question_number"
            )
            if is_active is not None:
                q = q.eq("is_active", is_active)
            r = q.range(offset, offset + 999).execute()
            raw_batch = r.data or []
            batch = raw_batch
            all_data.extend(batch)
            if len(raw_batch) < 1000:
                break
            offset += 1000

        if is_active is True:
            _admin_meta_cache = all_data
            _admin_meta_cache_ts = time.time()
        return {"questions": all_data, "total": len(all_data)}
    except Exception as e:
        print(f"[ERROR] Database error: {e}")
        raise HTTPException(500, "Database error")


@app.get("/admin/meta/catalog", dependencies=[Depends(verify_admin)])
async def admin_catalog_summary():
    try:
        meta = await admin_questions_meta(is_active=True)
        rows = _dedupe_admin_meta_rows(meta.get("questions", []))
        return build_catalog_from_meta(rows)
    except Exception as e:
        print(f"[ERROR] Admin catalog summary error: {e}")
        raise HTTPException(500, "Admin catalog summary error")


@app.get("/admin/meta/feed", dependencies=[Depends(verify_admin)])
async def admin_feed_summary():
    try:
        meta = await admin_questions_meta(is_active=True)
        rows = _dedupe_admin_meta_rows(meta.get("questions", []))
        return build_feed_from_meta(rows)
    except Exception as e:
        print(f"[ERROR] Admin feed summary error: {e}")
        raise HTTPException(500, "Admin feed summary error")


@app.get("/admin/topic-questions", dependencies=[Depends(verify_admin)])
async def admin_questions_by_topic(
    subject: str = Query(...),
    topic: str = Query(...),
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
):
    try:
        return _topic_bucket_questions(
            subject=subject,
            topic=topic,
            admin_mode=True,
            limit=limit,
            offset=offset,
        )
    except Exception as e:
        print(f"[ERROR] Database error: {e}")
        raise HTTPException(500, "Database error")


# ── Feedback ──────────────────────────────────────────────────────────────────

class _FeedbackBody(BaseModel):
    message: str
    user_email: str = ""
    user_uid: str = ""


@app.post("/feedback")
async def submit_feedback(body: _FeedbackBody):
    if not body.message.strip():
        raise HTTPException(400, "message is required")
    try:
        supabase.table("feedback").insert({
            "message": body.message.strip(),
            "user_email": body.user_email or None,
            "user_uid": body.user_uid or None,
        }).execute()
    except Exception as e:
        # Table may not exist yet — log and return ok so the UI doesn't break
        print(f"[FEEDBACK] insert failed (table missing?): {e}")
    return {"status": "ok"}


# ── Role-based route filtering ────────────────────────────────────────────────
# When APP_ROLE=public  → strips all /admin/* routes (safe for public-facing server)
# When APP_ROLE=admin   → keeps all routes (your private ingestion tool)
# When APP_ROLE=both    → keeps all routes (default, local development)
_APP_ROLE = os.getenv("APP_ROLE", "public").strip().lower()

if _APP_ROLE == "public":
    # Remove every /admin/* route so they are completely inaccessible.
    # All helper functions and data remain; only the HTTP endpoints are filtered.
    app.router.routes[:] = [
        r for r in app.router.routes
        if not getattr(r, "path", "").startswith("/admin")
    ]
    app.openapi_schema = None  # Reset cached OpenAPI schema so docs are correct

# ── Run ──────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    reload_enabled = os.getenv("UVICORN_RELOAD", "").lower() in {"1", "true", "yes"}
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload_enabled)
