import { ArxivBusyError, arxivStatus, cachedArxiv } from "./arxiv-client.js";
import { buildDigest, configureDigest, digestModes, schedulerEnabled, sendDigestEmail, smtpConfigured, startDigestScheduler, todayInPacific, unsubscribeToken } from "./digest.js";
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const dataDir = join(__dirname, "data");
const usersFile = join(dataDir, "users.json");
const port = Number(process.env.PORT || 4180);
const host = process.env.HOST || "0.0.0.0";
const sessionCookieName = "dap_session";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 30;
const sessionSecret = process.env.SESSION_SECRET || "daily-astroph-local-dev-secret";
configureDigest({ secret: sessionSecret });
let userStoreWrite = Promise.resolve();
let postgresPoolPromise;
let postgresSchemaPromise;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(body));
}

function cookies(req) {
  const header = req.headers.cookie || "";
  return header.split(/;\s*/).reduce((result, pair) => {
    if (!pair) {
      return result;
    }

    const index = pair.indexOf("=");

    if (index === -1) {
      return result;
    }

    const key = decodeURIComponent(pair.slice(0, index));
    const value = decodeURIComponent(pair.slice(index + 1));
    result[key] = value;
    return result;
  }, {});
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

  if (options.maxAge != null) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  parts.push(`Path=${options.path || "/"}`);
  parts.push("HttpOnly");
  parts.push("SameSite=Lax");
  res.setHeader("set-cookie", parts.join("; "));
}

function clearCookie(res, name) {
  setCookie(res, name, "", { maxAge: 0, path: "/" });
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function signValue(value) {
  return createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function createSessionCookie(username) {
  const payload = base64Url(JSON.stringify({
    username,
    expiresAt: Date.now() + sessionMaxAgeSeconds * 1000
  }));
  const signature = signValue(payload);
  return `${payload}.${signature}`;
}

function getSession(req) {
  const cookieValue = cookies(req)[sessionCookieName];

  if (!cookieValue) {
    return null;
  }

  const [payload, signature] = cookieValue.split(".");

  if (!payload || !signature || signValue(payload) !== signature) {
    return null;
  }

  let parsed;

  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
  } catch {
    return null;
  }

  if (!parsed.username || parsed.expiresAt < Date.now()) {
    return null;
  }

  return {
    username: parsed.username
  };
}

function deleteSession() {
  return null;
}

function normalizeUsername(value) {
  return value.trim().toLowerCase();
}

const adminUsernames = new Set(
  (process.env.ADMIN_USERS || "afaisst")
    .split(",")
    .map((value) => normalizeUsername(value))
    .filter(Boolean)
);

function isAdminUser(user) {
  return adminUsernames.has(normalizeUsername(user?.username || ""));
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password, salt, passwordHash) {
  const hashed = Buffer.from(hashPassword(password, salt), "hex");
  const stored = Buffer.from(passwordHash, "hex");

  return hashed.length === stored.length && timingSafeEqual(hashed, stored);
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf-8");

  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

async function readUserStore() {
  if (process.env.DATABASE_URL) {
    return readPostgresUserStore();
  }

  try {
    const raw = await readFile(usersFile, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.users) ? parsed : { users: [] };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { users: [] };
    }

    throw error;
  }
}

async function writeUserStore(store) {
  if (process.env.DATABASE_URL) {
    return writePostgresUserStore(store);
  }

  userStoreWrite = userStoreWrite.then(async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(usersFile, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  });
  return userStoreWrite;
}

async function getPostgresPool() {
  if (!postgresPoolPromise) {
    postgresPoolPromise = import("pg").then(({ Pool }) => new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false }
    }));
  }

  return postgresPoolPromise;
}

