const DEFAULT_API = "http://localhost:8000";

const state = {
  apiBaseUrl: DEFAULT_API,
  clientId: null,
  video: null,
  videoId: null,
  segments: [],
  maxUnlockedIndex: -1,
  passedSegments: new Set(),
  quizCache: new Map(),
  activeQuizSegmentId: null,
  overlayEl: null,
  initialized: false,
  initializing: false,
  videoKey: "",
  watchdogId: null,
};

const LOG_PREFIX = "[IVQ]";

function logInfo(...args) {
  console.log(LOG_PREFIX, ...args);
}

function logError(...args) {
  console.error(LOG_PREFIX, ...args);
}

function storageGet(defaults) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(defaults, resolve);
  });
}

function storageGetLocal(defaults) {
  return new Promise((resolve) => {
    chrome.storage.local.get(defaults, resolve);
  });
}

function storageSetLocal(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, resolve);
  });
}

async function getApiBaseUrl() {
  const settings = await storageGet({ apiBaseUrl: DEFAULT_API });
  return settings.apiBaseUrl || DEFAULT_API;
}

async function getClientId() {
  const settings = await storageGetLocal({ clientId: "" });
  if (settings.clientId) {
    return settings.clientId;
  }
  const newId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `client-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await storageSetLocal({ clientId: newId });
  return newId;
}

function buildVideoKey(video) {
  const src = video.currentSrc || video.src || "";
  const duration = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
  return `${window.location.href}|${src}|${duration}`;
}

function waitForVideo(timeoutMs = 20000) {
  return new Promise((resolve) => {
    const existing = findBestVideo();
    if (existing) {
      resolve(existing);
      return;
    }
    const observer = new MutationObserver(() => {
      const video = findBestVideo();
      if (video) {
        observer.disconnect();
        resolve(video);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

function findBestVideo() {
  const videos = Array.from(document.querySelectorAll("video"));
  if (!videos.length) {
    return null;
  }
  const scored = videos
    .map((video) => {
      const rect = video.getBoundingClientRect();
      return { video, area: rect.width * rect.height };
    })
    .filter((item) => item.area > 0);
  if (!scored.length) {
    return videos[0];
  }
  scored.sort((a, b) => b.area - a.area);
  return scored[0].video;
}

function ensureMetadata(video) {
  return new Promise((resolve) => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      resolve();
      return;
    }
    const handler = () => {
      video.removeEventListener("loadedmetadata", handler);
      resolve();
    };
    video.addEventListener("loadedmetadata", handler);
  });
}

function parseTimestamp(ts) {
  const parts = ts.split(":").map((part) => Number(part));
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, "0");
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

async function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("X-Client-Id", state.clientId);
  const payload = {
    type: "ivqFetch",
    url: `${state.apiBaseUrl}${path}`,
    method: options.method || "GET",
    headers: Object.fromEntries(headers.entries()),
    body: options.body || null,
  };

  const response = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });

  if (!response || !response.ok) {
    const message =
      (response && (response.error || response.data || response.statusText)) ||
      "Failed to fetch";
    throw new Error(message);
  }

  return response.data;
}

async function registerVideo(video) {
  const src = video.currentSrc || video.src || window.location.href;
  const duration =
    Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 600;
  const payload = await apiFetch("/video/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      video_url: src,
      duration_seconds: duration,
    }),
  });
  state.videoId = payload.video_id;
}

async function loadSegments() {
  if (!state.videoId) {
    return;
  }
  const segments = await apiFetch(`/video/${state.videoId}/segments`);
  state.segments = segments
    .map((segment) => ({
      ...segment,
      startSeconds: parseTimestamp(segment.start_time),
      endSeconds: parseTimestamp(segment.end_time),
    }))
    .sort((a, b) => a.index - b.index);

  const firstLocked = state.segments.find((segment) => segment.is_locked);
  if (firstLocked) {
    state.maxUnlockedIndex = Math.max(0, firstLocked.index - 1);
  } else {
    state.maxUnlockedIndex =
      state.segments.length > 0 ? state.segments[state.segments.length - 1].index : 0;
  }
}

function findSegmentByTime(time) {
  return state.segments.find(
    (segment) => time >= segment.startSeconds && time < segment.endSeconds + 0.05
  );
}

function getAllowedEndTime() {
  if (!state.segments.length) {
    return null;
  }
  const allowed = state.segments.find(
    (segment) => segment.index === state.maxUnlockedIndex
  );
  return allowed ? allowed.endSeconds : null;
}

function buildOverlay(segment, quiz) {
  const overlay = document.createElement("div");
  overlay.className = "ivq-overlay";

  const panel = document.createElement("div");
  panel.className = "ivq-panel";

  const title = document.createElement("h2");
  title.textContent = segment.topic_title;

  const subtitle = document.createElement("p");
  subtitle.textContent = `Segment ${segment.index + 1} ends at ${formatTimestamp(
    segment.endSeconds
  )}. Answer to continue.`;

  const form = document.createElement("form");

  quiz.questions.forEach((question, index) => {
    const questionWrap = document.createElement("div");
    questionWrap.className = "ivq-question";

    const questionTitle = document.createElement("h3");
    questionTitle.textContent = `${index + 1}. ${question.question}`;

    const optionsWrap = document.createElement("div");
    optionsWrap.className = "ivq-options";

    if (question.type === "short_answer") {
      const input = document.createElement("input");
      input.type = "text";
      input.name = `q-${question.id}`;
      input.dataset.questionId = question.id;
      optionsWrap.appendChild(input);
    } else {
      (question.options || []).forEach((option, optionIndex) => {
        const label = document.createElement("label");
        const input = document.createElement("input");
        input.type = "radio";
        input.name = `q-${question.id}`;
        input.value = option;
        input.dataset.questionId = question.id;
        input.dataset.optionIndex = String(optionIndex);
        label.appendChild(input);
        label.appendChild(document.createTextNode(` ${option}`));
        optionsWrap.appendChild(label);
      });
    }

    questionWrap.appendChild(questionTitle);
    questionWrap.appendChild(optionsWrap);
    form.appendChild(questionWrap);
  });

  const actions = document.createElement("div");
  actions.className = "ivq-actions";

  const submitButton = document.createElement("button");
  submitButton.type = "submit";
  submitButton.className = "ivq-button ivq-submit";
  submitButton.textContent = "Submit answers";

  const status = document.createElement("div");
  status.className = "ivq-status";

  actions.appendChild(submitButton);

  form.appendChild(actions);
  panel.appendChild(title);
  panel.appendChild(subtitle);
  panel.appendChild(form);
  panel.appendChild(status);
  overlay.appendChild(panel);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";

    const answers = quiz.questions.map((question) => {
      const selector = `[data-question-id="${question.id}"]`;
      if (question.type === "short_answer") {
        const input = form.querySelector(`${selector}`);
        return { question_id: question.id, answer: input ? input.value.trim() : "" };
      }
      const checked = form.querySelector(`${selector}:checked`);
      return { question_id: question.id, answer: checked ? checked.value : "" };
    });

    if (answers.some((item) => !item.answer)) {
      status.textContent = "Answer every question to continue.";
      return;
    }

    try {
      const result = await apiFetch(`/segment/${segment.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: state.clientId, answers }),
      });

      if (result.correct) {
        state.passedSegments.add(segment.id);
        const lastIndex = state.segments.length
          ? state.segments[state.segments.length - 1].index
          : 0;
        state.maxUnlockedIndex = Math.min(
          lastIndex,
          Math.max(state.maxUnlockedIndex, segment.index + 1)
        );
        hideOverlay();
        state.activeQuizSegmentId = null;
        state.video.play();
        return;
      }

      status.textContent = "Incorrect. Rewatching the segment.";
      setTimeout(() => {
        hideOverlay();
        state.activeQuizSegmentId = null;
        state.video.currentTime = segment.startSeconds;
        state.video.play();
      }, 800);
    } catch (error) {
      status.textContent = "Failed to submit answers. Try again.";
    }
  });

  return overlay;
}

