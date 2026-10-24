const adminStatus = document.querySelector("#adminStatus");
const adminUsers = document.querySelector("#adminUsers");
let viewer = null;

init();

async function init() {
  try {
    const sessionResponse = await fetch("/api/session");
    const sessionData = await sessionResponse.json();

    if (!sessionData.user) {
      adminStatus.textContent = "Please log in first.";
      return;
    }

    if (!sessionData.user.isAdmin) {
      adminStatus.textContent = "This account does not have admin access.";
      return;
    }

    viewer = sessionData.user;

    await loadUsers();
    await loadDigestStatus();
    await loadArxivStats();
  } catch (error) {
    adminStatus.textContent = `Could not load admin tools. ${error.message}`;
  }
}

async function loadUsers() {
  adminStatus.textContent = "Loading…";

  try {
    const response = await fetch("/api/admin/users");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load members.");
    }

    renderUsers(Array.isArray(data.users) ? data.users : []);
  } catch (error) {
    adminStatus.textContent = error.message;
  }
}

// ===== Member list (searchable, sortable table) =====
const adminMembers = document.querySelector("#adminMembers");
const memberSearch = document.querySelector("#memberSearch");
const memberCount = document.querySelector("#memberCount");
let allMembers = [];
let memberSort = { key: "username", direction: 1 };

memberSearch.addEventListener("input", renderMemberRows);
adminMembers.querySelectorAll(".sort-button").forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    memberSort = { key, direction: memberSort.key === key ? -memberSort.direction : 1 };
    renderMemberRows();
  });
});

function renderUsers(users) {
  allMembers = users;
  adminMembers.hidden = false;
  adminStatus.textContent = "";
  renderMemberRows();
}

// "today", "yesterday", "12 days ago" + the date as tooltip; long-unused accounts are highlighted.
function lastVisit(value) {
  const time = Date.parse(value);

  if (!time) {
    return '<span class="muted" title="No visit recorded since this was added">—</span>';
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.ceil((startOfToday.getTime() - time) / 86400000));
  const label = days === 0 ? "today" : days === 1 ? "yesterday" : days < 60 ? `${days} days ago` : formatDate(value);
  const stale = days >= 180 ? " last-visit--stale" : "";
  return `<span class="last-visit${stale}" title="${escapeHtml(formatDate(value))}">${escapeHtml(label)}</span>`;
}

function memberRole(user) {
  return user.isOwner ? 2 : user.coAdmin ? 1 : 0;
}

function sortValue(user, key) {
  switch (key) {
    case "coAdmin": return memberRole(user);
    case "createdAt": return Date.parse(user.createdAt) || 0;
    case "lastSeenAt": return Date.parse(user.lastSeenAt) || 0;
    case "favoriteCount": return Number(user.favoriteCount) || 0;
    case "digest": return { daily: 2, weekly: 1 }[user.digest] || 0;
    default: return String(user[key] || "").toLowerCase();
  }
}

