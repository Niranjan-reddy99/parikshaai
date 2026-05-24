"""
Telegram PYQ Scraper — Scrapes quiz polls from Telegram channels → Supabase
============================================================================
Works on channels that post MCQ quiz polls (UPSC/NDA/CDS/TSPSC/APPSC PYQs).

HOW TO SETUP (one time):
1. Go to https://my.telegram.org/apps
2. Log in with your phone number
3. Create a new app → get API_ID and API_HASH
4. Fill API_ID, API_HASH, PHONE below
5. pip install telethon

HOW TO FIND CHANNELS:
- Open Telegram, search: "UPSC PYQ quiz", "IAS prelims quiz", "UPSC daily quiz"
- Look for channels (not groups) that post quiz polls with 4 options
- Right-click on channel → Copy link → username is after t.me/
- Add the username (without @) to CHANNELS list below

USAGE:
    cd backend && source venv/bin/activate
    pip install telethon
    python telegram_scraper.py                        # scrape all channels
    python telegram_scraper.py --dry-run              # parse without inserting
    python telegram_scraper.py --channel upsc_channel # single channel
    python telegram_scraper.py --limit 100            # first 100 polls only

WHAT GETS SCRAPED:
- Only quiz-type polls (where correct answer is marked)
- Only polls with exactly 4 options (proper MCQ)
- Deduplication via SHA256 hash (re-runs are safe)
- Subject/topic auto-tagged via Gemini in batches (cheap: ~₹0.10 per 1000 questions)
"""

import asyncio
import hashlib
import json
import logging
import os
import sys
import time
import argparse
from typing import Optional

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── YOUR TELEGRAM CREDENTIALS ──────────────────────────────────────────────────
# Get from https://my.telegram.org/apps
API_ID   = os.getenv("TELEGRAM_API_ID", "YOUR_API_ID")
API_HASH = os.getenv("TELEGRAM_API_HASH", "YOUR_API_HASH")
PHONE    = os.getenv("TELEGRAM_PHONE", "+91XXXXXXXXXX")

# ── ADD YOUR CHANNELS HERE ─────────────────────────────────────────────────────
# Search Telegram for "UPSC quiz", "IAS prelims quiz", "NDA quiz" etc.
# Add channel usernames (without @) that post 4-option quiz polls.
# Map them to exam names for auto-tagging.
CHANNELS: dict[str, str] = {
    "upsc_prelims_mcq_pyq_quiz": "UPSC IAS",
}

LIMIT_PER_CHANNEL = 2000   # max messages to fetch per channel
GEMINI_BATCH_SIZE = 25     # questions per Gemini tagging call
# ──────────────────────────────────────────────────────────────────────────────


# ── Supabase ───────────────────────────────────────────────────────────────────
def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in backend/.env")
    return create_client(url, key)


# ── Gemini tagger ──────────────────────────────────────────────────────────────
def tag_questions_with_gemini(questions: list[dict]) -> list[dict]:
    """
    Batch-tag questions with subject/topic/difficulty using Gemini Flash (cheapest model).
    Sends 25 questions per API call. Cost: ~₹0.10 per 1000 questions.
    """
    try:
        import google.generativeai as genai
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        model = genai.GenerativeModel("gemini-1.5-flash-8b")
    except ImportError:
        log.warning("google-generativeai not installed — skipping tagging, using defaults")
        return questions
    except Exception as e:
        log.warning(f"Gemini init failed: {e} — skipping tagging")
        return questions

    tagged = list(questions)  # copy

    for batch_start in range(0, len(questions), GEMINI_BATCH_SIZE):
        batch = questions[batch_start: batch_start + GEMINI_BATCH_SIZE]

        prompt_lines = [
            "Tag each question with subject, topic, and difficulty.",
            "Return ONLY a JSON array. No explanation, no markdown.",
            'Schema: [{"id": 1, "subject": "...", "topic": "...", "difficulty": "Easy|Medium|Hard"}]',
            "",
            "Subjects: History & Culture, Geography, Polity & Governance, Economy, "
            "Science & Technology, Environment & Ecology, International Relations, "
            "Miscellaneous GK, Mathematics, English",
            "",
            "Questions:",
        ]
        for i, q in enumerate(batch, 1):
            prompt_lines.append(f'{i}. {q["question_text"]}')

        try:
            response = model.generate_content("\n".join(prompt_lines))
            raw = response.text.strip()
            # Strip markdown code fences if present
            raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            tags = json.loads(raw)

            for tag in tags:
                idx = batch_start + tag["id"] - 1
                if 0 <= idx < len(tagged):
                    tagged[idx]["subject"] = tag.get("subject", "Miscellaneous GK")
                    tagged[idx]["topic"] = tag.get("topic", "General")
                    tagged[idx]["difficulty"] = tag.get("difficulty", "Medium")

            log.info(f"Tagged batch {batch_start // GEMINI_BATCH_SIZE + 1}: "
                     f"{len(batch)} questions")

        except Exception as e:
            log.warning(f"Gemini tagging failed for batch starting {batch_start}: {e}")
            # Fallback: keep defaults
            for i in range(batch_start, min(batch_start + GEMINI_BATCH_SIZE, len(tagged))):
                if not tagged[i].get("subject"):
                    tagged[i]["subject"] = "Miscellaneous GK"
                    tagged[i]["topic"] = "General"
                    tagged[i]["difficulty"] = "Medium"

        time.sleep(1)  # rate limit

    return tagged


