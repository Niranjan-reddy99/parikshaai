import fitz
import re

class ExamFormat:
    TCSION_CBT = "tcsion_cbt"
    TELEGRAM_CBT = "telegram_cbt"
    APPSC_BOXED = "appsc_boxed"
    PATTERN_BOOK = "pattern_book"
    SCANNED_IMAGE = "scanned_image"
    DIGITAL_MCQ = "digital_mcq"


def _is_appsc_boxed(pdf_path: str, doc: fitz.Document) -> bool:
    """Detects APPSC boxed answer key format based on first few pages text."""
    for i in range(min(3, len(doc))):
        text = doc[i].get_text("text").lower()
        if "andhra pradesh public service commission" in text or "appsc" in text:
            # Look for typical instruction text or "Final Key"
            if "final key" in text or "initial key" in text:
                return True
    return False

def _is_tcsion_format(pdf_path: str, doc: fitz.Document) -> bool:
    """Detects TCSiON CAE export format with extreme precision."""
    for i in range(min(10, len(doc))): # High depth for papers with lots of instructions
        text = doc[i].get_text("text")
        # Require both markers or the domain with ID to avoid misrouting regular papers
        if "TCSiON CAE" in text and "Question ID" in text:
            return True
        if "tcsion.com" in text.lower() and "Question ID" in text:
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

def detect_format(pdf_path: str) -> str:
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
        if _is_appsc_boxed(pdf_path, doc):
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
