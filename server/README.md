# VRX Editing — YouTube Downloader backend

A small Express service that wraps the `yt-dlp` CLI so the YouTube Downloader
page can fetch video info and stream a download. Everything else in VRX Editing
is a static page that runs entirely in the browser — this is the one tool
that needs a real server, because pulling and muxing a video/audio stream
isn't something a browser can do on its own.

## Requirements

- Node.js 18+
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) on `PATH` (or set `YTDLP_PATH`)
  - `pip install -U yt-dlp` or `brew install yt-dlp`
- `ffmpeg` on `PATH` (needed for the MP3 audio-extraction option)
  - `apt install ffmpeg` / `brew install ffmpeg`

## Run it

```bash
cd server
npm install
node index.js
```

Defaults to `http://localhost:8787`. Override with env vars:

```bash
PORT=8787 YTDLP_PATH=yt-dlp ALLOWED_ORIGIN=https://your-site.com node index.js
```

Set `ALLOWED_ORIGIN` to your actual frontend origin once this is deployed
anywhere other than your own machine — it defaults to `*` for local testing.

## Endpoints

- `GET /api/info?url=<youtube url>` — returns title, thumbnail, duration, and
  a list of available progressive formats (video+audio already combined, no
  server-side muxing needed) plus an audio-only MP3 option.
- `GET /api/download?url=<youtube url>&format_id=<id>` — streams the file
  straight through as the HTTP response with a `Content-Disposition` header,
  so the browser just downloads it directly from this URL.
- `GET /api/health` — liveness check.

## Notes

- Only accepts `youtube.com` / `youtu.be` URLs — it's intentionally not a
  general-purpose extractor proxy.
- Has a basic in-memory per-IP rate limit. Fine for personal/small-scale use;
  swap in something backed by Redis if you're putting this in front of real
  traffic.
- `yt-dlp` changes format availability over time as YouTube's player changes.
  Keep it updated (`pip install -U yt-dlp`) — it breaks silently otherwise.
- Downloading YouTube content is against YouTube's Terms of Service outside
  of narrow cases (your own uploads, explicitly permissive licenses, etc.) —
  worth keeping in mind for how this gets deployed and used.