function buildErrorOverlay(segment) {
  const overlay = document.createElement("div");
  overlay.className = "ivq-overlay";

  const panel = document.createElement("div");
  panel.className = "ivq-panel";

  const title = document.createElement("h2");
  title.textContent = "Quiz unavailable";

  const message = document.createElement("p");
  message.textContent =
    "The quiz could not be loaded. Keep the video paused and retry.";

  const actions = document.createElement("div");
  actions.className = "ivq-actions";

  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.className = "ivq-button ivq-submit";
  retryButton.textContent = "Retry loading quiz";

  retryButton.addEventListener("click", () => {
    hideOverlay();
    state.activeQuizSegmentId = null;
    showQuiz(segment);
  });

  actions.appendChild(retryButton);
  panel.appendChild(title);
  panel.appendChild(message);
  panel.appendChild(actions);
  overlay.appendChild(panel);
  return overlay;
}

async function showQuiz(segment) {
  if (state.activeQuizSegmentId) {
    return;
  }
  state.activeQuizSegmentId = segment.id;
  state.video.pause();

  let quiz = state.quizCache.get(segment.id);
  try {
    if (!quiz) {
      quiz = await apiFetch(`/segment/${segment.id}/quiz`);
      state.quizCache.set(segment.id, quiz);
    }
  } catch (error) {
    state.activeQuizSegmentId = null;
    state.overlayEl = buildErrorOverlay(segment);
    document.body.appendChild(state.overlayEl);
    return;
  }

  state.overlayEl = buildOverlay(segment, quiz);
  document.body.appendChild(state.overlayEl);
}

function hideOverlay() {
  if (state.overlayEl) {
    state.overlayEl.remove();
    state.overlayEl = null;
  }
}

