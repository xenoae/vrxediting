// VRX Editing — YouTube Downloader backend
//
// Wraps the yt-dlp CLI. Requires `yt-dlp` and `ffmpeg` to be installed and
// on PATH on whatever machine runs this.
//
//   pip install -U yt-dlp        (or: brew install yt-dlp)
//   apt install ffmpeg           (or: brew install ffmpeg)
//   npm install
//   node index.js
//
// Env vars:
//   PORT                default 8787
//   YTDLP_PATH          default "yt-dlp"  (path to the binary if not on PATH)
//   ALLOWED_ORIGIN      default "*"       (set to your frontend's origin in production)
//   YTDLP_COOKIES_B64   optional          (base64-encoded cookies.txt — see README)

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8787;
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// If cookies were provided (base64-encoded Netscape-format cookies.txt),
// decode them to a file once at startup. YouTube's bot-check on datacenter
// IPs is bypassed by passing a real logged-in session's cookies to yt-dlp.
let COOKIES_PATH = null;
if (process.env.YTDLP_COOKIES_B64) {
  try {
    COOKIES_PATH = path.join(os.tmpdir(), 'yt-dlp-cookies.txt');
    fs.writeFileSync(COOKIES_PATH, Buffer.from(process.env.YTDLP_COOKIES_B64, 'base64'));
    console.log('Loaded cookies from YTDLP_COOKIES_B64 ->', COOKIES_PATH);
  } catch (e) {
    console.error('Failed to write cookies file:', e.message);
    COOKIES_PATH = null;
  }
}
function cookieArgs() {
  return COOKIES_PATH ? ['--cookies', COOKIES_PATH] : [];
}

app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

// Only accept youtube.com / youtu.be URLs — keeps this scoped to what it's
// meant for instead of becoming a general-purpose extractor proxy.
const YT_URL_RE = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]{6,}/i;

function isValidYoutubeUrl(url) {
  return typeof url === 'string' && YT_URL_RE.test(url.trim());
}

// Simple in-memory rate limit: N requests per IP per minute.
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const entry = hits.get(key) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
    entry.count++;
    hits.set(key, entry);
    if (entry.count > max) {
      return res.status(429).json({ error: 'Too many requests. Slow down a bit.' });
    }
    next();
  };
}

