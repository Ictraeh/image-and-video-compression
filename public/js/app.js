const tabImage = document.getElementById("tab-image");
const tabVideo = document.getElementById("tab-video");
const formImage = document.getElementById("form-image");
const formVideo = document.getElementById("form-video");
const dropImage = document.getElementById("drop-image");
const dropVideo = document.getElementById("drop-video");
const fileImage = document.getElementById("file-image");
const fileVideo = document.getElementById("file-video");
const imageFormat = document.getElementById("image-format");
const webpLosslessWrap = document.getElementById("webp-lossless-wrap");
const statusPanel = document.getElementById("status-panel");
const statusPhase = document.getElementById("status-phase");
const statusPct = document.getElementById("status-pct");
const statusBarFill = document.getElementById("status-bar-fill");
const statusDetail = document.getElementById("status-detail");
const fileQueuePanel = document.getElementById("file-queue-panel");
const fileQueueList = document.getElementById("file-queue-list");
const fileQueueBadge = document.getElementById("file-queue-badge");
const fileQueueHint = document.getElementById("file-queue-hint");
const resultsEl = document.getElementById("results");
const resultsList = document.getElementById("results-list");
const errorPanel = document.getElementById("error-panel");
const errorCodeEl = document.getElementById("error-code");
const errorTitleEl = document.getElementById("error-title");
const errorMessageEl = document.getElementById("error-message");
const errorDetailsEl = document.getElementById("error-details");
const btnImage = document.getElementById("btn-image");
const btnVideo = document.getElementById("btn-video");

const IMAGE_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".svg",
]);
const VIDEO_EXT = new Set([".mp4", ".avi", ".mov", ".mkv", ".wmv"]);

/** Synced from GET /api/config (matches server MAX_FILE_BYTES). */
let maxUploadBytes = 8 * 1024 * 1024 * 1024;
/** On Vercel, total request body limit (~4.5 MB); client blocks oversized batches. */
let maxRequestBytesApprox = null;

async function refreshUploadLimit() {
  try {
    const r = await fetch("/api/config");
    if (!r.ok) return;
    const d = await r.json();
    if (Number.isFinite(d.maxFileBytes) && d.maxFileBytes > 0) {
      maxUploadBytes = d.maxFileBytes;
    }
    maxRequestBytesApprox = Number.isFinite(d.maxRequestBytesApprox)
      ? d.maxRequestBytesApprox
      : null;
    const banner = document.getElementById("deploy-limit-banner");
    if (banner) {
      banner.classList.toggle("hidden", !d.serverless);
      const note = banner.querySelector("[data-deploy-note]");
      if (note && d.hostRequestBodyNote) {
        note.textContent = d.hostRequestBodyNote;
      }
    }
  } catch (_) {
    /* keep fallback */
  }
  updateSelectedFilesSummary();
}

function formatUploadLimitLabel() {
  if (maxUploadBytes >= 1024 * 1024 * 1024) {
    const g = maxUploadBytes / (1024 * 1024 * 1024);
    return g >= 10 ? `${Math.round(g)} GB` : `${g.toFixed(1)} GB`;
  }
  return `${Math.max(1, Math.round(maxUploadBytes / (1024 * 1024)))} MB`;
}

