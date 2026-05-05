# Refactor Review — 2026-05-05

This document records the incremental refactoring work completed during the current cleanup pass.

Goal of this pass:
- improve navigability for future coding agents
- reduce file size and mixed responsibilities in major UI/backend surfaces
- avoid regressions in live question flows, exam flows, admin flows, and public question visibility

Non-goals of this pass:
- no product redesign
- no route/path changes
- no schema changes
- no question filtering policy changes
- no publish-gate policy changes
- no intentional changes to question availability


## Refactoring Principles Used

The following constraints were followed throughout:

1. Refactor one surface at a time.
2. Keep existing props/callbacks stable where possible.
3. Extract presentation and pure helper logic before moving behavior-heavy orchestration.
4. Verify after each slice instead of batching many risky changes together.
5. Prefer tests/compile checks before deeper backend decomposition.


## Frontend Work Completed

### 1. Browse Flow Refactor

Primary file before:
- `src/views/BrowseView.tsx`

What changed:
- converted `BrowseView` into a thinner container
- added section markers for state, derived data, handlers, and render
- extracted exam picker UI
- extracted question list UI
- extracted browse configuration/constants

New files:
- `src/views/browse/browseConfig.ts`
- `src/views/browse/BrowseExamPicker.tsx`
- `src/views/browse/BrowseQuestionList.tsx`

What was intentionally preserved:
- exam picker year selection behavior
- `onPickExam(...)` callback shape
- filter clearing behavior
- empty state behavior
- admin edit button behavior
- load more / retry behavior

Why this was safe:
- the parent view still owns the same props and state transitions
- extracted pieces are presentation-focused
- no browsing or question-fetch logic changed


### 2. Practice Flow Refactor

Primary file before:
- `src/views/PracticeView.tsx`

What changed:
- converted `PracticeView` into a container with clearer sections
- extracted top focus/progress/filter bar
- extracted main question card
- extracted session sidebar/navigator
- extracted shared practice helper logic

New files:
- `src/views/practice/practiceUtils.ts`
- `src/views/practice/PracticeFocusBar.tsx`
- `src/views/practice/PracticeQuestionCard.tsx`
- `src/views/practice/PracticeSessionSidebar.tsx`

What was intentionally preserved:
- answer selection flow
- blocked explanation handling
- bookmark action
- flag action
- admin edit action
- restart behavior
- prev/next/skip/done behavior
- load-more / retry behavior
- subject/topic restart behavior

Why this was safe:
- `PracticeView` still owns the routing-level callbacks and queue state
- option-state logic was moved into helpers without changing decision rules
- explanation display rules remained unchanged


### 3. Exam Detail Flow Refactor

Primary file before:
- `src/views/ExamDetailView.tsx`

What changed:
- kept exam-detail orchestration in the parent
- extracted presentation sections for header, controls, audit section, mode cards, and subject breakdown
- extracted pure exam-detail derivation helpers

New files:
- `src/views/exam-detail/examDetailUtils.ts`
- `src/views/exam-detail/ExamDetailHeader.tsx`
- `src/views/exam-detail/ExamDetailControls.tsx`
- `src/views/exam-detail/ExamDetailAuditSection.tsx`
- `src/views/exam-detail/ExamDetailModeCards.tsx`
- `src/views/exam-detail/ExamDetailSubjectBreakdown.tsx`

What was intentionally preserved:
- selected year behavior
- year lock/premium gating behavior
- paper selection behavior
- admin rename/delete/add-question actions
- audit expand/collapse behavior
- subject/topic practice launch behavior
- browse-all behavior
- mock exam launch behavior

Why this was safe:
- all sensitive state stayed in `ExamDetailView`
- extracted pieces are display-oriented and callback-driven
- no route or fetch logic was moved out of the parent


### 4. Mock Exam Flow Refactor

Primary file before:
- `src/views/MockView.tsx`

What changed:
- converted `MockView` into a smaller container
- extracted timer/top bar
- extracted question panel
- extracted navigator palette
- extracted timer/count helper functions

