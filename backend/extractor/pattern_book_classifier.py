from __future__ import annotations

import hashlib
import json
import re
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

from PIL import Image


PAGE_TYPES = {
    "question_page",
    "answer_key_page",
    "solution_page",
    "mixed_special_page",
    "ignore_noisy_page",
}

TEXT_ESCALATION_THRESHOLD = 0.78
STRONG_TEXT_THRESHOLD = 0.84
STRONG_VISION_THRESHOLD = 0.72
VISION_OVERRIDE_MARGIN = 0.08
_TESSERACT_PATH = "/opt/homebrew/bin/tesseract"
_RENDER_DPI = 180

_WATERMARK_RE = re.compile(
    r"(?:tg\s*@|@[\w_]{3,}|free\s*pdf\s*hall|pdf\s*hall|exams?_pdfs?|freemebhaii)",
    re.IGNORECASE,
)
_ANSWER_KEY_HEADING_RE = re.compile(r"(?im)^\s*(answer\s*key|answers?)\s*:?\s*$")
_ANSWER_KEY_PAIR_RE = re.compile(r"\b\d{1,4}\s*[-.:)]?\s*[A-D]\b", re.IGNORECASE)
_SOLUTION_RE = re.compile(r"\b(sol(?:ution)?s?\.?|shortcut|trick|method|ratio method|alternate method|atq)\b", re.IGNORECASE)
_QUESTION_NUMBER_RE = re.compile(r"(?m)^\s*(?:q(?:uestion)?\s*)?\d{1,4}[\).:-]")
_OPTION_RE = re.compile(r"(?:(?<=\s)|^)[A-D][\).:-]\s*")
_DIAGRAM_WORD_RE = re.compile(r"\b(diagram|figure|graph|chart|table)\b", re.IGNORECASE)
_PATTERN_HEADING_RE = re.compile(
    r"\b(percentages?|profit|loss|discount|ratio|average|mixture|time and work|simple interest|compound interest|type\s*[ivx\d]+|pattern|ratio method)\b",
    re.IGNORECASE,
)


@dataclass
class PageSnapshot:
    page_number: int
    raw_text: str
    top_text: str
    block_x_positions: list[float]
    image_count: int
    drawing_count: int
    text_block_count: int


@dataclass
class VisionSnapshot:
    raw_text: str
    top_text: str
    layout_type: str
    column_count: int
    has_diagram: bool
    dark_pixel_ratio: float


@dataclass
class PageClassification:
    page_number: int
    page_type: str
    classification_confidence: float
    layout_type: str
    column_count: int
    has_diagram: bool
    detected_pattern_heading: str | None
    ocr_mode_used: str
    classification_source: str
    classification_reasons: list[str]
    escalated_to_vision: bool
    text_confidence: float
    vision_confidence: float


VisionProvider = Callable[[Any], VisionSnapshot]


def _clean_text(text: str) -> str:
    return "\n".join(line.rstrip() for line in (text or "").splitlines()).strip()


def _extract_heading(top_text: str) -> str | None:
    if not top_text:
        return None
    for raw_line in top_text.splitlines():
        line = raw_line.strip(" -:\t")
        if re.fullmatch(r"(?i)(solutions?|answer\s*key|answers?)", line):
            return line[:120]
    for raw_line in top_text.splitlines():
        line = raw_line.strip(" -:\t")
        if len(line) < 3:
            continue
        if _WATERMARK_RE.search(line):
            continue
        if _PATTERN_HEADING_RE.search(line):
            return line[:120]
    for raw_line in top_text.splitlines():
        line = raw_line.strip(" -:\t")
        if 3 <= len(line) <= 80 and line.upper() == line and not _WATERMARK_RE.search(line):
            return line[:120]
    return None


def _detect_columns(xs: list[float]) -> tuple[int, str]:
    if len(xs) < 4:
        return 1, "single_column"
    xs_sorted = sorted(xs)
    midpoint = sum(xs_sorted) / len(xs_sorted)
    left = [x for x in xs_sorted if x < midpoint]
    right = [x for x in xs_sorted if x >= midpoint]
    if left and right and max(left) + 80 < min(right) and min(len(left), len(right)) >= 2:
        return 2, "two_column"
    return 1, "single_column"


