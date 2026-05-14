# Product PRD — 2026-05-12

This document describes the current product, feature set, system structure, and operational flows of the Pariksha platform as implemented in this repository.

It is meant to serve as:
- the current product requirements document
- a feature inventory
- a system map for future development
- a handoff/orientation guide for future coding agents


## 1. Product Summary

Pariksha is a question-bank and exam-practice platform for government exam preparation.

The product has two separate surfaces:
- a learner-facing app for browsing papers, practicing questions, taking mock exams, reviewing results, and tracking progress
- an admin-facing app for uploading PDFs, extracting content, repairing data, and publishing cleaned papers to the learner app

The platform supports two major content models:
- exam-paper driven preparation
- pattern/chapter driven preparation for SSC-style content books


## 2. Product Vision

Pariksha should help aspirants do three things well:
- find the right questions quickly
- practice in a format that feels close to the real exam
- review performance clearly enough to improve weak areas

For admins, the product should make it practical to turn raw PDFs into reliable learner-facing question sets with minimal manual cleanup.


## 3. Core User Types

### 3.1 Learner

Primary goals:
- choose a commission or exam
- access PYQs by year, paper, topic, and subtopic
- practice with verified answers and explanations
- take mock-style timed sessions
- identify strengths, weaknesses, and recent mistakes

### 3.2 Admin / Content Operator

Primary goals:
- upload question-paper PDFs
- upload SSC content/pattern books
- repair missing or malformed questions
- edit answers/options/question text
- rename exams cleanly
- crop and attach images to visual questions
- explicitly publish cleaned papers to the learner app


## 4. Product Surfaces

### 4.1 Learner App

Runtime:
- `localhost:4000`

Primary shell:
- [src/App.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/App.tsx)

Navigation:
- [src/components/Navbar.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/components/Navbar.tsx)

Primary top-level views:
- Home
- Question Bank
- Insights
- Bookmarks
- Leaderboard
- PYQ Feed
- Pattern Practice
- Landing Page

### 4.2 Admin App

Runtime:
- `localhost:4001`

Primary shell:
- [frontend/src/App.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/frontend/src/App.tsx)

Primary responsibilities:
- upload PDFs
- monitor jobs
- load review workspace
- edit extracted questions
- repair missing questions
- rename exam
- publish paper to frontend
- upload SSC pattern-book PDFs

### 4.3 Public Backend

Runtime:
- `localhost:8000`

Primary backend file:
- [backend/main.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/main.py)

Responsibilities:
- serve learner APIs
- serve public metadata/catalog/feed endpoints
- serve practice/mock/question endpoints
- serve pattern-book learner APIs
- serve leaderboard and analytics-supporting endpoints

### 4.4 Admin Backend

Runtime:
- typically `localhost:8080`

Responsibilities:
- admin upload routes
- admin repair queue and question editing routes
- publish-control routes
- image upload/crop routes
- pattern-book ingestion routes
- extraction job polling


## 5. Repository Structure

```text
upsc-ai-strategy-engine/
├─ src/                            # learner-facing React app
│  ├─ App.tsx
│  ├─ components/
│  ├─ lib/
│  ├─ types/
│  └─ views/
├─ frontend/                       # separate admin React app
│  ├─ src/
│  └─ vite.config.ts
├─ backend/                        # FastAPI, extraction, repair, publishing
│  ├─ main.py
│  ├─ extractor/
│  ├─ public_metadata_helpers.py
│  ├─ public_metadata_queries.py
│  ├─ papers.py
│  ├─ pipeline.py
│  ├─ row_quality.py
│  ├─ question_repairs.py
│  ├─ pattern_tagger.py
│  ├─ migration.sql
│  ├─ schema.sql
│  ├─ uploads/
│  ├─ cache/
│  └─ run_public.sh / run_admin.sh
├─ public/                         # learner static assets
├─ docs/                           # product and engineering docs
├─ dist/                           # learner build output
└─ package.json                    # shared scripts
```


## 6. Learner Features

### 6.1 Landing Page

File:
- [src/views/LandingPage.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/LandingPage.tsx)

Purpose:
- introduce the product clearly
- explain free vs premium
- show core workflow
- help a new user understand what Pariksha does

Current content areas:
- hero
- feature framing
- workflow explanation
- exam/question-bank messaging
- pricing section
- call-to-action

### 6.2 Onboarding / Exam Selection