function renderMemberRows() {
  const query = memberSearch.value.trim().toLowerCase();
  const rows = allMembers
    .filter((user) => !query || [user.username, user.fullName, user.email, user.orcid].some((value) => String(value || "").toLowerCase().includes(query)))
    .sort((left, right) => {
      const a = sortValue(left, memberSort.key);
      const b = sortValue(right, memberSort.key);
      // Empty text values always go last.
      if (a === "" && b !== "") return 1;
      if (b === "" && a !== "") return -1;
      return (a < b ? -1 : a > b ? 1 : 0) * memberSort.direction || left.username.localeCompare(right.username);
    });

  memberCount.textContent = query ? `${rows.length} of ${allMembers.length} members` : `${allMembers.length} ${allMembers.length === 1 ? "member" : "members"}`;
  adminMembers.querySelectorAll(".sort-button").forEach((button) => {
    const active = button.dataset.sort === memberSort.key;
    button.classList.toggle("is-sorted", active);
    button.dataset.direction = active ? (memberSort.direction > 0 ? "asc" : "desc") : "";
    button.closest("th").setAttribute("aria-sort", active ? (memberSort.direction > 0 ? "ascending" : "descending") : "none");
  });

  adminUsers.innerHTML = "";

  if (!rows.length) {
    adminUsers.innerHTML = `<tr><td colspan="10" class="member-empty">${allMembers.length ? "No members match your search." : "No member accounts exist yet."}</td></tr>`;
    return;
  }

  rows.forEach((user) => {
    const isSelf = viewer && user.username === viewer.username;
    const row = document.createElement("tr");
    const digest = user.digest && user.digest !== "off"
      ? `<span class="digest-pill">${escapeHtml(user.digest)}</span>`
      : `<span class="muted">off</span>`;
    const email = user.email
      ? `<a href="mailto:${encodeURIComponent(user.email)}">${escapeHtml(user.email)}</a>`
      : '<span class="muted">—</span>';
    row.innerHTML = `
      <td><strong>${escapeHtml(user.username)}</strong>${user.isOwner ? ' <span class="role-badge role-badge--owner">Main admin</span>' : ""}${isSelf ? ' <span class="admin-you">(you)</span>' : ""}</td>
      <td>${user.fullName ? escapeHtml(user.fullName) : '<span class="muted">—</span>'}</td>
      <td class="nowrap">${user.orcid ? `<a href="https://orcid.org/${encodeURIComponent(user.orcid)}" target="_blank" rel="noreferrer">${escapeHtml(user.orcid)}</a>` : '<span class="muted">—</span>'}</td>
      <td>${email}</td>
      <td>${digest}</td>
      <td class="num">${Number(user.favoriteCount) || 0}</td>
      <td class="nowrap">${escapeHtml(formatDate(user.createdAt))}</td>
      <td class="nowrap">${lastVisit(user.lastSeenAt)}</td>
      <td class="center"></td>
      <td class="center"></td>
    `;

    const [coAdminCell, deleteCell] = row.querySelectorAll("td.center");

    // Co-admin checkbox: only the main admin can change it; the main admin row has none.
    if (!user.isOwner) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "coadmin-checkbox";
      checkbox.checked = Boolean(user.coAdmin);
      checkbox.disabled = !viewer?.isOwner;
      checkbox.title = viewer?.isOwner ? "Co-admins have the same admin rights, but cannot add or remove co-admins." : "Only the main admin can add or remove co-admins.";
      checkbox.setAttribute("aria-label", `Co-admin: ${user.username}`);
      checkbox.addEventListener("change", () => setCoAdmin(user.username, checkbox));
      coAdminCell.appendChild(checkbox);
    }

    // Delete: never for the main admin or yourself; co-admin accounts only by the main admin.
    if (!user.isOwner && !isSelf && (!user.coAdmin || viewer?.isOwner)) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "btn btn-small btn-danger-outline";
      deleteButton.textContent = "Delete";
      deleteButton.setAttribute("aria-label", `Delete ${user.username}`);
      deleteButton.addEventListener("click", () => deleteUser(user.username, deleteButton));
      deleteCell.appendChild(deleteButton);
    } else {
      deleteCell.innerHTML = '<span class="muted">—</span>';
    }

    adminUsers.appendChild(row);
  });
}

async function setCoAdmin(username, checkbox) {
  checkbox.disabled = true;
  adminStatus.textContent = `${checkbox.checked ? "Making" : "Removing"} ${username} ${checkbox.checked ? "a co-admin" : "as co-admin"}...`;

  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coAdmin: checkbox.checked })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not change co-admin rights.");
    }

    await loadUsers();
    adminStatus.textContent = data.user.coAdmin ? `${username} is now a co-admin.` : `${username} is no longer a co-admin.`;
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    checkbox.disabled = false;
    adminStatus.textContent = error.message;
  }
}

async function deleteUser(username, button) {
  if (!window.confirm(`Delete ${username} and all of their saved data? This cannot be undone.`)) {
    return;
  }

  button.disabled = true;
  adminStatus.textContent = `Deleting ${username}...`;

  try {
    const response = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
      method: "DELETE"
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not delete account.");
    }

    await loadUsers();
  } catch (error) {
    adminStatus.textContent = error.message;
    button.disabled = false;
  }
}