async function ensurePostgresSchema() {
  if (!postgresSchemaPromise) {
    postgresSchemaPromise = getPostgresPool().then((pool) => pool.query(`
      CREATE TABLE IF NOT EXISTS dap_users (
        username TEXT PRIMARY KEY,
        username_key TEXT UNIQUE NOT NULL,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL DEFAULT '',
        orcid TEXT NOT NULL DEFAULT '',
        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
        favorites JSONB NOT NULL DEFAULT '[]'::jsonb,
        name_aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
        suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
        liked JSONB NOT NULL DEFAULT '[]'::jsonb,
        email TEXT NOT NULL DEFAULT '',
        digest TEXT NOT NULL DEFAULT 'off',
        digest_last_sent JSONB NOT NULL DEFAULT '{}'::jsonb,
        hide_authors BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => pool.query(`
      ALTER TABLE dap_users
        ADD COLUMN IF NOT EXISTS name_aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS liked JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS digest TEXT NOT NULL DEFAULT 'off',
        ADD COLUMN IF NOT EXISTS digest_last_sent JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS hide_authors BOOLEAN NOT NULL DEFAULT FALSE
    `)));
  }

  return postgresSchemaPromise;
}

function rowToUser(row) {
  return {
    username: row.username,
    usernameKey: row.username_key,
    passwordSalt: row.password_salt,
    passwordHash: row.password_hash,
    fullName: row.full_name || "",
    orcid: row.orcid || "",
    isAdmin: Boolean(row.is_admin),
    favorites: Array.isArray(row.favorites) ? row.favorites : [],
    nameAliases: Array.isArray(row.name_aliases) ? row.name_aliases : [],
    suggestions: Array.isArray(row.suggestions) ? row.suggestions : [],
    liked: Array.isArray(row.liked) ? row.liked : [],
    email: row.email || "",
    digest: row.digest || "off",
    digestLastSent: row.digest_last_sent && typeof row.digest_last_sent === "object" ? row.digest_last_sent : {},
    hideAuthors: Boolean(row.hide_authors),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

async function readPostgresUserStore() {
  await ensurePostgresSchema();
  const pool = await getPostgresPool();
  const result = await pool.query("SELECT * FROM dap_users ORDER BY created_at ASC");
  return {
    users: result.rows.map(rowToUser)
  };
}

async function writePostgresUserStore(store) {
  userStoreWrite = userStoreWrite.then(async () => {
    await ensurePostgresSchema();
    const pool = await getPostgresPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const usernameKeys = store.users.map((user) => user.usernameKey);

      if (usernameKeys.length) {
        await client.query("DELETE FROM dap_users WHERE NOT (username_key = ANY($1::text[]))", [usernameKeys]);
      } else {
        await client.query("DELETE FROM dap_users");
      }

      for (const user of store.users) {
        await client.query(`
          INSERT INTO dap_users (
            username,
            username_key,
            password_salt,
            password_hash,
            full_name,
            orcid,
            is_admin,
            favorites,
            name_aliases,
            suggestions,
            liked,
            email,
            digest,
            digest_last_sent,
            hide_authors,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14::jsonb, $15, COALESCE($16::timestamptz, NOW()))
          ON CONFLICT (username_key) DO UPDATE SET
            username = EXCLUDED.username,
            password_salt = EXCLUDED.password_salt,
            password_hash = EXCLUDED.password_hash,
            full_name = EXCLUDED.full_name,
            orcid = EXCLUDED.orcid,
            is_admin = EXCLUDED.is_admin,
            favorites = EXCLUDED.favorites,
            name_aliases = EXCLUDED.name_aliases,
            suggestions = EXCLUDED.suggestions,
            liked = EXCLUDED.liked,
            email = EXCLUDED.email,
            digest = EXCLUDED.digest,
            digest_last_sent = EXCLUDED.digest_last_sent,
            hide_authors = EXCLUDED.hide_authors
        `, [
          user.username,
          user.usernameKey,
          user.passwordSalt,
          user.passwordHash,
          user.fullName || "",
          user.orcid || "",
          Boolean(user.isAdmin),
          JSON.stringify(Array.isArray(user.favorites) ? user.favorites : []),
          JSON.stringify(Array.isArray(user.nameAliases) ? user.nameAliases : []),
          JSON.stringify(Array.isArray(user.suggestions) ? user.suggestions : []),
          JSON.stringify(Array.isArray(user.liked) ? user.liked : []),
          user.email || "",
          user.digest || "off",
          JSON.stringify(user.digestLastSent && typeof user.digestLastSent === "object" ? user.digestLastSent : {}),
          Boolean(user.hideAuthors),
          user.createdAt || null
        ]);
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  return userStoreWrite;
}

function sanitizeFavoritePaper(paper) {
  const favoriteId = typeof paper?.id === "string" ? paper.id.trim() : "";
  const title = typeof paper?.title === "string" ? paper.title.trim() : "";
  const abstract = typeof paper?.abstract === "string" ? paper.abstract.trim() : "";
  const published = typeof paper?.published === "string" ? paper.published : "";
  const updated = typeof paper?.updated === "string" ? paper.updated : "";
  const url = typeof paper?.url === "string" ? paper.url.trim() : "";
  const topicId = typeof paper?.topic?.id === "string" ? paper.topic.id.trim() : "other";
  const topicLabel = typeof paper?.topic?.label === "string" ? paper.topic.label.trim() : "Other astro-ph";

  if (!favoriteId || !title || !url) {
    return null;
  }

  return {
    id: favoriteId,
    title,
    authors: Array.isArray(paper.authors) ? paper.authors.filter((author) => typeof author === "string").slice(0, 40) : [],
    authorOrcids: Array.isArray(paper.authorOrcids) ? paper.authorOrcids.filter((orcid) => typeof orcid === "string").slice(0, 40) : [],
    abstract,
    published,
    updated,
    categories: Array.isArray(paper.categories) ? paper.categories.filter((category) => typeof category === "string").slice(0, 20) : [],
    url,
    topic: {
      id: topicId || "other",
      label: topicLabel || "Other astro-ph"
    },
    relevance: Number.isFinite(Number(paper.relevance)) ? Number(paper.relevance) : 0,
    favoritedAt: typeof paper?.favoritedAt === "string" && paper.favoritedAt ? paper.favoritedAt : new Date().toISOString()
  };
}

function sanitizeProfileFields(payload) {
  const fullName = typeof payload?.fullName === "string" ? payload.fullName.trim().slice(0, 120) : "";
  const orcid = typeof payload?.orcid === "string"
    ? payload.orcid.trim().replace(/^https?:\/\/orcid\.org\//i, "").replace(/[^0-9X-]/gi, "").slice(0, 19)
    : "";
  const nameAliases = sanitizeNameAliases(payload?.nameAliases);

  return {
    fullName,
    orcid,
    nameAliases
  };
}

function serializeUser(user) {
  return {
    username: user.username,
    fullName: user.fullName || "",
    orcid: user.orcid || "",
    nameAliases: sanitizeNameAliases(user.nameAliases),
    email: user.email || "",
    digest: digestModes[user.digest] ? user.digest : "off",
    hideAuthors: Boolean(user.hideAuthors),
    isAdmin: isAdminUser(user)
  };
}

function sanitizeNameAliases(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  return value
    .map((entry) => typeof entry === "string" ? entry.trim().replace(/\s+/g, " ").slice(0, 120) : "")
    .filter(Boolean)
    .filter((entry) => {
      const key = entry.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

function serializePublicUser(user) {
  return {
    username: user.username,
    fullName: user.fullName || ""
  };
}

function sanitizeSuggestionPaper(paper, suggestedBy) {
  const sanitizedPaper = sanitizeFavoritePaper(paper);

  if (!sanitizedPaper) {
    return null;
  }

  return {
    ...sanitizedPaper,
    suggestedBy,
    suggestedAt: new Date().toISOString()
  };
}

function deleteSessionsForUsername(_username) {
  return null;
}

async function getUserFromSession(req, res) {
  const session = getSession(req);

  if (!session) {
    json(res, 401, { error: "Please log in first." });
    return null;
  }

  const store = await readUserStore();
  const user = store.users.find((entry) => entry.username === session.username);

  if (!user) {
    clearCookie(res, sessionCookieName);
    deleteSession();
    json(res, 401, { error: "Session user no longer exists." });
    return null;
  }

  return { session, store, user };
}

async function handleSession(req, res) {
  const session = getSession(req);

  if (!session) {
    return json(res, 200, { user: null });
  }

  const store = await readUserStore();
  const user = store.users.find((entry) => entry.username === session.username);

  if (!user) {
    clearCookie(res, sessionCookieName);
    deleteSession();
    return json(res, 200, { user: null });
  }

  return json(res, 200, { user: serializeUser(user) });
}

async function handleSignup(req, res) {
  let payload;

  try {
    payload = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: "Invalid JSON body." });
  }

  const username = typeof payload.username === "string" ? payload.username.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  const usernameKey = normalizeUsername(username);

  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(username)) {
    return json(res, 400, { error: "Username must be 3-24 characters and use letters, numbers, underscores, or hyphens." });
  }

  if (password.length < 6) {
    return json(res, 400, { error: "Password must be at least 6 characters long." });
  }

  const store = await readUserStore();

  if (store.users.some((user) => user.usernameKey === usernameKey)) {
    return json(res, 409, { error: "That username already exists." });
  }

  const salt = randomBytes(16).toString("hex");
  store.users.push({
    username,
    usernameKey,
    passwordSalt: salt,
    passwordHash: hashPassword(password, salt),
    fullName: "",
    orcid: "",
    favorites: [],
    nameAliases: [],
    suggestions: [],
    liked: [],
    createdAt: new Date().toISOString()
  });
  await writeUserStore(store);

  const createdUser = store.users[store.users.length - 1];
  const token = createSessionCookie(username);
  setCookie(res, sessionCookieName, token, { maxAge: sessionMaxAgeSeconds });
  return json(res, 201, { user: serializeUser(createdUser) });
}

async function handleLogin(req, res) {
  let payload;

  try {
    payload = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: "Invalid JSON body." });
  }

  const username = typeof payload.username === "string" ? payload.username.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  const usernameKey = normalizeUsername(username);
  const store = await readUserStore();
  const user = store.users.find((entry) => entry.usernameKey === usernameKey);

  if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    return json(res, 401, { error: "Incorrect username or password." });
  }

  const token = createSessionCookie(user.username);
  setCookie(res, sessionCookieName, token, { maxAge: sessionMaxAgeSeconds });
  return json(res, 200, { user: serializeUser(user) });
}

async function handleLogout(req, res) {
  deleteSession();
  clearCookie(res, sessionCookieName);
  return json(res, 200, { ok: true });
}

async function handleFavorites(req, res) {
  const auth = await getUserFromSession(req, res);

  if (!auth) {
    return;
  }

  const { store, user } = auth;

  if (req.method === "GET") {
    return json(res, 200, { favorites: Array.isArray(user.favorites) ? user.favorites : [] });
  }

  if (req.method === "PUT") {
    let payload;

    try {
      payload = await readJsonBody(req);
    } catch {
      return json(res, 400, { error: "Invalid JSON body." });
    }

    if (!Array.isArray(payload.favorites)) {
      return json(res, 400, { error: "Expected a favorites array." });
    }

    user.favorites = payload.favorites
      .map(sanitizeFavoritePaper)
      .filter(Boolean)
      .slice(0, 500);
    await writeUserStore(store);
    return json(res, 200, { favorites: user.favorites });
  }

  return json(res, 405, { error: "Method not allowed." });
}

async function handleProfile(req, res) {
  const auth = await getUserFromSession(req, res);

  if (!auth) {
    return;
  }

  if (req.method !== "PUT") {
    return json(res, 405, { error: "Method not allowed." });
  }

  let payload;

  try {
    payload = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: "Invalid JSON body." });
  }

  const { fullName, orcid, nameAliases } = sanitizeProfileFields(payload);

  // Optional email digest settings, saved together with the profile.
  if ("digest" in payload || "email" in payload) {
    const email = typeof payload.email === "string" ? payload.email.trim().slice(0, 200) : "";
    const digest = digestModes[payload.digest] ? payload.digest : "off";

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(res, 400, { error: "That email address does not look right." });
    }

    if (digest !== "off" && !email) {
      return json(res, 400, { error: "Enter an email address to receive the digest." });
    }

    auth.user.email = email;
    auth.user.digest = digest;
  }

  auth.user.fullName = fullName;
  auth.user.orcid = orcid;
  auth.user.nameAliases = nameAliases;

  if ("hideAuthors" in payload) {
    auth.user.hideAuthors = payload.hideAuthors === true;
  }

  await writeUserStore(auth.store);
  return json(res, 200, { user: serializeUser(auth.user) });
}

async function handleUsers(req, res) {
  const auth = await getUserFromSession(req, res);

  if (!auth) {
    return;
  }

  if (req.method !== "GET") {
    return json(res, 405, { error: "Method not allowed." });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const query = (url.searchParams.get("q") || "").trim().toLowerCase();

  if (query.length < 1) {
    return json(res, 200, { users: [] });
  }

  const users = auth.store.users
    .filter((user) => user.usernameKey !== auth.user.usernameKey)
    .filter((user) => `${user.username} ${user.fullName || ""}`.toLowerCase().includes(query))
    .sort((left, right) => left.username.localeCompare(right.username))
    .slice(0, 8)
    .map(serializePublicUser);

  return json(res, 200, { users });
}

async function handleSuggestions(req, res) {
  const auth = await getUserFromSession(req, res);

  if (!auth) {
    return;
  }

  if (req.method === "GET") {
    return json(res, 200, {
      suggestions: Array.isArray(auth.user.suggestions) ? auth.user.suggestions : []
    });
  }

  if (req.method !== "POST" && req.method !== "DELETE") {
    return json(res, 405, { error: "Method not allowed." });
  }

  let payload;

  try {
    payload = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: "Invalid JSON body." });
  }

  if (req.method === "DELETE") {
    // Dismiss a suggestion from the current user's own list. Favorites are stored separately and stay untouched.
    const paperId = typeof payload.id === "string" ? payload.id.trim() : "";
    const suggesterKey = normalizeUsername(typeof payload.suggestedBy === "string" ? payload.suggestedBy : "");

    if (!paperId) {
      return json(res, 400, { error: "Missing paper id." });
    }

    const existing = Array.isArray(auth.user.suggestions) ? auth.user.suggestions : [];
    auth.user.suggestions = existing.filter((entry) => !(
      entry?.id === paperId
      && (!suggesterKey || normalizeUsername(entry?.suggestedBy?.username || "") === suggesterKey)
    ));

    if (auth.user.suggestions.length !== existing.length) {
      await writeUserStore(auth.store);
    }

    return json(res, 200, { ok: true, suggestions: auth.user.suggestions });
  }

  const recipientUsername = typeof payload.recipientUsername === "string" ? payload.recipientUsername.trim() : "";
  const recipientKey = normalizeUsername(recipientUsername);

  if (!recipientKey) {
    return json(res, 400, { error: "Choose a user to suggest this paper to." });
  }

  if (recipientKey === auth.user.usernameKey) {
    return json(res, 400, { error: "Choose another user." });
  }

  const recipient = auth.store.users.find((user) => user.usernameKey === recipientKey);

  if (!recipient) {
    return json(res, 404, { error: "That user does not exist." });
  }

  const suggestion = sanitizeSuggestionPaper(payload.paper, serializePublicUser(auth.user));

  if (!suggestion) {
    return json(res, 400, { error: "Could not read that paper." });
  }

  const existing = Array.isArray(recipient.suggestions) ? recipient.suggestions : [];
  recipient.suggestions = [
    suggestion,
    ...existing.filter((entry) => !(entry?.id === suggestion.id && normalizeUsername(entry?.suggestedBy?.username || "") === auth.user.usernameKey))
  ].slice(0, 500);
  await writeUserStore(auth.store);
  return json(res, 200, { ok: true });
}

const maxLikedPapers = 1000;
const maxKeywordsPerPaper = 25;

function sanitizeLikedPaper(payload) {
  const id = typeof payload?.paper?.id === "string" ? payload.paper.id.trim().slice(0, 300) : "";
  const title = typeof payload?.paper?.title === "string" ? payload.paper.title.trim().slice(0, 500) : "";
  const url = typeof payload?.paper?.url === "string" ? payload.paper.url.trim().slice(0, 500) : "";

  if (!id) {
    return null;
  }

  const seen = new Set();
  const keywords = (Array.isArray(payload.keywords) ? payload.keywords : [])
    .map((entry) => ({
      term: typeof entry?.term === "string" ? entry.term.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60) : "",
      weight: Math.min(1, Math.max(0, Number(entry?.weight) || 0))
    }))
    .filter((entry) => entry.term && entry.weight > 0 && !seen.has(entry.term) && seen.add(entry.term))
    .slice(0, maxKeywordsPerPaper);

  // vote 1 = thumbs up, -1 = thumbs down ("show me fewer papers like this").
  const vote = Number(payload.vote) === -1 ? -1 : 1;
  return { id, title, url, keywords, vote, likedAt: new Date().toISOString() };
}

// Thumbs-up "likes": each entry keeps the paper's extracted keywords, which drive the "Most Interesting" list.
async function handleLikes(req, res) {
  const auth = await getUserFromSession(req, res);

  if (!auth) {
    return;
  }

  const current = () => (Array.isArray(auth.user.liked) ? auth.user.liked : []);

  if (req.method === "GET") {
    return json(res, 200, { liked: current() });
  }

  if (req.method !== "POST" && req.method !== "DELETE") {
    return json(res, 405, { error: "Method not allowed." });
  }

  let payload;

  try {
    payload = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: "Invalid JSON body." });
  }

  if (req.method === "POST") {
    const liked = sanitizeLikedPaper(payload);

    if (!liked) {
      return json(res, 400, { error: "Could not read that paper." });
    }

    auth.user.liked = [liked, ...current().filter((entry) => entry?.id !== liked.id)].slice(0, maxLikedPapers);
  } else if (payload.all === true) {
    auth.user.liked = [];
  } else {
    const id = typeof payload.id === "string" ? payload.id.trim() : "";

    if (!id) {
      return json(res, 400, { error: "Missing paper id." });
    }

    auth.user.liked = current().filter((entry) => entry?.id !== id);
  }

  await writeUserStore(auth.store);
  return json(res, 200, { liked: auth.user.liked });
}

// Email digest settings for the logged-in user: { email, digest: "off" | "daily" | "weekly" }.
async function handleDigestSettings(req, res) {
  const auth = await getUserFromSession(req, res);

  if (!auth) {
    return;
  }

  if (req.method !== "PUT") {
    return json(res, 405, { error: "Method not allowed." });
  }

  let payload;

  try {
    payload = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: "Invalid JSON body." });
  }

  const email = typeof payload.email === "string" ? payload.email.trim().slice(0, 200) : "";
  const digest = digestModes[payload.digest] ? payload.digest : "off";

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(res, 400, { error: "That email address does not look right." });
  }

  if (digest !== "off" && !email) {
    return json(res, 400, { error: "Enter an email address to receive the digest." });
  }

  auth.user.email = email;
  auth.user.digest = digest;
  await writeUserStore(auth.store);
  return json(res, 200, { user: serializeUser(auth.user) });
}

// Admin: digest status, preview or test-send to the admin's own email address.
async function handleAdminDigest(req, res) {
  const auth = await getUserFromSession(req, res);

  if (!auth || !ensureAdmin(req, res, auth)) {
    return;
  }

  if (req.method === "GET") {
    const subscribers = (mode) => auth.store.users.filter((user) => user.digest === mode && user.email).length;
    return json(res, 200, {
      smtpConfigured: smtpConfigured(),
      schedulerEnabled: schedulerEnabled(),
      sender: process.env.GMAIL_USER || "",
      adminEmail: auth.user.email || "",
      subscribers: { daily: subscribers("daily"), weekly: subscribers("weekly") }
    });
  }

  if (req.method !== "POST") {
    return json(res, 405, { error: "Method not allowed." });
  }

  let payload;

  try {
    payload = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: "Invalid JSON body." });
  }

  const mode = digestModes[payload.mode] ? payload.mode : "daily";

  try {
    const digest = await buildDigest(auth.user, mode, todayInPacific().date, { test: payload.send === true });
    let sentTo = "";

    if (payload.send === true) {
      if (!auth.user.email) {
        return json(res, 400, { error: "Add your email address on the profile page first." });
      }

      if (!digest.email) {
        return json(res, 400, { error: `Nothing to send: ${digest.reason}` });
      }

      await sendDigestEmail(auth.user.email, digest.email);
      sentTo = auth.user.email;
    }

    return json(res, 200, {
      mode,
      listingDates: digest.listingDates,
      candidateCount: digest.candidateCount,
      pickCount: digest.picks.length,
      reason: digest.reason,
      subject: digest.email?.subject || "",
      text: digest.email?.text || "",
      sentTo
    });
  } catch (error) {
    if (error instanceof ArxivBusyError) {
      return json(res, 503, { error: busyMessage(error) });
    }

    return json(res, 502, { error: `Could not build or send the digest: ${error.message}` });
  }
}

// Unsubscribe link from digest emails (no login needed; the link is signed per user).
// GET shows a confirmation page with a button, because mail security scanners (e.g. Microsoft Safe Links)
// open links automatically and must not unsubscribe anyone. POST does the unsubscribe; mail apps send it
// directly for one-click unsubscribe (RFC 8058).
function unsubscribePage(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/styles.css"><script src="/theme.js"></script></head>
<body><main class="app-shell"><section class="topbar" style="max-width:560px;margin:40px auto"><p class="eyebrow">Daily AstroPH</p><h1>${title}</h1>${body}</section></main></body></html>`;
}

async function handleUnsubscribe(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const usernameKey = normalizeUsername(url.searchParams.get("u") || "");
  const token = url.searchParams.get("t") || "";
  const expected = usernameKey ? unsubscribeToken(usernameKey) : "";
  const valid = Boolean(expected) && token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  const send = (status, title, body) => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(unsubscribePage(title, body));
  };

  if (!valid) {
    return send(400, "Link not valid", `<p class="profile-help">This unsubscribe link is not valid. You can switch the digest off on your <a href="/profile.html">profile page</a>.</p>`);
  }

  if (req.method === "GET") {
    const action = `/api/unsubscribe?u=${encodeURIComponent(usernameKey)}&t=${encodeURIComponent(token)}`;
    return send(200, "Unsubscribe from the digest?", `<p class="profile-help">This stops the Daily AstroPH email digest for this account. You can switch it on again any time on your profile page.</p>
<form method="post" action="${action}" style="margin-top:8px"><button class="btn btn-primary" type="submit">Unsubscribe</button> <a class="btn" href="/">Cancel</a></form>`);
  }

  if (req.method !== "POST") {
    res.writeHead(405);
    return res.end();
  }

  await readJsonBody(req).catch(() => ({}));
  const store = await readUserStore();
  const user = store.users.find((entry) => entry.usernameKey === usernameKey);

  if (user && user.digest !== "off") {
    user.digest = "off";
    await writeUserStore(store);
  }

  return send(200, "You're unsubscribed", `<p class="profile-help">You won't receive the Daily AstroPH email digest anymore. To switch it on again, go to your <a href="/profile.html">profile page</a>.</p><p><a class="btn" href="/">Back to Daily AstroPH</a></p>`);
}

async function handlePassword(req, res) {
  const auth = await getUserFromSession(req, res);

  if (!auth) {
    return;
  }

  if (req.method !== "PUT") {
    return json(res, 405, { error: "Method not allowed." });
  }

  let payload;

  try {
    payload = await readJsonBody(req);
  } catch {
    return json(res, 400, { error: "Invalid JSON body." });
  }

  const currentPassword = typeof payload.currentPassword === "string" ? payload.currentPassword : "";
  const newPassword = typeof payload.newPassword === "string" ? payload.newPassword : "";

  if (!verifyPassword(currentPassword, auth.user.passwordSalt, auth.user.passwordHash)) {
    return json(res, 401, { error: "Current password is incorrect." });
  }

  if (newPassword.length < 6) {
    return json(res, 400, { error: "New password must be at least 6 characters long." });
  }

  const salt = randomBytes(16).toString("hex");
  auth.user.passwordSalt = salt;
  auth.user.passwordHash = hashPassword(newPassword, salt);
  await writeUserStore(auth.store);
  return json(res, 200, { ok: true });
}

async function handleDeleteAccount(req, res) {
  const auth = await getUserFromSession(req, res);

  if (!auth) {
    return;
  }

  if (req.method !== "DELETE") {
    return json(res, 405, { error: "Method not allowed." });
  }

  auth.store.users = auth.store.users.filter((entry) => entry.username !== auth.user.username);
  await writeUserStore(auth.store);
  deleteSessionsForUsername(auth.user.username);
  clearCookie(res, sessionCookieName);
  return json(res, 200, { ok: true });
}

function ensureAdmin(req, res, auth) {
  if (!auth || !isAdminUser(auth.user)) {
    json(res, 403, { error: "Admin access is required." });
    return false;
  }

  return true;
}

async function handleAdminUsers(req, res) {
  const auth = await getUserFromSession(req, res);

  if (!auth || !ensureAdmin(req, res, auth)) {
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const usernameParam = decodeURIComponent(url.pathname.replace(/^\/api\/admin\/users\/?/, "")).trim();

  if (req.method === "GET" && url.pathname === "/api/admin/users") {
    return json(res, 200, {
      users: auth.store.users.map((user) => ({
        ...serializeUser(user),
        favoriteCount: Array.isArray(user.favorites) ? user.favorites.length : 0,
        createdAt: user.createdAt || ""
      }))
    });
  }

  if (req.method === "DELETE" && usernameParam) {
    const usernameKey = normalizeUsername(usernameParam);

    if (usernameKey === normalizeUsername(auth.user.username)) {
      return json(res, 400, { error: "Use your own account settings to delete the current admin account." });
    }

    const targetUser = auth.store.users.find((user) => user.usernameKey === usernameKey);

    if (!targetUser) {
      return json(res, 404, { error: "That account does not exist." });
    }

    auth.store.users = auth.store.users.filter((user) => user.usernameKey !== usernameKey);
    await writeUserStore(auth.store);
    deleteSessionsForUsername(targetUser.username);
    return json(res, 200, { ok: true });
  }

  return json(res, 405, { error: "Method not allowed." });
}

function dateToArxivBounds(dateValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    throw new Error("Expected date in YYYY-MM-DD format.");
  }

  const compact = dateValue.replaceAll("-", "");
  return [`${compact}0000`, `${compact}2359`];
}

function parseFigureHtml(html, baseUrl) {
  const figureMatches = html.match(/<figure\b[\s\S]*?<\/figure>/gi) || [];
  const sources = figureMatches.length ? figureMatches : html.match(/<img\b[^>]*>/gi) || [];

  return sources
    .map((block, index) => {
      const imgMatch = block.match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);

      if (!imgMatch) {
        return null;
      }

      const captionMatch = block.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
      const altMatch = imgMatch[0].match(/\balt=["']([^"']*)["']/i);
      const caption = cleanHtml(captionMatch?.[1] || altMatch?.[1] || `Figure ${index + 1}`);

      const src = new URL(imgMatch[1], baseUrl).toString();

      return {
        src,
        caption
      };
    })
    .filter(Boolean)
    .filter((figure) => {
      const src = figure.src.toLowerCase();
      return !src.includes("/static/")
        && !src.includes("/images/icons/")
        && !src.includes("/icons/")
        && !src.endsWith(".svg");
    })
    .filter((figure, index, figures) => figures.findIndex((item) => item.src === figure.src) === index)
    .slice(0, 30);
}

function cleanHtml(value) {
  return preserveMathText(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function preserveMathText(value) {
  return value.replace(/<math\b[^>]*\balttext=(["'])(.*?)\1[^>]*>[\s\S]*?<\/math>/gi, (_match, _quote, altText) => {
    const tex = decodeHtmlEntities(altText)
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `$${tex}$`;
  });
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function busyMessage(error) {
  const minutes = Math.ceil(error.retryAfterSeconds / 60);
  return `arXiv is limiting requests right now (too many requests). Please try again in ${minutes <= 1 ? "about a minute" : `about ${minutes} minutes`}.`;
}

async function handleFigures(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const id = url.searchParams.get("id")?.trim();

  if (!id || !/^\d{4}\.\d{4,5}(v\d+)?$/.test(id)) {
    return json(res, 400, { error: "Missing or invalid arXiv ID." });
  }

  const htmlUrl = `https://arxiv.org/html/${id}`;

  try {
    const { value: figures, source } = await cachedArxiv(`figures:${id}`, 24 * 60 * 60 * 1000, async (fetchArxiv) => {
      const response = await fetchArxiv(htmlUrl, "DailyAstroPH/1.0 (arxiv daily reader; figure preview)");

      if (response.status === 404) {
        return [];
      }

      if (!response.ok) {
        throw new Error(`arXiv HTML returned HTTP ${response.status}`);
      }

      return parseFigureHtml(await response.text(), htmlUrl);
    });

    json(res, 200, { id, source: htmlUrl, figures }, {
      "cache-control": "public, max-age=3600",
      "x-arxiv-cache": source
    });
  } catch (error) {
    if (error instanceof ArxivBusyError) {
      return json(res, 503, { error: "arXiv is busy.", detail: busyMessage(error) }, { "retry-after": String(error.retryAfterSeconds) });
    }

    json(res, 502, {
      error: "Could not load figures for this paper.",
      detail: error.message
    });
  }
}

// Full-arXiv search. arXiv's API can't filter by author position, so the server fetches the papers
// matching the author surnames/dates/IDs and the browser then applies "first author" / "position > N".
const maxSearchResults = 300;

function authorSurnameTerm(name) {
  const clean = String(name || "").trim().slice(0, 100);
  const surname = (clean.includes(",") ? clean.split(",")[0] : clean.split(/\s+/).pop() || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z' -]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  return surname ? `au:${surname}` : "";
}

function compactDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value.replaceAll("-", "") : "";
}

async function handleSearch(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const q = url.searchParams;
  const terms = [];

  [q.get("first_author"), q.get("author")].forEach((name) => {
    const term = authorSurnameTerm(name);

    if (term && !terms.includes(term)) {
      terms.push(term);
    }
  });

  const from = compactDate(q.get("from"));
  const to = compactDate(q.get("to"));

  if (from || to) {
    terms.push(`submittedDate:[${from || "19910101"}0000 TO ${to || "29991231"}2359]`);
  }

  const allowedCategories = ["astro-ph.CO", "astro-ph.GA", "astro-ph.HE", "astro-ph.IM", "astro-ph.SR", "astro-ph.EP"];
  const categories = (q.get("cats") || "").split(",").filter((category) => allowedCategories.includes(category));

  if (categories.length) {
    terms.push(categories.length === 1 ? `cat:${categories[0]}` : `(${categories.map((category) => `cat:${category}`).join(" OR ")})`);
  } else if (q.get("astroph") === "1") {
    terms.push("cat:astro-ph*");
  }

  const ids = (q.get("ids") || "")
    .split(/[\s,]+/)
    .map((id) => id.trim().replace(/^arxiv:/i, "").replace(/v\d+$/, ""))
    .filter((id) => /^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})$/i.test(id))
    .slice(0, 50);

  if (!ids.length && !terms.some((term) => !term.startsWith("cat:"))) {
    return json(res, 400, { error: "Enter at least an author, a date range or an arXiv number." });
  }

  const params = new URLSearchParams({
    start: "0",
    max_results: String(ids.length && !terms.length ? ids.length : maxSearchResults),
    sortBy: "submittedDate",
    sortOrder: "descending"
  });

  if (terms.length) {
    params.set("search_query", terms.join(" AND "));
  }

  if (ids.length) {
    params.set("id_list", ids.join(","));
  }

  try {
    const { value: xml, source } = await cachedArxiv(`search:${params}`, 60 * 60 * 1000, async (fetchArxiv) => {
      const response = await fetchArxiv(`https://export.arxiv.org/api/query?${params}`, "DailyAstroPH/1.0 (arxiv daily reader; search)");

      if (!response.ok) {
        throw new Error(`arXiv returned HTTP ${response.status}`);
      }

      return response.text();
    });

    res.writeHead(200, {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "private, max-age=600",
      "x-arxiv-cache": source,
      "x-search-limit": String(maxSearchResults)
    });
    res.end(xml);
  } catch (error) {
    if (error instanceof ArxivBusyError) {
      return json(res, 503, { error: "arXiv is busy.", detail: busyMessage(error) }, { "retry-after": String(error.retryAfterSeconds) });
    }

    json(res, 502, { error: "Could not search arXiv.", detail: error.message });
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const selectedDate = url.searchParams.get("date");
  const maxResults = Math.min(Number(url.searchParams.get("max") || 150), 300);

  if (!selectedDate) {
    return json(res, 400, { error: "Missing date query parameter." });
  }

  let start;
  let end;
  try {
    [start, end] = dateToArxivBounds(selectedDate);
  } catch (error) {
    return json(res, 400, { error: error.message });
  }

  const params = new URLSearchParams({
    search_query: `cat:astro-ph* AND submittedDate:[${start} TO ${end}]`,
    start: "0",
    max_results: String(maxResults),
    sortBy: "submittedDate",
    sortOrder: "descending"
  });

  // Days older than 3 days no longer change, so keep them for a week; recent days refresh every 30 minutes.
  const ageDays = (Date.now() - Date.parse(`${selectedDate}T00:00:00Z`)) / 86400000;
  const isSettled = ageDays > 3;
  const ttlMs = isSettled ? 7 * 24 * 60 * 60 * 1000 : 30 * 60 * 1000;

  try {
    const { value: xml, source } = await cachedArxiv(`papers:${selectedDate}:${maxResults}`, ttlMs, async (fetchArxiv) => {
      const response = await fetchArxiv(`https://export.arxiv.org/api/query?${params}`, "DailyAstroPH/1.0 (arxiv daily reader)");

      if (!response.ok) {
        throw new Error(`arXiv returned HTTP ${response.status}`);
      }

      return response.text();
    });

    res.writeHead(200, {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": `public, max-age=${isSettled ? 86400 : 900}`,
      "x-arxiv-cache": source
    });
    res.end(xml);
  } catch (error) {
    if (error instanceof ArxivBusyError) {
      return json(res, 503, { error: "arXiv is busy.", detail: busyMessage(error) }, { "retry-after": String(error.retryAfterSeconds) });
    }

    json(res, 502, {
      error: "Could not fetch papers from arXiv.",
      detail: error.message
    });
  }
}

async function handleAuth(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/session" && req.method === "GET") {
    return handleSession(req, res);
  }

  if (url.pathname === "/api/signup" && req.method === "POST") {
    return handleSignup(req, res);
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    return handleLogin(req, res);
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    return handleLogout(req, res);
  }

  if (url.pathname === "/api/favorites") {
    return handleFavorites(req, res);
  }

  if (url.pathname === "/api/profile") {
    return handleProfile(req, res);
  }

  if (url.pathname === "/api/users") {
    return handleUsers(req, res);
  }

  if (url.pathname === "/api/suggestions") {
    return handleSuggestions(req, res);
  }

  if (url.pathname === "/api/likes") {
    return handleLikes(req, res);
  }

  if (url.pathname === "/api/digest-settings") {
    return handleDigestSettings(req, res);
  }

  if (url.pathname === "/api/admin/digest") {
    return handleAdminDigest(req, res);
  }

  if (url.pathname === "/api/password") {
    return handlePassword(req, res);
  }

  if (url.pathname === "/api/account") {
    return handleDeleteAccount(req, res);
  }

  if (url.pathname === "/api/admin/users" || url.pathname.startsWith("/api/admin/users/")) {
    return handleAdminUsers(req, res);
  }

  return json(res, 404, { error: "Not found." });
}

async function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const contents = await readFile(filePath);
    const type = mimeTypes[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(contents);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/api/papers")) {
    return handleApi(req, res);
  }

  if (req.url?.startsWith("/api/figures")) {
    return handleFigures(req, res);
  }


  if (req.url?.startsWith("/api/search")) {
    return handleSearch(req, res);
  }

  if (req.url?.startsWith("/api/digest-info")) {
    return json(res, 200, { sender: process.env.GMAIL_USER || "" });
  }

  if (req.url?.startsWith("/api/unsubscribe")) {
    return handleUnsubscribe(req, res);
  }

  if (req.url?.startsWith("/api/arxiv-status")) {
    return json(res, 200, arxivStatus());
  }

  if (req.url?.startsWith("/api/session")
    || req.url?.startsWith("/api/signup")
    || req.url?.startsWith("/api/login")
    || req.url?.startsWith("/api/logout")
    || req.url?.startsWith("/api/favorites")
    || req.url?.startsWith("/api/profile")
    || req.url?.startsWith("/api/users")
    || req.url?.startsWith("/api/suggestions")
    || req.url?.startsWith("/api/likes")
    || req.url?.startsWith("/api/digest-settings")
    || req.url?.startsWith("/api/admin/digest")
    || req.url?.startsWith("/api/password")
    || req.url?.startsWith("/api/account")
    || req.url?.startsWith("/api/admin/users")) {
    return handleAuth(req, res);
  }

  return handleStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`DailyAstroPH running at http://${host}:${port}`);
  startDigestScheduler({ readUserStore, writeUserStore });
});