def _question_density(text: str) -> int:
    return len(_QUESTION_NUMBER_RE.findall(text)) + len(_OPTION_RE.findall(text)) // 4


def _answer_density(text: str) -> int:
    return len(_ANSWER_KEY_PAIR_RE.findall(text))


def _watermark_dominates(text: str, watermark_hits: int) -> bool:
    compact = re.sub(r"\s+", "", text)
    return watermark_hits >= 2 and (len(compact) < 300 or watermark_hits * 18 >= len(compact))


def _score_snapshot(
    *,
    text: str,
    top_text: str,
    column_count: int,
    layout_type: str,
    has_diagram: bool,
    image_count: int,
    drawing_count: int,
    text_block_count: int,
    source_label: str,
) -> tuple[str, float, list[str], str | None]:
    text = _clean_text(text)
    lowered = text.lower()
    watermark_hits = len(_WATERMARK_RE.findall(lowered))
    watermark_dominant = _watermark_dominates(text, watermark_hits)
    answer_heading = bool(_ANSWER_KEY_HEADING_RE.search(text))
    answer_hits = _answer_density(text)
    solution_hits = len(_SOLUTION_RE.findall(text))
    question_hits = _question_density(text)
    option_hits = len(_OPTION_RE.findall(text))
    structural_question_hits = max(0, question_hits - solution_hits)
    heading = _extract_heading(top_text)
    line_count = len([ln for ln in text.splitlines() if ln.strip()])
    reasons: list[str] = []

    if heading:
        reasons.append(f"{source_label}: heading_detected={heading}")
    if answer_heading:
        reasons.append(f"{source_label}: answer_key_heading")
    if answer_hits:
        reasons.append(f"{source_label}: answer_pairs={answer_hits}")
    if solution_hits:
        reasons.append(f"{source_label}: solution_markers={solution_hits}")
    if structural_question_hits:
        reasons.append(f"{source_label}: question_blocks={structural_question_hits}")
    if option_hits:
        reasons.append(f"{source_label}: option_markers={option_hits}")
    if watermark_hits:
        reasons.append(f"{source_label}: watermark_hits={watermark_hits}")
    if watermark_dominant:
        reasons.append(f"{source_label}: watermark_dominant")
    if column_count > 1:
        reasons.append(f"{source_label}: columns={column_count}")
    if has_diagram:
        reasons.append(f"{source_label}: visual_density_or_diagram")

    page_type = "mixed_special_page"
    confidence = 0.52

    if len(text) < 60 and watermark_dominant and structural_question_hits == 0 and answer_hits == 0 and solution_hits == 0:
        page_type = "ignore_noisy_page"
        confidence = 0.94
    elif answer_heading or answer_hits >= 18:
        if structural_question_hits >= 2 or solution_hits >= 2:
            page_type = "mixed_special_page"
            confidence = 0.74
        else:
            page_type = "answer_key_page"
            confidence = 0.95 if answer_hits >= 24 else 0.87
    elif solution_hits >= 2:
        if structural_question_hits >= 1 or answer_hits >= 6 or option_hits >= 4:
            page_type = "mixed_special_page"
            confidence = 0.73
        else:
            page_type = "solution_page"
            confidence = 0.88 if line_count >= 8 else 0.8
    elif (
        structural_question_hits >= 2
        or (option_hits >= 6 and len(text) >= 180)
        or (heading and _PATTERN_HEADING_RE.search(heading or "") and structural_question_hits >= 1)
    ):
        page_type = "question_page"
        confidence = 0.86 if structural_question_hits >= 3 else 0.8
    elif heading and has_diagram:
        page_type = "mixed_special_page"
        confidence = 0.7
    elif watermark_dominant and len(text) < 180:
        page_type = "ignore_noisy_page"
        confidence = 0.82
    elif image_count > 0 or drawing_count > 0 or text_block_count == 0:
        page_type = "mixed_special_page"
        confidence = 0.64

    return page_type, round(confidence, 2), reasons, heading