function formatDate(value) {
  if (!value) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

const adminDigest = document.querySelector("#adminDigest");
const digestStatus = document.querySelector("#digestStatus");
const digestResult = document.querySelector("#digestResult");
const digestPreview = document.querySelector("#digestPreview");

adminDigest.querySelectorAll("button[data-mode]").forEach((button) => {
  button.addEventListener("click", () => runDigest(button.dataset.mode, button.dataset.send === "true"));
});

async function loadDigestStatus() {
  adminDigest.hidden = false;

  try {
    const response = await fetch("/api/admin/digest");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load digest status.");
    }

    const flag = (ok, yes, no) => `<span class="${ok ? "ok" : "off"}">${ok ? yes : no}</span>`;
    digestStatus.innerHTML = [
      `Gmail: ${flag(data.smtpConfigured, `configured (${escapeHtml(data.sender)})`, "not configured")}`,
      `Schedule: ${flag(data.schedulerEnabled, "on", "off")}`,
      `Subscribers: ${data.subscribers.daily} daily, ${data.subscribers.weekly} weekly`,
      `Your email: ${data.adminEmail ? escapeHtml(data.adminEmail) : flag(false, "", "not set (add it on your profile)")}`
    ].map((item) => `<span>${item}</span>`).join("");
  } catch (error) {
    digestStatus.textContent = error.message;
  }
}

async function runDigest(mode, send) {
  const buttons = adminDigest.querySelectorAll("button[data-mode]");
  buttons.forEach((entry) => { entry.disabled = true; });
  digestResult.textContent = send ? `Building and sending the ${mode} digest… (fetching arXiv can take a few seconds)` : `Building the ${mode} digest…`;
  digestPreview.hidden = true;

  try {
    const response = await fetch("/api/admin/digest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, send })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Digest failed.");
    }

    const period = data.listingDates.length === 1 ? data.listingDates[0] : `${data.listingDates[0]} – ${data.listingDates[data.listingDates.length - 1]}`;
    digestResult.textContent = data.pickCount
      ? `${data.sentTo ? `Sent to ${data.sentTo}. ` : ""}${data.pickCount} of ${data.candidateCount} astro-ph papers picked for the arXiv listing ${period}.`
      : `No digest: ${data.reason} (${data.candidateCount} astro-ph papers in the listing ${period}).`;

    if (data.text) {
      digestPreview.textContent = `Subject: ${data.subject}\n\n${data.text}`;
      digestPreview.hidden = false;
    }
  } catch (error) {
    digestResult.textContent = error.message;
  } finally {
    buttons.forEach((entry) => { entry.disabled = false; });
  }
}

// ===== arXiv request statistics =====
const adminArxiv = document.querySelector("#adminArxiv");
const arxivTiles = document.querySelector("#arxivTiles");
const arxivChart = document.querySelector("#arxivChart");
const arxivTooltip = document.querySelector("#arxivTooltip");
const arxivTable = document.querySelector("#arxivTable");
const kindLabels = { papers: "Daily lists", search: "Search", figures: "Figures", digest: "Email digest" };
let arxivHours = [];
let arxivRangeDays = 2;

adminArxiv.querySelectorAll("button[data-range]").forEach((button) => {
  button.addEventListener("click", () => {
    arxivRangeDays = Number(button.dataset.range);
    renderArxivStats();
  });
});

async function loadArxivStats() {
  adminArxiv.hidden = false;

  try {
    const response = await fetch("/api/admin/arxiv-stats");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load arXiv statistics.");
    }

    const byHour = new Map(data.hours.map((entry) => [new Date(entry.hour).getTime(), entry]));
    const now = new Date();
    now.setMinutes(0, 0, 0);
    // One entry per hour for the last 14 days, zero-filled.
    arxivHours = Array.from({ length: 14 * 24 }, (_, index) => {
      const time = now.getTime() - (14 * 24 - 1 - index) * 3600000;
      const entry = byHour.get(time) || { sent: {}, cached: 0, limited: 0, refused: 0 };
      const sentTotal = Object.values(entry.sent || {}).reduce((sum, value) => sum + value, 0);
      return { time, sent: entry.sent || {}, sentTotal, cached: entry.cached || 0, limited: entry.limited || 0, refused: entry.refused || 0 };
    });
    adminArxiv.dataset.paused = data.status?.pausedForSeconds || 0;
    renderArxivStats();
  } catch (error) {
    arxivTiles.textContent = error.message;
  }
}

