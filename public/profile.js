import { aggregateKeywords, isDownVote } from "/interests.js";

const profileStatus = document.querySelector("#profileStatus");
const fullNameInput = document.querySelector("#fullNameInput");
const orcidInput = document.querySelector("#orcidInput");
const saveProfileButton = document.querySelector("#saveProfileButton");
const nameAliasesList = document.querySelector("#nameAliasesList");
const addNameAliasButton = document.querySelector("#addNameAliasButton");
const currentPasswordInput = document.querySelector("#currentPasswordInput");
const newPasswordInput = document.querySelector("#newPasswordInput");
const confirmPasswordInput = document.querySelector("#confirmPasswordInput");
const togglePasswordButton = document.querySelector("#togglePasswordButton");
const changePasswordButton = document.querySelector("#changePasswordButton");
const deleteAccountButton = document.querySelector("#deleteAccountButton");
const interestsSummary = document.querySelector("#interestsSummary");
const keywordCloud = document.querySelector("#keywordCloud");
const likedPapers = document.querySelector("#likedPapers");
const likedPapersList = document.querySelector("#likedPapersList");
const forgetLikesButton = document.querySelector("#forgetLikesButton");
const negativeHeading = document.querySelector("#negativeHeading");
const negativeCloud = document.querySelector("#negativeCloud");

let sessionUser = null;
let passwordsVisible = false;

saveProfileButton.addEventListener("click", saveProfile);
addNameAliasButton.addEventListener("click", () => addNameAliasInput("", true));
togglePasswordButton.addEventListener("click", togglePasswordVisibility);
changePasswordButton.addEventListener("click", changePassword);
deleteAccountButton.addEventListener("click", deleteAccount);
forgetLikesButton.addEventListener("click", forgetLikes);

init();

async function init() {
  try {
    const response = await fetch("/api/session");
    const data = await response.json();
    sessionUser = data.user || null;

    if (!sessionUser) {
      profileStatus.textContent = "Please log in first.";
      setFormDisabled(true);
      return;
    }

    fullNameInput.value = sessionUser.fullName || "";
    orcidInput.value = sessionUser.orcid || "";
    renderNameAliases(sessionUser.nameAliases || []);
    profileStatus.textContent = `Currently signed in as ${sessionUser.username}.`;
    await loadLikes();
  } catch (error) {
    profileStatus.textContent = `Could not load profile. ${error.message}`;
    setFormDisabled(true);
  }
}

async function saveProfile() {
  if (!sessionUser) {
    return;
  }

  saveProfileButton.disabled = true;
  profileStatus.textContent = "Saving profile...";

  try {
    const response = await fetch("/api/profile", {
      method: "PUT",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        fullName: fullNameInput.value.trim(),
        orcid: orcidInput.value.trim(),
        nameAliases: getNameAliases()
      })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not save profile.");
    }

    sessionUser = data.user;
    renderNameAliases(sessionUser.nameAliases || []);
    profileStatus.textContent = "Profile saved.";
  } catch (error) {
    profileStatus.textContent = error.message;
  } finally {
    saveProfileButton.disabled = false;
  }
}

function renderNameAliases(nameAliases) {
  nameAliasesList.innerHTML = "";
  const aliases = Array.isArray(nameAliases) && nameAliases.length ? nameAliases : [""];
  aliases.forEach((alias) => addNameAliasInput(alias, false));
}

function addNameAliasInput(value, shouldFocus = true) {
  const row = document.createElement("div");
  row.className = "name-alias-row";
  row.innerHTML = `
    <input type="text" value="" placeholder="Andreas Faisst">
    <button type="button" aria-label="Remove name variant">-</button>
  `;

  const input = row.querySelector("input");
  const removeButton = row.querySelector("button");
  input.value = value;
  removeButton.addEventListener("click", () => {
    row.remove();

    if (!nameAliasesList.children.length) {
      addNameAliasInput("", true);
    }
  });
  nameAliasesList.appendChild(row);

  if (shouldFocus) {
    input.focus();
  }
}

