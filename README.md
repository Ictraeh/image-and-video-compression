# Image and video compression

Small web app to compress **images** (WebP-first via Sharp) and **videos** (WebM-first via FFmpeg). Express serves the UI and upload API.

## Requirements

- Node.js 18+
- FFmpeg / FFprobe on the server PATH (or set `FFMPEG_PATH` / `FFPROBE_PATH`)

## Run locally

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). Override port with `PORT`.

## Dev

```bash
npm run dev
```

Uses `node --watch` to restart on file changes.
