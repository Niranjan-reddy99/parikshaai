"""
pattern_tagger.py — Pattern Intelligence Layer
==============================================
Tags every question with examiner-intent metadata:
  pattern_type, examiner_trap, syllabus_link, why_asked, trend_direction

Run standalone:
    cd backend && python pattern_tagger.py              # all untagged
    cd backend && python pattern_tagger.py --paper-id <uuid>
    cd backend && python pattern_tagger.py --limit 200
"""
from __future__ import annotations

import argparse
import json
import time
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

from config import supabase
from ai_models import get_genai_client, TAGGING_MODEL

_CLIENT = get_genai_client()
_BATCH = 20  # questions per Gemini call

PATTERN_TAGGER_PROMPT = """You are an expert examiner-analyst for Indian government competitive exams (UPSC, SSC, APPSC, TSPSC, AP High Court, CDS, etc.).

Analyse each question and return ONLY a JSON array — no markdown, no explanation.

For each question assign:
1. "pattern_type": one of —
   "fact_recall"        — pure memory: dates, names, capitals, articles
   "conceptual"         — requires understanding a concept/process
   "application"        — apply a principle to a scenario
   "current_affairs"    — news/event-based (year matters)
   "elimination"        — 4 options designed to trap; correct by ruling out
   "map_diagram"        — requires spatial or visual reasoning
   "match_the_following"— two-column matching
   "assertion_reason"   — Assertion-Reason format
   "statement_based"    — numbered statements, pick correct/incorrect combo

2. "examiner_trap": the most likely distractor technique (null if none obvious) —
   "close_dates", "similar_names", "negation_trick", "always_never_trap",
   "two_correct_one_wrong", "authority_confusion", "false_syllogism", null

3. "syllabus_link": map to official syllabus in format "Exam>Paper>Topic>Subtopic"
   e.g. "UPSC>GS-I>History>Indus Valley Civilization"
   e.g. "SSC-CGL>GA>Polity>Fundamental Rights"
   e.g. "APPSC>GS>Economy>Monetary Policy"

4. "why_asked": one concise sentence on examiner's intent
   e.g. "Tests whether candidates confuse Pitt's India Act with Regulating Act of 1773"

5. "trend_direction": based on how often this topic recurs across exams —
   "rising", "stable", "falling", "one_off"

Return format — JSON array, one object per question:
[{
  "id": <same id as input>,
  "pattern_type": "...",
  "examiner_trap": "...",
  "syllabus_link": "...",
  "why_asked": "...",
  "trend_direction": "..."
}]

Questions:
{questions_text}
"""


def _build_questions_text(batch: list[dict]) -> str:
    lines = []
    for q in batch:
        opts = f"A. {q.get('option_a','')}  B. {q.get('option_b','')}  C. {q.get('option_c','')}  D. {q.get('option_d','')}"
        lines.append(
            f"[id={q['id']}]\n"
            f"Exam: {q.get('exam_name','')} {q.get('exam_year','')}\n"
            f"Subject: {q.get('subject','')} / {q.get('topic','')}\n"
            f"Q: {q.get('question_text','')}\n"
            f"Options: {opts}\n"
            f"Answer: {q.get('correct_answer','')}\n"
        )
    return "\n---\n".join(lines)


def _call_gemini(questions_text: str, retries: int = 3) -> list[dict]:
    from google.genai import types
    prompt = PATTERN_TAGGER_PROMPT.format(questions_text=questions_text)
    last_err = None
    for attempt in range(retries):
        try:
            resp = _CLIENT.models.generate_content(
                model=TAGGING_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    max_output_tokens=4096,
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )
            raw = resp.text.strip()
            raw = raw.lstrip("```json").lstrip("```").rstrip("```").strip()
            return json.loads(raw)
        except Exception as e:
            last_err = e
            time.sleep(2 ** attempt)
    print(f"  [warn] pattern batch failed: {last_err}")
    return []


def _upsert_pattern_tags(tags: list[dict]) -> int:
    saved = 0
    for tag in tags:
        qid = tag.get("id")
        if not qid:
            continue
        patch = {
            "pattern_type": tag.get("pattern_type"),
            "examiner_trap": tag.get("examiner_trap"),
            "syllabus_link": tag.get("syllabus_link"),
            "why_asked": tag.get("why_asked"),
            "trend_direction": tag.get("trend_direction"),
            "pattern_tagged_at": "now()",
        }
        try:
            supabase.table("questions").update(patch).eq("id", qid).execute()
            saved += 1
        except Exception as e:
            print(f"  [warn] DB update failed for {qid[:8]}: {e}")
    return saved


def _fetch_untagged(paper_id: Optional[str], limit: int) -> list[dict]:
    q = (
        supabase.table("questions")
        .select("id,question_text,option_a,option_b,option_c,option_d,correct_answer,subject,topic,exam_name,exam_year")
        .is_("pattern_type", "null")
        .eq("is_active", True)
        .limit(limit)
    )
    if paper_id:
        q = q.eq("paper_id", paper_id)
    return q.execute().data or []


def run_pattern_tagger(paper_id: Optional[str] = None, limit: int = 500) -> dict:
    questions = _fetch_untagged(paper_id, limit)
    if not questions:
        print("  No untagged questions found.")
        return {"tagged": 0, "batches": 0}

    print(f"  Pattern tagging {len(questions)} questions in batches of {_BATCH}…")
    total_tagged = 0
    batches = 0
    for i in range(0, len(questions), _BATCH):
        batch = questions[i : i + _BATCH]
        text = _build_questions_text(batch)
        tags = _call_gemini(text)
        saved = _upsert_pattern_tags(tags)
        total_tagged += saved
        batches += 1
        print(f"  Batch {batches}: {saved}/{len(batch)} saved")

    print(f"\n  Done. Tagged {total_tagged}/{len(questions)} questions in {batches} batches.")
    return {"tagged": total_tagged, "batches": batches}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Tag questions with pattern intelligence metadata")
    parser.add_argument("--paper-id", help="Limit to a specific paper UUID")
    parser.add_argument("--limit", type=int, default=500, help="Max questions to tag (default 500)")
    args = parser.parse_args()
    run_pattern_tagger(paper_id=args.paper_id, limit=args.limit)
