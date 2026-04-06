"""
ExamRobot Scraper — Clean PYQ ingestion from examrobot.com
==========================================================
Replaces the error-prone PDF pipeline for Previous Year Questions.
Uses public question pages (no login needed) + JSON-LD schema for reliable parsing.

Coverage: UPSC IAS (2003–2024), NDA I/II, CDS I/II, CAPF
Zero OCR errors. Zero Gemini API cost for ingestion.

Usage:
    cd backend && source venv/bin/activate

    # Test single URL first (always do this before full run)
    python examrobot_scraper.py --test-url https://examrobot.com/ias/2003/geography/one-among-countries-lowest-gdp-capita-china-india-indonesia-sri-lanka

    # Dry run (parse but don't insert)
    python examrobot_scraper.py --dry-run --limit 20

    # IAS only
    python examrobot_scraper.py --exam ias

    # Specific year
    python examrobot_scraper.py --exam ias --year 2024

    # Full scrape all exams all years
    python examrobot_scraper.py
"""

import argparse
import hashlib
import json
import logging
import os
import re
import time
import xml.etree.ElementTree as ET
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────
BASE_URL = "https://examrobot.com"
SITEMAP_PAGES = 8
DELAY = 0.6  # seconds between requests (polite scraping)
RETRY_DELAY = 3.0

EXAM_NAME_MAP = {
    "ias":    "UPSC IAS",
    "nda-i":  "NDA I",
    "nda-ii": "NDA II",
    "cds-i":  "CDS I",
    "cds-ii": "CDS II",
    "capf":   "CAPF",
}

SUBJECT_MAP = {
    "polity-governance":                      "Polity & Governance",
    "geography":                              "Geography",
    "economy":                                "Economy",
    "environment-ecology":                    "Environment & Ecology",
    "science-technology":                     "Science & Technology",
    "history-culture":                        "History & Culture",
    "miscellaneous-general-knowledge":        "Miscellaneous GK",
    "international-relations-global-affairs": "International Relations",
    "mathematics":                            "Mathematics",
    "english":                                "English",
    "general-science":                        "Science & Technology",
    "current-affairs":                        "Current Affairs",
    "general-knowledge":                      "Miscellaneous GK",
}

LETTER_MAP = {"A": 0, "B": 1, "C": 2, "D": 3}
INDEX_TO_LETTER = {0: "A", 1: "B", 2: "C", 3: "D"}

# ── Supabase client ────────────────────────────────────────────────────────────
def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in backend/.env")
    return create_client(url, key)


# ── Sitemap fetcher ────────────────────────────────────────────────────────────
def fetch_all_question_urls(
    client: httpx.Client,
    exam_filter: Optional[str] = None,
    year_filter: Optional[int] = None,
) -> list[str]:
    """Collect every question URL from all 8 sitemap pages."""
    urls = []
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}

    for page in range(1, SITEMAP_PAGES + 1):
        try:
            r = client.get(f"{BASE_URL}/sitemap.xml?page={page}", timeout=20)
            r.raise_for_status()
            root = ET.fromstring(r.text)

            for loc in root.findall(".//sm:loc", ns):
                url = loc.text.strip()
                path = url.replace(BASE_URL, "").strip("/")
                parts = path.split("/")

                # Question pages have exactly 4 segments: exam/year/subject/slug
                if len(parts) != 4:
                    continue

                exam_slug, year_str, subject_slug, _ = parts

                if exam_slug not in EXAM_NAME_MAP:
                    continue
                if exam_filter and exam_slug != exam_filter:
                    continue
                try:
                    year = int(year_str)
                except ValueError:
                    continue
                if year_filter and year != year_filter:
                    continue

                urls.append(url)

            log.info(f"Sitemap page {page}/8 processed — {len(urls)} URLs so far")
            time.sleep(DELAY)

        except Exception as e:
            log.error(f"Sitemap page {page} failed: {e}")

    return urls


