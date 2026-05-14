"""
auto_tag_patterns.py — Bulk pattern tagger for UPSC question bank
Uses Gemini 2.5 Flash to classify every untagged question with:
  pattern_tag   : question structure (statement-based, assertion-reason, ...)
  trap_tag      : common examiner trick (absolute-wording, negation, ...)
  skill_tag     : cognitive skill needed (recall, elimination, inference, ...)
  question_style: how the question is framed (direct, analytical, ...)

Usage:
  # Dry run — preview counts without writing
  python auto_tag_patterns.py --dry-run

  # Tag up to 500 best questions across all exams
  python auto_tag_patterns.py --limit 500

  # Tag only one exam
  python auto_tag_patterns.py --exam "UPSC PRELIMS" --year 2023

  # Re-tag already tagged questions (force mode)
  python auto_tag_patterns.py --force --limit 200

Run from the backend/ directory with the venv active.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from config import supabase  # noqa: E402  (needs env loaded first)
from pattern_classifier import (  # noqa: E402
    PATTERN_TAGS,
    QUESTION_STYLES,
    SKILL_TAGS,
    TRAP_TAGS,
    classify_question_rule,
)

BATCH_SIZE = 20   # questions per Gemini call (kept small so JSON fits cleanly)
LOG_DIR = Path(__file__).parent / "cache" / "pattern_tags"


def _supported_question_columns() -> set[str]:
    try:
        row = supabase.table("questions").select("*").limit(1).execute().data or []
        if row:
            return set(row[0].keys())
    except Exception:
        pass
    return {
        "pattern_tag", "trap_tag", "skill_tag", "question_style",
    }


# ── Gemini client — Vertex AI only (no API key) ───────────────────────────────
def _build_genai_client():
    import tempfile
    from google import genai

    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    location = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
    if not project:
        sys.exit("ERROR: GOOGLE_CLOUD_PROJECT is not set in .env — Vertex AI requires it.")

    # If credentials were inlined as JSON string instead of a file path, write them out
    raw_creds = (
        os.getenv("GOOGLE_APPLICATION_CREDENTIALS_JSON")
        or os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    )
    if raw_creds and not os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
        p = Path(tempfile.gettempdir()) / "gcp-auto-tagger.json"
        p.write_text(raw_creds)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(p)

    print(f"Using Vertex AI — project={project} location={location}")
    return genai.Client(vertexai=True, project=project, location=location)


# ── Fetch untagged questions ──────────────────────────────────────────────────
def fetch_candidates(
    exam_name: str | None,
    exam_year: int | None,
    limit: int,
    force: bool,
    paper_id: str | None = None,
) -> list[dict]:
    """
    Priority order:
      1. practice_ready=TRUE (already curated, highest value)
      2. confidence_score DESC (best shape questions)
      3. id (deterministic tiebreak)
    Skips already-tagged rows unless --force.
    """
    results: list[dict] = []
    offset = 0
    page = 500  # fetch wide, filter locally

    while len(results) < limit:
        q = (
            supabase.table("questions")
            .select("id, question_text, option_a, option_b, option_c, option_d, "
                    "subject, topic, exam_name, exam_year, "
                    "pattern_tag, trap_tag, skill_tag, question_style, "
                    "practice_ready, confidence_score, is_active")
            .eq("is_active", True)
            .order("practice_ready", desc=True)
            .order("confidence_score", desc=True)
            .order("id")
            .range(offset, offset + page - 1)
        )
        if exam_name:
            q = q.ilike("exam_name", f"%{exam_name}%")
        if exam_year:
            q = q.eq("exam_year", exam_year)
        if paper_id:
            q = q.eq("paper_id", paper_id)

        rows = q.execute().data or []
        if not rows:
            break

        for row in rows:
            already_tagged = bool(row.get("pattern_tag"))
            if already_tagged and not force:
                continue
            results.append(row)
            if len(results) >= limit:
                break

        if len(rows) < page:
            break
        offset += page

    return results[:limit]


# ── Build the Gemini prompt ───────────────────────────────────────────────────
_PROMPT_HEADER = """\
You are an expert analyst of Indian civil-services and state PSC MCQ questions.

