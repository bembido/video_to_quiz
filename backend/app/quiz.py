from __future__ import annotations

import random
import uuid
from typing import List

from .store import QuizQuestionRecord, QuizRecord, SegmentRecord
from .utils import format_timestamp


def generate_quiz(segment: SegmentRecord) -> QuizRecord:
    rng = random.Random(segment.id)
    questions: List[QuizQuestionRecord] = []

    mc_options = [
        segment.topic_title,
        "Introduction",
        "Implementation details",
        "Conclusion",
    ]
    rng.shuffle(mc_options)
    questions.append(
        QuizQuestionRecord(
            id=str(uuid.uuid4()),
            type="multiple_choice",
            question="Which topic label matches this segment?",
            options=mc_options,
            correct_answer=[segment.topic_title],
        )
    )

    questions.append(
        QuizQuestionRecord(
            id=str(uuid.uuid4()),
            type="true_false",
            question=f"This segment starts at {format_timestamp(segment.start_seconds)}.",
            options=["true", "false"],
            correct_answer=["true"],
        )
    )

    questions.append(
        QuizQuestionRecord(
            id=str(uuid.uuid4()),
            type="short_answer",
            question="Provide one keyword from the segment summary.",
            options=None,
            correct_answer=[k.lower() for k in segment.keywords],
        )
    )

    return QuizRecord(segment_id=segment.id, questions=questions)


def is_answer_correct(question: QuizQuestionRecord, answer: str) -> bool:
    normalized = answer.strip().lower()
    return normalized in [item.lower() for item in question.correct_answer]