function detachEvents(video) {
  if (!video) {
    return;
  }
  video.removeEventListener("timeupdate", handleTimeUpdate);
  video.removeEventListener("seeking", handleSeeking);
}

function resetStateForVideo(video) {
  if (state.video && state.video !== video) {
    detachEvents(state.video);
  }
  hideOverlay();
  state.video = video;
  state.videoId = null;
  state.segments = [];
  state.maxUnlockedIndex = -1;
  state.passedSegments = new Set();
  state.quizCache = new Map();
  state.activeQuizSegmentId = null;
  state.initialized = false;
}

function buildApiErrorOverlay(message, onRetry) {
  const overlay = document.createElement("div");
  overlay.className = "ivq-overlay";

  const panel = document.createElement("div");
  panel.className = "ivq-panel";

  const title = document.createElement("h2");
  title.textContent = "Backend unreachable";

  const text = document.createElement("p");
  text.textContent = message;

  const actions = document.createElement("div");
  actions.className = "ivq-actions";

  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.className = "ivq-button ivq-submit";
  retryButton.textContent = "Retry connection";

  retryButton.addEventListener("click", () => {
    hideOverlay();
    onRetry();
  });

  actions.appendChild(retryButton);
  panel.appendChild(title);
  panel.appendChild(text);
  panel.appendChild(actions);
  overlay.appendChild(panel);
  return overlay;
}

function handleTimeUpdate() {
  if (!state.segments.length || !state.video) {
    return;
  }
  const time = state.video.currentTime;
  const segment = findSegmentByTime(time);
  if (!segment) {
    return;
  }
  if (segment.index > state.maxUnlockedIndex) {
    const allowedEnd = getAllowedEndTime();
    if (allowedEnd !== null) {
      const allowedSegment = state.segments.find(
        (item) => item.index === state.maxUnlockedIndex
      );
      const fallbackStart = allowedSegment ? allowedSegment.startSeconds : 0;
      state.video.currentTime = Math.max(fallbackStart, allowedEnd - 0.25);
    }
    return;
  }
  if (
    !state.passedSegments.has(segment.id) &&
    !state.activeQuizSegmentId &&
    time >= segment.endSeconds - 0.2
  ) {
    showQuiz(segment);
  }
}

function handleSeeking() {
  if (!state.segments.length || !state.video) {
    return;
  }
  const allowedEnd = getAllowedEndTime();
  if (allowedEnd === null) {
    return;
  }
  if (state.video.currentTime > allowedEnd + 0.05) {
    const allowedSegment = state.segments.find(
      (item) => item.index === state.maxUnlockedIndex
    );
    const fallbackStart = allowedSegment ? allowedSegment.startSeconds : 0;
    state.video.currentTime = Math.max(fallbackStart, allowedEnd - 0.25);
  }
}

function attachEvents() {
  if (!state.video || state.initialized) {
    return;
  }
  state.video.addEventListener("timeupdate", handleTimeUpdate);
  state.video.addEventListener("seeking", handleSeeking);
  state.initialized = true;
}

async function initializeForVideo(video, options = {}) {
  if (state.initializing || !video) {
    return;
  }
  state.initializing = true;
  try {
    await ensureMetadata(video);
    const key = buildVideoKey(video);
    const shouldReload =
      options.forceReload ||
      !state.videoKey ||
      key !== state.videoKey ||
      video !== state.video;
    if (shouldReload) {
      resetStateForVideo(video);
      await registerVideo(video);
      await loadSegments();
      state.videoKey = key;
    }
    attachEvents();
  } catch (error) {
    logError("Failed to initialize video.", error);
    state.video.pause();
    hideOverlay();
    state.overlayEl = buildApiErrorOverlay(
      "Check that the API is running and the URL in the extension popup is correct.",
      () => {
        initializeForVideo(video);
      }
    );
    document.body.appendChild(state.overlayEl);
  } finally {
    state.initializing = false;
  }
}

function startWatchdog() {
  if (state.watchdogId) {
    return;
  }
  state.watchdogId = setInterval(() => {
    const video = findBestVideo();
    if (!video) {
      return;
    }
    const key = buildVideoKey(video);
    if (video !== state.video || key !== state.videoKey) {
      initializeForVideo(video);
    }
  }, 1500);
}

async function bootstrap() {
  try {
    state.apiBaseUrl = await getApiBaseUrl();
    state.clientId = await getClientId();
    const video = await waitForVideo();
    if (video) {
      await initializeForVideo(video);
    } else {
      logInfo("No video element found yet.");
    }
    startWatchdog();
  } catch (error) {
    logError("Bootstrap failed.", error);
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.apiBaseUrl) {
    return;
  }
  const value = changes.apiBaseUrl.newValue || DEFAULT_API;
  if (value !== state.apiBaseUrl) {
    state.apiBaseUrl = value;
    if (state.video) {
      initializeForVideo(state.video, { forceReload: true });
    }
  }
});

bootstrap();