# ── Page parser ────────────────────────────────────────────────────────────────
def parse_question_page(html: str, url: str) -> Optional[dict]:
    """
    Parse an examrobot question page.
    Primary: JSON-LD schema (reliable, structured)
    Fallback: HTML text patterns
    """
    soup = BeautifulSoup(html, "html.parser")

    # Extract exam/year/subject from URL
    path = url.replace(BASE_URL, "").strip("/")
    parts = path.split("/")
    if len(parts) != 4:
        return None
    exam_slug, year_str, subject_slug, _ = parts

    exam_name = EXAM_NAME_MAP.get(exam_slug, exam_slug.upper())
    subject = SUBJECT_MAP.get(subject_slug, subject_slug.replace("-", " ").title())
    try:
        year = int(year_str)
    except ValueError:
        return None

    # ── Strategy 1: JSON-LD schema (most reliable) ─────────────────────────────
    question_text = None
    options = {}
    correct_answer = None
    topic = subject

    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
        except (json.JSONDecodeError, AttributeError):
            continue

        schema_type = data.get("@type", "")
        types = schema_type if isinstance(schema_type, list) else [schema_type]

        # ── JSON-LD #0: QAPage — question text + options embedded in .text ──────
        if "QAPage" in types and "mainEntity" in data:
            me = data["mainEntity"]

            # .name is the clean question title
            q_name = me.get("name", "").strip()
            # .text has "Question\nA. Opt1\nB. Opt2\nC. Opt3\nD. Opt4"
            q_text_full = me.get("text", "").strip()

            if q_name and len(q_name) > 10:
                question_text = q_name

            # Parse options from the embedded text block
            if q_text_full and len(options) < 4:
                for line in q_text_full.splitlines():
                    line = line.strip()
                    m = re.match(r'^([A-D])[.)]\s+(.+)$', line)
                    if m:
                        options[m.group(1)] = m.group(2).strip()

            # Correct answer: "The correct answer is (B)." or "(B) India"
            accepted = me.get("acceptedAnswer", {})
            if accepted and not correct_answer:
                ans_text = accepted.get("text", "")
                m = re.search(r'\(([A-D])\)', ans_text)
                if m:
                    correct_answer = m.group(1)

        # ── JSON-LD #1: Quiz/LearningResource — topic from .about ─────────────
        if any(t in types for t in ("Quiz", "LearningResource")):
            about = data.get("about")
            if isinstance(about, dict):
                t = about.get("name", "")
                if t and len(t) > 2:
                    topic = t

    # ── Strategy 2: JavaScript MCQ config (correct answer index fallback) ──────
    if question_text and (not correct_answer or len(options) < 4):
        page_text = str(soup)
        # Pattern: "mcq":{"q-4216":2}  — answer index 0-3
        mcq_match = re.search(r'"mcq"\s*:\s*\{[^}]*"q-\d+"\s*:\s*(\d)\s*\}', page_text)
        if mcq_match and not correct_answer:
            idx = int(mcq_match.group(1))
            correct_answer = INDEX_TO_LETTER.get(idx)

    # ── Strategy 3: HTML text fallback ────────────────────────────────────────
    if not question_text or len(options) < 4 or not correct_answer:
        full_text = soup.get_text(separator="\n")

        if not question_text:
            # Find first substantial line that looks like a question
            for line in full_text.splitlines():
                line = line.strip()
                if len(line) > 20 and not re.match(r'^[A-D][.)]\s', line):
                    question_text = line
                    break

        if len(options) < 4:
            options = {}
            for line in full_text.splitlines():
                line = line.strip()
                m = re.match(r'^([A-D])[.)]\s+(.+)$', line)
                if m and m.group(1) not in options:
                    options[m.group(1)] = m.group(2).strip()

        if not correct_answer:
            m = re.search(r'[Cc]orrect\s+(?:[Aa]nswer)?[:\s]+([A-D])\b', full_text)
            if m:
                correct_answer = m.group(1)

    # ── Validate ───────────────────────────────────────────────────────────────
    if not question_text or len(question_text) < 10:
        log.warning(f"No question text: {url}")
        return None
    if len(options) < 4:
        log.warning(f"Only {len(options)} options at {url}")
        return None
    if not correct_answer:
        log.warning(f"No correct answer at {url}")
        return None

    # ── Build record ───────────────────────────────────────────────────────────
    hash_input = f"{exam_name}_{year}_{question_text[:120]}".lower().strip()
    question_hash = hashlib.sha256(hash_input.encode()).hexdigest()

    return {
        "question_text": question_text,
        "option_a": options.get("A", ""),
        "option_b": options.get("B", ""),
        "option_c": options.get("C", ""),
        "option_d": options.get("D", ""),
        "correct_answer": correct_answer,
        "subject": subject,
        "topic": topic,
        "difficulty": "Medium",
        "question_type": "MCQ",
        "exam_name": exam_name,
        "exam_year": year,
        "source_pdf": url,
        "question_hash": question_hash,
        "is_active": True,
    }