def _render_page_png_bytes(page: Any, dpi: int = _RENDER_DPI) -> bytes:
    fitz = __import__("fitz")
    pix = page.get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), colorspace=fitz.csGRAY, alpha=False)
    return pix.tobytes("png")


def _estimate_columns_from_image(img: Image.Image) -> tuple[int, str]:
    gray = img.convert("L")
    width, height = gray.size
    crop = gray.crop((0, int(height * 0.08), width, int(height * 0.92)))
    binarized = crop.point(lambda px: 255 if px > 220 else 0)
    w, h = binarized.size
    dark_counts = []
    for x in range(w):
        col_dark = 0
        for y in range(h):
            if binarized.getpixel((x, y)) == 0:
                col_dark += 1
        dark_counts.append(col_dark)
    mid = w // 2
    gutter = dark_counts[max(0, mid - w // 12): min(w, mid + w // 12)]
    left = dark_counts[: max(1, mid - w // 8)]
    right = dark_counts[min(w, mid + w // 8):]
    if gutter and left and right:
        gutter_avg = sum(gutter) / len(gutter)
        left_avg = sum(left) / len(left)
        right_avg = sum(right) / len(right)
        if gutter_avg < 0.28 * min(left_avg, right_avg):
            return 2, "two_column"
    return 1, "single_column"


def _ocr_page_image(png_bytes: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp.write(png_bytes)
        tmp_path = tmp.name
    try:
        proc = subprocess.run(
            [_TESSERACT_PATH, tmp_path, "stdout", "--psm", "6"],
            capture_output=True,
            text=True,
            check=False,
        )
        return _clean_text((proc.stdout or "").replace("\x0c", ""))
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _vision_snapshot(page: Any) -> VisionSnapshot:
    png_bytes = _render_page_png_bytes(page)
    # Re-open from in-memory bytes for PIL analysis
    from io import BytesIO
    img = Image.open(BytesIO(png_bytes))
    text = _ocr_page_image(png_bytes)
    top_height = max(40, int(img.height * 0.18))
    top_img = img.crop((0, 0, img.width, top_height))
    top_bytes_io = BytesIO()
    top_img.save(top_bytes_io, format="PNG")
    top_text = _ocr_page_image(top_bytes_io.getvalue())
    column_count, layout_type = _estimate_columns_from_image(img)
    gray = img.convert("L")
    pixels = list(gray.getdata())
    dark_pixels = sum(1 for px in pixels if px < 200)
    dark_ratio = dark_pixels / max(1, len(pixels))
    has_diagram = dark_ratio > 0.12 and len(text) < 500
    return VisionSnapshot(
        raw_text=text,
        top_text=top_text,
        layout_type=layout_type,
        column_count=column_count,
        has_diagram=has_diagram,
        dark_pixel_ratio=round(dark_ratio, 4),
    )


def _should_escalate(
    snapshot: PageSnapshot,
    provisional_type: str,
    text_confidence: float,
    reasons: list[str],
) -> bool:
    watermark_dominant = any("watermark_dominant" in reason for reason in reasons)
    weak_mixed = provisional_type == "mixed_special_page" and text_confidence < STRONG_TEXT_THRESHOLD
    image_heavy = snapshot.image_count > 0 or snapshot.drawing_count >= 8 or snapshot.text_block_count == 0
    return (
        text_confidence < TEXT_ESCALATION_THRESHOLD
        or watermark_dominant
        or image_heavy
        or weak_mixed
    )


def resolve_page_classification(
    snapshot: PageSnapshot,
    *,
    page: Any | None = None,
    vision_provider: VisionProvider | None = None,
) -> PageClassification:
    text_column_count, text_layout_type = _detect_columns(snapshot.block_x_positions)
    text_has_diagram = (
        snapshot.image_count > 0
        or snapshot.drawing_count >= 8
        or bool(_DIAGRAM_WORD_RE.search(snapshot.raw_text))
    )
    text_type, text_confidence, text_reasons, text_heading = _score_snapshot(
        text=snapshot.raw_text,
        top_text=snapshot.top_text,
        column_count=text_column_count,
        layout_type=text_layout_type,
        has_diagram=text_has_diagram,
        image_count=snapshot.image_count,
        drawing_count=snapshot.drawing_count,
        text_block_count=snapshot.text_block_count,
        source_label="text",
    )
    ocr_mode_used = "text_layer_only"
    if len(snapshot.raw_text) < 120 and len(_WATERMARK_RE.findall(snapshot.raw_text.lower())) > 0:
        ocr_mode_used = "text_layer_preview_only"

    escalated = _should_escalate(snapshot, text_type, text_confidence, text_reasons)
    final_type = text_type
    final_confidence = text_confidence
    final_layout = text_layout_type
    final_columns = text_column_count
    final_has_diagram = text_has_diagram
    final_heading = text_heading
    final_reasons = list(text_reasons)
    classification_source = "text_only"
    vision_confidence = 0.0

    if escalated:
        provider = vision_provider or _vision_snapshot
        if page is None and vision_provider is None:
            raise ValueError("page is required for live vision escalation")
        vision = provider(page) if page is not None else provider(None)
        vision_type, vision_confidence, vision_reasons, vision_heading = _score_snapshot(
            text=vision.raw_text,
            top_text=vision.top_text,
            column_count=vision.column_count,
            layout_type=vision.layout_type,
            has_diagram=vision.has_diagram,
            image_count=snapshot.image_count,
            drawing_count=snapshot.drawing_count,
            text_block_count=snapshot.text_block_count,
            source_label="vision",
        )
        final_reasons.extend(vision_reasons)
        final_reasons.append(f"vision: dark_pixel_ratio={vision.dark_pixel_ratio}")
        noisy_page = any("text: watermark_dominant" == reason for reason in text_reasons) or snapshot.image_count > 0 or snapshot.drawing_count >= 8

        if text_confidence >= STRONG_TEXT_THRESHOLD and text_type == vision_type:
            classification_source = "hybrid"
            final_type = text_type
            final_confidence = round(max(text_confidence, min(0.99, (text_confidence + vision_confidence) / 2 + 0.03)), 2)
            final_layout = vision.layout_type if vision_confidence >= text_confidence else text_layout_type
            final_columns = vision.column_count if vision_confidence >= text_confidence else text_column_count
            final_has_diagram = text_has_diagram or vision.has_diagram
            final_heading = text_heading or vision_heading
        elif noisy_page and vision_confidence >= max(STRONG_VISION_THRESHOLD, text_confidence + VISION_OVERRIDE_MARGIN):
            classification_source = "vision_only"
            final_type = vision_type
            final_confidence = vision_confidence
            final_layout = vision.layout_type
            final_columns = vision.column_count
            final_has_diagram = vision.has_diagram or text_has_diagram
            final_heading = vision_heading or text_heading
            ocr_mode_used = "rendered_page_tesseract"
        elif vision_type == text_type and vision_confidence >= 0.62:
            classification_source = "hybrid"
            final_type = text_type
            final_confidence = round(max(text_confidence, min(0.99, (text_confidence + vision_confidence) / 2 + 0.02)), 2)
            final_layout = vision.layout_type if vision.column_count > text_column_count else text_layout_type
            final_columns = max(text_column_count, vision.column_count)
            final_has_diagram = text_has_diagram or vision.has_diagram
            final_heading = text_heading or vision_heading
            ocr_mode_used = "hybrid_text_and_rendered_ocr"
        elif vision_confidence >= STRONG_VISION_THRESHOLD:
            classification_source = "vision_only"
            final_type = vision_type
            final_confidence = vision_confidence
            final_layout = vision.layout_type
            final_columns = vision.column_count
            final_has_diagram = vision.has_diagram or text_has_diagram
            final_heading = vision_heading or text_heading
            ocr_mode_used = "rendered_page_tesseract"
        else:
            classification_source = "hybrid"
            final_confidence = round(max(text_confidence, min(0.99, (text_confidence + vision_confidence) / 2)), 2)
            final_heading = text_heading or vision_heading
            final_has_diagram = text_has_diagram or vision.has_diagram
            ocr_mode_used = "hybrid_text_and_rendered_ocr"

    return PageClassification(
        page_number=snapshot.page_number,
        page_type=final_type,
        classification_confidence=round(final_confidence, 2),
        layout_type=final_layout,
        column_count=final_columns,
        has_diagram=final_has_diagram,
        detected_pattern_heading=final_heading,
        ocr_mode_used=ocr_mode_used,
        classification_source=classification_source,
        classification_reasons=final_reasons,
        escalated_to_vision=escalated,
        text_confidence=round(text_confidence, 2),
        vision_confidence=round(vision_confidence, 2),
    )


def classify_page_snapshot(snapshot: PageSnapshot) -> PageClassification:
    """Compatibility wrapper for text-only unit tests."""
    return resolve_page_classification(snapshot, page=None, vision_provider=lambda _page: VisionSnapshot(
        raw_text="",
        top_text="",
        layout_type="single_column",
        column_count=1,
        has_diagram=False,
        dark_pixel_ratio=0.0,
    ))


def _page_snapshot(page: Any, page_number: int) -> PageSnapshot:
    text = _clean_text(page.get_text("text"))
    blocks = page.get_text("dict").get("blocks", [])
    page_rect = page.rect
    top_cutoff = page_rect.height * 0.25
    top_lines: list[str] = []
    block_x_positions: list[float] = []
    text_block_count = 0
    for block in blocks:
        if block.get("type") != 0:
            continue
        bbox = block.get("bbox") or [0, 0, 0, 0]
        block_x_positions.append(float(bbox[0]))
        text_block_count += 1
        if float(bbox[1]) <= top_cutoff:
            line_parts: list[str] = []
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    txt = (span.get("text") or "").strip()
                    if txt:
                        line_parts.append(txt)
            if line_parts:
                top_lines.append(" ".join(line_parts))

    return PageSnapshot(
        page_number=page_number,
        raw_text=text,
        top_text="\n".join(top_lines[:8]),
        block_x_positions=block_x_positions,
        image_count=len(page.get_images(full=True)),
        drawing_count=len(page.get_drawings()),
        text_block_count=text_block_count,
    )


def pattern_book_report_path(pdf_path: str) -> Path:
    pdf_file = Path(pdf_path)
    digest = hashlib.sha256(str(pdf_file.resolve()).encode("utf-8")).hexdigest()[:16]
    reports_dir = Path(__file__).resolve().parent.parent / "cache" / "pattern_book_reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", pdf_file.stem)[:80]
    return reports_dir / f"{safe_name}_{digest}.json"


def classify_pattern_book_pdf(pdf_path: str, write_report: bool = True) -> dict[str, Any]:
    try:
        import fitz  # type: ignore
    except ImportError as exc:
        raise RuntimeError("PyMuPDF (fitz) is required for pattern-book page classification") from exc

    doc = fitz.open(pdf_path)
    try:
        pages: list[dict[str, Any]] = []
        counts = {name: 0 for name in PAGE_TYPES}
        for idx, page in enumerate(doc):
            snapshot = _page_snapshot(page, idx + 1)
            classification = resolve_page_classification(snapshot, page=page)
            row = asdict(classification)
            pages.append(row)
            counts[classification.page_type] += 1

        report = {
            "pdf_path": str(Path(pdf_path).resolve()),
            "page_count": len(doc),
            "counts": counts,
            "pages": pages,
        }
        if write_report:
            report_path = pattern_book_report_path(pdf_path)
            report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
            report["report_path"] = str(report_path)
        return report
    finally:
        doc.close()


def detect_pattern_book_candidate(pdf_path: str) -> bool:
    path = Path(pdf_path)
    name = path.name.lower()
    if any(token in name for token in ("ssc", "cgl", "percentages", "pattern", "chapter")):
        return True
    try:
        report = classify_pattern_book_pdf(pdf_path, write_report=False)
    except Exception:
        return False
    counts = report.get("counts", {})
    return (
        counts.get("answer_key_page", 0) > 0
        or counts.get("solution_page", 0) > 0
        or counts.get("mixed_special_page", 0) >= 2
    )