function getNameAliases() {
  const seen = new Set();
  return [...nameAliasesList.querySelectorAll("input")]
    .map((input) => input.value.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .filter((alias) => {
      const key = alias.toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

async function changePassword() {
  if (!sessionUser) {
    return;
  }

  const currentPassword = currentPasswordInput.value;
  const newPassword = newPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (!currentPassword || !newPassword || !confirmPassword) {
    profileStatus.textContent = "Enter the current password and the new password twice.";
    return;
  }

  if (newPassword !== confirmPassword) {
    profileStatus.textContent = "The new password fields do not match.";
    return;
  }

  changePasswordButton.disabled = true;
  profileStatus.textContent = "Changing password...";

  try {
    const response = await fetch("/api/password", {
      method: "PUT",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        currentPassword,
        newPassword
      })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not change password.");
    }

    currentPasswordInput.value = "";
    newPasswordInput.value = "";
    confirmPasswordInput.value = "";
    profileStatus.textContent = "Password changed.";
  } catch (error) {
    profileStatus.textContent = error.message;
  } finally {
    changePasswordButton.disabled = false;
  }
}

async function deleteAccount() {
  if (!sessionUser) {
    return;
  }

  const confirmed = window.confirm("Delete this account and all saved data from the server? This cannot be undone.");

  if (!confirmed) {
    return;
  }

  deleteAccountButton.disabled = true;
  profileStatus.textContent = "Deleting account...";

  try {
    const response = await fetch("/api/account", { method: "DELETE" });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not delete account.");
    }

    window.location.href = "/";
  } catch (error) {
    profileStatus.textContent = error.message;
    deleteAccountButton.disabled = false;
  }
}

function togglePasswordVisibility() {
  passwordsVisible = !passwordsVisible;
  const type = passwordsVisible ? "text" : "password";
  currentPasswordInput.type = type;
  newPasswordInput.type = type;
  confirmPasswordInput.type = type;
  togglePasswordButton.textContent = passwordsVisible ? "Hide passwords" : "Show passwords";
}

function setFormDisabled(disabled) {
  [
    fullNameInput,
    orcidInput,
    saveProfileButton,
    addNameAliasButton,
    currentPasswordInput,
    newPasswordInput,
    confirmPasswordInput,
    togglePasswordButton,
    changePasswordButton,
    deleteAccountButton
  ].forEach((element) => {
    element.disabled = disabled;
  });
  nameAliasesList.querySelectorAll("input, button").forEach((element) => {
    element.disabled = disabled;
  });
}

async function loadLikes() {
  try {
    const response = await fetch("/api/likes");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not load your likes.");
    }

    renderLikes(Array.isArray(data.liked) ? data.liked : []);
  } catch (error) {
    interestsSummary.textContent = error.message;
  }
}

function renderKeywordChips(container, keywords, negative) {
  const strongest = Math.max(...keywords.map((entry) => Math.abs(entry.weight)), 1e-9);
  container.innerHTML = "";

  keywords.forEach(({ term, weight }) => {
    const chip = document.createElement("span");
    chip.className = `keyword-chip${negative ? " keyword-chip--negative" : ""}`;
    chip.style.setProperty("--strength", (Math.abs(weight) / strongest).toFixed(2));
    chip.textContent = term;
    const score = document.createElement("small");
    score.textContent = weight.toFixed(1);
    chip.appendChild(score);
    container.appendChild(chip);
  });
}

function renderLikes(liked) {
  const keywords = aggregateKeywords(liked);
  const positive = keywords.filter((entry) => entry.weight > 0).slice(0, 60);
  const negative = keywords.filter((entry) => entry.weight < 0).reverse().slice(0, 30);
  const upCount = liked.filter((entry) => !isDownVote(entry)).length;
  const downCount = liked.length - upCount;

  renderKeywordChips(keywordCloud, positive, false);
  renderKeywordChips(negativeCloud, negative, true);
  negativeHeading.hidden = !negative.length;
  likedPapersList.innerHTML = "";
  likedPapers.hidden = !liked.length;
  forgetLikesButton.disabled = !liked.length;

  if (!liked.length) {
    interestsSummary.textContent = "Nothing learned yet. Give papers a thumbs up (or thumbs down) on the main page and Daily AstroPH learns which keywords you care about. They drive the \"Most Interesting\" list.";
    return;
  }

  interestsSummary.textContent = `Learned from ${upCount} liked and ${downCount} not-interesting ${liked.length === 1 ? "paper" : "papers"}. Stronger keywords are shaded darker and count more when ranking "Most Interesting".`;

  liked.forEach((paper) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = paper.url || "#";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = paper.title || paper.id;
    const tag = document.createElement("span");
    tag.className = "vote-tag";
    tag.textContent = isDownVote(paper) ? "(not interesting)" : "(liked)";
    item.append(link, tag);
    likedPapersList.appendChild(item);
  });
}

function confirmForget() {
  const modal = document.querySelector("#confirmModal");
  modal.returnValue = "";

  return new Promise((resolve) => {
    modal.addEventListener("close", () => resolve(modal.returnValue === "confirm"), { once: true });
    modal.showModal();
    modal.querySelector('button[value="cancel"]').focus();
  });
}

async function forgetLikes() {
  if (!(await confirmForget())) {
    return;
  }

  forgetLikesButton.disabled = true;

  try {
    const response = await fetch("/api/likes", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not forget your likes.");
    }

    renderLikes([]);
    profileStatus.textContent = "Everything learned has been forgotten.";
  } catch (error) {
    profileStatus.textContent = error.message;
    forgetLikesButton.disabled = false;
  }
}
