import sys
import os
from pathlib import Path

# Add backend dir to path so we can import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from extractor.answer_key_parser import parse_answer_key_multiset
from pipeline import inject_answers

def main():
    if len(sys.argv) < 4:
        print("Usage: python apply_key.py <exam_name> <exam_year> <path_to_key_pdf> [series]")
        sys.exit(1)

    exam_name = sys.argv[1]
    exam_year = int(sys.argv[2])
    key_pdf = sys.argv[3]
    series = sys.argv[4] if len(sys.argv) > 4 else "A"

    print(f"Parsing answer key from {key_pdf} for Series {series}...")
    
    # Try parsing the multiset key
    multi_key = parse_answer_key_multiset(key_pdf, expected_count=150)
    
    target_series = series.strip().upper()
    if target_series in multi_key:
        answer_key_map = multi_key[target_series]
        print(f"Found {len(answer_key_map)} answers for Series {target_series}.")
    else:
        answer_key_map = multi_key.get("A", {})
        print(f"Series {target_series} not found. Falling back. Found {len(answer_key_map)} answers.")

    if not answer_key_map:
        print("Failed to extract any answers from the key.")
        sys.exit(1)

    print(f"Injecting answers into {exam_name} {exam_year}...")
    inject_answers(answer_key_map, exam_name, exam_year)
    print("Done!")

if __name__ == "__main__":
    main()
