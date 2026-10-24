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
  } catch (error) {
    adminStatus.textContent = `Could not load admin tools. ${error.message}`;
  }
}

async function loadUsers() {
  adminStatus.textContent = "Loading members...";

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

function renderUsers(users) {
  adminUsers.innerHTML = "";
  adminStatus.textContent = `${users.length} ${users.length === 1 ? "member" : "members"} found.`;

  if (!users.length) {
    adminUsers.innerHTML = `<div class="empty">No member accounts exist yet.</div>`;
    return;
  }

  users
    .sort((left, right) => left.username.localeCompare(right.username))
    .forEach((user) => {
      const card = document.createElement("article");
      card.className = "admin-user-card";
      const role = user.isOwner ? "Main admin" : user.coAdmin ? "Co-admin" : "";
      const isSelf = viewer && user.username === viewer.username;
      card.innerHTML = `
        <div class="admin-user-header">
          <h3>${escapeHtml(user.username)}${role ? ` <span class="role-badge role-badge--${user.isOwner ? "owner" : "co"}">${role}</span>` : ""}${isSelf ? ' <span class="admin-you">(you)</span>' : ""}</h3>
          <span>${user.favoriteCount} ${user.favoriteCount === 1 ? "favorite" : "favorites"}</span>
        </div>
        <div class="admin-user-meta">
          <span>Full name: ${escapeHtml(user.fullName || "Not set")}</span>
          <span>ORCID: ${escapeHtml(user.orcid || "Not set")}</span>
          <span>Digest: ${escapeHtml(user.digest && user.digest !== "off" ? `${user.digest} → ${user.email}` : "off")}</span>
          <span>Created: ${escapeHtml(formatDate(user.createdAt))}</span>
        </div>
        <div class="admin-user-actions"></div>
      `;

      const actions = card.querySelector(".admin-user-actions");

      // Co-admin checkbox: only the main admin can change it; the main admin account itself has none.
      if (!user.isOwner) {
        const label = document.createElement("label");
        label.className = "coadmin-toggle";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = Boolean(user.coAdmin);
        checkbox.disabled = !viewer?.isOwner;
        label.title = viewer?.isOwner ? "Co-admins have the same admin rights, but cannot add or remove co-admins." : "Only the main admin can add or remove co-admins.";
        label.append(checkbox, document.createTextNode(" Co-admin"));
        checkbox.addEventListener("change", () => setCoAdmin(user.username, checkbox));
        actions.appendChild(label);
      }

      // Delete: never for the main admin or yourself; co-admin accounts only by the main admin.
      if (!user.isOwner && !isSelf && (!user.coAdmin || viewer?.isOwner)) {
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "danger-button";
        deleteButton.textContent = "Delete account";
        deleteButton.addEventListener("click", () => deleteUser(user.username, deleteButton));
        actions.appendChild(deleteButton);
      }

      adminUsers.appendChild(card);
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
