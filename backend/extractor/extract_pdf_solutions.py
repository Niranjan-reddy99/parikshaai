import os
import sys
import re
import fitz
from dotenv import load_dotenv
from supabase import create_client

# Ensure backend modules can be found
sys.path.append(os.path.join(os.getcwd(), 'backend'))
load_dotenv('backend/.env')

sb = create_client(os.getenv('SUPABASE_URL'), os.getenv('SUPABASE_SERVICE_KEY'))
pdf_path = '/Users/niranjan/Downloads/SSC_CGL PERCENTAGES.pdf'

def clean_text(text: str) -> str:
    # Remove watermarks and noise
    text = re.sub(r'@FreemeBhaii|TG @Exams_Pdfss|Telegram @FreemeBhaii|TG @SSC_Pinnaclee|FREE PDF HALL|CLICK HERE FREE PDF HALL', '', text)
    return text.strip()

def extract_pdf_solutions():
    doc = fitz.open(pdf_path)
    # Solutions start from Page 19 (index 18)
    full_text = ""
    for i in range(18, len(doc)):
        full_text += doc[i].get_text() + "\n"
    
    # Simple regex to find "Sol.1", "1. (Ans)", "1. ", etc.
    # The SSC Pinnaclee format usually has "1. (b) Explanation text..." or just "1. ..."
    # We want to find chunks starting with a number and ending before the next number
    
    solutions = {}
    # Look for patterns like "1. (a)" or "1. Explanation"
    # This regex looks for digits at start of line or after double newline
    chunks = re.split(r'\n(?=\d+\.)', full_text)
    
    for chunk in chunks:
        match = re.match(r'^\s*(\d+)\.\s*(.*)', chunk, re.DOTALL)
        if match:
            q_num = match.group(1)
            sol_content = clean_text(match.group(2))
            # Limit length to keep it concise as requested
            if len(sol_content) > 500:
                sol_content = sol_content[:500] + "..."
            solutions[q_num] = sol_content

    return solutions

def sync_solutions():
    print("Extracting solutions from PDF (Page 19+)...")
    pdf_sols = extract_pdf_solutions()
    print(f"Found {len(pdf_sols)} solutions in PDF text.")

    print("Fetching questions from DB...")
    res = sb.table("pattern_questions").select("id, question_number").execute()
    questions = res.data
    
    count = 0
    for q in questions:
        q_num = str(q['question_number'])
        if q_num in pdf_sols:
            sb.table("pattern_questions").update({"explanation": pdf_sols[q_num]}).eq("id", q['id']).execute()
            count += 1
    
    print(f"✅ Successfully synced {count} PDF solutions to DB.")

if __name__ == "__main__":
    sync_solutions()
