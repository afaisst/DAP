// Hourly statistics of arXiv traffic, kept for 14 days (shown on the Admin page).
//
// Per hour (UTC) it counts:
//   sent     requests actually sent to arXiv, split by purpose (papers, search, figures, digest)
//   cached   requests answered from the server's memory without asking arXiv
//   limited  "too many requests" (HTTP 429) or "busy" (503) answers from arXiv
//   refused  requests the server held back itself (pause after a 429, or too long a queue)
//
// The counts live in memory and are saved every 10 minutes (and when the server shuts down)
// through the load/save functions passed in by server.js, so restarts don't lose them.

export const statKinds = ["papers", "search", "figures", "digest"];
const retentionMs = 14 * 24 * 60 * 60 * 1000;
const saveEveryMs = 10 * 60 * 1000;

let buckets = {};
let dirty = false;

const hourKey = (time = Date.now()) => new Date(time).toISOString().slice(0, 13);
const emptyBucket = () => ({ sent: Object.fromEntries(statKinds.map((kind) => [kind, 0])), cached: 0, limited: 0, refused: 0 });

function prune() {
  const oldest = hourKey(Date.now() - retentionMs);
  Object.keys(buckets).forEach((key) => {
    if (key < oldest) delete buckets[key];
  });
}

// event: "sent" | "cached" | "limited" | "refused"
export function recordArxivEvent(event, kind = "papers") {
  const key = hourKey();
  const bucket = buckets[key] || (buckets[key] = emptyBucket());

  if (event === "sent") {
    bucket.sent[kind] = (bucket.sent[kind] || 0) + 1;
  } else if (event in bucket) {
    bucket[event] += 1;
  }

  dirty = true;
}

export function arxivStatsSnapshot() {
  prune();
  return Object.entries(buckets)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([hour, bucket]) => ({ hour: `${hour}:00:00Z`, ...bucket }));
}

function mergeLoaded(saved) {
  if (!saved || typeof saved !== "object") return;

  Object.entries(saved).forEach(([key, value]) => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(key) || !value || typeof value !== "object") return;
    const bucket = buckets[key] || (buckets[key] = emptyBucket());
    statKinds.forEach((kind) => { bucket.sent[kind] += Number(value.sent?.[kind]) || 0; });
    ["cached", "limited", "refused"].forEach((field) => { bucket[field] += Number(value[field]) || 0; });
  });
  prune();
}

export async function startArxivStatsPersistence({ load, save }) {
  try {
    mergeLoaded(await load());
  } catch (error) {
    console.warn(`arXiv stats: could not load saved statistics: ${error.message}`);
  }

  const flush = async () => {
    if (!dirty) return;
    dirty = false;
    prune();

    try {
      await save(buckets);
    } catch (error) {
      dirty = true;
      console.warn(`arXiv stats: could not save statistics: ${error.message}`);
    }
  };

  setInterval(flush, saveEveryMs).unref();

  // Render sends SIGTERM before restarting (e.g. on deploy): save first.
  ["SIGTERM", "SIGINT"].forEach((signal) => {
    process.once(signal, async () => {
      await flush();
      process.exit(0);
    });
  });

  return flush;
}
