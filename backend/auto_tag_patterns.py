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
import errno
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Create a dedicated Supabase client for the tagger so it never shares
# connection state with the FastAPI request-handler client (supabase-py is
# not thread-safe; sharing it causes 500s on /attempt during bulk tagging).
from supabase import create_client as _create_client
_SUPABASE_URL = os.getenv("SUPABASE_URL", "")
_SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
supabase = _create_client(_SUPABASE_URL, _SUPABASE_KEY)  # tagger-local client
from pattern_classifier import (  # noqa: E402
    PATTERN_TAGS,
    QUESTION_STYLES,
    SKILL_TAGS,
    TRAP_TAGS,
    classify_question_rule,
)

BATCH_SIZE = 15   # Flash thinking handles 15 questions well; fewer API roundtrips
LOG_DIR = Path(__file__).parent / "cache" / "pattern_tags"
CHECKPOINT_FILE = LOG_DIR / "checkpoint.json"


def _load_checkpoint() -> dict | None:
    if CHECKPOINT_FILE.exists():
        try:
            return json.loads(CHECKPOINT_FILE.read_text())
        except Exception:
            return None
    return None


def _save_checkpoint(started_at: str, batches_done: int) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    CHECKPOINT_FILE.write_text(json.dumps({"started_at": started_at, "batches_done": batches_done}))


def _clear_checkpoint() -> None:
    if CHECKPOINT_FILE.exists():
        CHECKPOINT_FILE.unlink()


def _supabase_execute(query, retries: int = 3):
    """Execute a supabase query with EAGAIN retry (BlockingIOError [Errno 35] on macOS)."""
    for attempt in range(retries):
        try:
            return query.execute()
        except OSError as e:
            if e.errno == errno.EAGAIN and attempt < retries - 1:
                time.sleep(0.5 * (attempt + 1))
                continue
            raise
    return query.execute()


def _supported_question_columns() -> set[str]:
    try:
        row = _supabase_execute(supabase.table("questions").select("*").limit(1)).data or []
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

    print(f"Using Vertex AI — project={project} location={location} model=gemini-2.5-flash")
    # 90s socket-level timeout on every request — enforced by the underlying httpx
    # transport, so a hanging Vertex AI call is hard-killed, not just abandoned.
    return genai.Client(
        vertexai=True,
        project=project,
        location=location,
        http_options=genai.types.HttpOptions(timeout=90_000),  # 90 seconds in ms
    )


