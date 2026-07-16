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

## YouTube's bot check ("Sign in to confirm you're not a bot")

Cloud server IPs (Railway, AWS, DigitalOcean, etc.) get this from YouTube
constantly — it's not specific to this app. The fix is to pass cookies from
a real, logged-in browser session so requests look like they're coming from
an actual user instead of an anonymous datacenter IP.

**Recommended: use a throwaway/secondary Google account for this**, not your
main one — passing its session cookies to a server is a reasonable thing to
do for a personal tool, but it's worth keeping separate from an account you
care about.

1. Log into YouTube in a normal browser tab with that account.
2. Install a cookie-export extension — e.g. **"Get cookies.txt LOCALLY"**
   for Chrome/Firefox.
3. On youtube.com, export cookies as a `cookies.txt` file (Netscape format).
4. Base64-encode the file:
   - macOS/Linux: `base64 -i cookies.txt | tr -d '\n' > cookies.b64.txt`
   - Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cookies.txt")) | Out-File cookies.b64.txt`
5. In Railway, on the **backend service** → **Variables**, add:
   ```
   YTDLP_COOKIES_B64 = <paste the base64 string>
   ```
6. Redeploy. Check `/api/health` — it should now return
   `{"ok":true,"cookiesLoaded":true}`.

Cookies expire eventually (typically weeks to a couple months) — if the bot
check comes back after a while, just re-export and update the variable.

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