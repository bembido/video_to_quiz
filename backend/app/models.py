from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class VideoUploadResponse(BaseModel):
    video_id: str
    duration_seconds: float
    segments_count: int


class SegmentOut(BaseModel):
    id: str
    video_id: str
    index: int
    start_time: str
    end_time: str
    topic_title: str
    short_summary: str
    keywords: List[str]
    is_locked: bool = False


class QuizQuestionOut(BaseModel):
    id: str
    type: str
    question: str
    options: Optional[List[str]] = None


class QuizOut(BaseModel):
    segment_id: str
    questions: List[QuizQuestionOut]


class AnswerItem(BaseModel):
    question_id: str
    answer: str = Field(min_length=1)


class AnswerSubmission(BaseModel):
    client_id: Optional[str] = None
    answers: List[AnswerItem]


class AnswerResult(BaseModel):
    correct: bool
    segment_id: str
    retry_from: Optional[str] = None
    passed_segments: List[str]
    next_segment_id: Optional[str] = None
