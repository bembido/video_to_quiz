# AI Video Topic Segmentation & In-Video Quiz

This repo provides a FastAPI backend and a browser extension that satisfies the hackathon requirements:

- Video upload/register API
- Topic segmentation output with timestamps
- Quiz generation per segment
- In-video quiz overlay that pauses playback and locks future segments

The current implementation uses deterministic, time-based segmentation and template-driven quizzes. It is designed so ASR + LLM logic can be dropped in later without changing the extension flow.

## Project layout

- `backend/` FastAPI service
- `extension/` Chrome/Firefox extension (MV3)

## Backend setup

1. Create a virtual environment (optional).
2. Install dependencies:

```bash
pip install -r backend/requirements.txt
```

3. Run the API:

```bash
uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

The API exposes Swagger UI at `http://localhost:8000/docs`.

## Extension setup

1. Open Chrome (or Firefox) extension manager.
2. Enable developer mode.
3. Load the `extension/` folder as an unpacked extension.
4. Click the extension icon and set the API base URL (default `http://localhost:8000`).
5. Open any page with an HTML5 `<video>` tag (YouTube also works).

When playback reaches the end of a segment, a quiz overlay appears and the video is paused. A correct submission unlocks the next segment. A wrong answer rewinds to the segment start.

Note: if you see `Failed to fetch` in the extension errors, reload the extension after backend changes and confirm the API is reachable at the configured URL.

## API overview

- `POST /video/upload` (multipart/form-data)
  - `file`: optional video file
  - `video_url`: optional string
  - `duration_seconds`: optional float (used for time-based segmentation)
- `GET /video/{id}/segments`
- `GET /segment/{id}/quiz`
- `POST /segment/{id}/answer`

The extension sends `X-Client-Id` for per-user progress tracking.

## Implementation notes

- Segmentation uses equal-length time slices by default.
- Quizzes are generated from segment metadata and stored in memory.
- Progress is tracked in memory and resets on server restart.

If you want to plug in real ASR/topic modeling:
- Replace `generate_segments` in `backend/app/segmentation.py`.
- Replace `generate_quiz` in `backend/app/quiz.py` with model-driven generation.
