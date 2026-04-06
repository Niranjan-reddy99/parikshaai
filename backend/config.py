"""
Database configuration — Supabase + Firebase Admin SDK
"""
import os
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
FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "gen-lang-client-0575996387")

if not firebase_admin._apps:
    firebase_admin.initialize_app(options={"projectId": FIREBASE_PROJECT_ID})


def verify_firebase_token(token: str) -> dict:
    """Verify a Firebase ID token and return the decoded claims."""
    try:
        decoded = firebase_auth.verify_id_token(token)
        return decoded
    except Exception as e:
        raise ValueError(f"Invalid Firebase token: {e}")
