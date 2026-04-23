from __future__ import annotations

import hashlib
import json
import re
import subprocess
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image

from .pattern_book_classifier import classify_pattern_book_pdf

_TESSERACT_PATH = "/opt/homebrew/bin/tesseract"
_RENDER_DPI = 180

_QUESTION_START_RE = re.compile(r"^\s*(\d{1,4})\s*[\).:-]\s+")
_QUESTION_ANCHOR_ANY_RE = re.compile(r"(?<![A-Za-z0-9])(\d{1,4})\s*[\).:-]\s+")
_SOLUTION_START_RE = re.compile(r"^\s*(?:sol\.?\s*)?(\d{1,4})\s*[\).:-]\s*", re.IGNORECASE)
_OPTION_PREFIX_RE = re.compile(r"^\s*[A-D]\s*[\).:-]\s*")
_DIAGRAM_WORD_RE = re.compile(r"\b(diagram|figure|graph|chart|table)\b", re.IGNORECASE)
_FORMULA_MARK_RE = re.compile(r"(=|%|÷|/|\+|-|\b(?:ratio|method|profit|loss|discount)\b)")
_YEAR_RE = re.compile(r"\b20\d{2}\b")
_SOLUTION_HINT_RE = re.compile(r"\b(sol(?:ution)?|shortcut|alternate method|ratio method|atq)\b", re.IGNORECASE)
_OPTION_ANCHOR_SCAN_RE = re.compile(r"(?<![A-Za-z0-9])(?:\(?([A-Da-d])[\).:-])")


@dataclass
class OCRLine:
    text: str
    x0: int
    y0: int
    x1: int
    y1: int


@dataclass
class OCRRegion:
    label: str
    x0: int
    y0: int
    x1: int
    y1: int


def _raw_report_path(pdf_path: str) -> Path:
    pdf_file = Path(pdf_path)
    digest = hashlib.sha256(str(pdf_file.resolve()).encode("utf-8")).hexdigest()[:16]
    reports_dir = Path(__file__).resolve().parent.parent / "cache" / "pattern_book_raw_blocks"
    reports_dir.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", pdf_file.stem)[:80]
    return reports_dir / f"{safe_name}_{digest}.json"


def _render_page_png_bytes(page: Any, dpi: int = _RENDER_DPI) -> bytes:
    fitz = __import__("fitz")
    pix = page.get_pixmap(matrix=fitz.Matrix(dpi / 72, dpi / 72), colorspace=fitz.csGRAY, alpha=False)
    return pix.tobytes("png")


