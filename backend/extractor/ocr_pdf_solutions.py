import os
import sys
import json
import asyncio
import fitz
from dotenv import load_dotenv
from supabase import create_client
import google.generativeai as genai

# Ensure backend modules can be found
sys.path.append(os.path.join(os.getcwd(), 'backend'))
load_dotenv('backend/.env')

# Use AI Studio with the provided GEMINI_API_KEY
# This usually has a free tier that works without Vertex AI billing
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel("gemini-1.5-flash")
sb = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))

pdf_path = '/Users/niranjan/Downloads/SSC_CGL PERCENTAGES.pdf'

OCR_SOLUTIONS_PROMPT = """
Analyze this image of an exam solution page. 
Extract all mathematical solutions. 
Format each solution to be VERY CONCISE (only the core math steps).

Output strictly as a JSON object where keys are Question Numbers:
{
  "1": "Step 1: x=10. Step 2: y=20. Final: 30",
  "2": "..."
}
"""

async def ocr_solution_page(doc, page_idx):
    page = doc[page_idx]
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    img_bytes = pix.tobytes("jpeg")
    
    # Using the newer genai library format
    try:
        response = await model.generate_content_async(
            [OCR_SOLUTIONS_PROMPT, {"mime_type": "image/jpeg", "data": img_bytes}],
            generation_config={"response_mime_type": "application/json"}
        )
        return json.loads(response.text)
    except Exception as e:
        print(f"Error on page {page_idx+1}: {e}")
        return {}

async def sync_all_solutions():
    doc = fitz.open(pdf_path)
    print(f"Processing solution pages (19 to {len(doc)})...")
    
    all_sols = {}
    # Process in chunks of 5 pages to avoid massive payloads
    for i in range(18, len(doc), 3):
        print(f"  Scanning pages {i+1}-{min(i+3, len(doc))}...")
        tasks = [ocr_solution_page(doc, j) for j in range(i, min(i+3, len(doc)))]
        results = await asyncio.gather(*tasks)
        for r in results:
            all_sols.update(r)
            
    print(f"Total solutions extracted: {len(all_sols)}")
    
    # Update DB
    print("Updating questions in DB...")
    res = sb.table("pattern_questions").select("id, question_number").execute()
    count = 0
    for q in res.data:
        q_num = str(q['question_number'])
        if q_num in all_sols:
            sb.table("pattern_questions").update({"explanation": all_sols[q_num]}).eq("id", q['id']).execute()
            count += 1
            
    print(f"✅ Successfully synced {count} concise solutions from PDF.")

if __name__ == "__main__":
    asyncio.run(sync_all_solutions())
