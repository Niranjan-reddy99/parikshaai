"""
extract_text_from_pdf.py — Extract English text from UPSC PDF for manual review

This extracts raw text from each year's pages, filters out Hindi/Devanagari,
and saves clean text files that you can review/edit before importing.

The output files go to: backend/extracted_text/UPSC_Prelims_{year}.txt

After reviewing, run: python ingest_text.py

Cost: ₹0 (pure local extraction)
"""
import sys, os, re, tempfile, hashlib, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import fitz
from pipeline import detect_year_boundaries

PDF_PATH = "/Users/niranjan/Downloads/upsc 2024-2020.pdf"
YEARS = [2020, 2021, 2022, 2023, 2024]
OUT_DIR = Path("./extracted_text")
OUT_DIR.mkdir(exist_ok=True)

# Hindi/Devanagari Unicode range
_DEVANAGARI = re.compile(r'[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F]+')
# Common PDF noise
_NOISE_PATTERNS = [
    re.compile(r'\bP\.?T\.?O\.?\b', re.IGNORECASE),
    re.compile(r'\bM\s*A\s*S\s*T\s*E\s*R\s*\s*C\s*O\s*P\s*Y\b', re.IGNORECASE),
    re.compile(r'Page\s+\d+\s+of\s+\d+', re.IGNORECASE),
    re.compile(r'\bET\s*(?:X\s*)?\d+(?:\s*[A-Z])?\b'),
    re.compile(r'www\.\S+'),
    re.compile(r'Space\s+for\s+Rough\s+Work', re.IGNORECASE),
]

INSTRUCTION_PHRASES = [
    'hall ticket', 'invigilator', 'answer sheet', 'question paper',
    'do not open', 'rough work', 'time allowed', 'maximum marks',
    'general instructions', 'read the following', 'booklet',
    'admit card', 'roll number', 'signature of', 'do not write',
]


def is_instruction_page(text: str) -> bool:
    t = text.lower()
    return sum(1 for p in INSTRUCTION_PHRASES if p in t) >= 3


def clean_text(text: str) -> str:
    """Remove Hindi, watermarks, noise from extracted text."""
    # Remove Devanagari characters
    text = _DEVANAGARI.sub('', text)
    # Remove noise patterns
    for pat in _NOISE_PATTERNS:
        text = pat.sub('', text)
    # Clean up whitespace
    text = re.sub(r'[ \t]{3,}', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    # Remove lines that are just whitespace/punctuation
    lines = []
    for line in text.split('\n'):
        stripped = line.strip()
        if not stripped:
            lines.append('')
            continue
        # Keep line only if it has at least 2 ASCII alpha chars
        alpha = sum(1 for c in stripped if c.isalpha() and c.isascii())
        if alpha >= 2:
            lines.append(line.rstrip())
    text = '\n'.join(lines)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


print(f"\n{'='*60}")
print(f"  EXTRACTING TEXT FROM UPSC PDF (₹0)")
print(f"{'='*60}\n")

# Detect year boundaries
groups = detect_year_boundaries(PDF_PATH)
src_doc = fitz.open(PDF_PATH)

for year in sorted(groups.keys()):
    if year not in YEARS:
        continue
    
    page_indices = groups[year]
    print(f"\n  📅 {year} — {len(page_indices)} pages")
    
    all_text = []
    skipped_pages = 0
    
    for pi in page_indices:
        page = src_doc[pi]
        raw = page.get_text("text")
        
        if not raw or len(raw.strip()) < 30:
            skipped_pages += 1
            continue
        
        cleaned = clean_text(raw)
        
        if not cleaned or len(cleaned) < 30:
            skipped_pages += 1
            continue
        
        if is_instruction_page(cleaned):
            skipped_pages += 1
            continue
        
        # Check if it's a "rough work" only page
        if len(cleaned) < 200 and re.search(r'rough\s+work', cleaned, re.IGNORECASE):
            skipped_pages += 1
            continue
        
        all_text.append(f"--- PAGE {pi + 1} ---\n{cleaned}")
    
    full_text = '\n\n'.join(all_text)
    
    # Save to file
    out_path = OUT_DIR / f"UPSC_Prelims_{year}.txt"
    out_path.write_text(full_text, encoding='utf-8')
    
    # Count approximate question patterns
    q_pattern = re.compile(r'(?:^|\n)\s*(\d{1,3})\s*[.)]\s+', re.MULTILINE)
    q_nums = sorted(set(int(m.group(1)) for m in q_pattern.finditer(full_text) if 1 <= int(m.group(1)) <= 100))
    
    print(f"     Saved: {out_path}")
    print(f"     Text length: {len(full_text)} chars, skipped {skipped_pages} pages")
    print(f"     Question numbers found: {len(q_nums)}/100")
    if len(q_nums) < 100:
        missing = [n for n in range(1, 101) if n not in q_nums]
        print(f"     Missing: {missing[:20]}{'...' if len(missing) > 20 else ''}")

src_doc.close()

print(f"\n{'='*60}")
print(f"  ✅ Text files saved to: {OUT_DIR.absolute()}")
print(f"\n  NEXT STEPS:")
print(f"  1. Open the .txt files and review/fix any messy questions")
print(f"  2. OR: Copy-paste clean text from a website with UPSC PYQ")
print(f"  3. Run: python ingest_text.py")
print(f"{'='*60}\n")
