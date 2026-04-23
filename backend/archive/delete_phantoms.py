import sys
sys.path.insert(0, '/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend')
from config import supabase

# Delete only the 9 fake English idiom questions (Q#151-159)
# These do NOT exist in the actual paper (paper has exactly 150 questions)
r = supabase.table('questions').delete() \
    .eq('exam_name', 'TSPSC GROUP 3 PAPER 1') \
    .eq('exam_year', 2023) \
    .gt('question_number', 150) \
    .execute()

print(f'Deleted: {len(r.data)} rows')

verify = supabase.table('questions') \
    .select('id', count='exact') \
    .eq('exam_name', 'TSPSC GROUP 3 PAPER 1') \
    .eq('exam_year', 2023) \
    .execute()
print(f'Remaining: {verify.count}')