# ── DB insert ──────────────────────────────────────────────────────────────────
def insert_question(supabase: Client, q: dict) -> bool:
    try:
        supabase.table("questions").upsert(q, on_conflict="question_hash").execute()
        return True
    except Exception as e:
        log.error(f"Insert failed [{q['question_hash'][:8]}]: {e}")
        return False


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Scrape examrobot.com questions into Supabase")
    parser.add_argument("--exam", choices=list(EXAM_NAME_MAP.keys()),
                        help="Filter by exam (ias, nda-i, nda-ii, cds-i, cds-ii, capf)")
    parser.add_argument("--year", type=int, help="Filter by year e.g. 2024")
    parser.add_argument("--dry-run", action="store_true",
                        help="Parse but don't insert to DB")
    parser.add_argument("--limit", type=int, default=0,
                        help="Max questions to process (0 = all)")
    parser.add_argument("--test-url", metavar="URL",
                        help="Parse a single URL and print result (for debugging)")
    args = parser.parse_args()

    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    with httpx.Client(headers=headers, follow_redirects=True, timeout=20) as client:

        # ── Single URL test mode ───────────────────────────────────────────────
        if args.test_url:
            log.info(f"Testing URL: {args.test_url}")
            r = client.get(args.test_url)
            if r.status_code != 200:
                log.error(f"HTTP {r.status_code}")
                return
            result = parse_question_page(r.text, args.test_url)
            if result:
                print("\n✅ Parsed successfully:")
                for k, v in result.items():
                    print(f"  {k:20s}: {str(v)[:80]}")
            else:
                print("\n❌ Parse failed — check warnings above")
            return

        # ── Full scrape ────────────────────────────────────────────────────────
        supabase = None if args.dry_run else get_supabase()

        log.info("Step 1: Collecting question URLs from sitemaps...")
        urls = fetch_all_question_urls(client, exam_filter=args.exam, year_filter=args.year)
        total = len(urls)
        log.info(f"Found {total} question URLs")

        if args.limit:
            urls = urls[:args.limit]
            log.info(f"Limited to {args.limit}")

        inserted = skipped = failed = 0

        log.info("Step 2: Scraping questions...")
        for i, url in enumerate(urls, 1):
            try:
                r = client.get(url, timeout=15)
                if r.status_code == 404:
                    skipped += 1
                    continue
                if r.status_code != 200:
                    log.warning(f"HTTP {r.status_code} for {url}")
                    failed += 1
                    continue

                q = parse_question_page(r.text, url)
                if not q:
                    failed += 1
                    continue

                if args.dry_run:
                    log.info(
                        f"[DRY {i}/{len(urls)}] {q['exam_name']} {q['exam_year']} "
                        f"| {q['subject']} | {q['question_text'][:60]}..."
                    )
                    inserted += 1
                else:
                    if insert_question(supabase, q):
                        inserted += 1
                    else:
                        failed += 1

                if i % 100 == 0:
                    pct = i / len(urls) * 100
                    log.info(
                        f"[{i}/{len(urls)} {pct:.0f}%] "
                        f"inserted={inserted} skipped={skipped} failed={failed}"
                    )

                time.sleep(DELAY)

            except httpx.TimeoutException:
                log.warning(f"Timeout: {url} — retrying after {RETRY_DELAY}s")
                time.sleep(RETRY_DELAY)
                failed += 1
            except httpx.HTTPError as e:
                log.error(f"HTTP error {url}: {e}")
                failed += 1
                time.sleep(RETRY_DELAY)
            except Exception as e:
                log.error(f"Unexpected error {url}: {e}")
                failed += 1

    print(f"\n{'='*55}")
    print(f"  DONE")
    print(f"  Inserted : {inserted}")
    print(f"  Skipped  : {skipped}  (404s)")
    print(f"  Failed   : {failed}   (parse/insert errors)")
    print(f"  Total    : {len(urls)}")
    print(f"{'='*55}")


if __name__ == "__main__":
    main()
