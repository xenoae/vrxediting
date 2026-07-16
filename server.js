const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Clean URL routes — the actual filenames on disk stay the same,
// this just decides what path serves what.
const ROUTES = {
  '/': 'index.html',
  '/ytdl': 'youtube-downloader.html',
  '/tools': 'edit-tools.html',
  '/calculate': 'calculate-tools.html',
};

Object.entries(ROUTES).forEach(([route, file]) => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, file));
  });
});

// Redirect the old .html-style URLs to their clean equivalents, in case
// anything (bookmarks, old links) still points at the old paths.
const LEGACY_REDIRECTS = {
  '/index.html': '/',
  '/youtube-downloader.html': '/ytdl',
  '/edit-tools.html': '/tools',
  '/calculate-tools.html': '/calculate',
};

Object.entries(LEGACY_REDIRECTS).forEach(([oldPath, newPath]) => {
  app.get(oldPath, (req, res) => res.redirect(301, newPath));
});

app.listen(PORT, () => {
  console.log(`VRX Editing frontend listening on :${PORT}`);
});
