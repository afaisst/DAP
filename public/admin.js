const adminStatus = document.querySelector("#adminStatus");
const adminUsers = document.querySelector("#adminUsers");

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

    await loadUsers();
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
      card.innerHTML = `
        <div class="admin-user-header">
          <h3>${escapeHtml(user.username)}${user.isAdmin ? " (admin)" : ""}</h3>
          <span>${user.favoriteCount} ${user.favoriteCount === 1 ? "favorite" : "favorites"}</span>
        </div>
        <div class="admin-user-meta">
          <span>Full name: ${escapeHtml(user.fullName || "Not set")}</span>
          <span>ORCID: ${escapeHtml(user.orcid || "Not set")}</span>
          <span>Created: ${escapeHtml(formatDate(user.createdAt))}</span>
        </div>
        <div class="admin-user-actions"></div>
      `;

      const actions = card.querySelector(".admin-user-actions");

      if (!user.isAdmin) {
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