function sumHours(hours, field) {
  return hours.reduce((total, hour) => total + hour[field], 0);
}

function renderArxivStats() {
  adminArxiv.querySelectorAll("button[data-range]").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.range) === arxivRangeDays);
  });

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const lastHour = arxivHours.slice(-1);
  const today = arxivHours.filter((hour) => hour.time >= startOfToday.getTime());
  const paused = Number(adminArxiv.dataset.paused) || 0;
  const tile = (label, value, note = "") => `<div class="stat-tile"><span class="stat-label">${label}</span><span class="stat-value">${value}</span>${note ? `<span class="stat-note">${note}</span>` : ""}</div>`;

  arxivTiles.innerHTML = [
    tile("This hour", sumHours(lastHour, "sentTotal"), `${sumHours(lastHour, "cached")} from memory`),
    tile("Today", sumHours(today, "sentTotal"), `${sumHours(today, "cached")} from memory`),
    tile("Last 14 days", sumHours(arxivHours, "sentTotal"), `${sumHours(arxivHours, "cached")} from memory`),
    tile("“Too many requests”", sumHours(arxivHours, "limited"), `last 14 days · ${sumHours(arxivHours, "refused")} held back`),
    tile("Right now", paused ? "Paused" : "OK", paused ? `arXiv asked us to wait · ${Math.ceil(paused / 60)} min left` : "requests allowed")
  ].join("");

  renderArxivChart(arxivHours.slice(-arxivRangeDays * 24));
  renderArxivTable();
}