Files:
- [src/components/OnboardingModal.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/components/OnboardingModal.tsx)
- [src/views/HomeView.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/HomeView.tsx)

Purpose:
- help users choose initial commissions/exam areas
- personalize later surfaces like leaderboard scope

### 6.3 Home

File:
- [src/views/HomeView.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/HomeView.tsx)

Purpose:
- quick entry into question bank
- quick start for practice/mock
- present the app as a preparation workspace, not just a raw database

### 6.4 Question Bank

Files:
- [src/views/BrowseView.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/BrowseView.tsx)
- [src/views/CommissionView.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/CommissionView.tsx)
- [src/views/ExamDetailView.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/ExamDetailView.tsx)

Purpose:
- browse questions by commission, exam, year, paper, and topic

Current model:
- Question Bank home: exam discovery
- Commission page: paper discovery
- Exam detail/workspace: choose practice or mock against a specific paper

Important behavior:
- supports multi-paper or multi-shift manifests under the same exam/year
- supports free vs premium gating
- supports current exam-specific search context

### 6.5 Practice Mode

Files:
- [src/views/PracticeView.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/PracticeView.tsx)
- [src/views/practice/PracticeQuestionCard.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/practice/PracticeQuestionCard.tsx)

Purpose:
- untimed learning flow
- instant feedback after answering
- explanation-first understanding
- question-by-question self-paced learning

Capabilities:
- answer selection
- explanation display
- bookmark
- flag
- admin edit entry point where applicable
- topic-specific or paper-specific practice
- load more questions in longer sessions

### 6.6 Mock Exam Mode

Files:
- [src/views/MockView.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/MockView.tsx)
- [src/views/mock/MockQuestionPanel.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/mock/MockQuestionPanel.tsx)

Purpose:
- timed exam simulation
- real exam-like navigation and submission flow

Capabilities:
- timer
- palette navigation
- answer persistence
- load more questions when needed
- final submission and results review

### 6.7 Results + Review

File:
- [src/views/ResultsView.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/ResultsView.tsx)

Purpose:
- show outcomes after mock submission
- review right/wrong/skipped answers
- show explanations and official answer-state notes

Special answer-state support:
- normal verified answer
- multiple accepted answers
- deleted questions

### 6.8 Insights

File:
- [src/views/DashboardView.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/DashboardView.tsx)

Current insight sections:
- Strengths & Weaknesses
- Topic Analysis
- Test Analysis

Expected distinction:
- Strengths & Weaknesses: user performance view
- Topic Analysis: coverage/distribution view
- Test Analysis: attempt review and mistake-pattern view

### 6.9 Bookmarks

File:
- [src/views/BookmarksView.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/BookmarksView.tsx)

Purpose:
- save questions for later review
- practice all bookmarked questions together

### 6.10 Leaderboard

File:
- [src/views/LeaderboardView.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/LeaderboardView.tsx)

Purpose:
- rank users within their enrolled commission scope
- show relative performance and motivation layer

Current behavior:
- filtered to enrolled commissions rather than global mixed ranking
- now backed by live backend aggregation instead of static mock data

### 6.11 PYQ Feed

File:
- [src/views/FeedView.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/FeedView.tsx)

Purpose:
- surface subject/topic/subtopic clusters across exams
- let users practice topic buckets outside one specific paper

Important behavior:
- feed-launched practice now shows source exam labels per question

### 6.12 Pattern Practice

File:
- [src/views/PatternPracticeView.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/PatternPracticeView.tsx)

Purpose:
- support SSC-style chapter/pattern books
- organize chapter questions by `pattern_tag`
- let users practice recurring question types rather than only paper-wise PYQs

Current intended model:
- one book per uploaded chapter or content PDF
- questions grouped by pattern
- pattern-wise practice inside learner app


## 7. Learner Content Rendering Features

### 7.1 Structured Question Rendering

File:
- [src/lib/QuestionText.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/lib/QuestionText.tsx)

Purpose:
- render structured question bodies beyond plain text

Current supported special case:
- `__MATCH__` payloads for match-the-following questions

### 7.2 Visual Question Support

Supported behaviors:
- image-backed questions
- figure/diagram attachment
- special handling for cropped question images

### 7.3 Answer-State Semantics

Supported states:
- single correct answer
- multiple accepted answers
- deleted question
- pending review / withheld explanation state


## 8. Premium Model

Core logic:
- free tier is meant to demonstrate workflow
- premium unlocks depth across archive/history and broader usage

