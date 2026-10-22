// Daily / weekly email digests of each user's "Most Interesting" papers, sent through Gmail.
//
// Settings (environment variables):
//   GMAIL_USER          Gmail address the digests are sent from
//   GMAIL_APP_PASSWORD  16-character Gmail app password (needs 2-Step Verification on that account)
//   DIGEST_ENABLED      "true" to send scheduled digests (leave unset locally to avoid duplicate emails)
//   APP_URL             public address of the site, used for links in the email
//   DIGEST_FROM_NAME    optional sender name (default "Daily AstroPH")
//   SMTP_HOST/SMTP_PORT optional, only to use a mail server other than Gmail (default smtp.gmail.com:465)
//
// Schedule (US Pacific time): daily digests Monday–Friday at 7 am with the arXiv batch announced the
// evening before; weekly digests Monday at 7 am with the previous Monday–Friday batches.

import nodemailer from "nodemailer";
import { cachedArxiv } from "./arxiv-client.js";
import { buildInterestProfile, isDownVote, mostInterestingPapers } from "./public/interests.js";

export const digestModes = { daily: { limit: 12, label: "Daily" }, weekly: { limit: 30, label: "Weekly" } };
const sendHourPacific = 7;
const checkEveryMs = 5 * 60 * 1000;

let transporter = null;

export function smtpConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export function schedulerEnabled() {
  return process.env.DIGEST_ENABLED === "true" && smtpConfigured();
}

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, "") }
    });
  }

  return transporter;
}

// ----- Dates -----

function zonedParts(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday)
  };
}

const utcDay = (iso) => new Date(`${iso}T00:00:00Z`);
const isoDay = (date) => date.toISOString().slice(0, 10);
const addDays = (iso, days) => { const d = utcDay(iso); d.setUTCDate(d.getUTCDate() + days); return isoDay(d); };
const isWeekendIso = (iso) => [0, 6].includes(utcDay(iso).getUTCDay());

// arXiv listing (announcement) date of a paper: submissions before 14:00 US Eastern on a weekday appear in
// the listing dated the next weekday. Holidays are ignored.
export function arxivListingDate(isoTimestamp) {
  const submitted = new Date(isoTimestamp);

  if (Number.isNaN(submitted.getTime())) {
    return "";
  }

  const eastern = zonedParts(submitted, "America/New_York");
  let day = eastern.date;

  if (!isWeekendIso(day) && eastern.hour >= 14) day = addDays(day, 1);
  while (isWeekendIso(day)) day = addDays(day, 1);
  day = addDays(day, 1);
  while (isWeekendIso(day)) day = addDays(day, 1);
  return day;
}

// Listing dates covered by a digest sent on `todayPacific` (YYYY-MM-DD).
export function digestListingDates(mode, todayPacific) {
  if (mode === "weekly") {
    let monday = todayPacific;
    while (utcDay(monday).getUTCDay() !== 1) monday = addDays(monday, -1);
    const lastMonday = addDays(monday, -7);
    return [0, 1, 2, 3, 4].map((offset) => addDays(lastMonday, offset));
  }

  let day = todayPacific;
  while (isWeekendIso(day)) day = addDays(day, -1);
  return [day];
}

// ----- arXiv -----

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseAtomEntries(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => {
    const tag = (name) => decodeXml((entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1] || "");
    const id = tag("id");
    return {
      id,
      title: tag("title"),
      abstract: tag("summary"),
      published: tag("published"),
      authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((match) => decodeXml(match[1])),
      categories: [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map((match) => match[1]),
      url: (entry.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) || entry.match(/<link[^>]*href="([^"]+)"[^>]*rel="alternate"/) || [])[1] || id
    };
  }).filter((paper) => paper.title && !paper.id.includes("/api/errors"));
}

// One arXiv request per digest window, shared by all users (kept in memory for 6 hours).
export async function fetchPapersForListingDates(listingDates) {
  const sorted = [...listingDates].sort();
  const from = addDays(sorted[0], -5).replaceAll("-", "");
  const to = sorted[sorted.length - 1].replaceAll("-", "");
  const params = new URLSearchParams({
    search_query: `cat:astro-ph* AND submittedDate:[${from}0000 TO ${to}2359]`,
    start: "0",
    max_results: "2000",
    sortBy: "submittedDate",
    sortOrder: "descending"
  });
  const { value: xml } = await cachedArxiv(`digest:${params}`, 6 * 60 * 60 * 1000, async (fetchArxiv) => {
    const response = await fetchArxiv(`https://export.arxiv.org/api/query?${params}`, "DailyAstroPH/1.0 (arxiv daily reader; email digest)");

    if (!response.ok) {
      throw new Error(`arXiv returned HTTP ${response.status}`);
    }

    return response.text();
  });
  const wanted = new Set(listingDates);
  return parseAtomEntries(xml).filter((paper) => wanted.has(arxivListingDate(paper.published)));
}

// ----- Building and sending -----

