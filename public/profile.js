import { aggregateKeywords, isDownVote } from "/interests.js";

const $ = (selector) => document.querySelector(selector);

const profileStatus = $("#profileStatus");

// Profile section (author details, author names, email digest)
const fullNameInput = $("#fullNameInput");
const orcidInput = $("#orcidInput");
const nameAliasesList = $("#nameAliasesList");
const addNameAliasButton = $("#addNameAliasButton");
const digestEmailInput = $("#digestEmailInput");
const digestHint = $("#digestHint");
const saveProfileButton = $("#saveProfileButton");
const profileSaveStatus = $("#profileSaveStatus");
const deleteAccountButton = $("#deleteAccountButton");

// Password section
const currentPasswordInput = $("#currentPasswordInput");
const newPasswordInput = $("#newPasswordInput");
const confirmPasswordInput = $("#confirmPasswordInput");
const togglePasswordButton = $("#togglePasswordButton");
const changePasswordButton = $("#changePasswordButton");
const passwordSaveStatus = $("#passwordSaveStatus");

// What you like section
const interestsSummary = $("#interestsSummary");
const keywordCloud = $("#keywordCloud");
const negativeHeading = $("#negativeHeading");
const negativeCloud = $("#negativeCloud");
const likedPapers = $("#likedPapers");
const likedPapersList = $("#likedPapersList");
const forgetLikesButton = $("#forgetLikesButton");
const likesStatus = $("#likesStatus");

let sessionUser = null;
let savedProfileSnapshot = "";
let hasThumbsUp = false;
let passwordsVisible = false;

// ----- Wiring -----

$("#profileSection").addEventListener("input", onProfileEdited);
$("#profileSection").addEventListener("change", onProfileEdited);
addNameAliasButton.addEventListener("click", () => addNameAliasInput("", true));
saveProfileButton.addEventListener("click", saveProfile);
deleteAccountButton.addEventListener("click", deleteAccount);

[currentPasswordInput, newPasswordInput, confirmPasswordInput].forEach((input) => input.addEventListener("input", onPasswordEdited));
togglePasswordButton.addEventListener("click", togglePasswordVisibility);
changePasswordButton.addEventListener("click", changePassword);

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

    profileStatus.textContent = `Signed in as ${sessionUser.username}.`;
    fillProfileForm(sessionUser);
    await loadLikes();
  } catch (error) {
    profileStatus.textContent = `Could not load profile. ${error.message}`;
    setFormDisabled(true);
  }
}

// ----- Status messages -----

function setStatus(element, message, kind = "") {
  element.textContent = message;
  element.className = `save-status${kind ? ` save-status--${kind}` : ""}`;
}

// ----- Profile section -----

function fillProfileForm(user) {
  fullNameInput.value = user.fullName || "";
  orcidInput.value = user.orcid || "";
  renderNameAliases(user.nameAliases || []);
  digestEmailInput.value = user.email || "";
  const mode = ["off", "daily", "weekly"].includes(user.digest) ? user.digest : "off";
  $(`input[name="digestMode"][value="${mode}"]`).checked = true;
  savedProfileSnapshot = profileSnapshot();
  updateProfileButton();
  updateDigestHint();
}

function collectProfile() {
  return {
    fullName: fullNameInput.value.trim(),
    orcid: orcidInput.value.trim(),
    nameAliases: getNameAliases(),
    email: digestEmailInput.value.trim(),
    digest: selectedDigestMode()
  };
}

function profileSnapshot() {
  return JSON.stringify(collectProfile());
}

function updateProfileButton() {
  saveProfileButton.disabled = !sessionUser || profileSnapshot() === savedProfileSnapshot;
}

function onProfileEdited() {
  updateProfileButton();
  updateDigestHint();

  if (!saveProfileButton.disabled) {
    setStatus(profileSaveStatus, "Unsaved changes");
  } else if (!profileSaveStatus.classList.contains("save-status--ok")) {
    // Edited back to the saved state: drop "Unsaved changes" / old errors, keep a fresh "✓ saved".
    setStatus(profileSaveStatus, "");
  }
}