def _ocr_page_tsv(png_bytes: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp.write(png_bytes)
        tmp_path = tmp.name
    try:
        proc = subprocess.run(
            [_TESSERACT_PATH, tmp_path, "stdout", "--psm", "6", "tsv"],
            capture_output=True,
            text=True,
            check=False,
        )
        return proc.stdout or ""
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _ocr_region_tsv(png_bytes: bytes, psm: str = "4") -> str:
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp.write(png_bytes)
        tmp_path = tmp.name
    try:
        proc = subprocess.run(
            [_TESSERACT_PATH, tmp_path, "stdout", "--psm", psm, "tsv"],
            capture_output=True,
            text=True,
            check=False,
        )
        return proc.stdout or ""
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _ocr_preview_text(png_bytes: bytes) -> str:
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
        return (proc.stdout or "").replace("\x0c", "").strip()
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _parse_tsv_lines(tsv_text: str, *, x_offset: int = 0, y_offset: int = 0) -> list[OCRLine]:
    rows = [row for row in (tsv_text or "").splitlines() if row.strip()]
    if not rows:
        return []
    lines: list[OCRLine] = []
    current_key: tuple[str, str, str] | None = None
    current_words: list[str] = []
    bbox: list[int] | None = None
    for row in rows[1:]:
        cols = row.split("\t")
        if len(cols) < 12:
            continue
        level = cols[0]
        if level != "5":
            continue
        text = cols[11].strip()
        if not text:
            continue
        key = (cols[2], cols[3], cols[4])  # block_num, par_num, line_num
        x = int(cols[6])
        y = int(cols[7])
        w = int(cols[8])
        h = int(cols[9])
        if current_key is None:
            current_key = key
            current_words = [text]
            bbox = [x, y, x + w, y + h]
            continue
        if key != current_key:
            if current_words and bbox:
                lines.append(OCRLine(" ".join(current_words).strip(), bbox[0] + x_offset, bbox[1] + y_offset, bbox[2] + x_offset, bbox[3] + y_offset))
            current_key = key
            current_words = [text]
            bbox = [x, y, x + w, y + h]
        else:
            current_words.append(text)
            assert bbox is not None
            bbox[0] = min(bbox[0], x)
            bbox[1] = min(bbox[1], y)
            bbox[2] = max(bbox[2], x + w)
            bbox[3] = max(bbox[3], y + h)
    if current_words and bbox:
        lines.append(OCRLine(" ".join(current_words).strip(), bbox[0] + x_offset, bbox[1] + y_offset, bbox[2] + x_offset, bbox[3] + y_offset))
    return lines


def _aggregate_bbox(lines: list[OCRLine]) -> dict[str, int] | None:
    if not lines:
        return None
    return {
        "x0": min(line.x0 for line in lines),
        "y0": min(line.y0 for line in lines),
        "x1": max(line.x1 for line in lines),
        "y1": max(line.y1 for line in lines),
    }


def _option_text_from_lines(lines: list[OCRLine]) -> str:
    option_lines = [line.text for line in lines if _OPTION_PREFIX_RE.match(line.text)]
    return "\n".join(option_lines).strip()


def _merged_risk(raw_text: str) -> bool:
    starts = _QUESTION_START_RE.findall(raw_text)
    return len(starts) > 1


def _option_group_integrity(lines: list[OCRLine]) -> bool:
    option_lines = [line for line in lines if _OPTION_PREFIX_RE.match(line.text)]
    if not option_lines:
        return False
    letters = []
    for line in option_lines:
        m = re.match(r"^\s*([A-D])", line.text)
        if m:
            letters.append(m.group(1))
    return len(set(letters)) >= 2


def _split_line_on_inline_question_anchors(line: OCRLine) -> tuple[list[OCRLine], int]:
    matches = list(_QUESTION_ANCHOR_ANY_RE.finditer(line.text))
    if len(matches) <= 1:
        return [line], 0
    fragments: list[OCRLine] = []
    recovered = 0
    text = line.text
    width = max(1, line.x1 - line.x0)
    for idx, match in enumerate(matches):
        start = match.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        fragment_text = text[start:end].strip(" |")
        if not fragment_text:
            continue
        x0 = line.x0 + int(width * (start / max(1, len(text))))
        x1 = line.x0 + int(width * (end / max(1, len(text))))
        fragments.append(OCRLine(fragment_text, x0, line.y0, max(x0 + 1, x1), line.y1))
        if idx > 0:
            recovered += 1
    return fragments or [line], recovered


def _anchor_fragment_is_plausible_question(text: str) -> tuple[bool, str]:
    stripped = text.strip()
    match = _QUESTION_START_RE.match(stripped)
    if not match:
        return False, "not_question_anchor"
    remainder = stripped[match.end():].strip()
    alpha_words = re.findall(r"[A-Za-z]{3,}", remainder)
    alpha_chars = len(re.findall(r"[A-Za-z]", remainder))
    option_markers = len(re.findall(r"\([a-dA-D]\)|\b[A-D][\).]", remainder))
    inline_anchor_count = len(_QUESTION_ANCHOR_ANY_RE.findall(remainder))
    if _YEAR_RE.search(remainder) and alpha_chars < 25:
        return False, "year_or_date_noise"
    if len(alpha_words) < 2 and alpha_chars < 16:
        return False, "too_little_question_text"
    if option_markers >= 4 and alpha_chars < 25:
        return False, "compact_answer_list"
    if inline_anchor_count >= 2 and alpha_chars < 40:
        return False, "multi_anchor_noise"
    return True, "accepted"


def _prepare_question_anchor_lines(lines: list[OCRLine]) -> tuple[list[OCRLine], int, int]:
    prepared: list[OCRLine] = []
    recovered = 0
    suppressed = 0
    for line in lines:
        fragments, recovered_here = _split_line_on_inline_question_anchors(line)
        recovered += recovered_here
        for frag in fragments:
            if _QUESTION_ANCHOR_ANY_RE.search(frag.text):
                ok, _reason = _anchor_fragment_is_plausible_question(frag.text)
                if not ok:
                    suppressed += 1
                    continue
            prepared.append(frag)
    return sorted(prepared, key=lambda l: (l.y0, l.x0)), suppressed, recovered


def _stabilize_blocks_by_question_number(blocks: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    notes: list[str] = []
    numbered = []
    for block in blocks:
        qn = block.get("question_number_raw")
        if qn and str(qn).isdigit():
            numbered.append(int(qn))
    if len(numbered) < 2:
        return blocks, notes
    sorted_nums = sorted(numbered)
    median = sorted_nums[len(sorted_nums) // 2]
    filtered_blocks = blocks
    if median > 50:
        min_allowed = max(1, int(median * 0.5))
        outlier_count = sum(
            1
            for block in blocks
            if str(block.get("question_number_raw", "")).isdigit()
            and int(block["question_number_raw"]) < min_allowed
        )
        if outlier_count:
            filtered_blocks = [
                block for block in blocks
                if not (
                    str(block.get("question_number_raw", "")).isdigit()
                    and int(block["question_number_raw"]) < min_allowed
                )
            ]
            notes.append(f"removed_outlier_anchors={outlier_count}")
            blocks = filtered_blocks
            numbered = [
                int(block["question_number_raw"])
                for block in blocks
                if str(block.get("question_number_raw", "")).isdigit()
            ]
            if len(numbered) < 2:
                return blocks, notes
    monotonic_breaks = sum(1 for a, b in zip(numbered, numbered[1:]) if b <= a)
    if monotonic_breaks:
        notes.append(f"monotonic_breaks={monotonic_breaks}")
    if monotonic_breaks >= 1 and len(set(numbered)) == len(numbered):
        blocks = sorted(
            blocks,
            key=lambda b: (int(b["question_number_raw"]) if str(b.get("question_number_raw", "")).isdigit() else 10**9,
                           b["bbox"]["y0"] if b.get("bbox") else 10**9),
        )
        notes.append("reordered_by_question_number")
    return blocks, notes


def _estimate_vertical_gutter(img: Image.Image) -> OCRRegion | None:
    gray = img.convert("L")
    width, height = gray.size
    crop = gray.crop((0, int(height * 0.06), width, int(height * 0.96)))
    w, h = crop.size
    dark_counts = []
    for x in range(w):
        count = 0
        for y in range(h):
            if crop.getpixel((x, y)) < 220:
                count += 1
        dark_counts.append(count)
    mid = w // 2
    window = dark_counts[max(0, mid - w // 10): min(w, mid + w // 10)]
    if not window:
        return None
    gutter_idx = min(range(len(window)), key=lambda i: window[i])
    gutter_x = max(0, mid - w // 10) + gutter_idx
    local = dark_counts[max(0, gutter_x - w // 30): min(w, gutter_x + w // 30)]
    if not local:
        return None
    if sum(local) / len(local) >= 0.45 * max(1, sum(dark_counts) / len(dark_counts)):
        return None
    gutter_half = max(10, w // 50)
    return OCRRegion("gutter", gutter_x - gutter_half, 0, gutter_x + gutter_half, height)


def _question_page_regions(page: Any) -> list[OCRRegion]:
    png_bytes = _render_page_png_bytes(page)
    img = Image.open(BytesIO(png_bytes))
    width, height = img.size
    gutter = _estimate_vertical_gutter(img)
    top_margin = int(height * 0.04)
    bottom_margin = int(height * 0.98)
    left_margin = int(width * 0.03)
    right_margin = int(width * 0.97)
    if gutter and gutter.x0 > width * 0.28 and gutter.x1 < width * 0.72:
        return [
            OCRRegion("left", left_margin, top_margin, gutter.x0, bottom_margin),
            OCRRegion("right", gutter.x1, top_margin, right_margin, bottom_margin),
        ]
    return [OCRRegion("full", left_margin, top_margin, right_margin, bottom_margin)]


def _ocr_lines_for_region(page: Any, region: OCRRegion) -> list[OCRLine]:
    fitz = __import__("fitz")
    clip = fitz.Rect(region.x0 * 72 / _RENDER_DPI, region.y0 * 72 / _RENDER_DPI, region.x1 * 72 / _RENDER_DPI, region.y1 * 72 / _RENDER_DPI)
    pix = page.get_pixmap(matrix=fitz.Matrix(_RENDER_DPI / 72, _RENDER_DPI / 72), clip=clip, colorspace=fitz.csGRAY, alpha=False)
    png_bytes = pix.tobytes("png")
    tsv_text = _ocr_region_tsv(png_bytes, psm="4")
    return _parse_tsv_lines(tsv_text, x_offset=region.x0, y_offset=region.y0)


def _question_anchor_lines(lines: list[OCRLine]) -> list[OCRLine]:
    if not lines:
        return []
    min_x = min(line.x0 for line in lines)
    anchors = []
    for line in sorted(lines, key=lambda l: (l.y0, l.x0)):
        if _QUESTION_START_RE.match(line.text) and line.x0 <= min_x + 80:
            anchors.append(line)
    return anchors


def _block_from_lines(
    lines: list[OCRLine],
    *,
    page_number: int,
    detected_pattern_heading: str | None,
    boundary_note: str,
) -> dict[str, Any]:
    raw_text = "\n".join(l.text for l in lines).strip()
    qmatch = _QUESTION_START_RE.match(lines[0].text) if lines else None
    merged = _merged_risk(raw_text)
    option_integrity = _option_group_integrity(lines)
    confidence = 0.92
    if merged:
        confidence -= 0.28
    if not option_integrity:
        confidence -= 0.08
    if len(lines) < 2:
        confidence -= 0.08
    return {
        "page_number": page_number,
        "raw_block_text": raw_text,
        "question_number_raw": qmatch.group(1) if qmatch else None,
        "raw_options_text": _option_text_from_lines(lines),
        "detected_pattern_heading": detected_pattern_heading,
        "bbox": _aggregate_bbox(lines),
        "extraction_confidence": round(max(0.35, confidence), 2),
        "merged_question_risk": merged,
        "boundary_detection_note": boundary_note,
        "line_count": len(lines),
    }


def _mixed_block_kind(lines: list[OCRLine]) -> tuple[str, float, list[str]]:
    raw_text = "\n".join(l.text for l in lines).strip()
    reasons: list[str] = []
    question_anchor = bool(lines and _QUESTION_START_RE.match(lines[0].text))
    solution_anchor = bool(lines and _SOLUTION_START_RE.match(lines[0].text) and not _QUESTION_START_RE.match(lines[0].text))
    option_integrity = _option_group_integrity(lines)
    option_count = len(_option_text_from_lines(lines).splitlines()) if _option_text_from_lines(lines) else 0
    solution_hits = len(_SOLUTION_HINT_RE.findall(raw_text))
    formula_hits = len(_FORMULA_MARK_RE.findall(raw_text))
    inline_option_markers = len(re.findall(r"\b[A-D][\).]", raw_text))

    if question_anchor:
        reasons.append("question_anchor")
    if solution_anchor:
        reasons.append("solution_anchor")
    if option_integrity:
        reasons.append("option_integrity")
    if solution_hits:
        reasons.append(f"solution_hints={solution_hits}")
    if formula_hits:
        reasons.append(f"formula_hints={formula_hits}")

    if solution_anchor and not option_integrity:
        return "solution_block", 0.9, reasons
    if question_anchor and (option_integrity or inline_option_markers >= 4):
        return "question_block", 0.88, reasons
    if option_integrity and inline_option_markers >= 2 and solution_hits == 0:
        return "question_block", 0.78, reasons
    if solution_hits >= 2 and formula_hits >= 2 and option_count < 2:
        return "solution_block", 0.82, reasons
    if question_anchor and solution_hits == 0:
        return "question_block", 0.68, reasons + ["low_confidence_question_shape"]
    return "unknown_block", 0.45, reasons + ["ambiguous_mixed_block"]


def _question_number_is_plausible(qn: Any) -> bool:
    return bool(qn is not None and str(qn).isdigit() and 1 <= int(str(qn)) <= 9999)


def _option_completeness_score(raw_options_text: str) -> int:
    if not raw_options_text:
        return 0
    line_markers = re.findall(r"^\s*[A-D]\s*[\).:-]", raw_options_text, flags=re.MULTILINE)
    inline_markers = re.findall(r"\b[A-D]\s*[\).:-]", raw_options_text)
    return max(len(line_markers), len(set(inline_markers)))


def isolate_options_from_raw_block(block: dict[str, Any]) -> dict[str, Any]:
    raw_text = (block.get("raw_block_text") or "").strip()
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    if not lines:
        return {
            "stem_text": "",
            "options": {},
            "option_anchors_detected": [],
            "option_isolation_confidence": 0.0,
            "stem_extracted": False,
            "options_recovered_count": 0,
            "isolation_notes": ["empty_raw_block"],
        }

    stem_parts: list[str] = []
    options: dict[str, list[str]] = {}
    anchor_sequence: list[str] = []
    notes: list[str] = []
    current_option: str | None = None
    saw_any_anchor = False

    for idx, line in enumerate(lines):
        pieces: list[tuple[str | None, str]] = []
        matches = list(_OPTION_ANCHOR_SCAN_RE.finditer(line))
        if matches:
            saw_any_anchor = True
            if matches[0].start() > 0:
                prefix = line[:matches[0].start()].strip()
                if prefix:
                    pieces.append((None, prefix))
            for pos, match in enumerate(matches):
                label = match.group(1).upper()
                start = match.end()
                end = matches[pos + 1].start() if pos + 1 < len(matches) else len(line)
                content = line[start:end].strip(" -:\t")
                pieces.append((label, content))
        else:
            pieces.append((None, line))

        for label, content in pieces:
            if label is None:
                if current_option is None:
                    stem_parts.append(content)
                else:
                    options.setdefault(current_option, []).append(content)
                    notes.append("wrapped_option_line")
            else:
                current_option = label
                anchor_sequence.append(label)
                options.setdefault(label, [])
                if content:
                    options[label].append(content)
                elif idx + 1 < len(lines):
                    notes.append("empty_option_anchor")

    stem_text = "\n".join(part for part in stem_parts if part).strip()
    normalized_options = {
        label: "\n".join(part for part in parts if part).strip()
        for label, parts in options.items()
        if any(part.strip() for part in parts)
    }
    option_count = len(normalized_options)
    unique_anchor_count = len(set(anchor_sequence))
    ordered_unique = list(dict.fromkeys(anchor_sequence))
    in_order = ordered_unique == sorted(ordered_unique)
    if not in_order and ordered_unique:
        notes.append("option_anchor_order_irregular")
    if saw_any_anchor and option_count == 0:
        notes.append("anchors_without_option_text")

    confidence = 0.0
    if option_count >= 4 and unique_anchor_count >= 4:
        confidence = 0.9
    elif option_count >= 3 and unique_anchor_count >= 3:
        confidence = 0.76
    elif option_count >= 2 and unique_anchor_count >= 2:
        confidence = 0.62
    elif saw_any_anchor:
        confidence = 0.45

    if not stem_text:
        notes.append("stem_missing")
        confidence -= 0.1
    elif len(re.findall(r"[A-Za-z]", stem_text)) < 12:
        notes.append("stem_short")
        confidence -= 0.08

    if not in_order:
        confidence -= 0.1

    confidence = round(max(0.0, min(0.95, confidence)), 2)
    return {
        "stem_text": stem_text,
        "options": normalized_options,
        "option_anchors_detected": anchor_sequence,
        "option_isolation_confidence": confidence,
        "stem_extracted": bool(stem_text),
        "options_recovered_count": option_count,
        "isolation_notes": list(dict.fromkeys(notes)),
    }


def audit_raw_question_block(block: dict[str, Any]) -> dict[str, Any]:
    reasons: list[str] = []
    severity = 0
    raw_text = (block.get("raw_block_text") or "").strip()
    raw_options_text = (block.get("raw_options_text") or "").strip()
    qn = block.get("question_number_raw")
    extraction_conf = float(block.get("extraction_confidence") or 0.0)
    mixed_conf = float(block.get("mixed_block_confidence") or 0.0)
    line_count = int(block.get("line_count") or 0)
    source_page_type = block.get("source_page_type") or "question_page"
    option_shape = isolate_options_from_raw_block(block)
    option_count = option_shape["options_recovered_count"]
    option_conf = float(option_shape["option_isolation_confidence"] or 0.0)

    if not _question_number_is_plausible(qn):
        reasons.append("implausible_question_number")
        severity += 3

    alpha_chars = len(re.findall(r"[A-Za-z]", raw_text))
    digit_chars = len(re.findall(r"\d", raw_text))
    if alpha_chars < 18 and digit_chars < 4:
        reasons.append("question_text_incomplete")
        severity += 3
    elif alpha_chars < 32:
        reasons.append("question_text_short")
        severity += 1

    option_score = max(_option_completeness_score(raw_options_text), option_count)
    if option_score >= 4:
        pass
    elif option_score >= 3 and option_conf >= 0.72:
        reasons.append("partial_options")
        severity += 1
    elif option_score >= 2:
        reasons.append("partial_options")
        severity += 1
    else:
        reasons.append("option_incomplete")
        severity += 3

    if option_conf < 0.55:
        reasons.append("option_isolation_low_confidence")
        severity += 2
    elif option_conf < 0.72:
        reasons.append("option_isolation_partial")
        severity += 1

    solution_hits = len(_SOLUTION_HINT_RE.findall(raw_text))
    formula_hits = len(_FORMULA_MARK_RE.findall(raw_text))
    if solution_hits >= 1:
        reasons.append("possible_solution_leakage")
        severity += 2
    if solution_hits >= 2 or (solution_hits >= 1 and formula_hits >= 3):
        reasons.append("strong_solution_leakage")
        severity += 2

    if block.get("merged_question_risk"):
        reasons.append("possible_merge")
        severity += 3

    if line_count <= 1:
        reasons.append("single_line_fragment")
        severity += 2
    elif line_count == 2:
        reasons.append("short_block_shape")
        severity += 1

    boundary_note = block.get("boundary_detection_note") or ""
    if "mixed_page" in boundary_note:
        if mixed_conf < 0.72:
            reasons.append("mixed_page_recovery_low_confidence")
            severity += 3
        else:
            reasons.append("mixed_page_recovery")
            severity += 1

    if extraction_conf < 0.68:
        reasons.append("very_low_extraction_confidence")
        severity += 3
    elif extraction_conf < 0.8:
        reasons.append("low_extraction_confidence")
        severity += 1

    if source_page_type == "mixed_special_page" and mixed_conf < 0.78:
        reasons.append("mixed_page_recovery_risk")
        severity += 2

    deduped_reasons = list(dict.fromkeys(reasons))
    if severity >= 6 or any(
        r in deduped_reasons
        for r in (
            "implausible_question_number",
            "option_incomplete",
            "possible_merge",
            "very_low_extraction_confidence",
            "mixed_page_recovery_low_confidence",
            "strong_solution_leakage",
        )
    ):
        status = "withhold_for_now"
    elif severity >= 2:
        status = "needs_manual_review"
    else:
        status = "ready_for_phase_c"

    return {
        "page_number": block.get("page_number"),
        "question_number_raw": qn,
        "status": status,
        "failure_reasons": deduped_reasons,
        "extraction_confidence": extraction_conf,
        "source_page_type": source_page_type,
        "option_anchors_detected": option_shape["option_anchors_detected"],
        "option_isolation_confidence": option_conf,
        "stem_extracted": option_shape["stem_extracted"],
        "options_recovered_count": option_count,
        "isolated_stem_preview": option_shape["stem_text"][:180],
        "isolated_options_preview": option_shape["options"],
        "option_isolation_notes": option_shape["isolation_notes"],
        "raw_text_preview": raw_text[:220],
        "raw_options_preview": raw_options_text[:160],
    }


def build_phase_c_readiness_audit(report: dict[str, Any]) -> dict[str, Any]:
    question_blocks = report.get("question_blocks", [])
    block_audits = [audit_raw_question_block(block) for block in question_blocks]
    status_counts = Counter(audit["status"] for audit in block_audits)
    reason_counts: Counter[str] = Counter()
    improved_by_option_isolation = 0
    page_status_map: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for audit in block_audits:
        for reason in audit["failure_reasons"]:
            reason_counts[reason] += 1
        if audit["options_recovered_count"] >= 3 and audit["option_isolation_confidence"] >= 0.72:
            improved_by_option_isolation += 1
        if audit["page_number"] is not None:
            page_status_map[int(audit["page_number"])].append(audit)

    mixed_pages_processed = {
        int(row["page_number"]): row for row in report.get("mixed_pages_processed", []) if row.get("page_number") is not None
    }
    withheld_pages = {int(row["page_number"]): row for row in report.get("mixed_pages", []) if row.get("page_number") is not None}

    page_summaries: list[dict[str, Any]] = []
    for page_number in range(1, int(report.get("page_count", 0)) + 1):
        audits = page_status_map.get(page_number, [])
        status_counter = Counter(a["status"] for a in audits)
        if page_number in withheld_pages:
            page_status = "withhold_for_now"
        elif status_counter["withhold_for_now"] > 0:
            page_status = "withhold_for_now"
        elif status_counter["needs_manual_review"] > 0:
            page_status = "needs_manual_review"
        elif audits:
            page_status = "ready_for_phase_c"
        else:
            page_status = "withhold_for_now"
        top_reasons = Counter()
        for audit in audits:
            for reason in audit["failure_reasons"]:
                top_reasons[reason] += 1
        summary = {
            "page_number": page_number,
            "question_block_count": len(audits),
            "ready_for_phase_c_count": status_counter["ready_for_phase_c"],
            "needs_manual_review_count": status_counter["needs_manual_review"],
            "withhold_for_now_count": status_counter["withhold_for_now"],
            "page_readiness": page_status,
            "option_anchor_blocks": sum(1 for a in audits if a["option_anchors_detected"]),
            "remaining_option_incomplete_count": sum(1 for a in audits if "option_incomplete" in a["failure_reasons"]),
            "top_failure_reasons": dict(top_reasons.most_common(4)),
            "source_page_type": "mixed_special_page" if page_number in mixed_pages_processed else None,
            "mixed_page_recovered": page_number in mixed_pages_processed,
            "withheld_page": page_number in withheld_pages,
        }
        if page_number in mixed_pages_processed:
            summary["mixed_page_debug"] = {
                "question_blocks_recovered": mixed_pages_processed[page_number].get("question_blocks_recovered", 0),
                "solution_blocks_discarded": mixed_pages_processed[page_number].get("solution_blocks_discarded", 0),
                "low_confidence": mixed_pages_processed[page_number].get("low_confidence", False),
            }
        if page_number in withheld_pages:
            summary["withhold_note"] = withheld_pages[page_number].get("note", "")
        page_summaries.append(summary)

    representative_risky_blocks = [
        audit
        for audit in block_audits
        if audit["status"] != "ready_for_phase_c" and audit["page_number"] in set(report.get("summary", {}).get("low_confidence_pages", []))
    ][:12]

    return {
        "total_raw_blocks": len(question_blocks),
        "ready_for_phase_c_count": status_counts["ready_for_phase_c"],
        "needs_manual_review_count": status_counts["needs_manual_review"],
        "withhold_for_now_count": status_counts["withhold_for_now"],
        "blocks_improved_by_option_isolation": improved_by_option_isolation,
        "remaining_option_incomplete_count": reason_counts.get("option_incomplete", 0),
        "top_failure_reason_counts": dict(reason_counts.most_common(10)),
        "page_readiness_summary": page_summaries,
        "representative_risky_blocks": representative_risky_blocks,
        "block_readiness": block_audits,
    }


def extract_question_blocks_from_lines(
    lines: list[OCRLine],
    *,
    page_number: int,
    detected_pattern_heading: str | None,
) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    current: list[OCRLine] = []
    current_qnum: str | None = None
    for line in lines:
        match = _QUESTION_START_RE.match(line.text)
        if match:
            if current:
                raw_text = "\n".join(l.text for l in current).strip()
                merged = _merged_risk(raw_text)
                blocks.append(_block_from_lines(current, page_number=page_number, detected_pattern_heading=detected_pattern_heading, boundary_note="line_anchor_split"))
            current = [line]
            current_qnum = match.group(1)
        else:
            if current:
                current.append(line)
    if current:
        raw_text = "\n".join(l.text for l in current).strip()
        merged = _merged_risk(raw_text)
        blocks.append(_block_from_lines(current, page_number=page_number, detected_pattern_heading=detected_pattern_heading, boundary_note="line_anchor_split"))
    return blocks


def extract_question_blocks_from_page(
    page: Any,
    *,
    page_number: int,
    detected_pattern_heading: str | None,
) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    regions = _question_page_regions(page)
    all_blocks: list[dict[str, Any]] = []
    notes: list[str] = [f"region_count={len(regions)}"]
    before_after_samples: list[dict[str, Any]] = []

    baseline_lines = _parse_tsv_lines(_ocr_page_tsv(_render_page_png_bytes(page)))
    baseline_blocks = extract_question_blocks_from_lines(
        baseline_lines,
        page_number=page_number,
        detected_pattern_heading=detected_pattern_heading,
    )

    suppressed_false_anchors = 0
    recovered_anchors = 0
    accepted_anchor_sequence: list[int] = []
    low_conf_notes: list[str] = []

    for region in regions:
        lines = _ocr_lines_for_region(page, region)
        lines, suppressed_here, recovered_here = _prepare_question_anchor_lines(lines)
        suppressed_false_anchors += suppressed_here
        recovered_anchors += recovered_here
        anchors = _question_anchor_lines(lines)
        notes.append(f"{region.label}: lines={len(lines)} anchors={len(anchors)} suppressed={suppressed_here} recovered={recovered_here}")
        region_blocks = extract_question_blocks_from_lines(
            lines,
            page_number=page_number,
            detected_pattern_heading=detected_pattern_heading,
        )
        for block in region_blocks:
            block["region_label"] = region.label
            if block.get("bbox"):
                block["source_region_bbox"] = {
                    "x0": region.x0,
                    "y0": region.y0,
                    "x1": region.x1,
                    "y1": region.y1,
                }
        all_blocks.extend(region_blocks)

    all_blocks = sorted(
        all_blocks,
        key=lambda b: (
            b["bbox"]["y0"] if b.get("bbox") else 10**9,
            b["bbox"]["x0"] if b.get("bbox") else 10**9,
        ),
    )
    all_blocks, seq_notes = _stabilize_blocks_by_question_number(all_blocks)
    notes.extend(seq_notes)
    for block in all_blocks:
        qn = block.get("question_number_raw")
        if qn and str(qn).isdigit():
            accepted_anchor_sequence.append(int(qn))
    if len(accepted_anchor_sequence) < 3:
        low_conf_notes.append("few_accepted_anchors")
    if any(b["extraction_confidence"] < 0.75 for b in all_blocks):
        low_conf_notes.append("low_confidence_blocks_present")
    before_after_samples.append(
        {
            "page_number": page_number,
            "before_block_count": len(baseline_blocks),
            "after_block_count": len(all_blocks),
            "before_question_numbers": [b.get("question_number_raw") for b in baseline_blocks[:4]],
            "after_question_numbers": [b.get("question_number_raw") for b in all_blocks[:4]],
        }
    )
    page_summary = {
        "page_number": page_number,
        "raw_question_block_count": len(all_blocks),
        "suspected_merge_count": sum(1 for b in all_blocks if b["merged_question_risk"]),
        "low_confidence_block_count": sum(1 for b in all_blocks if b["extraction_confidence"] < 0.75),
        "boundary_detection_notes": notes,
        "region_count": len(regions),
        "anchor_count": len(accepted_anchor_sequence),
        "suppressed_false_anchors": suppressed_false_anchors,
        "recovered_anchors": recovered_anchors,
        "final_accepted_anchor_sequence": accepted_anchor_sequence,
        "low_confidence_anchor_notes": low_conf_notes,
    }
    return all_blocks, page_summary, before_after_samples


def extract_mixed_page_question_blocks(
    page: Any,
    *,
    page_number: int,
    detected_pattern_heading: str | None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    regions = _question_page_regions(page)
    recovered_question_blocks: list[dict[str, Any]] = []
    discarded_solution_blocks = 0
    low_confidence = False
    notes: list[str] = [f"region_count={len(regions)}"]

    for region in regions:
        lines = _ocr_lines_for_region(page, region)
        lines, suppressed_here, recovered_here = _prepare_question_anchor_lines(lines)
        notes.append(f"{region.label}: lines={len(lines)} suppressed={suppressed_here} recovered={recovered_here}")
        if not lines:
            continue

        candidates: list[list[OCRLine]] = []
        current: list[OCRLine] = []
        for line in lines:
            starts_question = bool(_QUESTION_START_RE.match(line.text))
            starts_solution = bool(_SOLUTION_START_RE.match(line.text))
            if (starts_question or starts_solution) and current:
                candidates.append(current)
                current = [line]
            else:
                current.append(line)
        if current:
            candidates.append(current)

        for candidate in candidates:
            kind, confidence, reasons = _mixed_block_kind(candidate)
            if kind == "question_block":
                block = _block_from_lines(
                    candidate,
                    page_number=page_number,
                    detected_pattern_heading=detected_pattern_heading,
                    boundary_note="mixed_page_candidate_split",
                )
                block["source_page_type"] = "mixed_special_page"
                block["mixed_block_confidence"] = round(confidence, 2)
                block["mixed_block_reasons"] = reasons
                block["region_label"] = region.label
                recovered_question_blocks.append(block)
                if confidence < 0.72:
                    low_confidence = True
            elif kind == "solution_block":
                discarded_solution_blocks += 1
            else:
                low_confidence = True

    summary = {
        "page_number": page_number,
        "mixed_page_recovered_question_blocks": len(recovered_question_blocks),
        "solution_blocks_discarded": discarded_solution_blocks,
        "low_confidence": low_confidence,
        "boundary_detection_notes": notes,
    }
    return recovered_question_blocks, summary


def extract_solution_blocks_from_lines(
    lines: list[OCRLine],
    *,
    page_number: int,
) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    current: list[OCRLine] = []
    current_qnum: str | None = None
    for line in lines:
        match = _SOLUTION_START_RE.match(line.text)
        if match:
            if current:
                raw_text = "\n".join(l.text for l in current).strip()
                blocks.append(
                    {
                        "page_number": page_number,
                        "raw_solution_text": raw_text,
                        "resolved_question_number": current_qnum,
                        "resolution_confidence": 0.92 if current_qnum else 0.0,
                        "has_formula": bool(_FORMULA_MARK_RE.search(raw_text)),
                        "has_diagram_note": bool(_DIAGRAM_WORD_RE.search(raw_text)),
                        "bbox": _aggregate_bbox(current),
                    }
                )
            current = [line]
            current_qnum = match.group(1)
        else:
            if current:
                current.append(line)
    if current:
        raw_text = "\n".join(l.text for l in current).strip()
        blocks.append(
            {
                "page_number": page_number,
                "raw_solution_text": raw_text,
                "resolved_question_number": current_qnum,
                "resolution_confidence": 0.92 if current_qnum else 0.0,
                "has_formula": bool(_FORMULA_MARK_RE.search(raw_text)),
                "has_diagram_note": bool(_DIAGRAM_WORD_RE.search(raw_text)),
                "bbox": _aggregate_bbox(current),
            }
        )
    if not blocks and lines:
        raw_text = "\n".join(l.text for l in lines).strip()
        blocks.append(
            {
                "page_number": page_number,
                "raw_solution_text": raw_text,
                "resolved_question_number": None,
                "resolution_confidence": 0.0,
                "has_formula": bool(_FORMULA_MARK_RE.search(raw_text)),
                "has_diagram_note": bool(_DIAGRAM_WORD_RE.search(raw_text)),
                "bbox": _aggregate_bbox(lines),
            }
        )
    return blocks


def extract_pattern_book_raw_blocks(pdf_path: str, write_report: bool = True) -> dict[str, Any]:
    try:
        import fitz  # type: ignore
    except ImportError as exc:
        raise RuntimeError("PyMuPDF (fitz) is required for pattern-book raw extraction") from exc

    classification_report = classify_pattern_book_pdf(pdf_path, write_report=True)
    doc = fitz.open(pdf_path)
    try:
        question_blocks: list[dict[str, Any]] = []
        solution_blocks: list[dict[str, Any]] = []
        mixed_pages: list[dict[str, Any]] = []
        low_confidence_pages: list[int] = []
        merged_risk_pages: list[int] = []
        page_question_summaries: list[dict[str, Any]] = []
        boundary_samples: list[dict[str, Any]] = []
        mixed_pages_processed: list[dict[str, Any]] = []
        question_blocks_recovered_from_mixed = 0
        solution_blocks_discarded = 0
        low_confidence_mixed_pages: list[int] = []

        for row in classification_report["pages"]:
            page_number = row["page_number"]
            page = doc[page_number - 1]
            if row["classification_confidence"] < 0.78:
                low_confidence_pages.append(page_number)

            if row["page_type"] == "mixed_special_page":
                recovered_blocks, mixed_summary = extract_mixed_page_question_blocks(
                    page,
                    page_number=page_number,
                    detected_pattern_heading=row.get("detected_pattern_heading"),
                )
                if recovered_blocks:
                    question_blocks.extend(recovered_blocks)
                    question_blocks_recovered_from_mixed += len(recovered_blocks)
                    mixed_pages_processed.append(
                        {
                            "page_number": page_number,
                            "question_blocks_recovered": len(recovered_blocks),
                            "solution_blocks_discarded": mixed_summary["solution_blocks_discarded"],
                            "low_confidence": mixed_summary["low_confidence"],
                            "classification_reasons": row["classification_reasons"],
                            "boundary_detection_notes": mixed_summary["boundary_detection_notes"],
                        }
                    )
                    solution_blocks_discarded += mixed_summary["solution_blocks_discarded"]
                    if mixed_summary["low_confidence"]:
                        low_confidence_mixed_pages.append(page_number)
                else:
                    mixed_pages.append(
                        {
                            "page_number": page_number,
                            "note": "withheld in Phase B because mixed page yielded no confident question blocks",
                            "manual_review_candidate": True,
                            "classification_reasons": row["classification_reasons"],
                        }
                    )
                continue

            if row["page_type"] not in {"question_page", "solution_page"}:
                continue

            if row["page_type"] == "question_page":
                blocks, page_summary, samples = extract_question_blocks_from_page(
                    page,
                    page_number=page_number,
                    detected_pattern_heading=row.get("detected_pattern_heading"),
                )
                if not blocks:
                    png_bytes = _render_page_png_bytes(page)
                    preview = _ocr_preview_text(png_bytes)
                    mixed_pages.append(
                        {
                            "page_number": page_number,
                            "note": "no OCR question blocks extracted after region segmentation",
                            "manual_review_candidate": True,
                            "ocr_preview": preview[:500],
                        }
                    )
                    continue
                question_blocks.extend(blocks)
                page_question_summaries.append(page_summary)
                if page_summary["suspected_merge_count"] > 0 or page_summary["region_count"] > 1 or page_number in {1, 2, 3}:
                    boundary_samples.extend(samples[:1])
                if any(block["merged_question_risk"] for block in blocks):
                    merged_risk_pages.append(page_number)
            else:
                png_bytes = _render_page_png_bytes(page)
                tsv_text = _ocr_page_tsv(png_bytes)
                lines = _parse_tsv_lines(tsv_text)
                if not lines:
                    preview = _ocr_preview_text(png_bytes)
                    mixed_pages.append(
                        {
                            "page_number": page_number,
                            "note": "no OCR lines extracted for solution block parsing",
                            "manual_review_candidate": True,
                            "ocr_preview": preview[:500],
                        }
                    )
                    continue
                blocks = extract_solution_blocks_from_lines(lines, page_number=page_number)
                solution_blocks.extend(blocks)

        report = {
            "pdf_path": str(Path(pdf_path).resolve()),
            "page_count": classification_report["page_count"],
            "classification_counts": classification_report["counts"],
            "summary": {
                "raw_question_blocks_extracted": len(question_blocks),
                "raw_solution_blocks_extracted": len(solution_blocks),
                "mixed_pages_skipped": len(mixed_pages),
                "mixed_pages_processed": len(mixed_pages_processed),
                "question_blocks_recovered_from_mixed": question_blocks_recovered_from_mixed,
                "solution_blocks_discarded": solution_blocks_discarded,
                "low_confidence_mixed_pages": sorted(set(low_confidence_mixed_pages)),
                "low_confidence_pages": sorted(set(low_confidence_pages)),
                "merged_question_risk_pages": sorted(set(merged_risk_pages)),
            },
            "question_blocks": question_blocks,
            "solution_blocks": solution_blocks,
            "mixed_pages": mixed_pages,
            "mixed_pages_processed": mixed_pages_processed,
            "question_page_summaries": page_question_summaries,
            "boundary_samples": boundary_samples[:8],
        }
        report["phase_c_readiness_audit"] = build_phase_c_readiness_audit(report)
        if write_report:
            report_path = _raw_report_path(pdf_path)
            report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
            report["report_path"] = str(report_path)
        return report
    finally:
        doc.close()
