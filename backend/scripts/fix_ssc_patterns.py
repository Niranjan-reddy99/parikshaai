"""
Fix SSC pattern questions:
  1. Solve each question → store correct_answer
  2. Map to canonical concept buckets (not terminology variants)
  3. Rewrite clean explanation WITHOUT stating the answer letter (UI shows it)

Run: python fix_ssc_patterns.py [--dry-run] [--book-id <uuid>]
"""
import os, json, time, argparse, re
from dotenv import load_dotenv
load_dotenv(".env")
from supabase import create_client
from google import genai

BOOK_ID = "ae1e96d2-3b55-41bc-8d3e-3cdac7b0f1f4"
BATCH   = 6
MODEL   = "publishers/google/models/gemini-2.5-flash"

# ── Canonical pattern buckets for a Percentages chapter ──────────────────────
# Keep this small. Gemini MUST pick from this list only.
CANONICAL_PATTERNS = [
    "Basic Percentage Calculation",
    "Percentage Change",
    "Successive Percentage Change",
    "Reverse Percentage Calculation",
    "Income, Expenditure & Savings",
    "Price, Quantity & Expenditure",
    "Population Growth & Depreciation",
    "Election & Voting Problems",
    "Venn Diagram Method",
    "Percentage ↔ Fraction Conversion",
    "Mixture & Alligation",
    "Data & Comparison",
]

PATTERN_LIST = "\n".join(f"- {p}" for p in CANONICAL_PATTERNS)

PROMPT = """You are an expert SSC mathematics teacher. For each question:

1. SOLVE the question and find the correct option (A, B, C, or D).
2. Pick ONE pattern from this FIXED list (do not invent new ones):
{patterns}
3. Write a SHORT explanation (3-5 lines):
   - State the concept/trick in simple English
   - Show the key calculation steps
   - Do NOT write "Answer: X" — the answer is shown separately

Return ONLY valid JSON array:
[{{
  "id": <question_number>,
  "correct_answer": "A|B|C|D",
  "pattern_tag": "<one from the fixed list above>",
  "explanation": "..."
}}]

Questions:
{questions}"""


def fetch_all(sb, book_id):
    rows, offset = [], 0
    while True:
        r = (sb.table("pattern_questions")
               .select("id,question_number,question_text,option_a,option_b,option_c,option_d,correct_answer,pattern_tag")
               .eq("book_id", book_id)
               .order("question_number")
               .range(offset, offset + 999)
               .execute())
        rows.extend(r.data)
        if len(r.data) < 1000:
            break
        offset += 1000
    return rows


def call_gemini(client, questions_text):
    prompt = PROMPT.format(patterns=PATTERN_LIST, questions=questions_text)
    resp = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config={"temperature": 0.1, "max_output_tokens": 8192, "response_mime_type": "application/json"},
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
        # Partial recovery
        results = []
        for obj in re.findall(r'\{[^{}]*"correct_answer"[^{}]*\}', raw, re.DOTALL):
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

    questions = fetch_all(sb, args.book_id)
    print(f"Loaded {len(questions)} questions")

    updated = failed = 0
    tag_counts: dict[str, int] = {}

    for i in range(0, len(questions), BATCH):
        batch = questions[i: i + BATCH]
        batch_text = "\n\n".join(
            f"[{q['question_number']}]\n{q['question_text']}\n"
            f"A) {q['option_a']}\nB) {q['option_b']}\nC) {q['option_c']}\nD) {q['option_d']}"
            for q in batch
        )

        try:
            results = call_gemini(client, batch_text)
        except Exception as e:
            print(f"  [Batch {i//BATCH+1}] Gemini error: {e}")
            failed += len(batch)
            time.sleep(3)
            continue

        num_to_id = {q["question_number"]: q["id"] for q in batch}

        for res in results:
            qnum     = res.get("id")
            answer   = (res.get("correct_answer") or "").strip().upper()
            pattern  = (res.get("pattern_tag") or "").strip()
            expl     = (res.get("explanation") or "").strip()

            # Validate answer is A/B/C/D
            if answer not in {"A","B","C","D"}:
                continue
            # Validate pattern is from canonical list
            if pattern not in CANONICAL_PATTERNS:
                # Fuzzy fallback — pick closest
                pattern = next((p for p in CANONICAL_PATTERNS if p.lower() in pattern.lower()), "Basic Percentage Calculation")

            if qnum not in num_to_id:
                continue

            tag_counts[pattern] = tag_counts.get(pattern, 0) + 1

            if args.dry_run:
                q_text = next(q['question_text'] for q in batch if q['question_number'] == qnum)
                print(f"\n  q{qnum} [{pattern}] → {answer}")
                print(f"  Q: {q_text[:80]}")
                print(f"  E: {expl[:160]}")
                updated += 1
            else:
                try:
                    sb.table("pattern_questions").update({
                        "correct_answer": answer,
                        "pattern_tag":    pattern,
                        "explanation":    expl,
                    }).eq("id", num_to_id[qnum]).execute()
                    updated += 1
                except Exception as e:
                    print(f"  DB error q{qnum}: {e}")
                    failed += 1

        print(f"  Batch {i//BATCH+1}/{-(-len(questions)//BATCH)}: {len(results)} done")
        time.sleep(0.5)

    print(f"\n{'='*60}")
    print(f"Updated: {updated} | Failed: {failed}")
    print(f"\nPattern distribution ({len(tag_counts)} buckets):")
    for tag, count in sorted(tag_counts.items(), key=lambda x: -x[1]):
        print(f"  [{count:3}] {tag}")


if __name__ == "__main__":
    main()
