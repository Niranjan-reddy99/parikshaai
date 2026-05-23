"""
Targeted repair for CAPF 2024 Q28, Q45, Q56, Q93 — extract missing options via Gemini Vision.
Uses wider page ranges (±5 pages) and larger image renders (300 DPI).
"""
import base64, json, os, sys, re
import fitz
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold
from config import supabase

COMPRESSED_PDF = "/Users/niranjan/Downloads/QP_CAPF_2024_GEN-ABILITY-AND-INTELLI_05082024 (1)_compressed.pdf"
EXAM_NAME = "UPSC CAPF GS"
EXAM_YEAR = 2024
TARGET_QS = [28, 45, 56, 93]

# ── Gemini setup ─────────────────────────────────────────────────────────────
import vertexai
from vertexai.generative_models import GenerativeModel, Part, Image as VertexImage, SafetySetting
PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "")
LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
vertexai.init(project=PROJECT, location=LOCATION)
model = GenerativeModel("publishers/google/models/gemini-2.5-flash")
SAFETY = [
    SafetySetting(category=c, threshold=SafetySetting.HarmBlockThreshold.BLOCK_NONE)
    for c in [
        SafetySetting.HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        SafetySetting.HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        SafetySetting.HarmCategory.HARM_CATEGORY_HARASSMENT,
        SafetySetting.HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    ]
]

def page_to_image_bytes(doc, page_idx: int, dpi: int = 300) -> bytes:
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = doc[page_idx].get_pixmap(matrix=mat, colorspace=fitz.csGRAY)
    return pix.tobytes("png")

def vision_extract_question(doc, page_indices: list[int], q_num: int) -> dict | None:
    """Run Gemini Vision on given pages to find Q{q_num} and extract its options."""
    parts = []
    for idx in page_indices:
        img_bytes = page_to_image_bytes(doc, idx, dpi=300)
        parts.append(Part.from_image(VertexImage.from_bytes(img_bytes)))

    prompt = f"""These are pages from a UPSC CAPF 2024 exam question paper (scanned image).

Find question number {q_num} on these pages. Extract it completely.

Return ONLY a JSON object with this exact schema:
{{
  "question_number": {q_num},
  "question_text": "full question text here",
  "option_a": "text of option A",
  "option_b": "text of option B",
  "option_c": "text of option C",
  "option_d": "text of option D"
}}

Rules:
- If question {q_num} is not found on these pages, return {{"question_number": {q_num}, "found": false}}
- Options may be labelled (a), (b), (c), (d) or A., B., C., D. — normalize to A/B/C/D
- Include complete text, do not truncate
- Return ONLY the JSON, no other text"""

    parts.append(prompt)
    resp = model.generate_content(parts, safety_settings=SAFETY)
    raw = resp.text.strip()
    # Strip markdown fences
    raw = re.sub(r'^```(?:json)?\s*', '', raw).rstrip('`').strip()
    try:
        data = json.loads(raw)
        if data.get("found") is False:
            return None
        if all(data.get(k) for k in ["option_a", "option_b", "option_c", "option_d"]):
            return data
        return None
    except Exception as e:
        print(f"    Parse error for Q{q_num}: {e} | raw={raw[:100]}")
        return None

def update_db(q_num: int, data: dict) -> bool:
    rows = supabase.table("questions").select("id").eq("exam_name", EXAM_NAME).eq("exam_year", EXAM_YEAR).eq("question_number", q_num).execute()
    if not rows.data:
        print(f"  Q{q_num}: not found in DB")
        return False

    row_id = rows.data[0]["id"]
    payload = {
        "option_a": data["option_a"],
        "option_b": data["option_b"],
        "option_c": data["option_c"],
        "option_d": data["option_d"],
        "structural_status": "ok",
        "needs_review": False,
    }
    # Fix question_text if provided and significantly longer
    if data.get("question_text") and len(data["question_text"]) > 20:
        payload["question_text"] = data["question_text"]

    # Remove incomplete-options and answer-option-missing from issue_codes
    existing = supabase.table("questions").select("issue_codes").eq("id", row_id).execute()
    old_issues = existing.data[0].get("issue_codes") or []
    new_issues = [i for i in old_issues if i not in {"incomplete-options", "answer-option-missing"}]
    payload["issue_codes"] = new_issues
    if not new_issues:
        payload["primary_issue_code"] = None

    supabase.table("questions").update(payload).eq("id", row_id).execute()
    print(f"  Q{q_num}: ✅ updated DB")
    return True

def main():
    doc = fitz.open(COMPRESSED_PDF)
    total_pages = doc.page_count
    print(f"PDF: {total_pages} pages")
    # 125 questions across ~52 content pages (pages 3-54 are content, 0-indexed 2-53)
    # Proportional: page_est = round((q_num - 1) / 124 * 51) + 2
    content_start = 2  # 0-indexed
    content_end = 53   # 0-indexed (inclusive)
    content_pages = content_end - content_start + 1  # 52

    repaired = []
    still_broken = []

    for q_num in TARGET_QS:
        est_offset = round((q_num - 1) / 124 * (content_pages - 1))
        est_page = content_start + est_offset
        # Try a ±5 page window
        candidates = list(range(max(0, est_page - 5), min(total_pages, est_page + 6)))
        print(f"\nQ{q_num}: est_page={est_page+1}, trying pages {[p+1 for p in candidates]}")

        # Try in two passes: center window first, then wider
        for window_size in [5, 11]:
            center = est_page
            pages_to_try = list(range(max(0, center - window_size//2), min(total_pages, center + window_size//2 + 1)))
            # Deduplicate
            pages_to_try = sorted(set(pages_to_try))

            # Send 3 pages at a time to avoid token limits
            found = False
            for start in range(0, len(pages_to_try), 3):
                chunk = pages_to_try[start:start+3]
                print(f"  Trying pages {[p+1 for p in chunk]}...")
                result = vision_extract_question(doc, chunk, q_num)
                if result:
                    print(f"  Q{q_num}: found on pages {[p+1 for p in chunk]}")
                    print(f"    A: {result['option_a'][:60]}")
                    print(f"    B: {result['option_b'][:60]}")
                    print(f"    C: {result['option_c'][:60]}")
                    print(f"    D: {result['option_d'][:60]}")
                    if update_db(q_num, result):
                        repaired.append(q_num)
                    found = True
                    break
            if found:
                break
        else:
            print(f"  Q{q_num}: ❌ could not extract after all attempts")
            still_broken.append(q_num)

    print(f"\n{'='*50}")
    print(f"Repaired: {repaired}")
    print(f"Still broken: {still_broken}")

    # Run quality recompute for repaired questions
    if repaired:
        try:
            from row_quality import recompute_quality_for_exam
            recompute_quality_for_exam(EXAM_NAME, EXAM_YEAR)
            print("Quality recomputed for exam")
        except Exception as e:
            print(f"Quality recompute failed (non-critical): {e}")

if __name__ == "__main__":
    main()
