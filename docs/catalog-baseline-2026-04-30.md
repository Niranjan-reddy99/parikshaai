# Catalog Baseline — 2026-04-30

This file records the known-good question bank state shown in the screenshot:

- Screenshot: `/Users/niranjan/Desktop/Screenshot 2026-04-30 at 8.42.27 AM.png`
- URL at capture time: `http://localhost:4000/`
- Mode: admin visible, student-style catalog cards

## Expected top-level numbers

- Questions: `7,933`
- Exam papers: `53`
- Years covered: `6+`
- Commissions: `6`

## Expected commissions visible

- `UPSC`
- `APPSC`
- `TSPSC`
- `AP`
- `APSLPRB`
- `TSLPRB`

## Expected commission card counts at capture time

- `UPSC`: `1,614` questions, `4` years, `9` papers
- `APPSC`: `1,264` questions, `4` years, `7` papers
- `TSPSC`: `3,426` questions, `4` years, `21` papers
- `AP`: `1,030` questions, `1` year, `13` papers
- `APSLPRB`: `200` questions, `1` year, `1` paper
- `TSLPRB`: `399` questions, `1` year, `2` papers

## Product meaning of this baseline

This is the reference "good enough to practice" catalog.

When catalog logic changes, we should compare the live app against this state:

- do not collapse to the tiny `publishable-only` subset
- do not expand to every historical/duplicate paper version
- include the six commissions above
- keep the question count near this clean baseline unless we intentionally add new clean papers

## What to verify after future catalog changes

1. `http://localhost:4000/` shows the six commissions above.
2. The top summary stays close to `7,933 / 53 / 6`.
3. No obvious duplicate exam versions appear in cards.
4. Practice sessions pull clean question rows, not repair/duplicate rows.
5. Reuploads do not replace a good older paper with an empty/bad newer version in the public catalog.

## Recommended next hardening work

1. Add a backend "catalog mode" test that asserts the six expected commissions exist.
2. Add a backend summary endpoint or snapshot test for total questions / papers / commissions.
3. Add explicit paper selection policy:
   latest usable paper per exam-year, not merely latest upload.
4. Add duplicate protection:
   one canonical public row per `exam_name + exam_year + question_number`.
5. Add a small admin-only "catalog health" panel:
   total questions, commissions, papers, and drift from this baseline.

