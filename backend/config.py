"""
Database configuration — Supabase + Firebase Admin SDK
"""
import os
import threading
import concurrent.futures
from dotenv import load_dotenv
from supabase import create_client, Client
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth

load_dotenv()

# ── Supabase ─────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")

# Use service_role key (bypasses RLS) — only for backend
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ── Firebase Admin (for verifying user tokens) ───────────
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID")
if not FIREBASE_PROJECT_ID:
    raise RuntimeError("FIREBASE_PROJECT_ID must be set in .env")

if not firebase_admin._apps:
    firebase_admin.initialize_app(options={"projectId": FIREBASE_PROJECT_ID})

# Thread pool for Firebase token verification (keeps connections warm)
_firebase_verify_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=8, thread_name_prefix="fb-verify"
)


def _warm_firebase_keys():
    """
    Download Firebase public keys into the SDK's internal cache.
    Called once at startup in a background thread.
    Any exception is swallowed — this is best-effort.
    """
    try:
        # verify_id_token with a junk token will:
        #   1. Download + cache Google's public certs (the slow part)
        #   2. Then fail on the JWT — that's fine, we only need step 1
        firebase_auth.verify_id_token("warmup")
    except Exception:
        pass


# Kick off key pre-warm immediately at module import so it has maximum lead time
threading.Thread(target=_warm_firebase_keys, daemon=True, name="fb-key-warmup").start()


def verify_firebase_token(token: str) -> dict:
    """
    Verify a Firebase ID token and return the decoded claims.
    Runs in a dedicated thread pool with a hard 10-second timeout so a slow
    network to googleapis.com never blocks a request indefinitely.
    """
    future = _firebase_verify_executor.submit(firebase_auth.verify_id_token, token)
    try:
        decoded = future.result(timeout=10.0)
        return decoded
    except concurrent.futures.TimeoutError:
        raise ValueError("Firebase token verification timed out (>10 s)")
    except Exception as e:
        raise ValueError(f"Invalid Firebase token: {e}")