Classify each question below using EXACTLY the allowed values.

ALLOWED VALUES (use null if none fits):
  pattern_tag   : statement-based | assertion-reason | chronology | match-the-following |
                  factual-recall | concept-application | elimination | article-provision |
                  committee-mapping
  trap_tag      : absolute-wording | negation | except-not | all-of-above |
                  double-negation | partial-truth | null
  skill_tag     : recall | elimination | inference | application | analysis
  question_style: direct | indirect | analytical | comparative | definitional

CLASSIFICATION GUIDE:
  statement-based   → "Consider the following statements: 1. ... 2. ..." pattern
  assertion-reason  → "Assertion: ... Reason: ..." pattern
  chronology        → asks to arrange events/acts in correct order
  match-the-following → Column I vs Column II matching
  factual-recall    → pure memory question (who/what/when/where)
  concept-application → apply a principle to a scenario
  elimination       → designed so 2 options are clearly wrong, choose between 2
  article-provision → asks about specific Article / Section / Schedule
  committee-mapping → links a committee/report/personality to an outcome

  trap_tag: set when the question has a deliberate trick
    absolute-wording → uses "always", "never", "all", "only", "must" trap
    negation         → "which is NOT", "which is INCORRECT"
    except-not       → "EXCEPT", "all EXCEPT"
    all-of-above     → "all of the above" as a trap option
    double-negation  → "which of the following is NOT incorrect"
    partial-truth    → one option is 90% right but one word makes it wrong

Return ONLY a JSON array — no markdown fences, no explanation:
[{
  "id": 1,
  "pattern_tag": "...",
  "trap_tag": null,
  "skill_tag": "...",
  "question_style": "...",
  "pattern_reason": "one short reason why the exam asks this frame",
  "solve_hint": "one short solving instruction for students"
}, ...]