Current premium themes:
- limited free access to some papers/workflows
- deeper archive access for premium users
- premium gating around certain question-bank surfaces and actions

Related files:
- [src/components/PremiumGateModal.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/components/PremiumGateModal.tsx)
- [src/views/LandingPage.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/views/LandingPage.tsx)


## 9. Admin Features

### 9.1 PDF Upload Console

File:
- [frontend/src/App.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/frontend/src/App.tsx)

Purpose:
- central admin entry point for content ingestion

Current upload modes:
- standard exam paper upload
- SSC content / pattern-book upload

### 9.2 Job Tracking

Capabilities:
- recent jobs list
- current upload status
- polling for progress
- error state handling

### 9.3 Review Workspace

Purpose:
- load the latest uploaded paper into a repair/edit surface

Capabilities:
- load by exam/year
- review publishability
- inspect blockers
- inspect row-level repair items

### 9.4 Repair Queue

Purpose:
- make paper blockers visible and actionable

Displays:
- publishable / blocked
- visible question count
- hidden question count
- row blockers
- paper blockers
- exact missing question numbers

### 9.5 Direct Question Editing

Capabilities:
- edit question text
- edit options
- edit answer
- edit topic/subject metadata
- edit difficulty and type

### 9.6 Missing Question Repair

Capabilities:
- add blank question placeholders
- repair numbering gaps
- manually recover damaged rows

### 9.7 Image Upload / Cropping

Purpose:
- attach cropped images to questions that depend on figures or diagrams

Backend route:
- admin question image upload in [backend/main.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/main.py)

### 9.8 Rename Exam

Purpose:
- correct uploaded exam naming without re-uploading the paper

### 9.9 Publish to Frontend

Purpose:
- explicitly move a repaired paper into learner visibility

Important behavior:
- publishing is not just “upload completed”
- paper must satisfy publish-state rules or publish with hidden rows if allowed


## 10. Backend Architecture

### 10.1 Main API Layer

Primary file:
- [backend/main.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/main.py)

Contains:
- public learner endpoints
- admin-only endpoints
- upload/job orchestration
- leaderboard endpoint
- pattern-book endpoints
- repair and publish actions

### 10.2 Metadata Layer

Files:
- [backend/public_metadata_helpers.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/public_metadata_helpers.py)
- [backend/public_metadata_queries.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/public_metadata_queries.py)

Purpose:
- build catalog summary
- build PYQ feed summary
- build exam outlines
- build paper manifests
- stream paginated public question pages

### 10.3 Paper Lifecycle / Publish Layer

File:
- [backend/papers.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/papers.py)

Purpose:
- track papers separately from raw question rows
- manage publish status, lifecycle status, question counts, and public visibility

### 10.4 Quality + Repair Layer

Files:
- [backend/row_quality.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/row_quality.py)
- [backend/question_repairs.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/question_repairs.py)
- [backend/pipeline.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/pipeline.py)

Purpose:
- score row quality
- track review needs
- preserve answer/explanation/tagging states
- support repair workflows

### 10.5 Taxonomy Layer

File:
- [backend/canonical_taxonomy.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/canonical_taxonomy.py)

Purpose:
- normalize subject/topic/subtopic naming
- reduce long-term metadata drift


## 11. Extraction Pipelines

### 11.1 Exam Paper Routing

File:
- [backend/extractor/router.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/extractor/router.py)

Purpose:
- detect which extraction pipeline should handle a PDF

### 11.2 Universal Exam Extraction

File:
- [backend/extractor/universal_extractor.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/extractor/universal_extractor.py)

Purpose:
- default path for many uploaded papers
- supports general MCQ extraction and image-aware recovery

### 11.3 CBT Extraction

File:
- [backend/extractor/cbt_pipeline.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/extractor/cbt_pipeline.py)

Purpose:
- extract CBT-style papers
- better suited for structured digital formats

### 11.4 Vision / Scanned Extraction

Files:
- [backend/extractor/vision_extractor.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/extractor/vision_extractor.py)
- [backend/extractor/scanned_extractor.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/extractor/scanned_extractor.py)

Purpose:
- handle PDFs that need image/OCR-first treatment

### 11.5 SSC Pattern-Book Pipeline

