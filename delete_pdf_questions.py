"""
Delete all questions from a specific source PDF.
"""
import os
import sys
from dotenv import load_dotenv
from supabase import create_client

load_dotenv("backend/.env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# First, find the exact source_pdf value stored in DB
print("Looking for TSPSC GROUP 1 2024 questions in DB...\n")
result = supabase.table("questions").select("source_pdf").ilike("source_pdf", "%TSPSC%GROUP%1%2024%").execute()

if not result.data:
    # Try broader search
    result = supabase.table("questions").select("source_pdf").ilike("source_pdf", "%TSPSC%").execute()

if not result.data:
    print("No questions found matching TSPSC GROUP 1 2024.")
    print("\nAll distinct source_pdfs in DB:")
    all_pdfs = supabase.table("questions").select("source_pdf").execute()
    unique = sorted(set(r["source_pdf"] for r in all_pdfs.data if r.get("source_pdf")))
    for p in unique:
        print(f"  - {p}")
    sys.exit(0)

unique_pdfs = sorted(set(r["source_pdf"] for r in result.data if r.get("source_pdf")))
print(f"Found {len(result.data)} questions across these source_pdf values:")
for p in unique_pdfs:
    count = sum(1 for r in result.data if r.get("source_pdf") == p)
    print(f"  - {p!r}  ({count} questions)")

print()
confirm = input("Delete ALL of these questions? (yes/no): ").strip().lower()
if confirm != "yes":
    print("Aborted.")
    sys.exit(0)

total_deleted = 0
for pdf_name in unique_pdfs:
    del_result = supabase.table("questions").delete().eq("source_pdf", pdf_name).execute()
    count = len(del_result.data) if del_result.data else 0
    print(f"Deleted {count} questions from {pdf_name!r}")
    total_deleted += count

print(f"\nDone. Total deleted: {total_deleted}")