QUESTIONS:
"""


def _build_prompt(batch: list[dict]) -> str:
    lines = [_PROMPT_HEADER]
    for i, q in enumerate(batch, 1):
        text = (q.get("question_text") or "").strip()
        a = (q.get("option_a") or "").strip()
        b = (q.get("option_b") or "").strip()
        c = (q.get("option_c") or "").strip()
        d = (q.get("option_d") or "").strip()
        subject = (q.get("subject") or "").strip()
        topic = (q.get("topic") or "").strip()
        lines.append(
            f"\n{i}. [{subject} / {topic}]\n"
            f"   Q: {text}\n"
            f"   A) {a}   B) {b}   C) {c}   D) {d}"
        )
    return "\n".join(lines)


# ── Call Gemini and parse ─────────────────────────────────────────────────────
def _tag_batch(client, batch: list[dict]) -> list[dict]:
    from google.genai import types as gtypes

    prompt = _build_prompt(batch)
    last_err = None
    last_raw = ""

    for attempt in range(3):
        try:
            resp = client.models.generate_content(
                model="publishers/google/models/gemini-2.5-flash",
                contents=prompt,
                config=gtypes.GenerateContentConfig(
                    temperature=0.0,
                    max_output_tokens=8192,
                    # Disable thinking tokens — pure classification, no reasoning needed.
                    # This prevents thinking budget from eating into output token space,
                    # which caused JSON to be cut off mid-string on every batch.
                    thinking_config=gtypes.ThinkingConfig(thinking_budget=0),
                ),
            )
            raw = (resp.text or "").strip()
            last_raw = raw
            # Strip markdown fences the model sometimes adds despite instructions
            raw = re.sub(r"^```(?:json)?\s*", "", raw).strip()
            raw = re.sub(r"\s*```$", "", raw).strip()
            items: list[dict] = json.loads(raw)
            return items
        except json.JSONDecodeError as e:
            last_err = e
            print(f"  [WARN] JSON parse error on attempt {attempt+1}: {e}")
            if last_raw:
                print(f"  [WARN] Raw tail (last 200 chars): ...{last_raw[-200:]}")
            time.sleep(2 ** attempt)
        except Exception as e:
            last_err = e
            print(f"  [WARN] Gemini error on attempt {attempt+1}: {e}")
            time.sleep(2 ** attempt)

    print(f"  [ERROR] All 3 attempts failed for batch: {last_err}")
    return []


def _coerce(value: str | None, allowed: set[str]) -> str | None:
    if not value or value == "null":
        return None
    v = str(value).strip().lower()
    return v if v in allowed else None


# ── Write tags to Supabase ────────────────────────────────────────────────────
def _apply_tags(
    batch: list[dict],
    items: list[dict],
    dry_run: bool,
    supported_cols: set[str] | None = None,
) -> tuple[int, int]:
    supported = supported_cols or _supported_question_columns()
    updated = skipped = 0
    for item in items:
        idx = int(item.get("id", 0)) - 1
        if not (0 <= idx < len(batch)):
            continue
        question = batch[idx]
        patch = {
            "pattern_tag":    _coerce(item.get("pattern_tag"), PATTERN_TAGS),
            "trap_tag":       _coerce(item.get("trap_tag"), TRAP_TAGS),
            "skill_tag":      _coerce(item.get("skill_tag"), SKILL_TAGS),
            "question_style": _coerce(item.get("question_style"), QUESTION_STYLES),
            "pattern_confidence": item.get("pattern_confidence"),
            "pattern_reason": str(item.get("pattern_reason") or "").strip() or None,
            "solve_hint": str(item.get("solve_hint") or "").strip() or None,
            "pattern_source": str(item.get("pattern_source") or "ai").strip() or "ai",
            "pattern_tagged_at": datetime.now(timezone.utc).isoformat(),
        }
        patch = {key: value for key, value in patch.items() if key in supported}
        if not any(patch.values()):
            skipped += 1
            continue
        if not dry_run:
            supabase.table("questions").update(patch).eq("id", question["id"]).execute()
        updated += 1
    return updated, skipped


# ── Progress log ──────────────────────────────────────────────────────────────
def _save_log(log: list[dict]) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    p = LOG_DIR / f"auto_tag_{ts}.json"
    p.write_text(json.dumps(log, indent=2, ensure_ascii=False))
    return p


# ── Main ─────────────────────────────────────────────────────────────────────
def run(
    exam_name: str | None,
    exam_year: int | None,
    limit: int,
    force: bool,
    dry_run: bool,
    paper_id: str | None = None,
) -> dict:
    print(f"\n{'[DRY RUN] ' if dry_run else ''}Pattern tagger starting — limit={limit}")
    print("Fetching candidates from Supabase...")

    candidates = fetch_candidates(exam_name, exam_year, limit, force, paper_id=paper_id)
    if not candidates:
        print("No untagged questions found. Use --force to re-tag existing ones.")
        return {"tagged": 0, "rule_tagged": 0, "ai_tagged": 0, "skipped": 0, "errors": 0}

    print(f"Found {len(candidates)} questions to tag.")
    if dry_run:
        print("[DRY RUN] Gemini will be called but Supabase will NOT be written.")

    supported_cols = _supported_question_columns()
    total_updated = total_skipped = total_errors = 0
    rule_updated = 0
    ai_updated = 0
    log: list[dict] = []

    ai_candidates: list[dict] = []
    for q in candidates:
        rule_tag = classify_question_rule(q)
        if rule_tag and int(rule_tag.get("pattern_confidence") or 0) >= 74:
            item = {"id": 1, **rule_tag}
            updated, skipped = _apply_tags([q], [item], dry_run, supported_cols)
            rule_updated += updated
            total_updated += updated
            total_skipped += skipped
            if updated:
                log.append({
                    "question_id": q["id"],
                    "exam": f"{q.get('exam_name')} {q.get('exam_year')}",
                    "subject": q.get("subject"),
                    "topic": q.get("topic"),
                    "source": "rules",
                    "pattern_tag": item.get("pattern_tag"),
                    "trap_tag": item.get("trap_tag"),
                    "skill_tag": item.get("skill_tag"),
                    "question_style": item.get("question_style"),
                    "question_preview": (q.get("question_text") or "")[:100],
                })
        else:
            ai_candidates.append(q)

    print(f"Rule pass tagged {rule_updated}; AI needed for {len(ai_candidates)} ambiguous questions.")
    client = _build_genai_client() if ai_candidates else None
    batches = [ai_candidates[i:i+BATCH_SIZE] for i in range(0, len(ai_candidates), BATCH_SIZE)]

    for b_idx, batch in enumerate(batches):
        print(f"\nBatch {b_idx+1}/{len(batches)} ({len(batch)} questions)...")
        t0 = time.perf_counter()
        items = _tag_batch(client, batch)
        elapsed = round(time.perf_counter() - t0, 1)

        if not items:
            total_errors += len(batch)
            print(f"  Batch failed entirely ({elapsed}s)")
            continue

        updated, skipped = _apply_tags(batch, items, dry_run, supported_cols)
        ai_updated += updated
        total_updated += updated
        total_skipped += skipped
        print(f"  Tagged {updated}, skipped {skipped} ({elapsed}s)")

        # Build audit log entry
        for item in items:
            idx = int(item.get("id", 0)) - 1
            if 0 <= idx < len(batch):
                q = batch[idx]
                log.append({
                    "question_id": q["id"],
                    "exam": f"{q.get('exam_name')} {q.get('exam_year')}",
                    "subject": q.get("subject"),
                    "topic": q.get("topic"),
                    "source": "ai",
                    "pattern_tag":    _coerce(item.get("pattern_tag"), PATTERN_TAGS),
                    "trap_tag":       _coerce(item.get("trap_tag"), TRAP_TAGS),
                    "skill_tag":      _coerce(item.get("skill_tag"), SKILL_TAGS),
                    "question_style": _coerce(item.get("question_style"), QUESTION_STYLES),
                    "question_preview": (q.get("question_text") or "")[:100],
                })

        # Small pause between batches (avoid rate-limit spikes)
        if b_idx < len(batches) - 1:
            time.sleep(1)

    log_path = _save_log(log) if log else None

    print(f"\n{'='*55}")
    print(f"{'[DRY RUN] ' if dry_run else ''}Done.")
    print(f"  Tagged:   {total_updated}")
    print(f"  Skipped:  {total_skipped}  (no valid tags returned)")
    print(f"  Errors:   {total_errors}  (Gemini failed for batch)")
    if log_path:
        print(f"  Audit log: {log_path}")
    print(f"{'='*55}\n")

    # Distribution summary
    if log:
        from collections import Counter
        pt = Counter(r["pattern_tag"] for r in log if r["pattern_tag"])
        sk = Counter(r["skill_tag"] for r in log if r["skill_tag"])
        tr = Counter(r["trap_tag"] for r in log if r["trap_tag"])
        print("Pattern distribution:")
        for tag, count in pt.most_common():
            bar = "█" * (count * 30 // max(pt.values()))
            print(f"  {tag:<25} {bar} {count}")
        print("\nSkill distribution:")
        for tag, count in sk.most_common():
            print(f"  {tag:<20} {count}")
        if tr:
            print("\nTrap distribution:")
            for tag, count in tr.most_common():
                print(f"  {tag:<25} {count}")
    return {
        "tagged": total_updated,
        "rule_tagged": rule_updated,
        "ai_tagged": ai_updated,
        "skipped": total_skipped,
        "errors": total_errors,
        "candidates": len(candidates),
        "ai_candidates": len(ai_candidates),
        "dry_run": dry_run,
        "log_path": str(log_path) if log_path else None,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bulk pattern tagger using Gemini 2.5 Flash")
    parser.add_argument("--exam",    default=None,  help="Filter by exam name (partial match)")
    parser.add_argument("--year",    type=int, default=None, help="Filter by exam year")
    parser.add_argument("--paper-id", default=None, help="Filter by paper UUID")
    parser.add_argument("--limit",   type=int, default=500,  help="Max questions to tag (default 500)")
    parser.add_argument("--force",   action="store_true",    help="Re-tag already-tagged questions")
    parser.add_argument("--dry-run", action="store_true",    dest="dry_run",
                        help="Call Gemini but do NOT write to Supabase")
    args = parser.parse_args()

    run(
        exam_name=args.exam,
        exam_year=args.year,
        limit=args.limit,
        force=args.force,
        dry_run=args.dry_run,
        paper_id=args.paper_id,
    )
