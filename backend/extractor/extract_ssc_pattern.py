import os
import sys
import json
import asyncio
import argparse
from pathlib import Path

# Ensure backend modules can be found
sys.path.append(os.path.join(os.getcwd(), 'backend'))
from dotenv import load_dotenv

# Load env variables
load_dotenv('backend/.env')

from supabase import create_client
import fitz  # PyMuPDF
from tenacity import retry, wait_exponential, stop_after_attempt

from google import genai
from google.genai import types

# Initialize Cloud & DB
client = genai.Client(
    vertexai=True,
    project=os.getenv("GOOGLE_CLOUD_PROJECT"),
    location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1"),
)
VISION_MODEL = "publishers/google/models/gemini-2.5-flash"

safety_settings = {
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
}

vision_model = GenerativeModel("gemini-2.5-flash")
sb = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))
CACHE_FILE = Path("backend/cache/pattern_extraction.json")

# ====================================================================================
# PROMPTS
# ====================================================================================

QUESTION_EXTRACTION_PROMPT = """
You are an expert OCR and reasoning AI operating on an image-based exam PDF page.
Extract all multiple-choice questions visible on this page.

CRITICAL INSTRUCTIONS:
1. This is a Pattern Book. Questions are grouped under sub-headings like "Type 1", "Pattern - 2", "Questions on Successive Discount". 
2. If you see ANY sub-heading before a question, capture it exactly as the `pattern_tag`. Carry this `pattern_tag` forward to all subsequent questions until a new sub-heading appears.
3. Maintain exact question numbering.
4. IMPORTANT: This page has a 2-column layout. Read all questions down the LEFT column first, from top to bottom. Then, read all questions down the RIGHT column, from top to bottom.
5. Do not hallucinate or skip questions. Do not capture watermarks like '@FreemeBhaii'.

Output strictly JSON:
[
  {
    "question_number": int,
    "pattern_tag": "string (sub-heading)",
    "question_text": "string",
    "option_a": "string",
    "option_b": "string",
    "option_c": "string",
    "option_d": "string"
  }
]
"""

ANSWER_KEY_PROMPT = """
You are looking at an Answer Key page for an exam PDF.
Extract all the correct answers mapping the Question Number to the Correct Option Letter (A, B, C, or D).

Format the output strictly as a JSON dictionary:
{
  "1": "A",
  "2": "C"
}
"""

EXPLANATION_GENERATION_PROMPT = """
You are an expert Math reasoning tutor.
I am providing you with a Question, its Options, and its officially Correct Answer.
Generate a pristine, step-by-step mathematical explanation for WHY the correct answer is right.
Do not refer to "the image". Explain directly to the student. Use clean unicode math (x² + y²), avoid complex LaTeX unless needed.

Output strictly as a JSON object:
{
  "explanation": "Your step-by-step clear explanation here."
}
"""

# ====================================================================================
# CACHE UTILS
# ====================================================================================
def load_cache() -> dict:
    if CACHE_FILE.exists():
        return json.loads(CACHE_FILE.read_text())
    return {"all_questions": [], "answer_key_map": {}, "explanations": {}}

def save_cache(cache_data: dict):
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(cache_data, indent=2))

# ====================================================================================
# HELPER FUNCTIONS
# ====================================================================================

@retry(wait=wait_exponential(multiplier=1, max=10), stop=stop_after_attempt(5))
async def _call_vision_json(prompt: str, image_bytes: bytes, mime_type="image/jpeg"):
    image_part = Part.from_data(mime_type=mime_type, data=image_bytes)
    response = await vision_model.generate_content_async(
        [image_part, prompt],
        safety_settings=safety_settings,
        generation_config={"temperature": 0.1, "response_mime_type": "application/json"}
    )
    return json.loads(response.text)

@retry(wait=wait_exponential(multiplier=1, max=10), stop=stop_after_attempt(5))
async def _call_text_json(prompt: str):
    response = await vision_model.generate_content_async(
        prompt,
        safety_settings=safety_settings,
        generation_config={"temperature": 0.1, "response_mime_type": "application/json"}
    )
    return json.loads(response.text)

def render_page_to_jpg(page) -> bytes:
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    return pix.tobytes("jpeg")

async def extract_questions_from_page(page, page_num: int, current_pattern: str) -> dict:
    print(f"  [Q-Extractor] Scanning Page {page_num}...")
    try:
        qs = await _call_vision_json(
            prompt=QUESTION_EXTRACTION_PROMPT + f"\n\nIf you see no pattern heading, use fallback: '{current_pattern}'", 
            image_bytes=render_page_to_jpg(page)
        )
        if qs and len(qs) > 0:
            current_pattern = qs[-1].get("pattern_tag", current_pattern)
        print(f"    -> Extracted {len(qs)} questions.")
        return {"questions": qs, "next_pattern": current_pattern}
    except Exception as e:
        print(f"  [Error Extracting Page {page_num}] {e}")
        return {"questions": [], "next_pattern": current_pattern}

async def extract_answer_key_from_page(page, page_num: int) -> dict:
    print(f"  [Key-Extractor] Scanning Page {page_num}...")
    try:
        keys = await _call_vision_json(prompt=ANSWER_KEY_PROMPT, image_bytes=render_page_to_jpg(page))
        print(f"    -> Extracted {len(keys)} answers.")
        return keys
    except Exception as e:
        print(f"  [Error Extracting Key] {e}")
        return {}