function runYtdlpJson(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, ['-j', '--no-warnings', '--no-playlist', ...cookieArgs(), url]);
    let out = '', err = '';
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('yt-dlp timed out')); }, timeoutMs);

    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim() || `yt-dlp exited with code ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(new Error('Could not parse yt-dlp output'));
      }
    });
  });
}

// GET /api/info?url=...
app.get('/api/info', rateLimit(20, 60_000), async (req, res) => {
  const { url } = req.query;
  if (!isValidYoutubeUrl(url)) {
    return res.status(400).json({ error: 'Provide a valid youtube.com or youtu.be URL.' });
  }

  try {
    const data = await runYtdlpJson(url);

    const allFormats = data.formats || [];

    // Progressive formats (video+audio already combined in one stream) —
    // these can be piped straight to the response with no merging needed.
    // YouTube caps these around 720p.
    const progressive = allFormats
      .filter((f) => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none' && f.ext === 'mp4')
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    // Video-only formats (DASH) — this is where 1080p/1440p/4K actually live.
    // These need to be merged with a separate audio track via ffmpeg.
    const videoOnly = allFormats
      .filter((f) => f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none') && (f.ext === 'mp4' || f.ext === 'webm'))
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    // Best available audio-only track to pair with video-only formats.
    const bestAudio = allFormats
      .filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
      .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

    const seen = new Set();
    const formats = [];

    // High-res merged formats first (what people actually want when they ask for 4K).
    if (bestAudio) {
      for (const f of videoOnly) {
        const h = f.height || 0;
        if (h < 1080 || seen.has(h)) continue; // below 1080 the progressive list already covers it
        seen.add(h);
        formats.push({
          format_id: `${f.format_id}+${bestAudio.format_id}`,
          height: h,
          label: h >= 2160 ? `${h}p (4K)` : h >= 1440 ? `${h}p (2K)` : `${h}p`,
          ext: 'mp4',
          approx_filesize: (f.filesize || f.filesize_approx || 0) + (bestAudio.filesize || bestAudio.filesize_approx || 0) || null,
          merged: true,
        });
      }
    }

    // Progressive formats fill in 720p and below.
    for (const f of progressive) {
      const h = f.height || 0;
      if (seen.has(h)) continue;
      seen.add(h);
      formats.push({
        format_id: f.format_id,
        height: h,
        label: h ? `${h}p` : (f.format_note || f.format_id),
        ext: f.ext,
        approx_filesize: f.filesize || f.filesize_approx || null,
        merged: false,
      });
    }

    formats.sort((a, b) => b.height - a.height);

    // Always offer an audio-only option (extracted to mp3 server-side).
    formats.push({ format_id: 'audio', height: 0, label: 'Audio only (MP3)', ext: 'mp3', approx_filesize: null });

    res.json({
      title: data.title,
      uploader: data.uploader,
      duration: data.duration,
      thumbnail: data.thumbnail,
      formats,
    });
  } catch (e) {
    res.status(502).json({ error: 'Could not fetch video info: ' + e.message });
  }
});

// GET /api/download?url=...&format_id=...
app.get('/api/download', rateLimit(10, 60_000), (req, res) => {
  const { url, format_id: formatId } = req.query;
  if (!isValidYoutubeUrl(url)) {
    return res.status(400).json({ error: 'Provide a valid youtube.com or youtu.be URL.' });
  }
  if (!formatId) {
    return res.status(400).json({ error: 'Missing format_id — call /api/info first.' });
  }
  // format_id is either "audio", a plain format code, or "videoId+audioId" for merged high-res.
  if (formatId !== 'audio' && !/^[\w.+-]+$/.test(formatId)) {
    return res.status(400).json({ error: 'Invalid format_id.' });
  }

  let args;
  let filename;
  if (formatId === 'audio') {
    args = ['-f', 'bestaudio', '-x', '--audio-format', 'mp3', '--no-playlist', '-o', '-', url];
    filename = 'audio.mp3';
    res.setHeader('Content-Type', 'audio/mpeg');
  } else if (formatId.includes('+')) {
    // Video-only + audio-only, needs ffmpeg to mux into one file.
    args = ['-f', formatId, '--merge-output-format', 'mp4', '--no-playlist', '-o', '-', url];
    filename = 'video.mp4';
    res.setHeader('Content-Type', 'video/mp4');
  } else {
    args = ['-f', formatId, '--no-playlist', '-o', '-', url];
    filename = 'video.mp4';
    res.setHeader('Content-Type', 'video/mp4');
  }
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const proc = spawn(YTDLP, ['--no-warnings', ...cookieArgs(), ...args]);

  proc.stdout.pipe(res);

  let errBuf = '';
  proc.stderr.on('data', (d) => { errBuf += d; });

  proc.on('error', (e) => {
    if (!res.headersSent) res.status(502).json({ error: 'Failed to start yt-dlp: ' + e.message });
  });

  proc.on('close', (code) => {
    if (code !== 0 && !res.writableEnded) {
      // Only safe to send a JSON error if we haven't already started streaming bytes.
      if (!res.headersSent) {
        res.status(502).json({ error: errBuf.trim() || `yt-dlp exited with code ${code}` });
      } else {
        res.end();
      }
    }
  });

  req.on('close', () => {
    // Client disconnected early — stop the download.
    if (!proc.killed) proc.kill('SIGKILL');
  });
});

app.get('/api/health', (req, res) => res.json({ ok: true, cookiesLoaded: !!COOKIES_PATH }));

app.listen(PORT, () => {
  console.log(`VRX Editing downloader backend listening on :${PORT}`);
});