from __future__ import annotations

import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import (
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware

from .models import AnswerResult, AnswerSubmission, QuizOut, QuizQuestionOut, SegmentOut, VideoUploadResponse
from .quiz import generate_quiz, is_answer_correct
from .segmentation import generate_segments
from .store import SegmentRecord, Store, VideoRecord
from .utils import format_timestamp


APP_ROOT = Path(__file__).resolve().parents[1]
UPLOAD_DIR = APP_ROOT / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

STORE = Store()


app = FastAPI(title="AI Video Segmentation & Quiz API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_video_segments(video_id: str) -> List[SegmentRecord]:
    segments = [s for s in STORE.segments.values() if s.video_id == video_id]
    segments.sort(key=lambda s: s.index)
    return segments


def _get_progress_set(client_id: str, video_id: str) -> set:
    return STORE.progress.setdefault(client_id, {}).setdefault(video_id, set())


def _segment_lock_map(video_id: str, client_id: Optional[str]) -> Dict[str, bool]:
    if not client_id:
        return {}
    segments = _get_video_segments(video_id)
    passed = _get_progress_set(client_id, video_id)
    max_index = -1
    for segment in segments:
        if segment.id in passed:
            max_index = max(max_index, segment.index)
    allowed_index = max_index + 1
    return {segment.id: segment.index > allowed_index for segment in segments}


def _ensure_client_id(client_id: Optional[str]) -> str:
    if not client_id:
        raise HTTPException(status_code=400, detail="client_id is required.")
    return client_id


@app.get("/health")
def health_check() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/video/upload", response_model=VideoUploadResponse)
async def upload_video(
    request: Request,
    file: Optional[UploadFile] = File(None),
    video_url: Optional[str] = Form(None),
    duration_seconds: Optional[float] = Form(None),
) -> VideoUploadResponse:
    if not file and not video_url:
        content_type = request.headers.get("content-type", "")
        if content_type.startswith("application/json"):
            payload = await request.json()
            video_url = payload.get("video_url")
            duration_seconds = payload.get("duration_seconds")

    if not file and not video_url:
        raise HTTPException(status_code=400, detail="Provide file or video_url.")

    source_type = "upload" if file else "url"
    source_value = file.filename if file else video_url
    index_key = f"{source_type}:{source_value}"
    existing_id = STORE.video_index.get(index_key)
    if existing_id:
        segments = _get_video_segments(existing_id)
        video = STORE.videos[existing_id]
        return VideoUploadResponse(
            video_id=video.id,
            duration_seconds=video.duration_seconds,
            segments_count=len(segments),
        )

    video_id = str(uuid.uuid4())
    if duration_seconds is None or duration_seconds <= 0:
        duration_seconds = 600.0

    if file:
        destination = UPLOAD_DIR / f"{video_id}_{file.filename}"
        with destination.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        source = str(destination)
    else:
        source = video_url or "unknown"

    video = VideoRecord(
        id=video_id,
        source_type=source_type,
        source=source,
        duration_seconds=duration_seconds,
        created_at=datetime.utcnow(),
    )
    STORE.videos[video_id] = video
    STORE.video_index[index_key] = video_id

    segments = generate_segments(video_id=video_id, duration_seconds=duration_seconds)
    for segment in segments:
        STORE.segments[segment.id] = segment
        STORE.quizzes[segment.id] = generate_quiz(segment)

    return VideoUploadResponse(
        video_id=video_id,
        duration_seconds=duration_seconds,
        segments_count=len(segments),
    )


@app.get("/video/{video_id}/segments", response_model=List[SegmentOut])
def get_video_segments(
    video_id: str,
    client_id: Optional[str] = Header(None, alias="X-Client-Id"),
) -> List[SegmentOut]:
    video = STORE.videos.get(video_id)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found.")

    segments = _get_video_segments(video_id)
    lock_map = _segment_lock_map(video_id, client_id)
    response: List[SegmentOut] = []
    for segment in segments:
        response.append(
            SegmentOut(
                id=segment.id,
                video_id=segment.video_id,
                index=segment.index,
                start_time=format_timestamp(segment.start_seconds),
                end_time=format_timestamp(segment.end_seconds),
                topic_title=segment.topic_title,
                short_summary=segment.short_summary,
                keywords=segment.keywords,
                is_locked=lock_map.get(segment.id, False),
            )
        )
    return response


@app.get("/segment/{segment_id}/quiz", response_model=QuizOut)
def get_segment_quiz(
    segment_id: str,
    client_id: Optional[str] = Header(None, alias="X-Client-Id"),
) -> QuizOut:
    segment = STORE.segments.get(segment_id)
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found.")

    lock_map = _segment_lock_map(segment.video_id, client_id)
    if lock_map.get(segment_id):
        raise HTTPException(status_code=403, detail="Segment is locked.")

    quiz = STORE.quizzes.get(segment_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found.")

    return QuizOut(
        segment_id=segment_id,
        questions=[
            QuizQuestionOut(
                id=question.id,
                type=question.type,
                question=question.question,
                options=question.options,
            )
            for question in quiz.questions
        ],
    )


@app.post("/segment/{segment_id}/answer", response_model=AnswerResult)
def submit_answer(
    segment_id: str,
    submission: AnswerSubmission,
    client_id: Optional[str] = Header(None, alias="X-Client-Id"),
) -> AnswerResult:
    resolved_client_id = submission.client_id or client_id
    resolved_client_id = _ensure_client_id(resolved_client_id)

    segment = STORE.segments.get(segment_id)
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found.")

    quiz = STORE.quizzes.get(segment_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found.")

    lock_map = _segment_lock_map(segment.video_id, resolved_client_id)
    if lock_map.get(segment_id):
        raise HTTPException(status_code=403, detail="Segment is locked.")

    answer_map = {item.question_id: item.answer for item in submission.answers}
    all_correct = True
    for question in quiz.questions:
        answer = answer_map.get(question.id)
        if not answer or not is_answer_correct(question, answer):
            all_correct = False
            break

    progress_set = _get_progress_set(resolved_client_id, segment.video_id)
    next_segment_id = None
    segments = _get_video_segments(segment.video_id)
    for item in segments:
        if item.index == segment.index + 1:
            next_segment_id = item.id
            break

    if all_correct:
        progress_set.add(segment_id)
        return AnswerResult(
            correct=True,
            segment_id=segment_id,
            retry_from=None,
            passed_segments=sorted(progress_set),
            next_segment_id=next_segment_id,
        )

    return AnswerResult(
        correct=False,
        segment_id=segment_id,
        retry_from=format_timestamp(segment.start_seconds),
        passed_segments=sorted(progress_set),
        next_segment_id=next_segment_id,
    )