async def generate_explanation(q: dict, correct_answer: str) -> str:
    prompt = f"""{EXPLANATION_GENERATION_PROMPT}

# QUESTION TEXT:
{q.get('question_text')}
A: {q.get('option_a')}
B: {q.get('option_b')}
C: {q.get('option_c')}
D: {q.get('option_d')}

# CORRECT ANSWER:
{correct_answer}
"""
    try:
        res = await _call_text_json(prompt)
        return res.get("explanation", "")
    except:
        return ""

# ====================================================================================
# PIPELINE
# ====================================================================================

async def process_pdf(pdf_path: str, title: str, q_end: int, ans_start: int):
    doc = fitz.open(pdf_path)
    chapter_name = title.split("—")[-1].strip() if "—" in title else title
    
    # 1. UPSERT BOOK
    print("Initialize DB...")
    book_id = sb.table("pattern_books").upsert({
        "title": title, "chapter": chapter_name, "exam_target": "SSC CGL", 
        "source_file": pdf_path, "question_count": 0
    }, on_conflict="title").execute().data[0]['id']
    sb.table("pattern_questions").delete().eq("book_id", book_id).execute()
    
    cache = load_cache()
    
    # 2. EXTRACT QUESTIONS
    print("\n--- PHASE 1: Questions ---")
    if not cache["all_questions"]:
        all_questions = []
        current_pattern = chapter_name
        for i in range(q_end):
            res = await extract_questions_from_page(doc[i], i+1, current_pattern)
            for q in res["questions"]:
                q["source_page"] = i + 1
                all_questions.append(q)
            current_pattern = res["next_pattern"]
        cache["all_questions"] = all_questions
        save_cache(cache)
    else:
        print(f"Loaded {len(cache['all_questions'])} questions from cache.")
        
    all_questions = cache["all_questions"]
    print(f"=> Total Extracted Qs: {len(all_questions)}")
    
    # 3. EXTRACT ANSWER KEY
    print("\n--- PHASE 2: Answer Key ---")
    if not cache["answer_key_map"]:
        answer_key_map = {}
        for i in range(ans_start - 1, min(len(doc), ans_start)):
            keys = await extract_answer_key_from_page(doc[i], i+1)
            answer_key_map.update(keys)
        cache["answer_key_map"] = answer_key_map
        save_cache(cache)
    else:
        print(f"Loaded {len(cache['answer_key_map'])} keys from cache.")
        
    answer_key_map = cache["answer_key_map"]
    print(f"=> Combined Keys: {len(answer_key_map)}")
    
    # 4. EXPLANATION GENERATION & DB PUSH
    print("\n--- PHASE 3: Generators & Sync ---")
    rows = []
    chunk_size = 10
    total = len(all_questions)
    
    # Track which explanations are done
    explanations_cache = cache["explanations"]
    
    for c_idx in range(0, total, chunk_size):
        chunk = all_questions[c_idx:c_idx + chunk_size]
        print(f"  Generating explanations {c_idx+1}-{c_idx+len(chunk)}/{total}...")
        
        tasks = []
        for q in chunk:
            q_num = str(q.get("question_number", ""))
            
            # Use cached solution if exists
            if q_num in explanations_cache:
                async def cached_expl(x): return x
                tasks.append(cached_expl(explanations_cache[q_num]))
            else:
                q_ans = answer_key_map.get(q_num)
                q["correct_answer"] = q_ans
                if q_ans: tasks.append(generate_explanation(q, q_ans))
                else:     tasks.append(asyncio.sleep(0, result=""))
                
        explanations = await asyncio.gather(*tasks)
        
        # Save to cache
        for idx, q in enumerate(chunk):
            q_num = str(q.get("question_number", ""))
            explanations_cache[q_num] = explanations[idx]
        cache["explanations"] = explanations_cache
        save_cache(cache)
        
        for idx, q in enumerate(chunk):
            rows.append({
                "book_id": book_id,
                "question_number": q.get("question_number"),
                "question_text": q.get("question_text", ""),
                "option_a": q.get("option_a", ""), "option_b": q.get("option_b", ""),
                "option_c": q.get("option_c", ""), "option_d": q.get("option_d", ""),
                "correct_answer": answer_key_map.get(str(q.get("question_number", ""))),
                "explanation": explanations[idx],
                "difficulty": "Medium",
                "pattern_tag": q.get("pattern_tag", chapter_name)[:200],
                "source_page": q.get("source_page"),
            })
    
    # PUSH
    for i in range(0, len(rows), 50):
        sb.table("pattern_questions").insert(rows[i:i+50]).execute()
    sb.table("pattern_books").update({"question_count": len(rows)}).eq("id", book_id).execute()
    print(f"\n✅ DONE! {len(rows)} questions synced.")
    
    # Clear cache upon absolute 100% success
    if CACHE_FILE.exists():
        CACHE_FILE.unlink()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=str, required=True)
    parser.add_argument("--title", type=str, required=True)
    parser.add_argument("--q_end", type=int, required=True)
    parser.add_argument("--ans_start", type=int, required=True)
    args = parser.parse_args()
    asyncio.run(process_pdf(args.pdf, args.title, args.q_end, args.ans_start))
