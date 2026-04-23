"""
Run: python diagnose.py '/Users/niranjan/Downloads/upsc 2024-2020.pdf'
Shows exactly which question numbers are missing per year and why.
"""
import sys
import re
import fitz
from pathlib import Path
from pipeline import extract_text, parse_questions_local, detect_year_boundaries, _parse_quality

pdf_path = sys.argv[1] if len(sys.argv) > 1 else '/Users/niranjan/Downloads/upsc 2024-2020.pdf'

print(f"\n{'='*60}")
print(f"DIAGNOSTIC: {Path(pdf_path).name}")
print(f"{'='*60}")

# Step 1: Year detection
print("\n1. YEAR BOUNDARY DETECTION")
groups = detect_year_boundaries(pdf_path)
print(f"   Years: {sorted(groups.keys())}")
for yr in sorted(groups.keys()):
    print(f"   {yr}: pages {groups[yr][0]+1}–{groups[yr][-1]+1} ({len(groups[yr])} pages)")

# Step 2: Per-year extraction
import tempfile, os
src = fitz.open(pdf_path)
total_found = 0
total_missing_all = []

for year in sorted(groups.keys()):
    page_indices = groups[year]
    tmp = tempfile.NamedTemporaryFile(suffix=f"_{year}.pdf", delete=False)
    tmp.close()
    year_doc = fitz.open()
    year_doc.insert_pdf(src, from_page=page_indices[0], to_page=page_indices[-1])
    year_doc.save(tmp.name)
    year_doc.close()

    pages = extract_text(tmp.name)
    qs = parse_questions_local(pages)
    os.unlink(tmp.name)

    found_nums = sorted(set(q["question_number"] for q in qs))
    missing = [n for n in range(1, 101) if n not in found_nums]
    quality = _parse_quality(qs)

    total_found += len(found_nums)
    total_missing_all.extend([(year, n) for n in missing])

    print(f"\n2. YEAR {year}")
    print(f"   Found: {len(found_nums)}/100 questions  |  Quality: {quality:.0%}")
    print(f"   Missing ({len(missing)}): {missing if missing else 'NONE ✅'}")

    # Check options completeness
    incomplete = [(q["question_number"], sum(1 for k in ("option_a","option_b","option_c","option_d") if q.get(k)))
                  for q in qs if sum(1 for k in ("option_a","option_b","option_c","option_d") if q.get(k)) < 4]
    if incomplete:
        print(f"   Incomplete options: {incomplete[:10]}{'...' if len(incomplete) > 10 else ''}")

src.close()

print(f"\n{'='*60}")
print(f"SUMMARY: {total_found}/500 questions found  |  {len(total_missing_all)} missing")
print(f"Missing: {total_missing_all}")
print(f"{'='*60}")
