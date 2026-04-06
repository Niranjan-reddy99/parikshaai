from dotenv import load_dotenv
load_dotenv()
from main import supabase

print("Inserting test for update...")
new_q = {
    "exam_name": "TEST",
    "exam_year": 2024,
    "question_number": 999,
    "question_text": "To Be Updated",
    "question_hash": "test_hash2"
}
res = supabase.table("questions").insert([new_q]).execute()
qid = res.data[0]["id"]
print("Inserted ID:", qid)

up_res = supabase.table("questions").update({"question_text": "Updated!"}).eq("id", qid).execute()
print("Update returned:", up_res.data)

supabase.table("questions").delete().eq("id", qid).execute()
