const profileStatus = document.querySelector("#profileStatus");
const fullNameInput = document.querySelector("#fullNameInput");
const orcidInput = document.querySelector("#orcidInput");
const saveProfileButton = document.querySelector("#saveProfileButton");
const currentPasswordInput = document.querySelector("#currentPasswordInput");
const newPasswordInput = document.querySelector("#newPasswordInput");
const confirmPasswordInput = document.querySelector("#confirmPasswordInput");
const togglePasswordButton = document.querySelector("#togglePasswordButton");
const changePasswordButton = document.querySelector("#changePasswordButton");
const deleteAccountButton = document.querySelector("#deleteAccountButton");

let sessionUser = null;
let passwordsVisible = false;

saveProfileButton.addEventListener("click", saveProfile);
togglePasswordButton.addEventListener("click", togglePasswordVisibility);
changePasswordButton.addEventListener("click", changePassword);
deleteAccountButton.addEventListener("click", deleteAccount);

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
    profileStatus.textContent = `Currently signed in as ${sessionUser.username}.`;
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
        orcid: orcidInput.value.trim()
      })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not save profile.");
    }

    sessionUser = data.user;
    profileStatus.textContent = "Profile saved.";
  } catch (error) {
    profileStatus.textContent = error.message;
  } finally {
    saveProfileButton.disabled = false;
  }
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
    currentPasswordInput,
    newPasswordInput,
    confirmPasswordInput,
    togglePasswordButton,
    changePasswordButton,
    deleteAccountButton
  ].forEach((element) => {
    element.disabled = disabled;
  });
}
