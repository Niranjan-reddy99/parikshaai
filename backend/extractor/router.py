import fitz
from pathlib import Path
import re

class ExamFormat:
    TCSION_CBT = "tcsion_cbt"
    TELEGRAM_CBT = "telegram_cbt"
    APPSC_BOXED = "appsc_boxed"
    PATTERN_BOOK = "pattern_book"
    SCANNED_IMAGE = "scanned_image"
    DIGITAL_MCQ = "digital_mcq"


_FUZZY_FINAL_KEY_RE = re.compile(
    r"f\W*i\W*n\W*a\W*l\W*k\W*e\W*y|"
    r"i\W*n\W*i\W*t\W*i\W*a\W*l\W*k\W*e\W*y|"
    r"f\W*a\W*l\W*k",
    re.IGNORECASE,
)


def _looks_like_boxed_final_key_layout(doc: fitz.Document) -> bool:
    """
    Detect APPSC-style final keys by page geometry, not just OCR text.

    These PDFs usually repeat many medium-width rectangles/rounded boxes around
    answer options on every question page. Regular question papers rarely have
    that many consistent answer boxes.
    """
    pages_to_check = range(min(3, len(doc)), min(8, len(doc)))
    total_boxes = 0
    dense_pages = 0
    for idx in pages_to_check:
        try:
            page = doc[idx]
            page_boxes = 0
            for drawing in page.get_drawings():
                rect = fitz.Rect(drawing.get("rect"))
                if rect.is_empty or rect.is_infinite:
                    continue
                width = rect.width
                height = rect.height
                area = rect.get_area()
                if 60 <= width <= 380 and 14 <= height <= 90 and 1_500 <= area <= 35_000:
                    page_boxes += 1
            total_boxes += page_boxes
            if page_boxes >= 6:
                dense_pages += 1
        except Exception:
            continue
    return dense_pages >= 2 or total_boxes >= 18


def _is_appsc_boxed(pdf_path: str, doc: fitz.Document, source_filename: str | None = None) -> bool:
    """Detect APPSC-style boxed final/initial keys using text + filename + layout."""
    file_name = (source_filename or Path(pdf_path).name).lower()
    filename_hints = any(token in file_name for token in ("finalkey", "initialkey", "final_key", "initial_key"))
    appsc_name_hint = any(token in file_name for token in ("appsc", "fbo", "abo", "group", "screening"))

    text_hints = False
    authority_hint = False
    for i in range(min(6, len(doc))):
        text = doc[i].get_text("text").lower()
        if "andhra pradesh public service commission" in text or "appsc" in text:
            authority_hint = True
        if "final key" in text or "initial key" in text or _FUZZY_FINAL_KEY_RE.search(text):
            text_hints = True

    layout_hint = _looks_like_boxed_final_key_layout(doc)

    if authority_hint and (text_hints or layout_hint):
        return True
    if filename_hints and layout_hint:
        return True
    if filename_hints and appsc_name_hint and text_hints:
        return True
    return False

def _is_tcsion_format(pdf_path: str, doc: fitz.Document) -> bool:
    """Detects TCSiON CAE export format with extreme precision."""
    for i in range(min(10, len(doc))): # High depth for papers with lots of instructions
        text = doc[i].get_text("text")
        text_lower = text.lower()
        # Require both markers or the domain with ID to avoid misrouting regular papers
        if "tcsion cae" in text_lower and "question id" in text_lower:
            return True
        if "tcsion.com" in text_lower and "question id" in text_lower:
            return True
    return False

def _is_telegram_cbt(pdf_path: str, doc: fitz.Document) -> bool:
    """Detects standard CBT format (e.g. TSLPRB, SSC) with green/red answer highlighting."""
    # Look for characteristic green tick marks or text styling
    for i in range(min(2, len(doc))):
        page = doc[i]
        # Check text colors for common "green" correctly answered or "correct option" color
        color_found = False
        blocks = page.get_text("dict").get("blocks", [])
        for b in blocks:
            if b.get("type") == 0:
                for l in b.get("lines", []):
                    for s in l.get("spans", []):
                        color = s.get("color")
                        if color:
                            hex_color = hex(color)
                            # Common green colors in CBT: 0x008000, 0x228B22, etc.
                            if color == 32768 or color == 2263842: # Just an example, we can check a few
                                color_found = True
                                break
        if color_found:
            return True
        # Text-based detection for standard telegram CBT output 
        text = page.get_text("text").lower()
        has_keywords = "chosen option" in text or "status : " in text
        # Must also have a question number pattern like "Q.1" or "1." at beginning of lines
        has_q_pattern = re.search(r'^(Q\s*.\s*\d+|\d+\s*.)', text, re.MULTILINE)
        if has_keywords and has_q_pattern:
            return True
    return False

def _is_scanned(pdf_path: str, doc: fitz.Document) -> bool:
    """Detect if a PDF is a scanned image (very little extractable text)."""
    total_chars = 0
    pages_to_check = min(5, len(doc))
    for i in range(pages_to_check):
        total_chars += len((doc[i].get_text("text") or "").strip())
        
    avg_chars = total_chars / max(1, pages_to_check)
    return avg_chars < 50

def detect_format(pdf_path: str, source_filename: str | None = None) -> str:
    """
    Intelligently determines the format of the exam paper.
    Returns one of the ExamFormat constants.
    """
    doc = fitz.open(pdf_path)
    try:
        if _is_tcsion_format(pdf_path, doc):
            return ExamFormat.TCSION_CBT
        if _is_telegram_cbt(pdf_path, doc):
            return ExamFormat.TELEGRAM_CBT
        if _is_appsc_boxed(pdf_path, doc, source_filename=source_filename):
            return ExamFormat.APPSC_BOXED
        if _is_scanned(pdf_path, doc):
            return ExamFormat.SCANNED_IMAGE
            
        return ExamFormat.DIGITAL_MCQ
    finally:
        doc.close()


def detect_pattern_book_candidate(pdf_path: str) -> bool:
    """Low-blast-radius pattern-book hint used by the dedicated pilot route."""
    try:
        from .pattern_book_classifier import detect_pattern_book_candidate as _detect
    except Exception:
        return False
    return _detect(pdf_path)
