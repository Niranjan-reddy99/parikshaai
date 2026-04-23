from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv
from google import genai

load_dotenv()

DEFAULT_MODEL = os.getenv(
    "AI_MODEL_DEFAULT",
    "publishers/google/models/gemini-2.5-flash",
)

EXTRACTION_MODEL = os.getenv("AI_MODEL_EXTRACTION", DEFAULT_MODEL)
EXTRACTION_REPAIR_MODEL = os.getenv("AI_MODEL_EXTRACTION_REPAIR", EXTRACTION_MODEL)
TAGGING_MODEL = os.getenv("AI_MODEL_TAGGING", DEFAULT_MODEL)
EXPLANATION_MODEL = os.getenv("AI_MODEL_EXPLANATION", DEFAULT_MODEL)
ANSWER_MODEL = os.getenv("AI_MODEL_ANSWER", EXPLANATION_MODEL)


@lru_cache(maxsize=1)
def get_genai_client() -> genai.Client:
    return genai.Client(
        vertexai=True,
        project=os.getenv("GOOGLE_CLOUD_PROJECT"),
        location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
    )


def short_model_name(model: str) -> str:
    return (model or "").rsplit("/", 1)[-1] or model