function renderArxivChart(hours) {
  const width = Math.max(arxivChart.clientWidth, 320);
  const height = 220;
  const margin = { top: 14, right: 8, bottom: 26, left: 34 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const max = Math.max(4, ...hours.map((hour) => hour.sentTotal));
  // Round the scale up to a "nice" number (1, 2, 5 × 10^k steps; ticks at 0, half, max).
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const niceMax = [1, 2, 4, 5, 10].map((factor) => factor * magnitude).find((value) => value >= max) || 10 * magnitude;
  const slot = plotWidth / hours.length;
  const gap = slot > 6 ? 2 : slot > 3 ? 1 : 0;
  const barWidth = Math.max(1, slot - gap);
  const y = (value) => margin.top + plotHeight - (value / niceMax) * plotHeight;
  const ticks = [0, niceMax / 2, niceMax];

  const grid = ticks.map((tick) => `<line x1="${margin.left}" x2="${width - margin.right}" y1="${y(tick)}" y2="${y(tick)}" class="chart-grid"/><text x="${margin.left - 6}" y="${y(tick) + 4}" class="chart-axis" text-anchor="end">${Math.round(tick)}</text>`).join("");

  const days = hours.filter((hour) => new Date(hour.time).getHours() === 0);
  const showEvery = hours.length > 24 * 7 ? 2 : 1;
  const dayLabels = days.filter((_, index) => index % showEvery === 0).map((hour) => {
    const x = margin.left + hours.indexOf(hour) * slot;
    const label = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" }).format(new Date(hour.time));
    return `<line x1="${x}" x2="${x}" y1="${margin.top}" y2="${margin.top + plotHeight}" class="chart-day"/><text x="${x + 3}" y="${height - 8}" class="chart-axis">${label}</text>`;
  }).join("");

  const bars = hours.map((hour, index) => {
    const x = margin.left + index * slot;
    const barHeight = hour.sentTotal ? Math.max(2, plotHeight - (y(hour.sentTotal) - margin.top)) : 0;
    const radius = Math.min(4, barWidth / 2, barHeight);
    const bar = barHeight ? `<path class="chart-bar" d="M${x},${margin.top + plotHeight} v${-(barHeight - radius)} q0,${-radius} ${radius},${-radius} h${barWidth - 2 * radius} q${radius},0 ${radius},${radius} v${barHeight - radius} z"/>` : "";
    const dot = hour.limited ? `<circle class="chart-limited" cx="${x + barWidth / 2}" cy="${margin.top + plotHeight - barHeight - 7}" r="3.5"/>` : "";
    return `${bar}${dot}<rect class="chart-hit" data-index="${index}" x="${x}" y="${margin.top}" width="${slot}" height="${plotHeight}"/>`;
  }).join("");

  arxivChart.innerHTML = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${grid}${dayLabels}${bars}</svg>`;

  arxivChart.querySelectorAll(".chart-hit").forEach((target) => {
    target.addEventListener("mouseenter", (event) => showArxivTooltip(hours[Number(target.dataset.index)], event));
    target.addEventListener("mousemove", (event) => positionTooltip(event));
    target.addEventListener("mouseleave", () => { arxivTooltip.hidden = true; target.classList.remove("is-hover"); });
  });
}

function showArxivTooltip(hour, event) {
  const start = new Date(hour.time);
  const end = new Date(hour.time + 3600000);
  const time = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric" }).format(start);
  const endTime = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(end);
  const kinds = Object.entries(kindLabels).map(([kind, label]) => `<tr><td>${label}</td><td>${hour.sent[kind] || 0}</td></tr>`).join("");
  arxivTooltip.innerHTML = `<strong>${time} – ${endTime}</strong>
    <table><tr><td>Sent to arXiv</td><td><strong>${hour.sentTotal}</strong></td></tr>${kinds}
    <tr><td>From memory</td><td>${hour.cached}</td></tr>
    <tr><td>“Too many requests”</td><td>${hour.limited}</td></tr>
    <tr><td>Held back</td><td>${hour.refused}</td></tr></table>`;
  arxivTooltip.hidden = false;
  event.target.classList.add("is-hover");
  positionTooltip(event);
}

// Tooltip sits above the cursor, and to its left near the right edge, so it never leaves the box.
function positionTooltip(event) {
  const box = adminArxiv.getBoundingClientRect();
  const x = event.clientX - box.left;
  const y = event.clientY - box.top;
  const width = arxivTooltip.offsetWidth;
  const left = x + 14 + width > box.width - 8 ? x - width - 14 : x + 14;
  arxivTooltip.style.left = `${Math.max(8, left)}px`;
  arxivTooltip.style.top = `${Math.max(8, y - arxivTooltip.offsetHeight - 12)}px`;
}

function renderArxivTable() {
  const days = new Map();
  arxivHours.forEach((hour) => {
    const date = new Date(hour.time);
    date.setHours(0, 0, 0, 0);
    const key = date.getTime();
    const day = days.get(key) || { key, sent: {}, sentTotal: 0, cached: 0, limited: 0, refused: 0 };
    Object.keys(kindLabels).forEach((kind) => { day.sent[kind] = (day.sent[kind] || 0) + (hour.sent[kind] || 0); });
    day.sentTotal += hour.sentTotal;
    day.cached += hour.cached;
    day.limited += hour.limited;
    day.refused += hour.refused;
    days.set(key, day);
  });

  const rows = [...days.values()].sort((a, b) => b.key - a.key).map((day) => `<tr>
    <td>${new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(day.key))}</td>
    <td class="num"><strong>${day.sentTotal}</strong></td>
    ${Object.keys(kindLabels).map((kind) => `<td class="num">${day.sent[kind]}</td>`).join("")}
    <td class="num">${day.cached}</td><td class="num${day.limited ? " warn" : ""}">${day.limited}</td><td class="num">${day.refused}</td>
  </tr>`).join("");

  arxivTable.innerHTML = `<thead><tr><th>Day</th><th class="num">Sent to arXiv</th>${Object.values(kindLabels).map((label) => `<th class="num">${label}</th>`).join("")}<th class="num">From memory</th><th class="num">“Too many requests”</th><th class="num">Held back</th></tr></thead><tbody>${rows}</tbody>`;
}

window.addEventListener("resize", () => { if (arxivHours.length) renderArxivChart(arxivHours.slice(-arxivRangeDays * 24)); });
