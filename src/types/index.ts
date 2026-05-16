/** Lightweight metadata — returned by /questions/meta. No question text or options. */
export interface QuestionMeta {
  id: string;
  exam: string;
  year: number;
  subject: string;
  topic: string;
  subtopic: string;
  difficulty: string;
}

export interface Question {
  id: string;
  question: string;
  question_number?: number;
  options: { A: string; B: string; C: string; D: string };
  answer?: string;
  answers?: string[];
  answerStatus?: string;
  explanation?: string;
  source?: string;
  flag_count?: number;
  subject: string;
  topic: string;
  subtopic: string;
  difficulty: string;
  concept: string;
  type: string;
  year: number;
  exam: string;
  passage?: string;
  shift?: string;
  needs_review?: boolean;
  has_image?: boolean;
  image_url?: string;
  pattern_tag?: string;
  trap_tag?: string;
  skill_tag?: string;
  question_style?: string;
  pattern_confidence?: number;
  pattern_reason?: string;
  solve_hint?: string;
}

export interface CatalogSummary {
  total_questions: number;
  commission_map: CommissionMap;
}

export interface FeedSubtopicSummary {
  subtopic: string;
  count: number;
  year_count: number;
  latest_exam: string;
  latest_year: number;
}

export interface FeedTopicSummary {
  topic: string;
  count: number;
  year_count: number;
  latest_exam: string;
  latest_year: number;
  subtopics: FeedSubtopicSummary[];
}

export interface FeedSubjectSummary {
  subject: string;
  count: number;
  year_count: number;
  latest_exam: string;
  latest_year: number;
  topics: FeedTopicSummary[];
}

export interface FeedExamTopicSummary {
  subject: string;
  topic: string;
  count: number;
  year_count: number;
  latest_year: number;
}

export interface FeedExamSummary {
  name: string;
  question_count: number;
  topic_count: number;
  year_count: number;
  latest_year: number;
  topics: FeedExamTopicSummary[];
}

export interface FeedSummary {
  subjects: FeedSubjectSummary[];
  exams?: FeedExamSummary[];
  total_questions: number;
}

export interface ExamOutlineTopic {
  topic: string;
  count: number;
  subtopics: { subtopic: string; count: number }[];
}

export interface ExamOutlineSubject {
  subject: string;
  count: number;
  topics: ExamOutlineTopic[];
}

export interface ExamOutline {
  exam_name: string;
  exam_year: number;
  total_count: number;
  subjects: ExamOutlineSubject[];
}

export interface ExamPaperManifestItem {
  paper_id: string | null;
  shift_label: string | null;
  question_count: number;
  first_question_number: number | null;
  last_question_number: number | null;
}

export interface ExamPaperManifest {
  exam_name: string;
  exam_year: number;
  total_count: number;
  papers: ExamPaperManifestItem[];
}

