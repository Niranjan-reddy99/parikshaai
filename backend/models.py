"""
Pydantic models for request/response validation
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from uuid import UUID
from datetime import datetime


# ── Request Models ───────────────────────────────────────

class QuestionFilter(BaseModel):
    """Query parameters for filtering questions."""
    subject: Optional[str] = None
    topic: Optional[str] = None
    exam_name: Optional[str] = None
    exam_year: Optional[int] = None
    difficulty: Optional[str] = None
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class AttemptCreate(BaseModel):
    """Payload for recording a user attempt."""
    question_id: str
    selected_answer: str = Field(..., pattern="^[A-D]$")
    is_correct: bool
    time_taken_seconds: Optional[int] = None
    exam_name: Optional[str] = None
    subject: Optional[str] = None


class BatchQuestionInsert(BaseModel):
    """Single question in a batch insert."""
    question_text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    correct_answer: str = Field(..., pattern="^[A-D]$")
    subject: str
    topic: str = "General"
    subtopic: Optional[str] = None
    difficulty: str = "Medium"
    question_type: str = "MCQ"
    concept: Optional[str] = None
    exam_name: str
    exam_year: int
    source_pdf: Optional[str] = None
    explanation: Optional[str] = None


# ── Response Models ──────────────────────────────────────

class QuestionResponse(BaseModel):
    """Question without explanation (for practice/quiz)."""
    id: str
    question_text: str
    option_a: str
    option_b: str
    option_c: str
    option_d: str
    subject: str
    topic: str
    subtopic: Optional[str] = None
    difficulty: str
    exam_name: str
    exam_year: int
    question_type: str = "MCQ"
    concept: Optional[str] = None


class QuestionWithAnswer(QuestionResponse):
    """Question with correct answer (after user submits)."""
    correct_answer: str


class ExplanationResponse(BaseModel):
    """Explanation loaded separately (lazy loading)."""
    question_id: str
    explanation: str
    source: Optional[str] = None


class PaginatedQuestions(BaseModel):
    """Paginated response for question listing."""
    questions: List[QuestionResponse]
    total: int
    limit: int
    offset: int
    has_more: bool


class QuestionStats(BaseModel):
    """Summary stats for dashboard."""
    total_questions: int
    subjects: List[dict]
    difficulty_distribution: dict
    exam_years: List[int]


class HealthResponse(BaseModel):
    status: str
    database: str
    timestamp: str