Files:
- [backend/extractor/pattern_book_classifier.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/extractor/pattern_book_classifier.py)
- [backend/extractor/pattern_book_gemini_stage12.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/extractor/pattern_book_gemini_stage12.py)
- [backend/extractor/pattern_book_pipeline.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/extractor/pattern_book_pipeline.py)
- [backend/extractor/pattern_book_raw_blocks.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/extractor/pattern_book_raw_blocks.py)
- [backend/extractor/pattern_book_phase_c_drafts.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/extractor/pattern_book_phase_c_drafts.py)

Purpose:
- classify question pages vs solution pages
- extract chapter/pattern-book questions
- assign `pattern_tag`
- ingest into `pattern_books` and `pattern_questions`

Current intended output:
- chapter-style question pool for Pattern Practice
- sorted in book flow
- grouped by real pattern section, not just one generic chapter label


## 12. Data Model Overview

Major logical entities:
- `questions`
- `papers`
- `jobs`
- `explanations`
- `pattern_books`
- `pattern_questions`
- leaderboard / attempt data

Role of each:
- `questions`: learner-visible MCQ rows and metadata
- `papers`: upload/version/publish wrapper for a paper
- `jobs`: upload/extraction progress tracking
- `explanations`: generated or corrected explanation records
- `pattern_books`: SSC chapter/book containers
- `pattern_questions`: pattern-practice question rows


## 13. Major User Flows

### 13.1 Learner Paper Flow

1. User opens Question Bank.
2. User selects commission.
3. User selects exam and year.
4. User selects a paper if multiple papers/shifts exist.
5. User chooses Practice or Mock.
6. User completes session.
7. User reviews results and insights.

### 13.2 Learner Topic Flow

1. User opens PYQ Feed.
2. User picks subject/topic/subtopic.
3. User enters mixed-source practice session.
4. User sees source exam per question.
5. User reviews topic performance.

### 13.3 Admin Paper Upload Flow

1. Admin uploads question-paper PDF.
2. Backend creates job and runs extraction.
3. Admin loads review workspace.
4. Admin repairs missing/bad questions.
5. Admin edits questions as needed.
6. Admin renames exam if needed.
7. Admin publishes paper to learner frontend.

### 13.4 Admin SSC Pattern-Book Flow

1. Admin uploads SSC content/pattern-book PDF.
2. Backend classifies pages and extracts chapter questions.
3. Backend assigns pattern tags and ingests pattern questions.
4. Learner app shows the book under Pattern Practice.


## 14. Current Strengths

- Separate learner and admin surfaces
- Strong upload → repair → publish workflow for exam papers
- Support for practice and mock separately
- Public metadata layer for question-bank browsing
- Repair queue and explicit publish semantics
- Support for special answer states
- Early but real SSC pattern-practice path


## 15. Current Weaknesses / Gaps

- Pattern Practice is still less mature than the main exam-paper flow
- Some extraction paths still need stronger mixed-page recovery
- Pricing/premium is product-positioned but not yet a full billing system
- Some scripts in backend are operational repair utilities rather than polished product modules
- Caches and duplicate rows can create subtle visibility/debugging issues if publish/order logic is not carefully preserved


## 16. Current Non-Goals

These are not yet the core finished product outcomes:
- full payment/checkout system
- full CMS-grade admin content studio
- perfect no-touch OCR across every exam format
- fully automated explanation correctness for every imported question


## 17. Strategic Product Shape

Pariksha currently sits at the intersection of:
- PYQ question bank
- exam simulation
- topic-based revision
- admin content ingestion and repair

The strongest long-term product loop is:
- upload paper or pattern book
- repair and verify content
- publish clean learner-facing practice
- collect attempt data
- feed insights and rankings back into learner behavior


## 18. Source of Truth Files

If someone needs to understand the product quickly, start here:
- learner shell: [src/App.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/App.tsx)
- learner types: [src/types/index.ts](/Users/niranjan/Downloads/upsc-ai-strategy-engine/src/types/index.ts)
- admin shell: [frontend/src/App.tsx](/Users/niranjan/Downloads/upsc-ai-strategy-engine/frontend/src/App.tsx)
- backend API: [backend/main.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/main.py)
- paper lifecycle: [backend/papers.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/papers.py)
- public metadata logic: [backend/public_metadata_helpers.py](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/public_metadata_helpers.py)
- extraction pipelines: [backend/extractor/](/Users/niranjan/Downloads/upsc-ai-strategy-engine/backend/extractor)


## 19. Recommended Next Documentation

Useful follow-up docs after this PRD:
- learner user-flow diagrams
- admin upload/review/publish SOP
- extraction-pipeline capability matrix
- premium/access policy doc
- content quality policy doc