New files:
- `src/views/mock/mockUtils.ts`
- `src/views/mock/MockTopBar.tsx`
- `src/views/mock/MockQuestionPanel.tsx`
- `src/views/mock/MockQuestionPalette.tsx`

What was intentionally preserved:
- submit exam confirmation
- answer writeback into `examSession.answers`
- question navigation behavior
- next vs load-next-batch behavior
- navigator button behavior
- timer warning/critical styling behavior

Why this was safe:
- `MockView` still owns `setExamSession(...)`
- extracted pieces do not own session state
- load-more behavior still depends on the same parent values


## Backend Work Completed

Primary file targeted:
- `backend/main.py`

Initial size observed:
- about `5,154` lines earlier in the pass

Current size checked later:
- `4,875` lines

Important note:
- this reduction came from slow helper extraction only
- no broad route split was attempted
- no major API behavior rewrite was attempted


### Backend Strategy Used

The backend refactor intentionally started with the safest categories:

1. pure public metadata helpers
2. public metadata collection helpers
3. public exam row collection helper
4. public exam page streaming helper
5. paper-manifest wrapper helper
6. regression tests for the extracted public pipeline

This was chosen because these helpers are easier to verify than admin mutation flows or publish-gate internals.


### 1. Extracted Pure Public Metadata Helpers

New file:
- `backend/public_metadata_helpers.py`

Responsibilities moved there:
- safe cursor parsing
- search matching
- public row identity logic
- catalog summary building from meta rows
- feed summary building from meta rows
- exam outline building from rows
- exam paper manifest shaping from already-fetched rows

What stayed in `main.py`:
- routes
- Supabase access
- cache ownership
- public visibility policy
- publish-ready/public filtering decisions


### 2. Extracted Public Metadata Query Helpers

New file:
- `backend/public_metadata_queries.py`

Responsibilities moved there:
- public metadata row collection
- public exam row collection
- public paginated page streaming
- exam paper manifest wrapper over collected rows

Important safety choice:
- these helpers receive dependencies explicitly from `main.py`
- this avoids hidden behavior changes while shrinking `main.py`

Dependencies still owned by `main.py` and passed in:
- `supabase`
- cache objects
- normalization helpers
- selected-paper filters
- visibility filters
- sanitizers
- merge helpers


## Tests and Verification Added

### Build/Type Checks Used During Refactor

Repeatedly used:
- `npm run lint`
- `npm run build`
- `python3 -m py_compile ...`

These were used after each major frontend/backend slice.


### New Regression Test File Added

New file:
- `backend/test_public_metadata_queries.py`

Current coverage added:

1. `collect_public_exam_rows(...)`
- verifies duplicate rows from the same paper/shift are merged
- verifies rows from different shifts are kept distinct

2. `stream_public_exam_page(...)`
- verifies pagination happens on deduped rows
- verifies `total`, `has_more`, and `next_cursor`

3. `build_exam_paper_manifest_from_rows(...)`
- verifies rows are grouped by `paper_id` and `shift_label`
- verifies legacy no-paper rows remain represented
- verifies question count / first / last question numbers

Why these tests matter:
- they directly protect against “missing questions” regressions
- they protect multi-shift and multi-paper exam handling
- they protect public metadata and public question navigation behavior


## Regressions Found and Fixed During This Pass

These issues were discovered after incremental refactoring and then fixed in a narrow follow-up pass.

### 1. Topic Practice 500 Error

User-visible symptom:
- topic practice failed with `Could not start practice for History -> Modern History: Failed to load topic questions (500)`

Root cause:
- during backend helper extraction, `_topic_bucket_questions(...)` in `backend/main.py` still referenced the old helper name `_public_row_identity(...)`
- the helper had already been extracted, so this stale reference could raise a backend error when `/topic-questions` was called

Additional hardening added:
- topic-bucket sorting was also made safe for malformed `question_number` values

Files involved:
- `backend/main.py`
- `backend/test_topic_bucket_questions.py`

Safeguard added:
- regression test coverage for topic-bucket question loading and malformed question-number sorting


### 2. Practice Explanations Missing or Appearing Blank

