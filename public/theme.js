// Theme handling: "light" | "dark" stored per browser; no stored value = follow the system setting.
(function () {
  const storageKey = "daily-astro-ph:theme";
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  function storedTheme() {
    try {
      const value = localStorage.getItem(storageKey);
      return value === "light" || value === "dark" ? value : null;
    } catch {
      return null;
    }
  }

  function effectiveTheme() {
    return root.dataset.theme || storedTheme() || (systemDark.matches ? "dark" : "light");
  }

  function apply(theme) {
    if (theme) {
      root.dataset.theme = theme;
    } else {
      delete root.dataset.theme;
    }
    updateButtons();
  }

  function updateButtons() {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    document.querySelectorAll(".theme-toggle").forEach((button) => {
      button.title = `Switch to ${next} mode`;
      button.setAttribute("aria-label", `Switch to ${next} mode`);
    });
  }

  function toggle() {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    const matchesSystem = next === (systemDark.matches ? "dark" : "light");

    try {
      // Choosing the system's own theme clears the override, so the page keeps following the system.
      if (matchesSystem) {
        localStorage.removeItem(storageKey);
      } else {
        localStorage.setItem(storageKey, next);
      }
    } catch {
      // Storage blocked: the switch still applies to this page view.
    }

    apply(matchesSystem ? null : next);
  }

  apply(storedTheme());
  systemDark.addEventListener?.("change", updateButtons);

  document.addEventListener("DOMContentLoaded", () => {
    updateButtons();
    document.querySelectorAll(".theme-toggle").forEach((button) => button.addEventListener("click", toggle));
  });
})();
