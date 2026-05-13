from __future__ import annotations

import os
import tempfile
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from google import genai

load_dotenv()


def configure_google_adc_from_env() -> None:
    """Allow Railway to provide a service-account JSON as one env var."""
    if os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
        return
    raw = (
        os.getenv("GOOGLE_APPLICATION_CREDENTIALS_JSON")
        or os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    )
    if not raw:
        return
    target = Path(tempfile.gettempdir()) / "google-application-credentials.json"
    target.write_text(raw, encoding="utf-8")
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(target)


def _use_vertex_ai() -> bool:
    value = (os.getenv("GOOGLE_GENAI_USE_VERTEXAI") or "").strip().lower()
    if value in {"1", "true", "yes"}:
        return True
    if value in {"0", "false", "no"}:
        return False
    return bool(os.getenv("GOOGLE_CLOUD_PROJECT"))


def _normalize_model_name(model: str) -> str:
    if _use_vertex_ai():
        return model
    return (model or "").rsplit("/", 1)[-1] or model


DEFAULT_MODEL = os.getenv(
    "AI_MODEL_DEFAULT",
    "publishers/google/models/gemini-2.5-flash"
    if _use_vertex_ai()
    else "gemini-2.5-flash",
)

EXTRACTION_MODEL = _normalize_model_name(os.getenv("AI_MODEL_EXTRACTION", DEFAULT_MODEL))
EXTRACTION_REPAIR_MODEL = _normalize_model_name(os.getenv("AI_MODEL_EXTRACTION_REPAIR", EXTRACTION_MODEL))
TAGGING_MODEL = _normalize_model_name(os.getenv("AI_MODEL_TAGGING", DEFAULT_MODEL))
EXPLANATION_MODEL = _normalize_model_name(os.getenv("AI_MODEL_EXPLANATION", DEFAULT_MODEL))
ANSWER_MODEL = _normalize_model_name(os.getenv("AI_MODEL_ANSWER", EXPLANATION_MODEL))


@lru_cache(maxsize=1)
def get_genai_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    use_vertex = _use_vertex_ai()
    if api_key and not use_vertex:
        return genai.Client(api_key=api_key)
    configure_google_adc_from_env()
    return genai.Client(
        vertexai=True,
        project=os.getenv("GOOGLE_CLOUD_PROJECT"),
        location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
    )


def short_model_name(model: str) -> str:
    return (model or "").rsplit("/", 1)[-1] or model