User-visible symptom:
- explanations were not appearing in practice mode even after answering questions

Root cause:
- practice mode used stricter explanation fetch timeouts than results mode
- blocked/unavailable explanation states were often collapsed into an empty UI instead of a visible message
- this made slow explanation generation look like missing explanations

Files involved:
- `src/App.tsx`
- `src/views/practice/PracticeQuestionCard.tsx`
- `src/views/practice/practiceUtils.ts`

Fix applied:
- increased practice explanation fetch timeouts
- preserved blocked/unavailable explanation states in practice flow
- added explicit practice-mode fallback panels for:
  - `Explanation Pending Review`
  - `Explanation Unavailable`

Why this matters:
- prevents explanation failures from looking like silent broken UI
- keeps answer-verification safeguards intact while making the user experience clearer


## Files Added or Touched in This Refactor Pass

### Frontend files added

- `src/views/browse/browseConfig.ts`
- `src/views/browse/BrowseExamPicker.tsx`
- `src/views/browse/BrowseQuestionList.tsx`
- `src/views/practice/practiceUtils.ts`
- `src/views/practice/PracticeFocusBar.tsx`
- `src/views/practice/PracticeQuestionCard.tsx`
- `src/views/practice/PracticeSessionSidebar.tsx`
- `src/views/exam-detail/examDetailUtils.ts`
- `src/views/exam-detail/ExamDetailHeader.tsx`
- `src/views/exam-detail/ExamDetailControls.tsx`
- `src/views/exam-detail/ExamDetailAuditSection.tsx`
- `src/views/exam-detail/ExamDetailModeCards.tsx`
- `src/views/exam-detail/ExamDetailSubjectBreakdown.tsx`
- `src/views/mock/mockUtils.ts`
- `src/views/mock/MockTopBar.tsx`
- `src/views/mock/MockQuestionPanel.tsx`
- `src/views/mock/MockQuestionPalette.tsx`

### Frontend files updated

- `src/views/BrowseView.tsx`
- `src/views/PracticeView.tsx`
- `src/views/ExamDetailView.tsx`
- `src/views/MockView.tsx`

### Backend files added

- `backend/public_metadata_helpers.py`
- `backend/public_metadata_queries.py`
- `backend/test_public_metadata_queries.py`

### Backend files updated

- `backend/main.py`


## What Was Explicitly Not Refactored Yet

These areas were intentionally left alone because they are more behavior-sensitive:

- admin mutation routes in `backend/main.py`
- publish-gate computation internals
- explanation generation routes
- upload/job processing routes
- heavy admin flows related to papers and repairs
- public single-question route behavior
- results flow UI

Reason:
- these are more likely to impact visibility, publishing, or content correctness if moved too fast


## Known Safe Invariants Preserved

The following were treated as invariants during this pass:

- no route paths changed
- no question schema changed
- no public visibility filter policy changed
- no publish-ready policy changed
- no admin action names changed
- no browsing flow was intentionally removed
- no exam launch path was intentionally removed
- no question-loading callback signature was intentionally changed


## Recommended Next Steps

Best next step for maximum safety:
- keep using test-backed extraction only

Recommended order:

1. Add a regression test before each risky backend extraction.
2. Only then continue shrinking `main.py`.
3. Prefer public read-path helpers before admin mutation helpers.
4. Avoid broad route splitting until helper extraction and test coverage are stronger.

If another backend refactor is needed next, safest candidates are:
- another isolated public helper cluster
- or a small admin-read-only helper cluster

Less safe candidates for immediate work:
- publish-gate computation internals
- admin mutation route splitting
- upload pipeline orchestration


## How To Use This File Later

If something appears missing later:

1. Check which surface is affected.
2. Use the “Files Added or Touched” section above to find the likely refactor area.
3. Verify whether the issue is in:
   - presentation extraction
   - helper extraction
   - existing older code unrelated to this pass
4. Use the regression tests in `backend/test_public_metadata_queries.py` as the first backend safety check.

This file is meant to be the quick audit trail for this cleanup pass.