export function pickDigestPapers(user, mode, papers) {
  const liked = Array.isArray(user.liked) ? user.liked : [];

  if (!liked.some((entry) => !isDownVote(entry))) {
    return { picks: [], reason: "This account has no thumbs-up papers yet, so there is nothing to rank by." };
  }

  const picks = mostInterestingPapers(
    papers,
    buildInterestProfile(liked),
    new Set(liked.filter((entry) => !isDownVote(entry)).map((entry) => entry.id)),
    digestModes[mode].limit,
    new Set(liked.filter(isDownVote).map((entry) => entry.id))
  );
  return { picks, reason: picks.length ? "" : "No papers in this period matched the learned keywords." };
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
const shortAuthors = (authors) => (authors.length > 3 ? `${authors.slice(0, 3).join(", ")} et al.` : authors.join(", "));
const prettyDate = (iso) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(utcDay(iso));

export function renderDigestEmail(user, mode, picks, listingDates) {
  const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
  const period = listingDates.length === 1
    ? `arXiv listing of ${prettyDate(listingDates[0])}`
    : `arXiv listings ${prettyDate(listingDates[0])} – ${prettyDate(listingDates[listingDates.length - 1])}`;
  const subject = `Daily AstroPH ${digestModes[mode].label.toLowerCase()} digest: ${picks.length} papers for you (${period.replace("arXiv listing of ", "").replace("arXiv listings ", "")})`;
  const greeting = `Hi ${user.fullName ? user.fullName.split(/\s+/)[0] : user.username},`;
  const intro = `here are the ${picks.length} most interesting astro-ph papers for you from the ${period}, ranked by the papers you gave a thumbs up.`;
  const footer = [
    appUrl ? `Open Daily AstroPH: ${appUrl}` : "",
    `You receive this ${mode} digest because it is switched on in your Daily AstroPH profile${appUrl ? ` (${appUrl}/profile.html)` : ""}. Set it to "Off" there to unsubscribe.`
  ].filter(Boolean);

  const text = [
    greeting, "", intro, "",
    ...picks.flatMap((paper, index) => [
      `${index + 1}. ${paper.title}`,
      `   ${shortAuthors(paper.authors)}`,
      `   ${paper.url}${paper.interestMatches?.length ? `  ·  matches: ${paper.interestMatches.join(", ")}` : ""}`,
      ""
    ]),
    "--", ...footer
  ].join("\n");

  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2430;max-width:680px">
<p>${escapeHtml(greeting)}</p><p>${escapeHtml(intro)}</p>
<ol style="padding-left:22px">${picks.map((paper) => `<li style="margin-bottom:14px"><a href="${escapeHtml(paper.url)}" style="color:#3343bd;font-weight:600;text-decoration:none">${escapeHtml(paper.title)}</a><br><span style="color:#555">${escapeHtml(shortAuthors(paper.authors))}</span>${paper.interestMatches?.length ? `<br><span style="color:#2563eb;font-size:13px">Matches: ${escapeHtml(paper.interestMatches.join(", "))}</span>` : ""}</li>`).join("")}</ol>
<p style="color:#777;font-size:13px;border-top:1px solid #ddd;padding-top:10px">${footer.map((line) => escapeHtml(line)).join("<br>")}</p></div>`;

  return { subject, text, html };
}

export async function buildDigest(user, mode, todayPacific) {
  const listingDates = digestListingDates(mode, todayPacific);
  const papers = await fetchPapersForListingDates(listingDates);
  const { picks, reason } = pickDigestPapers(user, mode, papers);
  return { listingDates, candidateCount: papers.length, picks, reason, email: picks.length ? renderDigestEmail(user, mode, picks, listingDates) : null };
}

export async function sendDigestEmail(to, email) {
  if (!smtpConfigured()) {
    throw new Error("Gmail is not configured (GMAIL_USER / GMAIL_APP_PASSWORD).");
  }

  return getTransporter().sendMail({
    from: { name: process.env.DIGEST_FROM_NAME || "Daily AstroPH", address: process.env.GMAIL_USER },
    to,
    subject: email.subject,
    text: email.text,
    html: email.html
  });
}

export function todayInPacific(now = new Date()) {
  return zonedParts(now, "America/Los_Angeles");
}

// ----- Scheduler -----

export function startDigestScheduler({ readUserStore, writeUserStore }) {
  if (!schedulerEnabled()) {
    console.log("Email digests: scheduler off (set DIGEST_ENABLED=true, GMAIL_USER and GMAIL_APP_PASSWORD to enable).");
    return;
  }

  let running = false;
  console.log("Email digests: scheduler on (daily Mon–Fri and weekly Monday, 7 am Pacific).");

  const tick = async () => {
    if (running) return;
    running = true;

    try {
      const now = todayInPacific();

      if (now.weekday < 1 || now.weekday > 5 || now.hour < sendHourPacific) return;

      const modes = now.weekday === 1 ? ["daily", "weekly"] : ["daily"];
      const store = await readUserStore();

      for (const mode of modes) {
        const due = store.users.filter((user) => user.digest === mode && user.email && user.digestLastSent?.[mode] !== now.date);

        for (const user of due) {
          try {
            const digest = await buildDigest(user, mode, now.date);

            if (digest.email) {
              await sendDigestEmail(user.email, digest.email);
              console.log(`Email digests: sent ${mode} digest (${digest.picks.length} papers) to ${user.username}`);
            } else {
              console.log(`Email digests: nothing to send to ${user.username} (${digest.reason})`);
            }

            // Re-read so changes users made in the meantime are not overwritten.
            const fresh = await readUserStore();
            const target = fresh.users.find((entry) => entry.usernameKey === user.usernameKey);

            if (target) {
              target.digestLastSent = { ...(target.digestLastSent || {}), [mode]: now.date };
              await writeUserStore(fresh);
            }
          } catch (error) {
            // arXiv busy or Gmail error: leave it unmarked so the next check (5 minutes later) retries.
            console.warn(`Email digests: ${mode} digest for ${user.username} failed: ${error.message}`);
            break;
          }
        }
      }
    } catch (error) {
      console.warn(`Email digests: check failed: ${error.message}`);
    } finally {
      running = false;
    }
  };

  setTimeout(tick, 30 * 1000);
  setInterval(tick, checkEveryMs);
}
