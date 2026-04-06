import asyncio
from backend.main import supabase

async def main():
    q = supabase.table("questions").select("*").limit(1).execute()
    print("Q:", q.data)
    if q.data:
        qid = q.data[0]["id"]
        res = supabase.table("questions").delete().eq("id", qid).execute()
        print("DEL:", res.data)
        
        # restore
        supabase.table("questions").insert([q.data[0]]).execute()

asyncio.run(main())
