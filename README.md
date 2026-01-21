# AI Video Topic Segmentation and In-Video Quiz

FastAPI backend + browser extension that matches the hackathon requirements:

- Video upload/register API
- Topic segmentation with timestamps
- Quiz generation per segment
- In-video overlay that pauses playback and blocks the next segment until correct answers

Current implementation uses time-based segmentation and template-driven quizzes. It is designed so ASR + LLM logic can be plugged in later without changing the extension flow.

## Requirements

- Python 3.10+
- Chrome or Firefox (for the extension)
- Git (optional, for GitHub upload)

## Project layout

- `backend/` FastAPI service
- `extension/` Chrome/Firefox extension (MV3)

## Quick start

Create a virtual environment (optional):

Windows PowerShell:
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Windows CMD:
```bat
python -m venv .venv
.\.venv\Scripts\activate.bat
```

macOS/Linux:
```bash
python3 -m venv .venv
source .venv/bin/activate
```

Install dependencies:

```bash
pip install -r backend/requirements.txt
```

Run the API:

```bash
uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

Swagger UI: `http://localhost:8000/docs`  
Health check: `http://localhost:8000/health`

## Extension setup

Chrome:
1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked" and select the `extension/` folder.
4. Click the extension icon and set the API base URL (default `http://localhost:8000`).
5. Open any page with an HTML5 `<video>` tag (YouTube works).

Firefox:
1. Open `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on".
3. Select `extension/manifest.json`.
4. Set API base URL in the extension popup.

When playback reaches the end of a segment, a quiz overlay appears and the video is paused. A correct submission unlocks the next segment. A wrong answer rewinds to the segment start.

## API overview

Endpoints:

- `POST /video/upload`
- `GET /video/{id}/segments`
- `GET /segment/{id}/quiz`
- `POST /segment/{id}/answer`

Notes:
- The API accepts `multipart/form-data` or JSON for `/video/upload`.
- The extension sends `X-Client-Id` for per-user progress tracking.

Examples:

Register video (JSON):
```bash
curl -X POST http://localhost:8000/video/upload \
  -H "Content-Type: application/json" \
  -d "{\"video_url\":\"https://example.com/video.mp4\",\"duration_seconds\":600}"
```

Register video (file upload):
```bash
curl -X POST http://localhost:8000/video/upload \
  -F "file=@sample.mp4" \
  -F "duration_seconds=600"
```

Get segments:
```bash
curl -H "X-Client-Id: demo-client" \
  http://localhost:8000/video/<VIDEO_ID>/segments
```

Get quiz:
```bash
curl -H "X-Client-Id: demo-client" \
  http://localhost:8000/segment/<SEGMENT_ID>/quiz
```

Submit answers:
```bash
curl -X POST http://localhost:8000/segment/<SEGMENT_ID>/answer \
  -H "Content-Type: application/json" \
  -H "X-Client-Id: demo-client" \
  -d "{\"answers\":[{\"question_id\":\"<QID>\",\"answer\":\"true\"}]}"
```

## Implementation notes

- Segmentation uses equal-length time slices by default.
- Quizzes are generated from segment metadata and stored in memory.
- Progress is tracked in memory and resets on server restart.

To plug in real ASR and topic modeling:
- Replace `generate_segments` in `backend/app/segmentation.py`.
- Replace `generate_quiz` in `backend/app/quiz.py` with model-driven generation.

## Troubleshooting

- `Failed to fetch` in extension errors:
  - Confirm the API is running and reachable at the URL in the extension popup.
  - Reload the extension after backend changes.
  - Check `http://localhost:8000/health` in the browser.
- `No video element found yet`:
  - The current page has no `<video>` element. Open a page with a video.

## Download from GitHub

Clone the repo:
```bash
git clone https://github.com/<user>/<repo>.git
cd <repo>
```

Or download a ZIP from GitHub:
1. Open the repository page.
2. Click "Code" → "Download ZIP".
3. Extract the archive and open the folder.
