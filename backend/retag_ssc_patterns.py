"""
Retag SSC pattern_questions using Gemini.
Each question gets a proper solving-technique pattern_tag + difficulty.
Run: python retag_ssc_patterns.py [--dry-run] [--book-id <uuid>]
"""
import os, json, time, argparse
from dotenv import load_dotenv
load_dotenv(".env")

from supabase import create_client
from google import genai

BOOK_ID = "ae1e96d2-3b55-41bc-8d3e-3cdac7b0f1f4"
BATCH   = 15
MODEL   = "publishers/google/models/gemini-2.5-flash"

PROMPT_TEMPLATE = """You are an expert SSC/competitive exam mathematics teacher specialising in Quantitative Aptitude.

For each question identify:
1. pattern_tag  — the specific solving technique/question-type (NOT the chapter name).
   Use short, reusable labels like:
   "Successive Percentage", "Percentage ↔ Fraction Conversion", "Venn Diagram Method",
   "Ratio & Proportion Method", "Population Growth / Depreciation",
   "Income & Expenditure", "Election / Voting Problems",
   "Profit Loss & Discount", "Data Sufficiency", "Mixture & Alligation",
   "Percentage Change", "Two-Variable System", "Reverse Calculation",
   "Direct Percentage Calculation", "Comparative Percentage"
   — or invent a precise label if none fits. NEVER return "Chapter" or "Percentage" alone.

2. difficulty   — Easy (1-step, direct formula) | Medium (2-3 steps, slight trick) | Hard (multi-concept, trap)

Return ONLY a valid JSON array — no markdown, no explanation:
[{{"id": <question_number>, "pattern_tag": "...", "difficulty": "Easy|Medium|Hard"}}]

Questions:
{questions}"""


def fetch_questions(sb, book_id: str):
    rows = []
    offset = 0
    while True:
        r = sb.table("pattern_questions") \
              .select("id,question_number,question_text,option_a,option_b,option_c,option_d,correct_answer") \
              .eq("book_id", book_id) \
              .order("question_number") \
              .range(offset, offset + 999) \
              .execute()
        rows.extend(r.data)
        if len(r.data) < 1000:
            break
        offset += 1000
    return rows


def call_gemini(client: genai.Client, questions_text: str) -> list[dict]:
    prompt = PROMPT_TEMPLATE.format(questions=questions_text)
    resp = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config={
            "temperature": 0.1,
            "max_output_tokens": 8192,
            "response_mime_type": "application/json",
        },
    )
    raw = resp.text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Partial output — extract all complete objects with regex
        import re
        objects = re.findall(r'\{\s*"id"\s*:\s*\d+.*?"difficulty"\s*:\s*"[^"]+"\s*\}', raw, re.DOTALL)
        results = []
        for obj in objects:
            try:
                results.append(json.loads(obj))
            except Exception:
                pass
        if results:
            return results
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--book-id", default=BOOK_ID)
    args = parser.parse_args()

    sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))
    client = genai.Client(
        vertexai=True,
        project=os.getenv("GOOGLE_CLOUD_PROJECT"),
        location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
    )

    print(f"Fetching questions for book {args.book_id}...")
    questions = fetch_questions(sb, args.book_id)
    print(f"Loaded {len(questions)} questions")

    updated = 0
    failed  = 0
    tag_counts: dict[str, int] = {}

    for i in range(0, len(questions), BATCH):
        batch = questions[i: i + BATCH]
        batch_text = "\n\n".join(
            f"[{q['question_number']}] {q['question_text']}\n"
            f"A) {q['option_a']}  B) {q['option_b']}  C) {q['option_c']}  D) {q['option_d']}"
            for q in batch
        )

        try:
            results = call_gemini(client, batch_text)
        except Exception as e:
            print(f"  [BATCH {i}–{i+BATCH}] Gemini error: {e}")
            failed += len(batch)
            time.sleep(2)
            continue

        # Map question_number → row id
        num_to_id = {q["question_number"]: q["id"] for q in batch}

        for res in results:
            qnum = res.get("id")
            tag  = (res.get("pattern_tag") or "").strip()
            diff = (res.get("difficulty") or "Medium").strip()

            if not tag or qnum not in num_to_id:
                continue

            tag_counts[tag] = tag_counts.get(tag, 0) + 1

            if not args.dry_run:
                try:
                    sb.table("pattern_questions") \
                      .update({"pattern_tag": tag, "difficulty": diff}) \
                      .eq("id", num_to_id[qnum]) \
                      .execute()
                    updated += 1
                except Exception as e:
                    print(f"  DB update failed for q{qnum}: {e}")
                    failed += 1
            else:
                print(f"  [DRY] q{qnum}: {tag} | {diff}")
                updated += 1

        print(f"  Batch {i//BATCH + 1}/{-(-len(questions)//BATCH)}: {len(results)} tagged")
        time.sleep(0.5)  # rate limit courtesy

    print(f"\n{'='*60}")
    print(f"Updated: {updated} | Failed: {failed}")
    print(f"\nPattern tag distribution ({len(tag_counts)} unique tags):")
    for tag, count in sorted(tag_counts.items(), key=lambda x: -x[1]):
        print(f"  [{count:3}] {tag}")


if __name__ == "__main__":
    main()
