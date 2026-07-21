import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
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
const sessions = new Map();
let userStoreWrite = Promise.resolve();

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

function createSession(username) {
  const token = randomBytes(24).toString("hex");
  sessions.set(token, {
    username,
    expiresAt: Date.now() + sessionMaxAgeSeconds * 1000
  });
  return token;
}

function getSession(req) {
  const token = cookies(req)[sessionCookieName];

  if (!token) {
    return null;
  }

  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }

  return { token, ...session };
}

function deleteSession(token) {
  if (token) {
    sessions.delete(token);
  }
}

function normalizeUsername(value) {
  return value.trim().toLowerCase();
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
  userStoreWrite = userStoreWrite.then(async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(usersFile, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
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

  return {
    fullName,
    orcid
  };
}

function serializeUser(user) {
  return {
    username: user.username,
    fullName: user.fullName || "",
    orcid: user.orcid || ""
  };
}

function deleteSessionsForUsername(username) {
  for (const [token, session] of sessions.entries()) {
    if (session.username === username) {
      sessions.delete(token);
    }
  }
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
    deleteSession(session.token);
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
    deleteSession(session.token);
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
    createdAt: new Date().toISOString()
  });
  await writeUserStore(store);

  const createdUser = store.users[store.users.length - 1];
  const token = createSession(username);
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

  const token = createSession(user.username);
  setCookie(res, sessionCookieName, token, { maxAge: sessionMaxAgeSeconds });
  return json(res, 200, { user: serializeUser(user) });
}

async function handleLogout(req, res) {
  deleteSession(getSession(req)?.token);
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

  const { fullName, orcid } = sanitizeProfileFields(payload);
  auth.user.fullName = fullName;
  auth.user.orcid = orcid;
  await writeUserStore(auth.store);
  return json(res, 200, { user: serializeUser(auth.user) });
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

async function handleFigures(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const id = url.searchParams.get("id")?.trim();

  if (!id || !/^\d{4}\.\d{4,5}(v\d+)?$/.test(id)) {
    return json(res, 400, { error: "Missing or invalid arXiv ID." });
  }

  const htmlUrl = `https://arxiv.org/html/${id}`;

  try {
    const response = await fetch(htmlUrl, {
      headers: {
        "user-agent": "DailyAstroPH/1.0 (local webpage; figure preview)"
      }
    });

    if (!response.ok) {
      throw new Error(`arXiv HTML returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const figures = parseFigureHtml(html, htmlUrl);
    json(res, 200, { id, source: htmlUrl, figures }, {
      "cache-control": "public, max-age=900"
    });
  } catch (error) {
    json(res, 502, {
      error: "Could not load figures for this paper.",
      detail: error.message
    });
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

  try {
    const response = await fetch(`https://export.arxiv.org/api/query?${params}`, {
      headers: {
        "user-agent": "DailyAstroPH/1.0 (local webpage; arxiv daily reader)"
      }
    });

    if (!response.ok) {
      throw new Error(`arXiv returned HTTP ${response.status}`);
    }

    const xml = await response.text();
    res.writeHead(200, {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "public, max-age=900"
    });
    res.end(xml);
  } catch (error) {
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

  if (url.pathname === "/api/account") {
    return handleDeleteAccount(req, res);
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

  if (req.url?.startsWith("/api/session")
    || req.url?.startsWith("/api/signup")
    || req.url?.startsWith("/api/login")
    || req.url?.startsWith("/api/logout")
    || req.url?.startsWith("/api/favorites")
    || req.url?.startsWith("/api/profile")
    || req.url?.startsWith("/api/account")) {
    return handleAuth(req, res);
  }

  return handleStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`DailyAstroPH running at http://${host}:${port}`);
});