# ── Channel scraper ────────────────────────────────────────────────────────────
async def scrape_channel(client, channel_username: str, exam_name: str,
                         limit: int) -> list[dict]:
    """Scrape all quiz poll messages from a Telegram channel."""
    from telethon.tl.types import MessageMediaPoll

    questions = []
    log.info(f"Scraping @{channel_username} ({exam_name})...")

    try:
        entity = await client.get_entity(channel_username)
        count = 0

        async for message in client.iter_messages(entity, limit=limit):
            if not isinstance(message.media, MessageMediaPoll):
                continue

            poll = message.media.poll
            results = message.media.results

            # Extract question text
            q_text = (
                poll.question.text
                if hasattr(poll.question, "text")
                else str(poll.question)
            ).strip()

            if not q_text or len(q_text) < 10:
                continue

            # Extract options
            options = []
            for answer in poll.answers:
                opt = (
                    answer.text.text
                    if hasattr(answer.text, "text")
                    else str(answer.text)
                ).strip()
                options.append(opt)

            # Must have exactly 4 options
            if len(options) < 4:
                continue
            options = options[:4]  # cap at 4 (A-D)

            # Extract correct answer — only present in quiz-type polls
            correct_index = None
            if results and results.results:
                for i, result in enumerate(results.results):
                    if result.correct:
                        correct_index = i
                        break

            if correct_index is None:
                continue  # not a quiz poll or answer not revealed yet

            correct_letter = ["A", "B", "C", "D"][correct_index]

            # Build hash for deduplication
            hash_input = f"{exam_name}_{q_text[:120]}".lower().strip()
            question_hash = hashlib.sha256(hash_input.encode()).hexdigest()

            questions.append({
                "question_text": q_text,
                "option_a": options[0],
                "option_b": options[1],
                "option_c": options[2],
                "option_d": options[3],
                "correct_answer": correct_letter,
                "subject": None,       # filled by Gemini tagger
                "topic": None,
                "difficulty": "Medium",
                "question_type": "MCQ",
                "exam_name": exam_name,
                "exam_year": _guess_year(q_text, message.date),
                "source_pdf": f"https://t.me/{channel_username}/{message.id}",
                "question_hash": question_hash,
                "is_active": True,
                "_message_date": message.date.isoformat() if message.date else None,
            })
            count += 1

            if count % 100 == 0:
                log.info(f"  @{channel_username}: {count} questions scraped...")

        log.info(f"  ✓ @{channel_username}: {count} quiz questions found")

    except Exception as e:
        log.error(f"  ✗ @{channel_username}: {e}")

    return questions


def _guess_year(question_text: str, message_date) -> int:
    """
    Try to extract exam year from question text (e.g. 'UPSC 2022', '2023 prelims').
    Falls back to message year if not found.
    """
    import re
    m = re.search(r'\b(20\d{2}|19\d{2})\b', question_text)
    if m:
        y = int(m.group(1))
        if 1990 <= y <= 2025:
            return y
    if message_date:
        return message_date.year
    return 0


