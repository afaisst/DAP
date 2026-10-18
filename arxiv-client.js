// All traffic to arXiv goes through here.
//
// 1. Throttle: at most one arXiv request every 3 seconds, across all users of this server
//    (arXiv's API terms ask for no more than one request every 3 seconds).
// 2. Cooldown: when arXiv answers 429 (too many requests) or 503 (busy), stop asking for a few
//    minutes instead of retrying right away, which would only extend the block.
// 3. Memory cache: results are kept in RAM (never on disk), so all users share one request per day
//    and figure page. Capped at ~40 MB; the oldest entries are dropped first and everything is
//    cleared when the server restarts.

const minIntervalMs = 3000;
const maxQueueWaitMs = 20000;
const cooldownAfter429Ms = 5 * 60 * 1000;
const cooldownAfter503Ms = 60 * 1000;
const maxCacheBytes = 40 * 1024 * 1024;
const maxCacheEntries = 400;

let nextSlot = 0;
let blockedUntil = 0;
let lastBlock = null;

const cache = new Map();
const inflight = new Map();
let cacheBytes = 0;

export class ArxivBusyError extends Error {
  constructor(retryAfterSeconds) {
    super("arXiv is limiting requests right now.");
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assertNotBlocked() {
  const remaining = blockedUntil - Date.now();

  if (remaining > 0) {
    throw new ArxivBusyError(remaining / 1000);
  }
}

export async function throttledFetch(url, userAgent) {
  assertNotBlocked();

  const now = Date.now();
  const slot = Math.max(now, nextSlot);

  if (slot - now > maxQueueWaitMs) {
    throw new ArxivBusyError((slot - now) / 1000);
  }

  nextSlot = slot + minIntervalMs;

  if (slot > now) {
    await sleep(slot - now);
    assertNotBlocked();
  }

  const response = await fetch(url, { headers: { "user-agent": userAgent } });

  if (response.status === 429 || response.status === 503) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const fallback = response.status === 429 ? cooldownAfter429Ms : cooldownAfter503Ms;
    const pauseMs = Math.max(fallback, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0);
    blockedUntil = Date.now() + pauseMs;
    lastBlock = { status: response.status, at: new Date().toISOString(), url };
    console.warn(`arXiv returned HTTP ${response.status}; pausing arXiv requests for ${Math.round(pauseMs / 1000)}s`);
    await response.body?.cancel().catch(() => {});
    throw new ArxivBusyError(pauseMs / 1000);
  }

  return response;
}

function sizeOf(value) {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value));
}

function store(key, value, ttlMs) {
  const old = cache.get(key);

  if (old) {
    cacheBytes -= old.bytes;
    cache.delete(key);
  }

  const bytes = sizeOf(value);
  cache.set(key, { value, bytes, expiresAt: Date.now() + ttlMs, storedAt: Date.now() });
  cacheBytes += bytes;

  // Map keeps insertion order, so the first entries are the least recently used.
  for (const [oldestKey, entry] of cache) {
    if (cacheBytes <= maxCacheBytes && cache.size <= maxCacheEntries) {
      break;
    }

    cache.delete(oldestKey);
    cacheBytes -= entry.bytes;
  }
}

// Returns { value, source } where source is "memory" (fresh copy), "arxiv" (just fetched) or
// "stale" (arXiv unavailable, older copy from memory). `loader` receives throttledFetch.
export async function cachedArxiv(key, ttlMs, loader) {
  const entry = cache.get(key);

  if (entry && entry.expiresAt > Date.now()) {
    cache.delete(key);
    cache.set(key, entry);
    return { value: entry.value, source: "memory" };
  }

  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const request = (async () => {
    try {
      const value = await loader(throttledFetch);
      store(key, value, ttlMs);
      return { value, source: "arxiv" };
    } catch (error) {
      if (entry) {
        return { value: entry.value, source: "stale" };
      }

      throw error;
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, request);
  return request;
}

export function arxivStatus() {
  return {
    pausedForSeconds: Math.max(0, Math.ceil((blockedUntil - Date.now()) / 1000)),
    lastBlock,
    cache: {
      entries: cache.size,
      megabytes: Math.round((cacheBytes / 1024 / 1024) * 100) / 100,
      limitMegabytes: maxCacheBytes / 1024 / 1024
    }
  };
}
