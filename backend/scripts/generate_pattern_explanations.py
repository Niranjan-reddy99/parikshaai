"""
Generate clean, simple explanations for pattern_questions using Gemini.
Run: python generate_pattern_explanations.py [--book-id <uuid>] [--dry-run]
"""
import os, json, time, argparse, re
from dotenv import load_dotenv
load_dotenv(".env")

from supabase import create_client
from google import genai

BOOK_ID = "ae1e96d2-3b55-41bc-8d3e-3cdac7b0f1f4"
BATCH   = 8
MODEL   = "publishers/google/models/gemini-2.5-flash"

PROMPT = """You are a friendly math teacher explaining SSC exam questions to a student preparing for competitive exams.

For each question write a SHORT, CLEAR explanation:
- 3 to 5 lines maximum
- Use simple English — no jargon
- Show the key calculation step(s)
- State the trick or shortcut if there is one
- End with "Answer: (option letter)"

Return ONLY a valid JSON array:
[{{"id": <question_number>, "explanation": "..."}}]

Questions:
{questions}"""


def fetch_unanswered(sb, book_id: str) -> list[dict]:
    rows = []
    offset = 0
    while True:
        r = (sb.table("pattern_questions")
               .select("id,question_number,question_text,option_a,option_b,option_c,option_d,correct_answer,pattern_tag")
               .eq("book_id", book_id)
               .is_("explanation", "null")
               .order("question_number")
               .range(offset, offset + 999)
               .execute())
        rows.extend(r.data)
        if len(r.data) < 1000:
            break
        offset += 1000
    return rows


def call_gemini(client, questions_text: str) -> list[dict]:
    prompt = PROMPT.format(questions=questions_text)
    resp = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config={
            "temperature": 0.2,
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
        objects = re.findall(
            r'\{\s*"id"\s*:\s*\d+.*?"explanation"\s*:\s*"(?:[^"\\]|\\.)*"\s*\}',
            raw, re.DOTALL
        )
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

    questions = fetch_unanswered(sb, args.book_id)
    print(f"Questions needing explanations: {len(questions)}")
    if not questions:
        print("All explanations already generated.")
        return

    updated = failed = 0

    for i in range(0, len(questions), BATCH):
        batch = questions[i: i + BATCH]
        batch_text = "\n\n".join(
            f"[{q['question_number']}] {q['question_text']}\n"
            f"A) {q['option_a']}\nB) {q['option_b']}\nC) {q['option_c']}\nD) {q['option_d']}\n"
            f"Correct: {q['correct_answer']}  |  Pattern: {q['pattern_tag']}"
            for q in batch
        )

        try:
            results = call_gemini(client, batch_text)
        except Exception as e:
            print(f"  [BATCH {i//BATCH+1}] Gemini error: {e}")
            failed += len(batch)
            time.sleep(3)
            continue

        num_to_id = {q["question_number"]: q["id"] for q in batch}

        for res in results:
            qnum = res.get("id")
            expl = (res.get("explanation") or "").strip()
            if not expl or qnum not in num_to_id:
                continue
            if args.dry_run:
                print(f"\n  q{qnum} [{[q for q in batch if q['question_number']==qnum][0]['pattern_tag'][:40]}]")
                print(f"  {expl[:200]}")
                updated += 1
            else:
                try:
                    sb.table("pattern_questions").update({"explanation": expl}).eq("id", num_to_id[qnum]).execute()
                    updated += 1
                except Exception as e:
                    print(f"  DB error q{qnum}: {e}")
                    failed += 1

        print(f"  Batch {i//BATCH+1}/{-(-len(questions)//BATCH)}: {len(results)} done")
        time.sleep(0.5)

    print(f"\nUpdated: {updated} | Failed: {failed}")


if __name__ == "__main__":
    main()