const ERROR_LABELS = {
  FILE_TOO_LARGE: "That file is too big",
  HOST_PAYLOAD_LIMIT: "This site cannot take a file that large",
  TOO_MANY_FILES: "Too many at once",
  BAD_UPLOAD_FIELD: "Something odd about the upload",
  UPLOAD_FAILED: "Upload did not finish",
  INVALID_FILE_TYPE: "Wrong file type",
  NO_FILES: "Pick a file first",
  UNSUPPORTED_OUTPUT_FORMAT: "That format is not available",
  PROCESSING_FAILED: "We could not finish shrinking",
  FFMPEG_ERROR: "Video needs FFmpeg",
  NETWORK_ERROR: "No connection",
  PARSE_ERROR: "Odd reply from the server",
  VALIDATION: "Quick fix",
  ABORTED: "Cancelled",
  SERVER_ERROR: "Server hiccup",
};

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function formatBytes(n) {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function setMode(mode) {
  const isImage = mode === "image";
  tabImage.classList.toggle("is-active", isImage);
  tabVideo.classList.toggle("is-active", !isImage);
  tabImage.setAttribute("aria-selected", String(isImage));
  tabVideo.setAttribute("aria-selected", String(!isImage));
  formImage.classList.toggle("hidden", !isImage);
  formVideo.classList.toggle("hidden", isImage);
  updateSelectedFilesSummary();
}

tabImage.addEventListener("click", () => setMode("image"));
tabVideo.addEventListener("click", () => setMode("video"));

imageFormat.addEventListener("change", () => {
  const isWebp = imageFormat.value === "webp";
  webpLosslessWrap.classList.toggle("hidden", !isWebp);
});

function wireDropzone(zone, input) {
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  ["dragenter", "dragover"].forEach((ev) => {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add("is-dragover");
    });
  });
  ["dragleave", "drop"].forEach((ev) => {
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove("is-dragover");
    });
  });
  zone.addEventListener("drop", (e) => {
    const dt = e.dataTransfer?.files;
    if (dt?.length) {
      input.files = dt;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

wireDropzone(dropImage, fileImage);
wireDropzone(dropVideo, fileVideo);

function updateSelectedFilesSummary() {
  if (!fileQueuePanel || !fileQueueList) return;
  const isImage = !formImage.classList.contains("hidden");
  const input = isImage ? fileImage : fileVideo;
  const files = input?.files;

  if (!files?.length) {
    fileQueuePanel.classList.add("hidden");
    return;
  }

  let total = 0;
  fileQueueList.innerHTML = "";
  for (const f of files) {
    total += f.size;
    const li = document.createElement("li");
    li.textContent = `${f.name} · ${formatBytes(f.size)}`;
    fileQueueList.appendChild(li);
  }

  const kind = isImage ? "Photos" : "Videos";
  fileQueueBadge.textContent = `${files.length} ${kind.toLowerCase()}`;
  fileQueueHint.textContent = `About ${formatBytes(total)} all together. Each file can be up to ${formatUploadLimitLabel()}. Tap the blue button when you are ready.`;
  fileQueuePanel.classList.remove("hidden");
}

fileImage.addEventListener("change", updateSelectedFilesSummary);
fileVideo.addEventListener("change", updateSelectedFilesSummary);

/** Lets the browser paint status UI before a fast localhost request completes. */
function flushPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

function clearError() {
  errorPanel.classList.add("hidden");
  errorCodeEl.textContent = "";
  errorTitleEl.textContent = "";
  errorMessageEl.textContent = "";
  errorDetailsEl.textContent = "";
  errorDetailsEl.classList.add("hidden");
}

/**
 * @param {string} message
 * @param {{ code?: string, title?: string, details?: string }} [meta]
 */
function showError(message, meta = {}) {
  const code = meta.code || "";
  const title =
    meta.title ||
    ERROR_LABELS[code] ||
    (code ? `Heads up (${code})` : "That did not work");

  errorCodeEl.textContent = code;
  errorTitleEl.textContent = title;
  errorMessageEl.textContent = message;

  if (meta.details && String(meta.details).trim()) {
    errorDetailsEl.textContent = String(meta.details).trim();
    errorDetailsEl.classList.remove("hidden");
  } else {
    errorDetailsEl.classList.add("hidden");
  }

  errorPanel.classList.remove("hidden");
}

function hideStatus() {
  statusPanel.classList.add("hidden");
  statusPanel.classList.remove("is-processing");
  statusPanel.setAttribute("aria-busy", "false");
  btnImage.disabled = false;
  btnVideo.disabled = false;
  updateSelectedFilesSummary();
}

/**
 * @param {"upload" | "process"} phase
 * @param {{ percent?: number, detail?: string, processingLabel?: string }} [opts]
 */
function showStatus(phase, opts = {}) {
  if (fileQueuePanel) fileQueuePanel.classList.add("hidden");
  statusPanel.classList.remove("hidden");
  statusPanel.setAttribute("aria-busy", "true");
  btnImage.disabled = true;
  btnVideo.disabled = true;

  if (phase === "upload") {
    statusPanel.classList.remove("is-processing");
    const unknown = opts.percent === null;
    const pct =
      typeof opts.percent === "number" ? opts.percent : unknown ? 0 : 0;
    statusPhase.textContent = "Sending to the server";
    statusPct.textContent = unknown ? "…" : `${pct}%`;
    const barPct = unknown ? 8 : Math.min(100, Math.max(3, pct));
    statusBarFill.style.width = `${barPct}%`;
    statusDetail.textContent =
      opts.detail ||
      "Hang tight — big videos take longer to send.";
  } else {
    statusPanel.classList.add("is-processing");
    statusPhase.textContent = opts.processingLabel || "Almost there";
    statusPct.textContent = "…";
    statusBarFill.style.width = "100%";
    statusDetail.textContent =
      opts.detail ||
      "You can leave this tab open. We will show your downloads when it is done.";
  }

  queueMicrotask(() => {
    statusPanel.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}

function validateImageFiles(fileList) {
  const bad = [];
  if (fileList.length > 50) {
    bad.push(
      `Whoa — only 50 photos at a time. You picked ${fileList.length}. Try a smaller batch.`
    );
    return { bad, total: 0 };
  }
  let total = 0;
  for (const f of fileList) {
    total += f.size;
    const ext = extOf(f.name);
    if (!IMAGE_EXT.has(ext)) {
      bad.push(
        `${f.name} — we need a normal photo type (JPEG, PNG, GIF, and friends).`
      );
    } else if (f.size > maxUploadBytes) {
      bad.push(
        `${f.name} — this one is bigger than we allow (${formatUploadLimitLabel()} max each).`
      );
    }
  }
  if (
    bad.length === 0 &&
    maxRequestBytesApprox != null &&
    total > maxRequestBytesApprox
  ) {
    bad.push(
      `All together these are ${formatBytes(total)} — on this small hosted site the limit is about one short send at a time. Try fewer photos, or run the app on your computer (npm start) for huge batches.`
    );
  }
  return { bad, total };
}

function validateVideoFiles(fileList) {
  const bad = [];
  if (fileList.length > 20) {
    bad.push(
      `Only 20 videos at a time. You picked ${fileList.length}. Try fewer.`
    );
    return { bad, total: 0 };
  }
  let total = 0;
  for (const f of fileList) {
    total += f.size;
    const ext = extOf(f.name);
    if (!VIDEO_EXT.has(ext)) {
      bad.push(
        `${f.name} — we need a normal video type (MP4, MOV, and similar).`
      );
    } else if (f.size > maxUploadBytes) {
      bad.push(
        `${f.name} — this one is bigger than we allow (${formatUploadLimitLabel()} max each).`
      );
    }
  }
  if (
    bad.length === 0 &&
    maxRequestBytesApprox != null &&
    total > maxRequestBytesApprox
  ) {
    bad.push(
      `All together this is ${formatBytes(total)} — too much for this small hosted site in one go. Try one shorter clip, or run the app on your computer (npm start).`
    );
  }
  return { bad, total };
}

function showResults(files) {
  resultsList.innerHTML = "";
  const origin = window.location.origin;
  for (const f of files) {
    const href = f.url.startsWith("http") ? f.url : `${origin}${f.url}`;
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = href;
    a.download = f.name;
    a.append(document.createTextNode(f.name), " ");
    const span = document.createElement("span");
    span.textContent = "Save";
    a.appendChild(span);
    li.appendChild(a);
    resultsList.appendChild(li);
  }
  resultsEl.classList.remove("hidden");
}

/**
 * @param {string} url
 * @param {FormData} formData
 * @param {{
 *   onUploadProgress?: (p: {
 *     percent: number | null,
 *     loaded: number,
 *     total: number | null
 *   }) => void,
 *   onUploadComplete?: () => void
 * }} [callbacks]
 */
function postFormWithProgress(url, formData, callbacks = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.addEventListener("progress", (e) => {
      if (!callbacks.onUploadProgress) return;
      if (e.lengthComputable) {
        const percent = Math.min(
          100,
          Math.round((e.loaded / e.total) * 100)
        );
        callbacks.onUploadProgress({
          loaded: e.loaded,
          total: e.total,
          percent,
        });
      } else {
        callbacks.onUploadProgress({
          loaded: e.loaded,
          total: null,
          percent: null,
        });
      }
    });
    xhr.upload.addEventListener("load", () => {
      callbacks.onUploadComplete?.();
    });
    xhr.addEventListener("load", () => {
      const raw = xhr.responseText || "";
      const status = xhr.status;

      if (
        status === 413 ||
        /FUNCTION_PAYLOAD_TOO_LARGE|Request Entity Too Large|PAYLOAD_TOO_LARGE/i.test(
          raw
        )
      ) {
        const err = new Error(
          "This site's host only accepts small packages at once (think one little photo). Try a smaller file, or run the app on your own Mac or PC with npm start - then you can go big."
        );
        err.code = "HOST_PAYLOAD_LIMIT";
        err.details = raw.trim().slice(0, 800);
        reject(err);
        return;
      }

      let data = {};
      try {
        data = JSON.parse(raw || "{}");
      } catch {
        const parseErr = new Error(
          "We got a weird answer back instead of the usual OK message. If the file was huge, the website host may have said no before our app even saw it."
        );
        parseErr.code = "PARSE_ERROR";
        parseErr.details = raw.trim().slice(0, 800) || `HTTP ${status}`;
        reject(parseErr);
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }
      const err = new Error(
        data.error || xhr.statusText || `Request failed (${xhr.status})`
      );
      err.code = data.code;
      err.details = data.details;
      err.status = xhr.status;
      reject(err);
    });
    xhr.addEventListener("error", () => {
      const err = new Error(
        "We could not reach the server. Is the app running? Is your internet on?"
      );
      err.code = "NETWORK_ERROR";
      reject(err);
    });
    xhr.addEventListener("abort", () => {
      const err = new Error("You stopped the upload.");
      err.code = "ABORTED";
      reject(err);
    });
    xhr.send(formData);
  });
}

formImage.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  resultsEl.classList.add("hidden");

  if (!fileImage.files?.length) {
    showError("Choose at least one photo first.", {
      code: "NO_FILES",
      title: ERROR_LABELS.NO_FILES,
    });
    return;
  }

  const list = Array.from(fileImage.files);
  const { bad, total } = validateImageFiles(list);
  if (bad.length) {
    showError("These need a quick change:", {
      code: "VALIDATION",
      title: ERROR_LABELS.VALIDATION,
      details: bad.join("\n"),
    });
    return;
  }

  const fd = new FormData();
  for (const file of list) {
    fd.append("files", file);
  }
  fd.append("format", imageFormat.value);
  fd.append("quality", document.getElementById("image-quality").value);
  fd.append(
    "lossless",
    document.getElementById("image-lossless").checked ? "true" : "false"
  );

  let serverPhase = false;
  showStatus("upload", {
    percent: 0,
    detail: `${list.length} file(s) · ${formatBytes(total)} total`,
  });
  await flushPaint();

  try {
    const data = await postFormWithProgress("/api/compress/images", fd, {
      onUploadProgress: ({ percent, loaded, total: t }) => {
        if (serverPhase) return;
        const detail =
          t == null
            ? `Sending ${list.length} · ${formatBytes(loaded)} so far`
            : `Sending ${list.length} · ${formatBytes(loaded)} of ${formatBytes(
                t
              )}`;
        showStatus("upload", {
          percent: percent == null ? null : percent,
          detail,
        });
      },
      onUploadComplete: () => {
        serverPhase = true;
        showStatus("process", {
          processingLabel: "Shrinking your photos",
          detail: "Sent! Now we are making them lighter.",
        });
      },
    });
    showResults(data.files);
  } catch (err) {
    showError(err.message, {
      code: err.code,
      details: err.details,
      title: err.code ? ERROR_LABELS[err.code] : undefined,
    });
  } finally {
    hideStatus();
  }
});

formVideo.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  resultsEl.classList.add("hidden");

  if (!fileVideo.files?.length) {
    showError("Choose at least one video first.", {
      code: "NO_FILES",
      title: ERROR_LABELS.NO_FILES,
    });
    return;
  }

  const list = Array.from(fileVideo.files);
  const { bad, total } = validateVideoFiles(list);
  if (bad.length) {
    showError("These need a quick change:", {
      code: "VALIDATION",
      title: ERROR_LABELS.VALIDATION,
      details: bad.join("\n"),
    });
    return;
  }

  const fd = new FormData();
  for (const file of list) {
    fd.append("files", file);
  }
  fd.append("format", document.getElementById("video-format").value);
  fd.append("quality", document.getElementById("video-quality").value);
  const mw = document.getElementById("video-max-width").value.trim();
  const br = document.getElementById("video-bitrate").value.trim();
  if (mw) fd.append("maxWidth", mw);
  if (br) fd.append("bitrate", br);

  let serverPhase = false;
  showStatus("upload", {
    percent: 0,
    detail: `${list.length} file(s) · ${formatBytes(total)} total`,
  });
  await flushPaint();

  try {
    const data = await postFormWithProgress("/api/compress/videos", fd, {
      onUploadProgress: ({ percent, loaded, total: t }) => {
        if (serverPhase) return;
        const detail =
          t == null
            ? `Sending ${list.length} · ${formatBytes(loaded)} so far`
            : `Sending ${list.length} · ${formatBytes(loaded)} of ${formatBytes(
                t
              )}`;
        showStatus("upload", {
          percent: percent == null ? null : percent,
          detail,
        });
      },
      onUploadComplete: () => {
        serverPhase = true;
        showStatus("process", {
          processingLabel: "Shrinking your video",
          detail:
            "Sent! This part can take a few minutes for long movies — that is normal.",
        });
      },
    });
    showResults(data.files);
  } catch (err) {
    showError(err.message, {
      code: err.code,
      details: err.details,
      title: err.code ? ERROR_LABELS[err.code] : undefined,
    });
  } finally {
    hideStatus();
  }
});

refreshUploadLimit();
