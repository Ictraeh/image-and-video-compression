const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const { execFileSync } = require("child_process");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sharp = require("sharp");
const ffmpeg = require("fluent-ffmpeg");
const { v4: uuidv4 } = require("uuid");

function fileExistsSync(p) {
  return Boolean(p && fsSync.existsSync(p));
}

function whichBinary(name) {
  try {
    const isWin = process.platform === "win32";
    const out = execFileSync(isWin ? "where" : "which", [name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    const first = out.trim().split(/[\r\n]+/)[0];
    return fileExistsSync(first) ? first : null;
  } catch {
    return null;
  }
}

function resolveFfmpegBinary() {
  if (process.env.FFMPEG_PATH && fileExistsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  try {
    const fromPkg = require("ffmpeg-static");
    if (fromPkg && fileExistsSync(fromPkg)) return fromPkg;
  } catch {
    /* optional bundled binary (e.g. Vercel Linux) */
  }
  const candidates = [
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/homebrew/opt/ffmpeg/bin/ffmpeg",
    "/usr/bin/ffmpeg",
  ];
  for (const c of candidates) {
    if (fileExistsSync(c)) return c;
  }
  return whichBinary("ffmpeg");
}

function resolveFfprobeBinary(ffmpegPath) {
  if (process.env.FFPROBE_PATH && fileExistsSync(process.env.FFPROBE_PATH)) {
    return process.env.FFPROBE_PATH;
  }
  try {
    const mod = require("ffprobe-static");
    const p = typeof mod === "string" ? mod : mod?.path;
    if (p && fileExistsSync(p)) return p;
  } catch {
    /* optional bundled binary */
  }
  const candidates = [
    "/opt/homebrew/bin/ffprobe",
    "/usr/local/bin/ffprobe",
    "/opt/homebrew/opt/ffmpeg/bin/ffprobe",
    "/usr/bin/ffprobe",
  ];
  for (const c of candidates) {
    if (fileExistsSync(c)) return c;
  }
  const fromWhich = whichBinary("ffprobe");
  if (fromWhich) return fromWhich;
  if (ffmpegPath) {
    const nextToFfmpeg = path.join(path.dirname(ffmpegPath), "ffprobe");
    if (fileExistsSync(nextToFfmpeg)) return nextToFfmpeg;
  }
  return null;
}

/** Paths Node can see (GUI/IDE apps often omit Homebrew from PATH). */
let resolvedFfmpegPath = null;
let resolvedFfprobePath = null;

function configureFfmpeg() {
  resolvedFfmpegPath = resolveFfmpegBinary();
  resolvedFfprobePath = resolveFfprobeBinary(resolvedFfmpegPath);
  if (resolvedFfmpegPath) {
    ffmpeg.setFfmpegPath(resolvedFfmpegPath);
    console.log(`Using FFmpeg: ${resolvedFfmpegPath}`);
  } else {
    console.warn(
      "FFmpeg not found — video compression will fail. Install: brew install ffmpeg (macOS) or set FFMPEG_PATH."
    );
  }
  if (resolvedFfprobePath) {
    ffmpeg.setFfprobePath(resolvedFfprobePath);
    console.log(`Using ffprobe: ${resolvedFfprobePath}`);
  }
}

configureFfmpeg();

const ROOT = __dirname;
const IS_VERCEL = Boolean(process.env.VERCEL);
/**
 * Vercel serverless rejects the whole HTTP request around ~4.5 MB (platform error
 * FUNCTION_PAYLOAD_TOO_LARGE). Multipart boundaries add overhead, so cap below that.
 */
const VERCEL_PER_REQUEST_SAFE_BYTES = 4 * 1024 * 1024;
const WORK_BASE = IS_VERCEL ? path.join("/tmp", "image-video-compression") : ROOT;
const UPLOADS = path.join(WORK_BASE, "uploads");
const OUTPUT = path.join(WORK_BASE, "output");

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

/** Lossy image quality (Sharp): tuned for smaller files; medium = strong size/quality balance. */
const QUALITY = { low: 42, medium: 68, high: 82 };

/** VP9 CRF: higher = smaller file; medium sits in the “visually fine on the web” range. */
const VP9_CRF = { low: 44, medium: 36, high: 30 };

/** H.264 CRF: higher = smaller; slow preset improves compression vs same CRF. */
const X264_CRF = { low: 30, medium: 24, high: 19 };

async function ensureDirs() {
  await fs.mkdir(UPLOADS, { recursive: true });
  await fs.mkdir(OUTPUT, { recursive: true });
}

const storageReady = ensureDirs();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safe}`);
  },
});

/**
 * Per-file upload cap (multer). Override with MAX_FILE_BYTES (bytes).
 * On Vercel, values are clamped so a single-file upload can fit under the
 * platform request-body limit; multi-file batches must stay smaller in total.
 */
const MAX_FILE_BYTES = (() => {
  let n;
  if (process.env.MAX_FILE_BYTES) {
    const parsed = parseInt(process.env.MAX_FILE_BYTES, 10);
    if (Number.isFinite(parsed) && parsed > 0) n = parsed;
  }
  if (n === undefined) {
    n = IS_VERCEL ? 3 * 1024 * 1024 : 8 * 1024 * 1024 * 1024;
  }
  if (IS_VERCEL) {
    n = Math.min(n, VERCEL_PER_REQUEST_SAFE_BYTES);
  }
  return n;
})();
const MAX_IMAGE_FILES = 50;
const MAX_VIDEO_FILES = 20;

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_IMAGE_FILES },
});

const uploadVideo = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_VIDEO_FILES },
});

function withUpload(middleware) {
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({
            error: `File exceeds the maximum upload size (${Math.round(
              MAX_FILE_BYTES / (1024 * 1024)
            )} MB per file).`,
            code: "FILE_TOO_LARGE",
            details: err.message,
          });
        }
        if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_PART_COUNT") {
          return res.status(400).json({
            error: "Too many files in one request.",
            code: "TOO_MANY_FILES",
            details: err.message,
          });
        }
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          return res.status(400).json({
            error: 'Unexpected file field. Use the "files" field for uploads.',
            code: "BAD_UPLOAD_FIELD",
            details: err.message,
          });
        }
        return res.status(400).json({
          error: "Upload could not be completed.",
          code: "UPLOAD_FAILED",
          details: err.message,
        });
      }
      return next(err);
    });
  };
}

function extLower(name) {
  return path.extname(name).toLowerCase();
}

async function processImage(filePath, outDir, options) {
  const {
    format = "webp",
    qualityKey = "medium",
    lossless = false,
  } = options;
  const q = QUALITY[qualityKey] ?? QUALITY.medium;
  const base = path.basename(filePath, path.extname(filePath));
  let pipeline = sharp(filePath, { animated: true, limitInputPixels: false });

  const outName = `${base}.${format === "jpeg" ? "jpg" : format}`;
  const outPath = path.join(outDir, outName);

  switch (format) {
    case "webp":
      await pipeline.webp(
        lossless
          ? { lossless: true, effort: 6 }
          : { quality: q, effort: 6, smartSubsample: true, alphaQuality: 100 }
      ).toFile(outPath);
      break;
    case "jpeg":
      await pipeline
        .jpeg({
          quality: q,
          mozjpeg: true,
          trellisQuantisation: true,
          overshootDeringing: true,
        })
        .toFile(outPath);
      break;
    case "png":
      await pipeline.png({ compressionLevel: 9, quality: q }).toFile(outPath);
      break;
    case "gif":
      await pipeline.gif({ effort: 10 }).toFile(outPath);
      break;
    case "avif":
      await pipeline.avif({ quality: q, effort: 6 }).toFile(outPath);
      break;
    default:
      await pipeline.webp({ quality: q, effort: 6 }).toFile(
        path.join(outDir, `${base}.webp`)
      );
      return `${base}.webp`;
  }
  return outName;
}

function runFfmpeg(inputPath, outPath, opts) {
  const {
    mode = "webm",
    qualityKey = "medium",
    maxWidth,
    videoBitrate,
  } = opts;
  const crfVp9 = VP9_CRF[qualityKey] ?? VP9_CRF.medium;
  const crfH264 = X264_CRF[qualityKey] ?? X264_CRF.medium;
  const x264Preset =
    qualityKey === "high" ? "slower" : qualityKey === "low" ? "medium" : "slow";

  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(inputPath);

    if (maxWidth && Number(maxWidth) > 0) {
      cmd = cmd.videoFilters(`scale=${maxWidth}:-2`);
    }

    cmd = cmd.outputOptions(["-map", "0:v:0", "-map", "0:a?"]);

    if (mode === "webm") {
      cmd = cmd.videoCodec("libvpx-vp9").audioCodec("libopus").audioBitrate("96k");
      if (videoBitrate) {
        cmd = cmd.outputOptions([
          "-b:v",
          String(videoBitrate),
          "-maxrate",
          String(videoBitrate),
          "-bufsize",
          "5000k",
          "-row-mt",
          "1",
          "-deadline",
          "good",
        ]);
      } else {
        cmd = cmd.outputOptions([
          "-crf",
          String(crfVp9),
          "-b:v",
          "0",
          "-row-mt",
          "1",
          "-deadline",
          "good",
        ]);
      }
    } else if (mode === "mp4") {
      cmd = cmd
        .videoCodec("libx264")
        .audioCodec("aac")
        .audioBitrate("112k")
        .outputOptions([
          "-crf",
          String(crfH264),
          "-preset",
          x264Preset,
          "-movflags",
          "+faststart",
        ]);
    } else if (mode === "ogg") {
      cmd = cmd.videoCodec("libtheora").audioCodec("libvorbis");
    }

    cmd
      .output(outPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}

const app = express();
app.use((req, res, next) => {
  storageReady.then(() => next()).catch(next);
});
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use("/output", express.static(OUTPUT));
app.use(express.static(path.join(ROOT, "public")));

app.get("/api/config", (_req, res) => {
  /** Approximate safe total body size (all files + multipart overhead) on Vercel. */
  const maxRequestBytesApprox = IS_VERCEL
    ? Math.floor(4.2 * 1024 * 1024)
    : null;
  res.json({
    maxFileBytes: MAX_FILE_BYTES,
    maxFileMb: Math.ceil(MAX_FILE_BYTES / (1024 * 1024)),
    maxFileGb: MAX_FILE_BYTES / (1024 * 1024 * 1024),
    serverless: IS_VERCEL,
    maxRequestBytesApprox,
    hostRequestBodyNote: IS_VERCEL
      ? "This version lives on Vercel, which only allows tiny uploads (about one small photo at a time). For big files, run the app on your own computer with npm start — then you can go much larger."
      : null,
  });
});

app.post(
  "/api/compress/images",
  withUpload(upload.array("files", MAX_IMAGE_FILES)),
  async (req, res) => {
    try {
      const format = (req.body.format || "webp").toLowerCase();
      const qualityKey = (req.body.quality || "medium").toLowerCase();
      const lossless = req.body.lossless === "true" || req.body.lossless === true;

      const allowed = ["webp", "jpeg", "png", "gif", "avif"];
      if (!allowed.includes(format)) {
        return res.status(400).json({
          error: `Output format "${format}" is not supported.`,
          code: "UNSUPPORTED_OUTPUT_FORMAT",
          details: `Allowed: ${allowed.join(", ")}.`,
        });
      }

      const files = req.files || [];
      if (!files.length) {
        return res.status(400).json({
          error: "No files were received. Choose files and try again.",
          code: "NO_FILES",
        });
      }

      const jobId = uuidv4();
      const outDir = path.join(OUTPUT, jobId);
      await fs.mkdir(outDir, { recursive: true });

      const results = [];
      const rejected = [];
      for (const f of files) {
        const ext = extLower(f.originalname);
        if (!IMAGE_EXT.has(ext)) {
          rejected.push(`${f.originalname} (${ext || "no extension"})`);
          await fs.unlink(f.path).catch(() => {});
          continue;
        }
        const name = await processImage(f.path, outDir, {
          format,
          qualityKey,
          lossless,
        });
        await fs.unlink(f.path).catch(() => {});
        results.push({
          name,
          url: `/output/${jobId}/${encodeURIComponent(name)}`,
        });
      }

      if (!results.length) {
        await fs.rm(outDir, { recursive: true }).catch(() => {});
        return res.status(400).json({
          error: "None of the uploaded files are supported image types.",
          code: "INVALID_FILE_TYPE",
          details:
            rejected.length > 0
              ? `Not accepted: ${rejected.join("; ")}. Allowed: JPEG, PNG, GIF, BMP, TIFF, SVG.`
              : "Allowed: JPEG, PNG, GIF, BMP, TIFF, SVG.",
        });
      }

      res.json({ jobId, files: results });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error:
          "Image compression failed on the server. The file may be corrupt or too large to decode.",
        code: "PROCESSING_FAILED",
        details: err.message,
      });
    }
  }
);

app.post(
  "/api/compress/videos",
  withUpload(uploadVideo.array("files", MAX_VIDEO_FILES)),
  async (req, res) => {
    try {
      if (!resolvedFfmpegPath) {
        return res.status(503).json({
          error:
            "FFmpeg is not installed or not found. On macOS run: brew install ffmpeg — then restart the server.",
          code: "FFMPEG_ERROR",
          details:
            "If FFmpeg is already installed, set FFMPEG_PATH to the full path (for example /opt/homebrew/bin/ffmpeg) and restart.",
        });
      }

      const mode = (req.body.format || "webm").toLowerCase();
      const qualityKey = (req.body.quality || "medium").toLowerCase();
      const maxWidth = req.body.maxWidth ? parseInt(req.body.maxWidth, 10) : null;
      const videoBitrate = req.body.bitrate || null;

      const allowed = ["webm", "mp4", "ogg"];
      if (!allowed.includes(mode)) {
        return res.status(400).json({
          error: `Output format "${mode}" is not supported.`,
          code: "UNSUPPORTED_OUTPUT_FORMAT",
          details: `Allowed: ${allowed.join(", ")}.`,
        });
      }

      const files = req.files || [];
      if (!files.length) {
        return res.status(400).json({
          error: "No files were received. Choose files and try again.",
          code: "NO_FILES",
        });
      }

      const extOut =
        mode === "webm" ? "webm" : mode === "mp4" ? "mp4" : "ogv";

      const jobId = uuidv4();
      const outDir = path.join(OUTPUT, jobId);
      await fs.mkdir(outDir, { recursive: true });

      const results = [];
      const rejected = [];
      for (const f of files) {
        const ext = extLower(f.originalname);
        if (!VIDEO_EXT.has(ext)) {
          rejected.push(`${f.originalname} (${ext || "no extension"})`);
          await fs.unlink(f.path).catch(() => {});
          continue;
        }
        const base = path.basename(f.originalname, path.extname(f.originalname));
        const outName = `${base}.${extOut}`;
        const outPath = path.join(outDir, outName);

        await runFfmpeg(f.path, outPath, {
          mode,
          qualityKey,
          maxWidth,
          videoBitrate,
        });
        await fs.unlink(f.path).catch(() => {});

        results.push({
          name: outName,
          url: `/output/${jobId}/${encodeURIComponent(outName)}`,
        });
      }

      if (!results.length) {
        await fs.rm(outDir, { recursive: true }).catch(() => {});
        return res.status(400).json({
          error: "None of the uploaded files are supported video types.",
          code: "INVALID_FILE_TYPE",
          details:
            rejected.length > 0
              ? `Not accepted: ${rejected.join("; ")}. Allowed: MP4, AVI, MOV, MKV, WMV.`
              : "Allowed: MP4, AVI, MOV, MKV, WMV.",
        });
      }

      res.json({ jobId, files: results });
    } catch (err) {
      console.error(err);
      const msg = String(err.message || err);
      const ffmpegHint =
        /ffmpeg|ffprobe|ENOENT|spawn/i.test(msg) || /Cannot find/i.test(msg);
      res.status(500).json({
        error: ffmpegHint
          ? "Video encoding failed. Install FFmpeg (brew install ffmpeg) or set FFMPEG_PATH / FFPROBE_PATH to your binaries, then restart the server."
          : "Video encoding failed on the server.",
        code: ffmpegHint ? "FFMPEG_ERROR" : "PROCESSING_FAILED",
        details: msg,
      });
    }
  }
);

const VERCEL_FUNCTION_PAYLOAD_BYTES = Math.floor(4.5 * 1024 * 1024);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    ffmpeg: resolvedFfmpegPath,
    ffprobe: resolvedFfprobePath,
    videoCompression: Boolean(resolvedFfmpegPath),
    maxFileBytesPerPart: MAX_FILE_BYTES,
    expressJsonLimit: "10mb",
    vercelFunctionPayloadBytesApprox: IS_VERCEL ? VERCEL_FUNCTION_PAYLOAD_BYTES : null,
    vercelPayloadNote: IS_VERCEL
      ? "Vercel caps each function request/response body near 4.5 MB (not configurable in vercel.json). Multer/JSON allow 10 MB so small JSON bodies parse; multipart uploads cannot exceed the platform cap."
      : null,
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    error: "An unexpected server error occurred.",
    code: "SERVER_ERROR",
    details: err.message,
  });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  storageReady
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Server http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
