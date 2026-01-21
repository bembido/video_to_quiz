from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional, Set


@dataclass
class VideoRecord:
    id: str
    source_type: str
    source: str
    duration_seconds: float
    created_at: datetime


@dataclass
class SegmentRecord:
    id: str
    video_id: str
    index: int
    start_seconds: float
    end_seconds: float
    topic_title: str
    short_summary: str
    keywords: List[str]


@dataclass
class QuizQuestionRecord:
    id: str
    type: str
    question: str
    options: Optional[List[str]]
    correct_answer: List[str]


@dataclass
class QuizRecord:
    segment_id: str
    questions: List[QuizQuestionRecord]


@dataclass
class Store:
    videos: Dict[str, VideoRecord] = field(default_factory=dict)
    segments: Dict[str, SegmentRecord] = field(default_factory=dict)
    quizzes: Dict[str, QuizRecord] = field(default_factory=dict)
    progress: Dict[str, Dict[str, Set[str]]] = field(default_factory=dict)
    video_index: Dict[str, str] = field(default_factory=dict)
