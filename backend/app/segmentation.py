from __future__ import annotations

import math
import uuid
from typing import List

from .store import SegmentRecord


def generate_segments(
    video_id: str,
    duration_seconds: float,
    target_segment_seconds: float = 180.0,
) -> List[SegmentRecord]:
    if duration_seconds <= 0:
        duration_seconds = target_segment_seconds
    count = max(1, int(math.ceil(duration_seconds / target_segment_seconds)))
    segment_duration = duration_seconds / count
    segments: List[SegmentRecord] = []

    for index in range(count):
        start_seconds = index * segment_duration
        end_seconds = min(duration_seconds, (index + 1) * segment_duration)
        segment_id = str(uuid.uuid4())
        topic_title = f"Topic {index + 1}"
        short_summary = (
            f"Auto-generated summary for {topic_title.lower()} based on timeline."
        )
        keywords = ["topic", f"segment-{index + 1}", "summary"]
        segments.append(
            SegmentRecord(
                id=segment_id,
                video_id=video_id,
                index=index,
                start_seconds=start_seconds,
                end_seconds=end_seconds,
                topic_title=topic_title,
                short_summary=short_summary,
                keywords=keywords,
            )
        )

    return segments