export interface PaginatedQuestionsResponse {
  questions: any[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_cursor?: string | null;
}

export type View = 'dashboard' | 'home' | 'commission' | 'exam-detail' | 'practice' | 'mock' | 'results' | 'browse' | 'report' | 'feed' | 'badges' | 'leaderboard' | 'pattern-practice' | 'profile' | 'bookmarks' | 'referral';

export interface ExamSession {
  questions: Question[];
  currentIndex: number;
  answers: Record<number, string>;
  startTime: number;
  duration: number;
  isFinished: boolean;
  examName: string;
  year: number;
  paperId?: string | null;
  shiftLabel?: string | null;
  totalCount?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
}

export interface ExamInfo {
  years: number[];
  count: number;
  yearCounts?: Record<string, number>;
  difficulty: Record<string, number>;
  fullName: string;
}

export type CommissionMap = Record<string, Record<string, ExamInfo>>;

export interface WeightageItem {
  subject: string;
  count: number;
  pct: number;
  topics: {
    topic: string;
    count: number;
    pct: number;
    subtopics: { subtopic: string; count: number; pct: number }[];
  }[];
}

export interface RepairQueueItem {
  exam: string;
  exam_name: string;
  exam_year: number;
  question_number?: number | null;
  question_id?: string | null;
  question_text?: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  correct_answer?: string;
  subject?: string;
  topic?: string;
  subtopic?: string;
  difficulty?: string;
  question_type?: string;
  concept?: string;
  passage?: string;
  has_image?: boolean;
  image_url?: string | null;
  is_active?: boolean;
  needs_review?: boolean;
  issue_type: string;
  severity: string;
  publish_blocker: string;
  repair_path: string;
  priority: string;
  safe_to_hide: boolean;
  reasons: string[];
}

export interface RepairQueuePaper {
  exam: string;
  exam_name: string;
  exam_year: number;
  publishable: boolean;
  likely_publishable_with_hidden_rows: boolean;
  blocked: boolean;
  visible_question_count: number;
  hidden_question_count: number;
  paper_blocker_count: number;
  row_blocker_count: number;
}

export interface PatternBookClassificationPage {
  page_number: number;
  page_type: string;
  classification_confidence: number;
  layout_type: string;
  column_count: number;
  has_diagram: boolean;
  detected_pattern_heading?: string | null;
  ocr_mode_used: string;
  classification_source: string;
  classification_reasons: string[];
  escalated_to_vision: boolean;
  text_confidence: number;
  vision_confidence: number;
}

export interface PatternBookClassificationReport {
  pdf_path: string;
  page_count: number;
  counts: Record<string, number>;
  pages: PatternBookClassificationPage[];
  report_path?: string;
}

export interface PatternQuestionBlock {
  page_number: number;
  raw_block_text: string;
  question_number_raw?: string | null;
  raw_options_text?: string;
  detected_pattern_heading?: string | null;
  bbox?: { x0: number; y0: number; x1: number; y1: number } | null;
  extraction_confidence: number;
  merged_question_risk?: boolean;
  boundary_detection_note?: string;
  region_label?: string;
  source_region_bbox?: { x0: number; y0: number; x1: number; y1: number };
}

export interface PatternSolutionBlock {
  page_number: number;
  raw_solution_text: string;
  resolved_question_number?: string | null;
  resolution_confidence: number;
  has_formula?: boolean;
  has_diagram_note?: boolean;
  bbox?: { x0: number; y0: number; x1: number; y1: number } | null;
}

export interface PatternMixedPage {
  page_number: number;
  note: string;
  manual_review_candidate: boolean;
  classification_reasons?: string[];
  ocr_preview?: string;
}

export interface PatternQuestionPageSummary {
  page_number: number;
  raw_question_block_count: number;
  suspected_merge_count: number;
  low_confidence_block_count: number;
  boundary_detection_notes: string[];
  region_count: number;
  anchor_count?: number;
  suppressed_false_anchors?: number;
  recovered_anchors?: number;
  final_accepted_anchor_sequence?: number[];
  low_confidence_anchor_notes?: string[];
}

export interface PatternBoundarySample {
  page_number: number;
  before_block_count: number;
  after_block_count: number;
  before_question_numbers: Array<string | null | undefined>;
  after_question_numbers: Array<string | null | undefined>;
}

export interface PatternBookRawReport {
  pdf_path: string;
  page_count: number;
  classification_counts: Record<string, number>;
  summary: {
    raw_question_blocks_extracted: number;
    raw_solution_blocks_extracted: number;
    mixed_pages_skipped: number;
    mixed_pages_processed?: number;
    question_blocks_recovered_from_mixed?: number;
    solution_blocks_discarded?: number;
    low_confidence_mixed_pages?: number[];
    low_confidence_pages: number[];
    merged_question_risk_pages: number[];
  };
  question_blocks: PatternQuestionBlock[];
  solution_blocks: PatternSolutionBlock[];
  mixed_pages: PatternMixedPage[];
  mixed_pages_processed?: Array<{
    page_number: number;
    question_blocks_recovered: number;
    solution_blocks_discarded: number;
    low_confidence: boolean;
    classification_reasons: string[];
    boundary_detection_notes: string[];
  }>;
  question_page_summaries?: PatternQuestionPageSummary[];
  boundary_samples?: PatternBoundarySample[];
  report_path?: string;
}

export interface PatternNormalizedDraftQuestion {
  question_number: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  source_page_number: number;
  source_block_id: string;
  extraction_confidence: number;
  source_page_type: string;
  normalization_notes?: string[];
  detected_pattern_heading?: string | null;
  source_bbox?: { x0: number; y0: number; x1: number; y1: number } | null;
}

export interface PatternNormalizedDraftFailure {
  source_block_id: string;
  page_number: number;
  question_number_raw?: string | null;
  reason: string;
  missing_option_labels?: string[];
}

export interface PatternNormalizedDraftReport {
  pdf_path: string;
  page_count: number;
  source_report_path?: string;
  phase_c_readiness_audit_summary: {
    total_raw_blocks: number;
    ready_for_phase_c_count: number;
    needs_manual_review_count: number;
    withhold_for_now_count: number;
  };
  summary: {
    blocks_considered_for_normalization: number;
    normalized_blocks_count: number;
    normalization_failures_count: number;
    pages_contributing_normalized_questions: number[];
  };
  normalized_questions: PatternNormalizedDraftQuestion[];
  normalization_failures: PatternNormalizedDraftFailure[];
  sample_normalized_outputs?: PatternNormalizedDraftQuestion[];
  report_path?: string;
}

export interface PatternStage12PageProcessed {
  page_number: number;
  page_type: string;
  detected_pattern_heading?: string | null;
  classification_source?: string;
  classification_confidence?: number;
  questions_extracted: number;
  invalid_question_objects: number;
}

export interface PatternStage12Question {
  question_number: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  source_page_number: number;
  source_page_type: string;
  source_block_id?: string;
  detected_pattern_heading?: string | null;
  classification_source?: string;
  classification_confidence?: number;
}

export interface PatternStage12ReviewItem {
  page_number: number;
  page_type: string;
  object_index: number;
  reasons: string[];
  raw_item: unknown;
}

export interface PatternStage12Report {
  pdf_path: string;
  page_count: number;
  classification_counts: Record<string, number>;
  summary: {
    pages_processed: number;
    total_questions_extracted: number;
    valid_extracted_questions: number;
    review_bucket_count: number;
  };
  pages_processed: PatternStage12PageProcessed[];
  extracted_questions: Array<Record<string, unknown>>;
  valid_questions: PatternStage12Question[];
  review_bucket: PatternStage12ReviewItem[];
  sample_extracted_mcqs?: PatternStage12Question[];
  source_classification_report_path?: string;
  report_path?: string;
}

export interface ReportData {
  examName: string;
  year: number;
  totalQuestions: number;
  generatedAt: string;
  subjectDistribution: { subject: string; count: number; percentage: number }[];
  topicWise: { subject: string; topics: { topic: string; count: number }[] }[];
  difficultyAnalysis: {
    easy: number;
    medium: number;
    hard: number;
    total: number;
    easyPercent: number;
    mediumPercent: number;
    hardPercent: number;
    explanation: string;
  };
  currentVsStatic: {
    current: number;
    static: number;
    currentPercent: number;
    staticPercent: number;
  };
  keyInsights: string[];
  comparisonWithPreviousYears: string[];
  predictionsForNextExam: string[];
  studentStrategy: string[];
  overallVerdict: string;
}
