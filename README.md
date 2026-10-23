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
npm install
npm start
```

Then open:

```text
http://127.0.0.1:4180/
```

Use the local server URL rather than opening `public/index.html` directly. The
server provides the arXiv proxy endpoints used by the paper list and figure
carousel.

By default, local user accounts and favorites are stored in `data/users.json`.
For deployed environments, use Postgres by setting `DATABASE_URL`.

## Persistent User Storage

Vercel and Render free web services do not provide a durable writable filesystem.
Do not rely on `data/users.json` in production.

Set these environment variables for deployment:

```text
DATABASE_URL=postgres://user:password@host:5432/database
SESSION_SECRET=replace-with-a-long-random-string
ADMIN_USERS=afaisst
```

For a local Postgres server without SSL, also set:

```text
POSTGRES_SSL=false
```

To import the current local `data/users.json` into Postgres:

```bash
DATABASE_URL="postgres://..." npm run import:users
```

## Public Hosting

The app is currently deployed on https://dap-eret.onrender.com/

Note: This app needs a Node server because browsers cannot reliably fetch and parse
all arXiv resources directly from a static page. GitHub Pages alone is not
enough for the full app. Deploy it to a Node-capable host such as Render,
Railway, Fly.io, or Vercel.

## Email Digests

Users can get their "Most Interesting" papers by email (profile page → Email digest):

- **Daily**: Monday–Friday at 7 am US Pacific, the 12 best papers from the latest arXiv listing.
- **Weekly**: Mondays at 7 am US Pacific, the 30 best papers from the previous Monday–Friday listings.

Papers are ranked per user from their thumbs-up/down votes (same logic as `public/interests.js`).
Users without any thumbs-up receive nothing. The code is in `digest.js`.

Emails are sent through Gmail. Set these environment variables on the server (Render → Environment):

```text
GMAIL_USER=your.digest.account@gmail.com
GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
DIGEST_ENABLED=true
APP_URL=https://dap-eret.onrender.com
```

`GMAIL_APP_PASSWORD` is a Google app password (https://myaccount.google.com/apppasswords), which
requires 2-Step Verification on the account. Personal Gmail accounts can send up to 500 emails per day.
Keep `DIGEST_ENABLED` unset on local machines so digests are only sent once, from the deployed server.

Optionally set `DIGEST_REPLY_TO` so replies go to a real inbox. `APP_URL` is required for the
unsubscribe link and the one-click "Unsubscribe" header that mail apps (and spam filters) look for.

Admins can preview their own digest and send a test email to themselves on the Admin page.
