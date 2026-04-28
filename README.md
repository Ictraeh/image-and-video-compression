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

## Deploy on Vercel

This repo includes `vercel.json` and `api/index.js` so Express runs as a single serverless function. From this directory:

```bash
npx vercel link   # once
npx vercel --prod
```

**Important limits:** Vercel Functions cap **request and response bodies at about 4.5 MB** per invocation; that ceiling is **not** something you can raise in `vercel.json` or the function `config` export ([limits](https://vercel.com/docs/functions/limitations), [large payloads KB](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)). This repo sets **`express.json({ limit: '10mb' })`** and **Multer `fileSize` to 10 MB on Vercel** so app-level parsing matches common guidance; **multipart uploads still cannot exceed the platform ~4.5 MB** total request size. For larger files, use a normal Node host or direct-to-storage uploads (e.g. Vercel Blob).

On Vercel, uploads and outputs use **`/tmp`**; FFmpeg/ffprobe use the **`ffmpeg-static`** / **`ffprobe-static`** binaries bundled in `package.json`.