# ── Fetch untagged questions ──────────────────────────────────────────────────
def fetch_candidates(
    exam_name: str | None,
    exam_year: int | None,
    limit: int,
    force: bool,
    paper_id: str | None = None,
    resume_after: str | None = None,
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
        # Resume: skip questions already tagged in this run (pattern_tagged_at >= job start)
        if resume_after:
            q = q.or_(f"pattern_tagged_at.is.null,pattern_tagged_at.lt.{resume_after}")

        rows = _supabase_execute(q).data or []
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
        time.sleep(0.05)  # small pause to avoid socket exhaustion on rapid page fetches

    return results[:limit]


# ── Build the Gemini prompt ───────────────────────────────────────────────────
_PROMPT_HEADER = """\
You are a senior UPSC/PSC question analyst with 15 years of experience classifying PYQ patterns.
Your job: classify each question with surgical precision using EXACTLY the allowed values.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALLOWED VALUES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
pattern_tag (pick exactly one):
  statement-based        → "Consider the following statements: 1. X  2. Y" — validate truth of each statement
  statement-elimination  → statement question where options are code combinations (1 only / 1&2 / 1,2&3 / all)
  assertion-reason       → "Assertion: X   Reason: Y" format
  chronology             → arrange events/acts/dates in correct sequential order
  match-the-following    → Column I ↔ Column II pair matching
  article-provision      → asks about specific Article / Section / Schedule / Part of Constitution or law
  committee-mapping      → links a committee, report, or recommendation to a personality/outcome
  factual-recall         → pure memory: who/what/where/which on history, geography, science, art, culture, polity
  concept-application    → apply a principle, rule, or definition to a given scenario/example
  elimination            → designed so ≥2 options are clearly wrong; solve by eliminating
  date-event-recall      → the ANSWER is a specific year or date (e.g. "In which year was X established?")
  scheme-current-affairs → govt scheme / policy / yojana / mission / budget / index / award / sports event /
                           diplomatic summit / bilateral deal / recent appointment / recent election result
  map-location           → geography/location: river, state, district, mountain, national park, dam
  grammar-error-detection → spot grammatical error / correct the sentence — ENGLISH SECTION ONLY
  fill-in-the-blank      → complete a blank in a sentence — ENGLISH SECTION ONLY
  para-jumble            → arrange jumbled sentences into a coherent paragraph — ENGLISH SECTION ONLY
  vocabulary-usage       → synonym/antonym/idiom/one-word substitution/spelling — ENGLISH SECTION ONLY
  coding-decoding        → logical coding: if APPLE=12345, what is PLEA?
  ranking-order          → rank/seating/direction-sense/blood-relation reasoning
  gcd-lcm-calculation    → HCF/GCD/LCM prime factorisation
  arithmetic-calculation → percentage/profit-loss/SI-CI/ratio/time-work/speed-distance calculation
  data-interpretation    → read a table/bar chart/pie chart then calculate

trap_tag (null if no trick):
  absolute-wording   → "always / never / all / only / must / solely / entirely / completely / none"
  negation           → "which is NOT correct" / "which is INCORRECT"
  except-not         → "all EXCEPT" / "which is NOT among"
  all-of-above       → "all of the above" or "none of the above" as an option trap
  double-negation    → "which is NOT incorrect" / "which is NOT false"
  partial-truth      → one word makes an otherwise correct option wrong
  close-dates        → nearby years/dates as distractors (e.g. 1947 vs 1950 vs 1952)
  similar-names      → similar-sounding names/committees/places as distractors
  formula-confusion  → wrong formula or calculation shortcut trap
  code-pair-confusion → matching/coding answer-code pairing trap
  sequence-confusion → timeline/order/ranking trap
  unit-conversion    → units must be converted before solving
  option-pairing     → answer-code combinations (1&2 / 2&3 / only 3) are the trap

skill_tag (pick exactly one):
  recall            → pure memory retrieval
  elimination       → process of elimination
  inference         → derive unstated conclusion
  application       → apply a known rule to a new context
  analysis          → break down a complex question
  sequencing        → arrange in order
  calculation       → arithmetic/mathematical computation
  language-usage    → grammar/vocabulary skill
  pattern-recognition → identify code/sequence pattern
  mapping           → link two sets of items

question_style (pick exactly one):
  direct       → simple who/what/when/where question
  indirect     → negative framing (NOT, EXCEPT, INCORRECT)
  analytical   → multi-statement, assertion-reason, match
  comparative  → compare/distinguish between two things
  definitional → asks meaning/definition of a term
  language     → grammar/vocabulary/sentence structure
  quantitative → mathematical/numerical
  reasoning    → logical/coded/positional

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL DISAMBIGUATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATE-EVENT-RECALL vs SCHEME-CURRENT-AFFAIRS vs FACTUAL-RECALL:
  • date-event-recall → the ANSWER the student must recall IS a year/date
      ✓ "In which year was the Right to Information Act passed?" → date-event-recall
      ✓ "The Planning Commission was dissolved in ____?" → date-event-recall
      ✗ "Who became the Player of the Match in the 2025 ICC Champions Trophy?" → NOT date-event-recall
         (2025 is context; the answer is a person's name → scheme-current-affairs)
      ✗ "Who established the East India Company in 1600?" → NOT date-event-recall
         (1600 is context; the answer is a person/entity → factual-recall)

  • scheme-current-affairs → recent events, policies, sports, awards, summits, appointments
      ✓ Sports awards, trophies, medals, Olympics, World Cup, ICC events
      ✓ Government schemes (PM-KISAN, Ayushman Bharat, Smart Cities)
      ✓ Budgets, economic surveys, global indices (HDI, EoDB, GHI)
      ✓ G20, SAARC, bilateral summits, defence deals, trade agreements
      ✓ Recent elections, appointments, state government schemes

  • factual-recall → timeless factual recall (history, geography, science, culture, polity)
      ✓ "Who wrote the Arthashastra?" → factual-recall
      ✓ "Which planet is closest to the Sun?" → factual-recall
      ✓ "The Gandhara school of art flourished under which rulers?" → factual-recall

WHO-QUESTION RULE:
  A question starting with "Who" ALWAYS asks for a person/entity — never a date.
  "Who won X in [year]?" → year is context only. Tag based on the subject (sports=scheme-current-affairs,
  historical figure=factual-recall, committee head=committee-mapping)

ENGLISH-ONLY TAGS:
  fill-in-the-blank, vocabulary-usage, grammar-error-detection, para-jumble →
  ONLY if subject is English / Verbal Ability / Language / Comprehension.
  A History/Geography/Polity question with a _____ blank → use date-event-recall or scheme-current-affairs.

BLANK (___) RULE:
  "The ARC was set up in the year _____" → date-event-recall (answer = a year)
  "The PM Vidya scheme aims to _____" → scheme-current-affairs (answer = objective/fact)
  NEVER fill-in-the-blank for non-English subjects.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATTERN_REASON & SOLVE_HINT — MUST BE SPECIFIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• pattern_reason: ONE sentence explaining WHY the examiner asks THIS specific question frame.
  Be specific to the content — mention the topic, event, concept. Do NOT write generic descriptions.
  BAD:  "The examiner is testing exact date or year-event association."
  GOOD: "The examiner is testing whether you recall the exact year the Right to Information Act was passed
         — a frequently asked constitutional milestone."

• solve_hint: ONE actionable sentence telling the student HOW to approach THIS question.
  Be specific — mention what to anchor on, what distractor to watch.
  BAD:  "Use known anchor years/events to eliminate close-date distractors."
  GOOD: "Anchor on 2005 (RTI Act) vs 2009 (RTE Act) — these two years are the standard distractor pair in UPSC."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Return ONLY a raw JSON array (no markdown, no explanation, no preamble):
[{
  "id": 1,
  "pattern_tag": "...",
  "trap_tag": null,
  "skill_tag": "...",
  "question_style": "...",
  "pattern_reason": "specific one-sentence reason for THIS question",
  "solve_hint": "specific one-sentence solving instruction for THIS question"
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
                    max_output_tokens=16384,
                    # Thinking enabled — Flash thinking gives Pro-level accuracy
                    # for constrained classification at ~5x the speed.
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
            _supabase_execute(supabase.table("questions").update(patch).eq("id", question["id"]))
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

    # Checkpoint: resume from where we left off if a previous force-run was interrupted
    checkpoint = _load_checkpoint() if force and not dry_run else None
    job_started_at = datetime.now(timezone.utc).isoformat()
    if checkpoint:
        job_started_at = checkpoint["started_at"]
        print(f"Resuming interrupted run from {job_started_at} (checkpoint: {checkpoint['batches_done']} batches done)")
    else:
        if force and not dry_run:
            _save_checkpoint(job_started_at, 0)

    print("Fetching candidates from Supabase...")
    candidates = fetch_candidates(
        exam_name, exam_year, limit, force,
        paper_id=paper_id,
        resume_after=job_started_at if checkpoint else None,
    )
    if not candidates:
        print("No untagged questions found. Use --force to re-tag existing ones.")
        _clear_checkpoint()
        return {"tagged": 0, "rule_tagged": 0, "ai_tagged": 0, "skipped": 0, "errors": 0}

    print(f"Found {len(candidates)} questions to tag.")
    if dry_run:
        print("[DRY RUN] Gemini will be called but Supabase will NOT be written.")

    supported_cols = _supported_question_columns()
    total_updated = total_skipped = total_errors = 0
    rule_updated = 0
    ai_updated = 0
    log: list[dict] = []

    ai_candidates: list[dict] = list(candidates)
    print(f"Sending all {len(ai_candidates)} questions to Gemini 2.5 Flash thinking (rule fallback on batch failure).")
    client = _build_genai_client() if ai_candidates else None
    batches = [ai_candidates[i:i+BATCH_SIZE] for i in range(0, len(ai_candidates), BATCH_SIZE)]
    batches_done_offset = checkpoint["batches_done"] if checkpoint else 0

    for b_idx, batch in enumerate(batches):
        absolute_batch = batches_done_offset + b_idx + 1
        print(f"\nBatch {absolute_batch} ({b_idx+1}/{len(batches)} this run, {len(batch)} questions)...")
        t0 = time.perf_counter()
        items = _tag_batch(client, batch)
        elapsed = round(time.perf_counter() - t0, 1)

        if not items:
            # Gemini failed — fall back to rule-based classifier for this batch
            print(f"  Gemini batch failed ({elapsed}s) — falling back to rule-based classifier")
            for q in batch:
                rule_tag = classify_question_rule(q)
                if rule_tag:
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
                            "source": "rules-fallback",
                            "pattern_tag": item.get("pattern_tag"),
                            "trap_tag": item.get("trap_tag"),
                            "skill_tag": item.get("skill_tag"),
                            "question_style": item.get("question_style"),
                            "question_preview": (q.get("question_text") or "")[:100],
                        })
                else:
                    total_errors += 1
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

        # Save checkpoint after every successful batch so a crash can resume here
        if force and not dry_run:
            _save_checkpoint(job_started_at, absolute_batch)

        # Small pause between batches (avoid rate-limit spikes)
        if b_idx < len(batches) - 1:
            time.sleep(1)

    _clear_checkpoint()
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
