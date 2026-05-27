from supabase import create_client
import os
import asyncio
from dotenv import load_dotenv

load_dotenv()

async def main():
    try:
        from config import supabase
        res = supabase.table("jobs").select("*").ilike("exam_name", "%tspsc aee%").execute()
        for j in res.data:
            print(f"Job: {j['exam_name']} {j['exam_year']}, paper_id: {j.get('paper_id')}")
    except Exception as e:
        import traceback
        traceback.print_exc()

asyncio.run(main())