async function saveProfile() {
  saveProfileButton.disabled = true;
  setStatus(profileSaveStatus, "Saving…");

  try {
    const response = await fetch("/api/profile", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(collectProfile())
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not save profile.");
    }

    sessionUser = { ...sessionUser, ...data.user };
    fillProfileForm(sessionUser);
    setStatus(profileSaveStatus, "✓ Profile saved", "ok");
  } catch (error) {
    setStatus(profileSaveStatus, error.message, "error");
    updateProfileButton();
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
    <input type="text" value="" placeholder="Vera C. Rubin" aria-label="Author name variant">
    <button type="button" aria-label="Remove name variant" title="Remove">−</button>
  `;

  const input = row.querySelector("input");
  input.value = value;
  row.querySelector("button").addEventListener("click", () => {
    row.remove();

    if (!nameAliasesList.children.length) {
      addNameAliasInput("", true);
    }

    onProfileEdited();
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

function selectedDigestMode() {
  return $('input[name="digestMode"]:checked')?.value || "off";
}

function updateDigestHint() {
  digestHint.hidden = selectedDigestMode() === "off" || hasThumbsUp;
}

async function deleteAccount() {
  const confirmed = await confirmAction({
    title: "Delete your account?",
    text: "This deletes your account and all saved data (favorites, likes, suggestions, settings) from the server. This cannot be undone.",
    button: "Delete account"
  });

  if (!confirmed) {
    return;
  }

  deleteAccountButton.disabled = true;
  setStatus(profileSaveStatus, "Deleting account…");

  try {
    const response = await fetch("/api/account", { method: "DELETE" });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not delete account.");
    }

    window.location.href = "/";
  } catch (error) {
    setStatus(profileSaveStatus, error.message, "error");
    deleteAccountButton.disabled = false;
  }
}

// ----- Password section -----

function onPasswordEdited() {
  const filled = currentPasswordInput.value && newPasswordInput.value && confirmPasswordInput.value;
  const mismatch = newPasswordInput.value && confirmPasswordInput.value && newPasswordInput.value !== confirmPasswordInput.value;
  changePasswordButton.disabled = !filled || mismatch;

  if (mismatch) {
    setStatus(passwordSaveStatus, "The new passwords do not match", "error");
  } else if (currentPasswordInput.value || newPasswordInput.value || confirmPasswordInput.value) {
    setStatus(passwordSaveStatus, filled ? "" : "Fill in all three fields");
  } else {
    setStatus(passwordSaveStatus, "");
  }
}

async function changePassword() {
  changePasswordButton.disabled = true;
  setStatus(passwordSaveStatus, "Changing password…");

  try {
    const response = await fetch("/api/password", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: currentPasswordInput.value, newPassword: newPasswordInput.value })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not change password.");
    }

    currentPasswordInput.value = "";
    newPasswordInput.value = "";
    confirmPasswordInput.value = "";
    setStatus(passwordSaveStatus, "✓ Password changed", "ok");
  } catch (error) {
    setStatus(passwordSaveStatus, error.message, "error");
    changePasswordButton.disabled = false;
  }
}

function togglePasswordVisibility() {
  passwordsVisible = !passwordsVisible;
  const type = passwordsVisible ? "text" : "password";
  [currentPasswordInput, newPasswordInput, confirmPasswordInput].forEach((input) => { input.type = type; });
  togglePasswordButton.textContent = passwordsVisible ? "Hide passwords" : "Show passwords";
}

function setFormDisabled(disabled) {
  document.querySelectorAll(".profile-section input, .profile-section button").forEach((element) => {
    element.disabled = disabled;
  });
}

// ----- What you like section -----

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
  hasThumbsUp = liked.some((entry) => !isDownVote(entry));
  updateDigestHint();

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
    interestsSummary.textContent = "Nothing learned yet. Give papers a thumbs up (or thumbs down) on the main page and Daily AstroPH learns which keywords you care about. They drive the \"Most Interesting\" list and your email digest.";
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

async function forgetLikes() {
  const confirmed = await confirmAction({
    title: "Forget everything?",
    text: "This removes all learned keywords, thumbs-ups and thumbs-downs, and the \"Most Interesting\" list starts from scratch. This cannot be undone.",
    button: "Forget"
  });

  if (!confirmed) {
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
    setStatus(likesStatus, "✓ Everything learned has been forgotten", "ok");
  } catch (error) {
    setStatus(likesStatus, error.message, "error");
    forgetLikesButton.disabled = false;
  }
}

// ----- Confirmation dialog -----

function confirmAction({ title, text, button }) {
  const modal = $("#confirmModal");
  $("#confirmModalTitle").textContent = title;
  $("#confirmModalText").textContent = text;
  $("#confirmModalButton").textContent = button;
  modal.returnValue = "";

  return new Promise((resolve) => {
    modal.addEventListener("close", () => resolve(modal.returnValue === "confirm"), { once: true });
    modal.showModal();
    modal.querySelector('button[value="cancel"]').focus();
  });
}
