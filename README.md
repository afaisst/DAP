# Daily AstroPH

Daily AstroPH is a small local web app for browsing daily arXiv `astro-ph`
submissions by topic.

## Features

- Fetches daily `astro-ph*` submissions from arXiv.
- Groups and ranks papers by broad topic.
- Shows title, date, categories, first three authors, expandable author lists,
  and collapsible abstracts.
- Keeps topic sections collapsed by default.
- Includes search and date controls.
- Copies arXiv abstract links, with a fallback when browser clipboard access is
  blocked.
- Shows paper figures in a carousel when arXiv's experimental HTML page exposes
  figure markup.

## Run Locally

```bash
npm start
```

Then open:

```text
http://127.0.0.1:4180/
```

Use the local server URL rather than opening `public/index.html` directly. The
server provides the arXiv proxy endpoints used by the paper list and figure
carousel.

## Public Hosting

This app needs a Node server because browsers cannot reliably fetch and parse
all arXiv resources directly from a static page. GitHub Pages alone is not
enough for the full app. Deploy it to a Node-capable host such as Render,
Railway, Fly.io, or Vercel.