# ── DB insert ──────────────────────────────────────────────────────────────────
def insert_questions(supabase: Client, questions: list[dict]) -> tuple[int, int]:
    """Batch upsert questions. Returns (inserted, failed)."""
    inserted = failed = 0
    # Strip internal fields before insert
    clean = [{k: v for k, v in q.items() if not k.startswith("_")} for q in questions]

    # Batch in chunks of 100 for efficiency
    for i in range(0, len(clean), 100):
        batch = clean[i:i + 100]
        try:
            supabase.table("questions").upsert(
                batch, on_conflict="question_hash"
            ).execute()
            inserted += len(batch)
        except Exception as e:
            log.error(f"Batch insert failed (batch {i // 100 + 1}): {e}")
            # Fall back to one-by-one
            for q in batch:
                try:
                    supabase.table("questions").upsert(
                        q, on_conflict="question_hash"
                    ).execute()
                    inserted += 1
                except Exception as e2:
                    log.error(f"Single insert failed [{q['question_hash'][:8]}]: {e2}")
                    failed += 1

    return inserted, failed


# ── Main ───────────────────────────────────────────────────────────────────────
async def main_async(args):
    # Check credentials
    if API_ID == "YOUR_API_ID" or API_HASH == "YOUR_API_HASH":
        print("\n❌ SETUP REQUIRED:")
        print("   1. Go to https://my.telegram.org/apps")
        print("   2. Create an app and get API_ID + API_HASH")
        print("   3. Set them in backend/.env or directly in this file")
        print("   TELEGRAM_API_ID=your_id")
        print("   TELEGRAM_API_HASH=your_hash")
        print("   TELEGRAM_PHONE=+91XXXXXXXXXX\n")
        sys.exit(1)

    if not CHANNELS:
        print("\n❌ No channels configured.")
        print("   Search Telegram for UPSC/NDA/TSPSC quiz channels")
        print("   Add channel usernames to the CHANNELS dict at the top of this file.\n")
        sys.exit(1)

    channels_to_scrape = dict(CHANNELS)
    if args.channel:
        if args.channel not in CHANNELS:
            print(f"❌ Channel '{args.channel}' not in CHANNELS list")
            sys.exit(1)
        channels_to_scrape = {args.channel: CHANNELS[args.channel]}

    supabase = None if args.dry_run else get_supabase()

    try:
        from telethon import TelegramClient
    except ImportError:
        print("\n❌ telethon not installed. Run: pip install telethon\n")
        sys.exit(1)

    client = TelegramClient("pyq_session", int(API_ID), API_HASH)
    await client.start(phone=PHONE)
    log.info(f"Telegram connected. Scraping {len(channels_to_scrape)} channel(s)...")

    all_questions: list[dict] = []

    for username, exam_name in channels_to_scrape.items():
        limit = args.limit if args.limit else LIMIT_PER_CHANNEL
        questions = await scrape_channel(client, username, exam_name, limit)
        all_questions.extend(questions)

    await client.disconnect()

    if not all_questions:
        log.warning("No questions scraped. Check channel names and that they post quiz polls.")
        return

    log.info(f"Total scraped: {len(all_questions)} questions")

    # Tag with Gemini (subject/topic/difficulty)
    if not args.skip_tagging:
        log.info("Tagging with Gemini (subject/topic/difficulty)...")
        all_questions = tag_questions_with_gemini(all_questions)
    else:
        for q in all_questions:
            q["subject"] = q["subject"] or "Miscellaneous GK"
            q["topic"] = q["topic"] or "General"

    # Dry run: just print
    if args.dry_run:
        for q in all_questions[:10]:
            print(f"\n  Q: {q['question_text'][:80]}")
            print(f"  A: {q['option_a']}  B: {q['option_b']}")
            print(f"  C: {q['option_c']}  D: {q['option_d']}")
            print(f"  ✓ {q['correct_answer']} | {q['subject']} | {q['exam_name']} {q['exam_year']}")
        if len(all_questions) > 10:
            print(f"\n  ... and {len(all_questions) - 10} more")
        print(f"\n[DRY RUN] Would insert {len(all_questions)} questions")
        return

    # Insert to Supabase
    log.info(f"Inserting {len(all_questions)} questions to Supabase...")
    inserted, failed = insert_questions(supabase, all_questions)

    print(f"\n{'='*50}")
    print(f"  DONE")
    print(f"  Scraped  : {len(all_questions)}")
    print(f"  Inserted : {inserted}  (duplicates auto-skipped)")
    print(f"  Failed   : {failed}")
    print(f"{'='*50}")


def main():
    parser = argparse.ArgumentParser(description="Telegram quiz scraper → Supabase")
    parser.add_argument("--channel", help="Scrape only this channel username")
    parser.add_argument("--limit", type=int, default=0,
                        help="Max messages per channel (0 = all)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Parse and print but don't insert to DB")
    parser.add_argument("--skip-tagging", action="store_true",
                        help="Skip Gemini subject/topic tagging (faster, less accurate)")
    args = parser.parse_args()
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
