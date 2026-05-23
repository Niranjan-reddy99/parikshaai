"""
Database configuration — Supabase + Firebase Admin SDK
"""
import os
import time
import threading
import concurrent.futures
import urllib.request
import json
import logging

from dotenv import load_dotenv
from supabase import create_client, Client
import firebase_admin
from firebase_admin import credentials, auth as firebase_auth
import jwt
from cryptography.x509 import load_pem_x509_certificate

load_dotenv()

logger = logging.getLogger(__name__)

# ── Supabase ─────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


# ── Firebase Admin ────────────────────────────────────────
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID")
if not FIREBASE_PROJECT_ID:
    raise RuntimeError("FIREBASE_PROJECT_ID must be set in .env")

if not firebase_admin._apps:
    firebase_admin.initialize_app(options={"projectId": FIREBASE_PROJECT_ID})

_firebase_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=8, thread_name_prefix="fb-verify"
)


# ── Local Firebase JWT verification (fast fallback) ───────
_CERTS_URL = (
    "https://www.googleapis.com/robot/v1/metadata/x509/"
    "securetoken@system.gserviceaccount.com"
)
_certs_cache: dict[str, str] = {}          # kid → PEM cert string
_certs_fetched_at: float = 0.0
_CERTS_TTL = 3600                          # refresh every hour
_certs_lock = threading.Lock()


def _fetch_firebase_certs(force: bool = False) -> dict[str, str]:
    """Download Google's Firebase public certs and cache them."""
    global _certs_cache, _certs_fetched_at
    with _certs_lock:
        if not force and _certs_cache and (time.time() - _certs_fetched_at) < _CERTS_TTL:
            return _certs_cache
        try:
            with urllib.request.urlopen(_CERTS_URL, timeout=15) as resp:
                data = json.loads(resp.read())
            _certs_cache = data
            _certs_fetched_at = time.time()
            logger.info("[firebase] Public certs fetched (%d keys)", len(data))
        except Exception as exc:
            logger.warning("[firebase] Failed to fetch public certs: %s", exc)
            if not _certs_cache:
                raise ValueError(f"Could not fetch Firebase public certs: {exc}") from exc
    return _certs_cache


def _verify_local(token: str) -> dict:
    """
    Verify a Firebase JWT locally using Google's public certs.
    Faster than the Admin SDK path — no SDK overhead, just a
    single cert download (cached 1 h) and a local RSA verify.
    """
    # Decode header to find which cert to use
    header = jwt.get_unverified_header(token)
    kid = header.get("kid")
    if not kid:
        raise ValueError("Firebase JWT missing 'kid' header")

    certs = _fetch_firebase_certs()
    if kid not in certs:
        # Key rotated? Force a refresh
        certs = _fetch_firebase_certs(force=True)
    if kid not in certs:
        raise ValueError(f"Firebase public key '{kid}' not found")

    # Load PEM certificate → public key
    cert = load_pem_x509_certificate(certs[kid].encode())
    public_key = cert.public_key()

    # Decode + verify (raises on bad sig / exp / aud / iss)
    payload = jwt.decode(
        token,
        public_key,
        algorithms=["RS256"],
        audience=FIREBASE_PROJECT_ID,
        issuer=f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}",
        options={"verify_exp": True, "verify_iat": True},
    )

    # Firebase requires sub == uid
    if not payload.get("sub"):
        raise ValueError("Firebase JWT missing 'sub' claim")

    # Normalise to match Firebase Admin SDK shape
    payload.setdefault("uid", payload["sub"])
    return payload


def _warm_firebase_keys() -> None:
    """
    Pre-fetch public certs at startup so the first real request is instant.
    Also tries Firebase Admin SDK (warms its internal cache).
    Both are best-effort — errors are swallowed.
    """
    try:
        _fetch_firebase_certs()
    except Exception:
        pass
    try:
        firebase_auth.verify_id_token("warmup")
    except Exception:
        pass


# Start warmup immediately at import time
threading.Thread(target=_warm_firebase_keys, daemon=True, name="fb-warmup").start()


def verify_firebase_token(token: str) -> dict:
    """
    Verify a Firebase ID token and return decoded claims.

    Strategy (fastest path first):
    1. Local JWT verification using cached Google public certs — no Firebase
       Admin SDK overhead, < 5 ms once certs are cached.
    2. Firebase Admin SDK in a thread pool with a 10-second timeout —
       catches edge cases the local path might miss.
    Falls back to path 2 only if path 1 fails.
    """
    # Path 1: fast local verification
    try:
        return _verify_local(token)
    except Exception as local_err:
        logger.debug("[firebase] Local verify failed (%s), trying Admin SDK", local_err)

    # Path 2: Firebase Admin SDK (may be slow on first call)
    future = _firebase_executor.submit(firebase_auth.verify_id_token, token)
    try:
        return dict(future.result(timeout=10.0))
    except concurrent.futures.TimeoutError:
        raise ValueError("Firebase token verification timed out")
    except Exception as sdk_err:
        raise ValueError(f"Invalid Firebase token: {sdk_err}") from sdk_err
