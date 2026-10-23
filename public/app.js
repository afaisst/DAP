import { buildInterestProfile, extractKeywords, isDownVote, mostInterestingPapers } from "/interests.js";

const topics = [
    {
    id: "cosmology",
    label: "Cosmology",
    terms: ["cosmology", "cosmological", "dark matter", "dark energy", "cmb", "inflation", "hubble constant", "h0", "sigma8", "s8", "lambda cdm", "lcdm", "expansion", "primordial fluctuations", "cosmic microwave background", "baryon acoustic", "bao", "neutrino"]
  },
  {
    id: "large-scale-structure",
    label: "Environment",
    terms: ["large scale structure", "weak lensing", "clustering", "halo", "void", "cosmic web", "lss", "proto cluster", "proto-cluster", "group"]
  },
  {
    id: "reionization",
    label: "Reionization",
    terms: ["reionization", "epoch of reionization", "eor", "first galaxies", "igm", "lyman alpha", "lyman escape", "escape fraction", "lyc", "lyc escape", "lyman continuum", "lyman continuum escape", "popIII", "population III", "bubble"]
  },
  {
    id: "galaxies",
    label: "Galaxies",
    terms: ["galaxy", "galaxies", "galactic", "morphology", "kinematics", "structure", "stellar mass", "metallicity", "gas", "dust", "ism", "circumgalactic", "cgm", "interstellar medium", "bursty", "burstiness", "dwarf", "little red dot", "lrd"]
  },
  {
    id: "quenching",
    label: "Quiescent",
    terms: ["quiescent", "quenching", "ram pressure", "stripping", "mass quenching", "environment quenching", "red sequence", "green valley", "lulling", "bursty", "burstiness", "satellite", "satellite quenching"]
  },
  {
    id: "feedback-outflow",
    label: "Feedback",
    terms: ["feedback", "outflow", "inflow", "mass loading", "jet"]
  },
  {
    id: "black-holes",
    label: "Black holes",
    terms: ["black hole", "agn", "quasar", "accretion", "event horizon", "supermassive", "smbh", "jets", "radio jet", "lrd", "little red dot"]
  },
  {
    id: "dark-matter",
    label: "Dark Matter",
    terms: ["dark matter", "weak lensing", "strong lensing", "lensing"]
  },
  {
    id: "transient",
    label: "Transients",
    terms: ["transient", "supernovae", "sne", "variable", "alert"]
  },
  {
    id: "local-galaxies",
    label: "Local galaxies",
    terms: ["milky way", "andromeda", "m31", "local group", "magellanic", "nearby galaxy", "dwarf galaxy", "local volume"]
  },
  {
    id: "stars",
    label: "Stars",
    terms: ["star", "stars", "stellar", "supernova", "nova", "exoplanet", "planet", "white dwarf", "neutron star", "binary", "asteroseismology", "protostar"]
  }
];

const astroPhCategories = [
  { id: "astro-ph.CO", label: "Cosmology" },
  { id: "astro-ph.GA", label: "Galaxies" },
  { id: "astro-ph.HE", label: "High Energy" },
  { id: "astro-ph.IM", label: "Instrumentation" },
  { id: "astro-ph.SR", label: "Solar and Stellar" },
  { id: "astro-ph.EP", label: "Earth and Planetary" }
];

const fallbackTopic = {
  id: "other",
  label: "Other astro-ph",
  terms: []
};

const favoriteTopic = {
  id: "favorites",
  label: "Favorites",
  terms: []
};

const myPapersTopic = {
  id: "my-papers",
  label: "My Papers",
  terms: []
};

const searchTopic = {
  id: "search",
  label: "Search results",
  terms: []
};

const interestingTopic = {
  id: "interesting",
  label: "Most Interesting",
  terms: []
};

const suggestedTopic = {
  id: "suggested",
  label: "Suggested Papers",
  terms: []
};

const favoritesStorageKey = "daily-astro-ph:favorites";

const state = {
  papers: [],
  favorites: [],
  suggestions: [],
  liked: [],
  selectedDate: formatDateInputValue(new Date()),
  search: "",
  activeCategories: new Set(astroPhCategories.map((category) => category.id)),
  activeTopicId: null,
  sessionUser: null,
  calendarMonth: null,
  showAllInteresting: false,
  searchView: null
};

const interestingInitialCount = 12;

const personalTopicIds = new Set(["interesting", "favorites", "suggested", "my-papers"]);

const calendarEl = document.querySelector("#calendar");
const topicNav = document.querySelector("#topicNav");
const selectedDateHeading = document.querySelector("#selectedDateHeading");
const accountMenu = document.querySelector("#accountMenu");
const accountAvatar = document.querySelector("#accountAvatar");
const accountLabel = document.querySelector("#accountLabel");
const searchInput = document.querySelector("#searchInput");
const categoryFilters = document.querySelector("#categoryFilters");
const topicList = document.querySelector("#topicList");
const statusText = document.querySelector("#statusText");
const refreshButton = document.querySelector("#refreshButton");
const template = document.querySelector("#paperTemplate");
const figureModal = document.querySelector("#figureModal");
const figureModalTitle = document.querySelector("#figureModalTitle");
const figureCloseButton = document.querySelector("#figureCloseButton");
const figureStatus = document.querySelector("#figureStatus");
const figureCarousel = document.querySelector("#figureCarousel");
const figureImage = document.querySelector("#figureImage");
const figureCaption = document.querySelector("#figureCaption");
const prevFigureButton = document.querySelector("#prevFigureButton");
const nextFigureButton = document.querySelector("#nextFigureButton");
const summaryModal = document.querySelector("#summaryModal");
const summaryModalTitle = document.querySelector("#summaryModalTitle");
const summaryCloseButton = document.querySelector("#summaryCloseButton");
const summaryList = document.querySelector("#summaryList");
const bibtexModal = document.querySelector("#bibtexModal");
const bibtexModalTitle = document.querySelector("#bibtexModalTitle");
const bibtexCloseButton = document.querySelector("#bibtexCloseButton");
const bibtexText = document.querySelector("#bibtexText");
const bibtexAdsLink = document.querySelector("#bibtexAdsLink");
const bibtexCopyButton = document.querySelector("#bibtexCopyButton");
const suggestModal = document.querySelector("#suggestModal");
const suggestModalTitle = document.querySelector("#suggestModalTitle");
const suggestCloseButton = document.querySelector("#suggestCloseButton");
const suggestUserInput = document.querySelector("#suggestUserInput");
const suggestUserResults = document.querySelector("#suggestUserResults");
const suggestSendButton = document.querySelector("#suggestSendButton");
const suggestStatus = document.querySelector("#suggestStatus");
const authStatus = document.querySelector("#authStatus");
const usernameInput = document.querySelector("#usernameInput");
const passwordInput = document.querySelector("#passwordInput");
const loginButton = document.querySelector("#loginButton");
const signupButton = document.querySelector("#signupButton");
const profileLink = document.querySelector("#profileLink");
const adminLink = document.querySelector("#adminLink");
const logoutButton = document.querySelector("#logoutButton");

const figureState = {
  figures: [],
  index: 0
};

const suggestState = {
  paper: null,
  selectedUser: null,
  searchController: null
};

state.calendarMonth = monthStart(parseDateInputValue(state.selectedDate));
renderCalendar();
updateDateHeading();
renderCategoryFilters();

calendarEl.addEventListener("click", (event) => {
  const target = event.target.closest("button");

  if (!target || target.disabled) {
    return;
  }

  if (target.dataset.date) {
    selectDate(target.dataset.date);
  } else if (target.dataset.monthStep) {
    shiftCalendarMonth(Number(target.dataset.monthStep));
  } else if (target.dataset.dayStep) {
    shiftSelectedDate(Number(target.dataset.dayStep));
  } else if (target.dataset.action === "today") {
    selectDate(formatDateInputValue(new Date()));
  }
});

document.addEventListener("keydown", (event) => {
  const tag = event.target.tagName;

  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag) || event.target.isContentEditable || document.querySelector("dialog[open]")) {
    return;
  }

  if (event.key === "ArrowLeft" && !event.metaKey && !event.altKey) {
    shiftSelectedDate(-1);
  } else if (event.key === "ArrowRight" && !event.metaKey && !event.altKey) {
    shiftSelectedDate(1);
  } else if (event.key === "/") {
    event.preventDefault();
    searchInput.focus();
  }
});

document.addEventListener("click", (event) => {
  document.querySelectorAll("details.share-menu[open], details.library-menu[open], details.account-menu[open]").forEach((menu) => {
    if (!menu.contains(event.target)) {
      menu.open = false;
    }
  });
});

searchInput.addEventListener("input", () => {
  state.search = searchInput.value.trim().toLowerCase();
  render();
});

refreshButton.addEventListener("click", loadPapers);
figureCloseButton.addEventListener("click", () => figureModal.close());
prevFigureButton.addEventListener("click", () => showFigure(figureState.index - 1));
nextFigureButton.addEventListener("click", () => showFigure(figureState.index + 1));
summaryCloseButton.addEventListener("click", () => summaryModal.close());
bibtexCloseButton.addEventListener("click", () => bibtexModal.close());
bibtexCopyButton.addEventListener("click", () => copyBibtex());
suggestCloseButton.addEventListener("click", () => suggestModal.close());
suggestUserInput.addEventListener("input", () => searchSuggestUsers());
suggestSendButton.addEventListener("click", () => sendSuggestion());
loginButton.addEventListener("click", () => submitAuth("/api/login"));
signupButton.addEventListener("click", () => submitAuth("/api/signup"));
logoutButton.addEventListener("click", logout);
passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitAuth("/api/login");
  }
});
window.addEventListener("mathjax-ready", () => typesetMath(document.body));

updateAuthUi();
init();

async function init() {
  await loadSession();
  await loadPapers();
}

async function loadPapers() {
  state.showAllInteresting = false;
  topicList.innerHTML = loadingSkeleton();
  topicNav.innerHTML = `<div class="topic-nav-loading"><span></span><span></span><span></span><span></span><span></span></div>`;
  setStatus(`Loading astro-ph papers for ${formatDate(state.selectedDate)}...`);

  try {
    const response = await fetch(`/api/papers?date=${encodeURIComponent(state.selectedDate)}&max=250`);
    const body = await response.text();

    if (!response.ok) {
      const parsed = safeJson(body);
      throw new Error(parsed?.detail || parsed?.error || `Request failed with HTTP ${response.status}`);
    }

    state.papers = parseArxivFeed(body).map(scorePaper);
    render();
  } catch (error) {
    state.papers = [];
    topicNav.innerHTML = "";
    topicList.innerHTML = `<div class="empty error">Could not load papers. ${escapeHtml(error.message)}</div>`;
    setStatus("arXiv is unreachable from this local server right now.");
  }
}

function shiftSelectedDate(dayOffset) {
  const date = parseDateInputValue(state.selectedDate);
  date.setDate(date.getDate() + dayOffset);
  selectDate(formatDateInputValue(date));
}

function selectDate(value) {
  const today = formatDateInputValue(new Date());

  if (value > today || value === state.selectedDate) {
    return;
  }

  state.selectedDate = value;
  state.calendarMonth = monthStart(parseDateInputValue(value));
  renderCalendar();
  updateDateHeading();
  loadPapers();
}

function shiftCalendarMonth(monthOffset) {
  const next = new Date(state.calendarMonth);
  next.setMonth(next.getMonth() + monthOffset);
  const currentMonth = monthStart(new Date());
  state.calendarMonth = next > currentMonth ? currentMonth : next;
  renderCalendar();
}

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function updateDateHeading() {
  selectedDateHeading.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(parseDateInputValue(state.selectedDate));
}

function renderCalendar() {
  const month = state.calendarMonth;
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const today = formatDateInputValue(new Date());
  const isCurrentMonth = monthStart(new Date()).getTime() === month.getTime();
  const leadingBlanks = (new Date(year, monthIndex, 1, 12).getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month);
  const weekdayLabels = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const chevron = (direction) => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="${direction < 0 ? "M10 3.5L5.5 8l4.5 4.5" : "M6 3.5L10.5 8 6 12.5"}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const doubleChevron = (direction) => `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="${direction < 0 ? "M8 3.5L3.5 8 8 12.5M12.5 3.5L8 8l4.5 4.5" : "M3.5 3.5L8 8l-4.5 4.5M8 3.5l4.5 4.5L8 12.5"}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  let cells = "";

  for (let blank = 0; blank < leadingBlanks; blank += 1) {
    cells += `<span class="cal-day cal-day--blank" aria-hidden="true"></span>`;
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const value = formatDateInputValue(new Date(year, monthIndex, day, 12));
    const weekday = (leadingBlanks + day - 1) % 7;
    const classes = ["cal-day"];

    if (weekday >= 5) classes.push("cal-day--weekend");
    if (value === today) classes.push("cal-day--today");
    if (value === state.selectedDate) classes.push("cal-day--selected");

    cells += `<button type="button" class="${classes.join(" ")}" data-date="${value}" ${value > today ? "disabled" : ""} aria-label="${formatDate(value)}" ${value === state.selectedDate ? 'aria-current="date"' : ""}>${day}</button>`;
  }

  calendarEl.innerHTML = `
    <div class="cal-header">
      <button type="button" class="cal-nav" data-month-step="-12" title="Previous year" aria-label="Previous year">${doubleChevron(-1)}</button>
      <button type="button" class="cal-nav" data-month-step="-1" title="Previous month" aria-label="Previous month">${chevron(-1)}</button>
      <span class="cal-title">${escapeHtml(monthLabel)}</span>
      <button type="button" class="cal-nav" data-month-step="1" title="Next month" aria-label="Next month" ${isCurrentMonth ? "disabled" : ""}>${chevron(1)}</button>
      <button type="button" class="cal-nav" data-month-step="12" title="Next year" aria-label="Next year" ${isCurrentMonth ? "disabled" : ""}>${doubleChevron(1)}</button>
    </div>
    <div class="cal-grid">
      ${weekdayLabels.map((label, index) => `<span class="cal-weekday${index >= 5 ? " cal-weekday--weekend" : ""}">${label}</span>`).join("")}
      ${cells}
    </div>
    <div class="cal-footer">
      <button type="button" class="cal-step" data-day-step="-1" title="Previous day (←)">${chevron(-1)} Prev day</button>
      <button type="button" class="cal-today" data-action="today" ${state.selectedDate === today ? "disabled" : ""}>Today</button>
      <button type="button" class="cal-step" data-day-step="1" title="Next day (→)" ${state.selectedDate >= today ? "disabled" : ""}>Next day ${chevron(1)}</button>
    </div>
  `;
}

function loadingSkeleton() {
  return `<div class="skeleton-list" aria-label="Loading papers">${'<div class="skeleton-card"><span></span><span></span><span></span></div>'.repeat(4)}</div>`;
}

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInputValue(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function parseArxivFeed(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const entries = [...doc.querySelectorAll("entry")];

  return entries.map((entry) => {
    const authorNodes = [...entry.querySelectorAll("author")];
    const authors = authorNodes
      .map((node) => cleanText(node.querySelector("name")?.textContent || ""))
      .filter(Boolean);
    const authorOrcids = authorNodes
      .map((node) => cleanText([...node.children].find((child) => child.localName === "orcid")?.textContent || ""))
      .filter(Boolean);
    const categories = [...entry.querySelectorAll("category")].map((node) => node.getAttribute("term")).filter(Boolean);
    const links = [...entry.querySelectorAll("link")];
    const abstractUrl = links.find((link) => link.getAttribute("rel") === "alternate")?.getAttribute("href");

    return {
      id: cleanText(entry.querySelector("id")?.textContent || ""),
      title: cleanText(entry.querySelector("title")?.textContent || ""),
      authors,
      authorOrcids,
      abstract: cleanText(entry.querySelector("summary")?.textContent || ""),
      published: entry.querySelector("published")?.textContent || "",
      updated: entry.querySelector("updated")?.textContent || "",
      categories,
      url: abstractUrl || cleanText(entry.querySelector("id")?.textContent || ""),
      authorMetadataLoaded: authorOrcids.length > 0
    };
  });
}

function scorePaper(paper) {
  const haystack = `${paper.title} ${paper.abstract} ${paper.categories.join(" ")}`.toLowerCase();
  const scoredTopics = topics.map((topic) => {
    const score = topic.terms.reduce((total, term) => {
      const pattern = new RegExp(`\\b${escapeRegExp(term.toLowerCase())}\\b`, "g");
      const titleBoost = paper.title.toLowerCase().match(pattern)?.length || 0;
      const bodyMatches = haystack.match(pattern)?.length || 0;
      return total + bodyMatches + titleBoost * 2;
    }, 0);

    return { topic, score };
  });

  scoredTopics.sort((a, b) => b.score - a.score);
  const best = scoredTopics[0];

  return {
    ...paper,
    topic: best.score > 0 ? best.topic : fallbackTopic,
    relevance: best.score
  };
}

function render() {
  const filtered = state.papers.filter(matchesCategoryFilter).filter(matchesSearch);
  const grouped = [...topics, fallbackTopic]
    .map((topic) => ({
      topic,
      papers: filtered
        .filter((paper) => paper.topic.id === topic.id)
        .sort((a, b) => b.relevance - a.relevance || new Date(b.published) - new Date(a.published))
    }))
    .filter((group) => group.papers.length);
  const myPapers = filtered.filter(paperMatchesProfile);
  const favoritePapers = getFavoritePapers().filter(matchesSearch);
  const suggestedPapers = getSuggestedPapers().filter(matchesSearch);

  if (myPapers.length) {
    grouped.unshift({
      topic: myPapersTopic,
      papers: [...myPapers].sort((a, b) => new Date(b.published) - new Date(a.published))
    });
  }

  if (suggestedPapers.length) {
    grouped.unshift({
      topic: suggestedTopic,
      papers: suggestedPapers
    });
  }

  if (favoritePapers.length) {
    grouped.unshift({
      topic: favoriteTopic,
      papers: favoritePapers
    });
  }

  if (state.searchView) {
    grouped.unshift({
      topic: searchTopic,
      papers: state.searchView.papers.filter(matchesSearch)
    });
  }

  const interestingPapers = state.liked.length ? mostInterestingPapers(
        filtered,
        buildInterestProfile(state.liked),
        new Set(state.liked.filter((entry) => !isDownVote(entry)).map((entry) => entry.id)),
        Infinity,
        new Set(state.liked.filter(isDownVote).map((entry) => entry.id))
      ) : [];

  if (interestingPapers.length) {
    grouped.unshift({
      topic: interestingTopic,
      papers: interestingPapers
    });
  }

  setStatus(statusMessage(filtered.length, state.papers.length));

  if (!grouped.length) {
    topicNav.innerHTML = "";
    topicList.innerHTML = `<div class="empty">No papers match this date and search.</div>`;
    return;
  }

  topicList.innerHTML = "";

  if (!grouped.some((group) => group.topic.id === state.activeTopicId)) {
    state.activeTopicId = grouped[0].topic.id;
  }

  renderTopicNav(grouped);

  const activeGroup = grouped.find((group) => group.topic.id === state.activeTopicId);
  const panel = document.createElement("section");
  panel.className = "active-topic-panel";
  panel.dataset.topic = activeGroup.topic.id;
  panel.innerHTML = `
    <div class="active-topic-heading">
      <h2><span class="topic-dot" aria-hidden="true"></span>${escapeHtml(activeGroup.topic.label)}</h2>
      <span>${activeGroup.papers.length} ${activeGroup.papers.length === 1 ? "paper" : "papers"}</span>
    </div>
    <div class="papers-grid"></div>
  `;

  if (activeGroup.topic.id === searchTopic.id) {
    const info = document.createElement("div");
    info.className = "search-summary";
    info.innerHTML = `
      <span>${escapeHtml(state.searchView.summary)}</span>
      ${state.searchView.note ? `<span class="search-summary-note">${escapeHtml(state.searchView.note)}</span>` : ""}
      <span class="search-summary-actions">
        <button type="button" class="btn search-edit-button">Edit search</button>
        <button type="button" class="btn search-clear-button">Clear search</button>
      </span>
    `;
    info.querySelector(".search-edit-button").addEventListener("click", openSearchModal);
    info.querySelector(".search-clear-button").addEventListener("click", clearSearch);
    panel.querySelector(".active-topic-heading").after(info);
  }

  const grid = panel.querySelector(".papers-grid");
  // "Most Interesting" shows the top papers first; the rest that passed the score checks sit behind "Show more".
  const isInteresting = activeGroup.topic.id === interestingTopic.id;
  const visiblePapers = isInteresting && !state.showAllInteresting
    ? activeGroup.papers.slice(0, interestingInitialCount)
    : activeGroup.papers;
  visiblePapers.forEach((paper) => grid.appendChild(renderPaper(paper)));

  if (visiblePapers.length < activeGroup.papers.length) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "btn show-more-button";
    const remaining = activeGroup.papers.length - visiblePapers.length;
    more.textContent = `Show ${remaining} more ${remaining === 1 ? "paper" : "papers"}`;
    more.addEventListener("click", () => {
      state.showAllInteresting = true;
      render();
    });
    panel.appendChild(more);
  }
  topicList.appendChild(panel);
  typesetMath(topicList);
}

function renderTopicNav(grouped) {
  topicNav.innerHTML = "";
  const sections = [
    { title: "arXiv search", groups: grouped.filter((group) => group.topic.id === searchTopic.id) },
    { title: "Your library", groups: grouped.filter((group) => personalTopicIds.has(group.topic.id)) },
    { title: "Science topics", groups: grouped.filter((group) => !personalTopicIds.has(group.topic.id) && group.topic.id !== searchTopic.id) }
  ];

  sections.filter((section) => section.groups.length).forEach((section) => {
    const wrapper = document.createElement("div");
    wrapper.className = "topic-nav-section";
    wrapper.innerHTML = `<div class="topic-nav-title">${section.title}</div>`;
    const list = document.createElement("div");
    list.className = "topic-nav-list";

    section.groups.forEach((group) => {
      const button = document.createElement("button");
      const isActive = group.topic.id === state.activeTopicId;
      button.type = "button";
      button.className = "topic-link";
      button.dataset.topic = group.topic.id;
      button.setAttribute("aria-pressed", String(isActive));
      button.innerHTML = `
        <span class="topic-dot" aria-hidden="true"></span>
        <span class="topic-link-label">${escapeHtml(group.topic.label)}</span>
        <span class="topic-link-count">${group.papers.length}</span>
      `;
      button.addEventListener("click", () => {
        state.activeTopicId = group.topic.id;
        render();

        if (topicList.getBoundingClientRect().top < 0) {
          topicList.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
      list.appendChild(button);
    });

    wrapper.appendChild(list);
    topicNav.appendChild(wrapper);
  });
}

function renderPaperMeta(meta, paper) {
  meta.textContent = "";
  const date = document.createElement("span");
  date.className = "meta-date";
  date.textContent = formatDate(paper.published.slice(0, 10));
  meta.appendChild(date);

  (paper.categories.length ? paper.categories : ["astro-ph"]).forEach((category, index) => {
    const pill = document.createElement("span");
    pill.className = `cat-pill${index === 0 ? " cat-pill--primary" : ""}`;
    pill.dataset.category = category;
    pill.textContent = category.replace(/^astro-ph\./, "");
    pill.title = category;
    meta.appendChild(pill);
  });

  if (paper.interestMatches?.length) {
    const interest = document.createElement("span");
    interest.className = "meta-interest";
    interest.textContent = `Matches: ${paper.interestMatches.join(", ")}`;
    interest.title = "Keywords learned from papers you liked";
    meta.appendChild(interest);
  }

  if (paper.suggestedBy) {
    const suggested = document.createElement("span");
    suggested.className = "meta-suggested";
    suggested.textContent = `Suggested by ${paper.suggestedBy.fullName || paper.suggestedBy.username}`;
    meta.appendChild(suggested);
  }
}

function renderPaper(paper) {
  const node = template.content.firstElementChild.cloneNode(true);
  const title = node.querySelector(".paper-title");
  const meta = node.querySelector(".paper-meta");
  const authors = node.querySelector(".authors");
  const abstract = node.querySelector(".abstract-block p");
  const shareMenu = node.querySelector(".share-menu");
  const copyButton = node.querySelector(".copy-link-button");
  const emailShareLink = node.querySelector(".email-share-link");
  const xShareLink = node.querySelector(".x-share-link");
  const facebookShareLink = node.querySelector(".facebook-share-link");
  const linkedinShareLink = node.querySelector(".linkedin-share-link");
  const suggestButton = node.querySelector(".suggest-button");
  const libraryMenu = node.querySelector(".library-menu");
  const zoteroLibraryLink = node.querySelector(".zotero-library-link");
  const papersLibraryLink = node.querySelector(".papers-library-link");
  const adsBibtexLink = node.querySelector(".ads-bibtex-link");
  const bentyVoteLink = node.querySelector(".benty-vote-link");
  const bibtexButton = node.querySelector(".bibtex-button");
  const favoriteButton = node.querySelector(".favorite-button");
  const dismissSuggestionButton = node.querySelector(".dismiss-suggestion-button");
  const likeButton = node.querySelector(".like-button");
  const dislikeButton = node.querySelector(".dislike-button");
  const figuresButton = node.querySelector(".figures-button");
  const summaryButton = node.querySelector(".summary-button");

  title.href = paper.url;
  title.textContent = paper.title;
  renderPaperMeta(meta, paper);
  abstract.textContent = paper.abstract;
  node.classList.toggle("paper-card--author-match", paperMatchesProfile(paper));
  updateFavoriteButton(favoriteButton, paper);
  favoriteButton.addEventListener("click", () => toggleFavorite(paper));
  updateVoteButtons(likeButton, dislikeButton, paper);
  likeButton.addEventListener("click", () => setVote(paper, voteOf(paper) === 1 ? 0 : 1));
  dislikeButton.addEventListener("click", () => setVote(paper, voteOf(paper) === -1 ? 0 : -1));

  if (paper.suggestedBy) {
    dismissSuggestionButton.hidden = false;
    dismissSuggestionButton.addEventListener("click", () => dismissSuggestion(paper, dismissSuggestionButton));
  }
  copyButton.addEventListener("click", () => copyPaperLink(copyButton, paper.url, shareMenu));
  suggestButton.addEventListener("click", () => openSuggestModal(paper, shareMenu));
  setShareLinks(paper, { emailShareLink, xShareLink, facebookShareLink, linkedinShareLink });
  setLibraryLinks(paper, { zoteroLibraryLink, papersLibraryLink, adsBibtexLink, bentyVoteLink });
  bibtexButton.addEventListener("click", () => openBibtexModal(paper, libraryMenu));
  figuresButton.addEventListener("click", () => openFigureModal(paper));
  summaryButton.addEventListener("click", () => openSummaryModal(paper));
  renderAuthors(authors, paper.authors, paper);

  return node;
}

function setShareLinks(paper, links) {
  const encodedUrl = encodeURIComponent(paper.url);
  const encodedTitle = encodeURIComponent(paper.title);
  const encodedText = encodeURIComponent(`${paper.title} ${paper.url}`);

  links.emailShareLink.href = `mailto:?subject=${encodedTitle}&body=${encodedText}`;
  links.xShareLink.href = `https://twitter.com/intent/tweet?text=${encodedText}`;
  links.facebookShareLink.href = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
  links.linkedinShareLink.href = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
}

function setLibraryLinks(paper, links) {
  links.zoteroLibraryLink.href = `https://www.zotero.org/save?q=${encodeURIComponent(paper.url)}`;
  links.papersLibraryLink.href = paper.url;
  links.adsBibtexLink.href = adsExportCitationUrl(paper);
  links.bentyVoteLink.href = bentyFieldsUrl(paper);
}

// arXiv ID without version ("2610.20722v2" -> "2610.20722"); also handles old-style IDs like "astro-ph/0601001".
function paperBaseArxivId(paper) {
  const match = (paper.url || paper.id || "").match(/abs\/(.+?)(v\d+)?$/);
  return match ? match[1] : arxivIdFromUrl(paper.url).replace(/v\d+$/, "");
}

// Opens the paper's own Benty Fields page, which has the Vote button (Benty Fields doesn't accept version suffixes).
function bentyFieldsUrl(paper) {
  return `https://www.benty-fields.com/daily_arXiv_results?paper_id=${encodeURIComponent(paperBaseArxivId(paper))}&dbname=arxiv`;
}

function loadLocalFavorites() {
  try {
    const stored = localStorage.getItem(favoritesStorageKey);
    const favorites = stored ? JSON.parse(stored) : [];
    return Array.isArray(favorites) ? favorites.filter((paper) => paper && favoriteKey(paper)) : [];
  } catch {
    return [];
  }
}

function saveLocalFavorites() {
  try {
    localStorage.setItem(favoritesStorageKey, JSON.stringify(state.favorites));
    return true;
  } catch {
    setStatus("Could not save favorites in this browser session.");
    return false;
  }
}

async function loadSession() {
  try {
    const response = await fetch("/api/session");
    const data = await response.json();
    state.sessionUser = data.user || null;

    if (state.sessionUser) {
      await loadRemoteFavorites(true);
      await loadSuggestions();
      await loadLikes();
    } else {
      state.favorites = loadLocalFavorites();
      state.suggestions = [];
      state.liked = [];
    }
  } catch {
    state.sessionUser = null;
    state.favorites = loadLocalFavorites();
    state.suggestions = [];
    state.liked = [];
  }

  updateAuthUi();
}

async function submitAuth(endpoint) {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) {
    authStatus.textContent = "Enter a username and password to continue.";
    return;
  }

  setAuthButtonsDisabled(true);
  authStatus.textContent = endpoint === "/api/signup" ? "Creating local account..." : "Logging in...";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not authenticate.");
    }

    state.sessionUser = data.user;
    passwordInput.value = "";
    await loadRemoteFavorites(true);
    await loadSuggestions();
    await loadLikes();
    updateAuthUi();
    render();
  } catch (error) {
    authStatus.textContent = error.message;
  } finally {
    setAuthButtonsDisabled(false);
  }
}

async function logout() {
  logoutButton.disabled = true;

  try {
    await fetch("/api/logout", { method: "POST" });
  } catch {
    // Keep the UI moving even if the local server drops the response.
  }

  state.sessionUser = null;
  state.favorites = loadLocalFavorites();
  state.suggestions = [];
  state.liked = [];
  passwordInput.value = "";
  updateAuthUi();
  render();
  logoutButton.disabled = false;
}

async function loadSuggestions() {
  const response = await fetch("/api/suggestions");
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not load suggested papers.");
  }

  state.suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
}

async function loadRemoteFavorites(mergeLocal = false) {
  const response = await fetch("/api/favorites");
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not load account favorites.");
  }

  const remoteFavorites = Array.isArray(data.favorites) ? data.favorites : [];
  const localFavorites = mergeLocal ? loadLocalFavorites() : [];
  const mergedFavorites = mergeFavorites(remoteFavorites, localFavorites);
  state.favorites = mergedFavorites;

  if (mergedFavorites.length !== remoteFavorites.length) {
    await saveRemoteFavorites(mergedFavorites);
  }
}

async function saveRemoteFavorites(favorites = state.favorites) {
  const response = await fetch("/api/favorites", {
    method: "PUT",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ favorites })
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Could not save account favorites.");
  }

  state.favorites = Array.isArray(data.favorites) ? data.favorites : favorites;
  return true;
}

function mergeFavorites(primaryFavorites, secondaryFavorites) {
  const merged = [];
  const seen = new Set();

  [...primaryFavorites, ...secondaryFavorites].forEach((paper) => {
    const normalized = toFavoritePaper(paper);
    const key = favoriteKey(normalized);

    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    merged.push(normalized);
  });

  return merged;
}

function getFavoritePapers() {
  return [...state.favorites].sort((a, b) => new Date(b.favoritedAt || b.published) - new Date(a.favoritedAt || a.published));
}

async function loadLikes() {
  try {
    const response = await fetch("/api/likes");
    const data = await response.json();
    state.liked = response.ok && Array.isArray(data.liked) ? data.liked : [];
  } catch {
    state.liked = [];
  }
}

// 1 = thumbs up, -1 = thumbs down, 0 = no vote.
function voteOf(paper) {
  const key = favoriteKey(paper);
  const entry = state.liked.find((item) => item.id === key);
  return entry ? (isDownVote(entry) ? -1 : 1) : 0;
}

function updateVoteButtons(likeButton, dislikeButton, paper) {
  const vote = voteOf(paper);
  likeButton.setAttribute("aria-pressed", String(vote === 1));
  likeButton.title = vote === 1 ? "Liked — click to stop learning from this paper" : "I like this — show me more papers like it";
  likeButton.setAttribute("aria-label", vote === 1 ? "Remove like" : "Like this paper");
  dislikeButton.setAttribute("aria-pressed", String(vote === -1));
  dislikeButton.title = vote === -1 ? "Marked not interesting — click to undo" : "Not interesting — show me fewer papers like this";
  dislikeButton.setAttribute("aria-label", vote === -1 ? "Undo not interesting" : "Not interesting");
}

async function setVote(paper, vote) {
  if (!state.sessionUser) {
    accountMenu.open = true;
    authStatus.textContent = "Log in to teach Daily AstroPH which papers you like.";
    usernameInput.focus();
    return;
  }

  const key = favoriteKey(paper);
  const previous = state.liked;
  const others = state.liked.filter((entry) => entry.id !== key);
  let request;

  if (vote === 0) {
    state.liked = others;
    request = { method: "DELETE", body: { id: key } };
  } else {
    const corpus = state.papers.some((entry) => favoriteKey(entry) === key) ? state.papers : [paper, ...state.papers];
    const existing = state.liked.find((entry) => entry.id === key);
    const keywords = existing?.keywords?.length ? existing.keywords : extractKeywords(paper, corpus);
    state.liked = [{ id: key, title: paper.title, url: paper.url, keywords, vote, likedAt: new Date().toISOString() }, ...others];
    request = { method: "POST", body: { paper: { id: key, title: paper.title, url: paper.url }, keywords, vote } };
    const terms = `${keywords.slice(0, 5).map((keyword) => keyword.term).join(", ")}${keywords.length > 5 ? "…" : ""}`;
    showToast(vote === 1
      ? `Learning from this paper: ${terms}`
      : `Got it — hidden from Most Interesting, and fewer papers about: ${terms}`);
  }

  render();

  try {
    const response = await fetch("/api/likes", {
      method: request.method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request.body)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Could not save your vote.");
    }

    if (Array.isArray(data.liked)) {
      state.liked = data.liked;
    }
  } catch (error) {
    state.liked = previous;
    showToast(error.message);
  }

  render();
}

let toastTimer = null;

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add("toast--visible"));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("toast--visible");
    window.setTimeout(() => { toast.hidden = true; }, 250);
  }, 3500);
}

// ===== Full-arXiv search =====
const searchModal = document.querySelector("#searchModal");
const searchForm = document.querySelector("#searchForm");
const searchFields = {
  firstAuthor: document.querySelector("#searchFirstAuthor"),
  author: document.querySelector("#searchAuthor"),
  positionFrom: document.querySelector("#searchPositionFrom"),
  positionTo: document.querySelector("#searchPositionTo"),
  from: document.querySelector("#searchFrom"),
  to: document.querySelector("#searchTo"),
  ids: document.querySelector("#searchIds"),
  astroph: document.querySelector("#searchAstroph")
};
const searchCategoryRow = document.querySelector("#searchCategoryRow");
const searchCategories = document.querySelector("#searchCategories");
const searchStatus = document.querySelector("#searchStatus");

// Same chips (and colors) as the daily Classifications filter; all selected by default.
astroPhCategories.forEach((category) => {
  const label = document.createElement("label");
  label.className = "category-filter";
  label.dataset.category = category.id;
  label.title = category.id;
  label.innerHTML = `
    <input type="checkbox" value="${category.id}" checked>
    <span><strong>${category.id.replace("astro-ph.", "")}</strong> ${category.label}</span>
  `;
  searchCategories.appendChild(label);
});

function updateSearchCategoryRow() {
  searchCategoryRow.hidden = !searchFields.astroph.checked;
}

searchFields.astroph.addEventListener("change", updateSearchCategoryRow);
const searchSubmitButton = document.querySelector("#searchSubmitButton");

document.querySelector("#openSearchButton").addEventListener("click", openSearchModal);
document.querySelector("#searchCloseButton").addEventListener("click", () => searchModal.close());
document.querySelector("#searchResetButton").addEventListener("click", () => {
  searchForm.reset();
  updateSearchCategoryRow();
  searchStatus.textContent = "";
  searchFields.firstAuthor.focus();
});
searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch();
});

function openSearchModal() {
  searchStatus.textContent = "";
  searchModal.showModal();
  searchFields.firstAuthor.focus();
}

function clearSearch() {
  state.searchView = null;
  state.activeTopicId = null;
  render();
}

function normalizeNameText(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "Rubin, V", "V. Rubin", "Vera Rubin" or "Rubin" -> surname tokens + optional first initial.
function parseAuthorQuery(value) {
  const clean = (value || "").trim();

  if (!clean) {
    return null;
  }

  let surname;
  let given;

  if (clean.includes(",")) {
    [surname, given] = clean.split(/,(.*)/s);
  } else {
    const parts = clean.split(/\s+/);
    surname = parts.pop();
    given = parts.join(" ");
  }

  const surnameTokens = normalizeNameText(surname).split(" ").filter(Boolean);
  return surnameTokens.length ? { surname: surnameTokens, initial: normalizeNameText(given)[0] || "" } : null;
}

function authorMatchesQuery(author, query) {
  const tokens = normalizeNameText(author).split(" ").filter(Boolean);
  const length = query.surname.length;

  if (tokens.length < length || tokens.slice(-length).join(" ") !== query.surname.join(" ")) {
    return false;
  }

  const given = tokens.slice(0, tokens.length - length);
  return !query.initial || (given.length > 0 && given[0][0] === query.initial);
}

function describePositionRange({ positionFrom, positionTo }) {
  if (positionFrom && positionTo) return positionFrom === positionTo ? ` at position ${positionFrom}` : ` at position ${positionFrom}–${positionTo}`;
  if (positionFrom) return ` at position ${positionFrom} or later`;
  if (positionTo) return ` at position ${positionTo} or earlier`;
  return "";
}

function describeSearch(criteria) {
  const parts = [];

  if (criteria.firstAuthor) parts.push(`first author ${criteria.firstAuthor}`);
  if (criteria.author) parts.push(`author ${criteria.author}${describePositionRange(criteria)}`);
  if (criteria.from || criteria.to) parts.push(`submitted ${criteria.from ? formatDate(criteria.from) : "…"} – ${criteria.to ? formatDate(criteria.to) : "today"}`);
  if (criteria.ids) parts.push(`arXiv ${criteria.ids}`);
  if (criteria.astroph) {
    parts.push(criteria.categories.length < astroPhCategories.length
      ? `astro-ph ${criteria.categories.map((id) => id.replace("astro-ph.", "")).join(", ")}`
      : "astro-ph only");
  }
  return parts.join(" · ");
}

async function runSearch() {
  const criteria = {
    firstAuthor: searchFields.firstAuthor.value.trim(),
    author: searchFields.author.value.trim(),
    positionFrom: Math.max(0, Number.parseInt(searchFields.positionFrom.value, 10) || 0),
    positionTo: Math.max(0, Number.parseInt(searchFields.positionTo.value, 10) || 0),
    from: searchFields.from.value,
    to: searchFields.to.value,
    ids: searchFields.ids.value.trim(),
    astroph: searchFields.astroph.checked,
    categories: [...searchCategories.querySelectorAll("input:checked")].map((input) => input.value)
  };
  const firstAuthorQuery = parseAuthorQuery(criteria.firstAuthor);
  const authorQuery = parseAuthorQuery(criteria.author);

  if (!firstAuthorQuery && !authorQuery && !criteria.from && !criteria.to && !criteria.ids) {
    searchStatus.textContent = "Fill in at least an author, a date or an arXiv number.";
    return;
  }

  if (criteria.astroph && !criteria.categories.length) {
    searchStatus.textContent = "Select at least one classification, or uncheck \"Only astro-ph papers\".";
    return;
  }

  if (criteria.positionFrom && criteria.positionTo && criteria.positionFrom > criteria.positionTo) {
    searchStatus.textContent = "The first author position is larger than the last one.";
    return;
  }

  if ((criteria.positionFrom || criteria.positionTo) && !authorQuery) {
    searchStatus.textContent = "Enter an author name to use the author position.";
    return;
  }

  if (criteria.from && criteria.to && criteria.from > criteria.to) {
    searchStatus.textContent = "The \"from\" date is after the \"until\" date.";
    return;
  }

  const params = new URLSearchParams();
  if (criteria.firstAuthor) params.set("first_author", criteria.firstAuthor);
  if (criteria.author) params.set("author", criteria.author);
  if (criteria.from) params.set("from", criteria.from);
  if (criteria.to) params.set("to", criteria.to);
  if (criteria.ids) params.set("ids", criteria.ids);
  if (criteria.astroph) {
    params.set("astroph", "1");

    if (criteria.categories.length < astroPhCategories.length) {
      params.set("cats", criteria.categories.join(","));
    }
  }

  searchSubmitButton.disabled = true;
  searchStatus.textContent = "Searching arXiv…";

  try {
    const response = await fetch(`/api/search?${params}`);
    const body = await response.text();

    if (!response.ok) {
      const parsed = safeJson(body);
      throw new Error(parsed?.detail || parsed?.error || `Search failed with HTTP ${response.status}`);
    }

    const limit = Number(response.headers.get("x-search-limit")) || 0;
    const fetched = parseArxivFeed(body).filter((paper) => paper.title && !paper.id.includes("/api/errors"));
    const papers = fetched
      .filter((paper) => !firstAuthorQuery || (paper.authors[0] && authorMatchesQuery(paper.authors[0], firstAuthorQuery)))
      .filter((paper) => !authorQuery || paper.authors.some((name, index) => {
        const position = index + 1;
        return (!criteria.positionFrom || position >= criteria.positionFrom)
          && (!criteria.positionTo || position <= criteria.positionTo)
          && authorMatchesQuery(name, authorQuery);
      }))
      .map(scorePaper);

    if (!papers.length) {
      searchStatus.textContent = fetched.length
        ? `arXiv returned ${fetched.length} papers for these names/dates, but none match the author position. Try a different spelling or position.`
        : "No papers found. Try fewer fields or a different spelling.";
      return;
    }

    state.searchView = {
      papers,
      summary: describeSearch(criteria),
      note: limit && fetched.length >= limit
        ? `Only the ${limit} most recent arXiv matches were checked — add a date range to reach older papers.`
        : ""
    };
    state.activeTopicId = searchTopic.id;
    searchModal.close();
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    searchStatus.textContent = error.message;
  } finally {
    searchSubmitButton.disabled = false;
  }
}

function sameSuggestion(entry, paper) {
  return entry?.id === paper.id
    && (entry?.suggestedBy?.username || "").toLowerCase() === (paper.suggestedBy?.username || "").toLowerCase();
}

function confirmAction(detail) {
  const modal = document.querySelector("#confirmModal");
  document.querySelector("#confirmModalPaper").textContent = detail || "";
  modal.returnValue = "";

  return new Promise((resolve) => {
    modal.addEventListener("close", () => resolve(modal.returnValue === "confirm"), { once: true });
    modal.showModal();
    modal.querySelector('button[value="cancel"]').focus();
  });
}

async function dismissSuggestion(paper, button) {
  if (!state.sessionUser) {
    return;
  }

  if (!(await confirmAction(paper.title))) {
    return;
  }

  const previous = state.suggestions;
  button.disabled = true;
  // Only the suggestion entry is removed; favorites live in state.favorites and are not touched.
  state.suggestions = state.suggestions.filter((entry) => !sameSuggestion(entry, paper));
  render();

  try {
    const response = await fetch("/api/suggestions", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: paper.id, suggestedBy: paper.suggestedBy?.username || "" })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Could not remove the suggestion.");
    }

    if (Array.isArray(data.suggestions)) {
      state.suggestions = data.suggestions;
      render();
    }
  } catch (error) {
    state.suggestions = previous;
    render();
    setStatus(error.message);
  }
}

function getSuggestedPapers() {
  return [...state.suggestions]
    .map((paper) => ({
      ...paper,
      topic: paper.topic || fallbackTopic,
      relevance: Number.isFinite(Number(paper.relevance)) ? Number(paper.relevance) : 0
    }))
    .sort((a, b) => new Date(b.suggestedAt || b.published) - new Date(a.suggestedAt || a.published));
}

function favoriteKey(paper) {
  return paper.id || paper.url;
}

function isFavorite(paper) {
  const key = favoriteKey(paper);
  return Boolean(key) && state.favorites.some((favorite) => favoriteKey(favorite) === key);
}

async function toggleFavorite(paper) {
  const key = favoriteKey(paper);

  if (!key) {
    return;
  }

  const previousFavorites = [...state.favorites];

  if (isFavorite(paper)) {
    state.favorites = state.favorites.filter((favorite) => favoriteKey(favorite) !== key);
  } else {
    state.favorites = [toFavoritePaper(paper), ...state.favorites];
  }

  render();

  try {
    if (state.sessionUser) {
      await saveRemoteFavorites();
    } else {
      saveLocalFavorites();
    }
  } catch (error) {
    state.favorites = previousFavorites;
    render();
    setStatus(error.message);
  }
}

function toFavoritePaper(paper) {
  return {
    id: paper.id,
    title: paper.title,
    authors: [...paper.authors],
    authorOrcids: [...(paper.authorOrcids || [])],
    abstract: paper.abstract,
    published: paper.published,
    updated: paper.updated,
    categories: [...paper.categories],
    url: paper.url,
    topic: {
      id: paper.topic?.id || fallbackTopic.id,
      label: paper.topic?.label || fallbackTopic.label
    },
    relevance: paper.relevance || 0,
    favoritedAt: new Date().toISOString()
  };
}

function updateFavoriteButton(button, paper) {
  const active = isFavorite(paper);
  button.setAttribute("aria-pressed", String(active));
  button.textContent = active ? "★" : "☆";
  button.title = active ? "Remove from favorites" : "Add to favorites";
  button.setAttribute("aria-label", active ? "Remove from favorites" : "Add to favorites");
}

function updateAuthUi() {
  const loggedIn = Boolean(state.sessionUser);
  usernameInput.hidden = loggedIn;
  passwordInput.hidden = loggedIn;
  loginButton.hidden = loggedIn;
  signupButton.hidden = loggedIn;
  profileLink.hidden = !loggedIn;
  adminLink.hidden = !(loggedIn && state.sessionUser?.isAdmin);
  logoutButton.hidden = !loggedIn;

  accountMenu.open = false;
  accountMenu.classList.toggle("account-menu--signed-in", loggedIn);

  if (loggedIn) {
    const displayName = firstAndLastName(state.sessionUser.fullName || "") || state.sessionUser.username;
    accountLabel.textContent = displayName;
    accountAvatar.textContent = initials(displayName);
    authStatus.textContent = welcomeMessage(state.sessionUser);
    usernameInput.value = state.sessionUser.username;
  } else {
    accountLabel.textContent = "Log in";
    accountAvatar.innerHTML = `<svg viewBox="0 0 20 20" width="16" height="16"><circle cx="10" cy="7" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.8 17c.8-3.2 3.3-5 6.2-5s5.4 1.8 6.2 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
    authStatus.textContent = "Anonymous mode. Favorites stay in this browser until you log in.";
    usernameInput.value = "";
  }
}

function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

function welcomeMessage(user) {
  const displayName = firstAndLastName(user.fullName || "");
  return displayName ? `Welcome ${displayName} (${user.username})!` : `Welcome ${user.username}!`;
}

function firstAndLastName(fullName) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);

  if (parts.length < 2) {
    return parts[0] || "";
  }

  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function setAuthButtonsDisabled(disabled) {
  usernameInput.disabled = disabled;
  passwordInput.disabled = disabled;
  loginButton.disabled = disabled;
  signupButton.disabled = disabled;
}

// "My Papers" matching uses the profile's full name and name aliases against the author list.
// (arXiv's listing has no ORCIDs, and fetching every paper page to find them caused HTTP 429 errors.)
function paperMatchesProfile(paper) {
  if (!state.sessionUser) {
    return false;
  }

  const profileNames = [state.sessionUser.fullName, ...(state.sessionUser.nameAliases || [])]
    .map((name) => extractNameSignature(name || ""))
    .filter(Boolean);

  if (!profileNames.length) {
    return false;
  }

  return paper.authors.some((author) => {
    const authorName = extractNameSignature(author);
    return profileNames.some((profileName) => sameNameSignature(authorName, profileName));
  });
}

function renderCategoryFilters() {
  categoryFilters.innerHTML = "";

  astroPhCategories.forEach((category) => {
    const label = document.createElement("label");
    label.className = "category-filter";
    label.dataset.category = category.id;
    label.title = category.id;
    label.innerHTML = `
      <input type="checkbox" value="${category.id}" checked>
      <span><strong>${category.id.replace("astro-ph.", "")}</strong> ${category.label}</span>
    `;

    const checkbox = label.querySelector("input");
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.activeCategories.add(category.id);
      } else {
        state.activeCategories.delete(category.id);
      }

      render();
    });

    categoryFilters.appendChild(label);
  });
}

function openSummaryModal(paper) {
  summaryModalTitle.textContent = paper.title;
  summaryList.innerHTML = "";

  buildSummaryBullets(paper).forEach((bullet) => {
    const item = document.createElement("li");
    item.textContent = bullet;
    summaryList.appendChild(item);
  });

  summaryModal.showModal();
  typesetMath(summaryModal);
}

function openSuggestModal(paper, shareMenu) {
  if (!state.sessionUser) {
    authStatus.textContent = "Log in to suggest papers to other users.";
    shareMenu.open = false;
    return;
  }

  suggestState.paper = paper;
  suggestState.selectedUser = null;
  suggestModalTitle.textContent = paper.title;
  suggestUserInput.value = "";
  suggestUserResults.innerHTML = "";
  suggestStatus.textContent = "";
  suggestSendButton.disabled = true;
  shareMenu.open = false;
  suggestModal.showModal();
  suggestUserInput.focus();
}

async function searchSuggestUsers() {
  const query = suggestUserInput.value.trim();
  suggestState.selectedUser = null;
  suggestSendButton.disabled = true;
  suggestStatus.textContent = "";

  if (suggestState.searchController) {
    suggestState.searchController.abort();
  }

  if (!query) {
    suggestUserResults.innerHTML = "";
    return;
  }

  const controller = new AbortController();
  suggestState.searchController = controller;

  try {
    const response = await fetch(`/api/users?q=${encodeURIComponent(query)}`, {
      signal: controller.signal
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not search users.");
    }

    renderSuggestUserResults(Array.isArray(data.users) ? data.users : []);
  } catch (error) {
    if (error.name !== "AbortError") {
      suggestUserResults.innerHTML = "";
      suggestStatus.textContent = error.message;
    }
  }
}

function renderSuggestUserResults(users) {
  suggestUserResults.innerHTML = "";

  if (!users.length) {
    suggestUserResults.innerHTML = `<div class="suggest-empty">No matching users.</div>`;
    return;
  }

  users.forEach((user) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggest-user-option";
    button.textContent = user.fullName ? `${user.fullName} (${user.username})` : user.username;
    button.addEventListener("click", () => {
      suggestState.selectedUser = user;
      suggestUserInput.value = button.textContent;
      suggestUserResults.innerHTML = "";
      suggestSendButton.disabled = false;
    });
    suggestUserResults.appendChild(button);
  });
}

async function sendSuggestion() {
  if (!suggestState.paper || !suggestState.selectedUser) {
    return;
  }

  suggestSendButton.disabled = true;
  suggestStatus.textContent = "Sending suggestion...";

  try {
    const response = await fetch("/api/suggestions", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        recipientUsername: suggestState.selectedUser.username,
        paper: toFavoritePaper(suggestState.paper)
      })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not suggest this paper.");
    }

    suggestStatus.textContent = "Suggested.";
    window.setTimeout(() => suggestModal.close(), 650);
  } catch (error) {
    suggestStatus.textContent = error.message;
    suggestSendButton.disabled = false;
  }
}

function buildSummaryBullets(paper) {
  const sentences = splitSentences(paper.abstract);

  if (!sentences.length) {
    return ["No abstract text was available to summarize."];
  }

  const resultLike = sentences
    .map((sentence, index) => ({
      sentence,
      index,
      score: summarySentenceScore(sentence, index, sentences.length)
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 4)
    .sort((a, b) => a.index - b.index)
    .map((item) => trimSentence(item.sentence));

  const bullets = [];
  bullets.push(`Focus: ${trimSentence(paper.title)}`);

  resultLike.forEach((sentence) => {
    if (!bullets.includes(sentence)) {
      bullets.push(sentence);
    }
  });

  return bullets.slice(0, 5);
}

function splitSentences(text) {
  return cleanText(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 28);
}

function summarySentenceScore(sentence, index, total) {
  const lower = sentence.toLowerCase();
  const positiveTerms = [
    "we find",
    "we show",
    "we present",
    "we demonstrate",
    "we report",
    "we reveal",
    "results",
    "suggest",
    "indicate",
    "consistent",
    "evidence",
    "conclude",
    "contribution",
    "measurement",
    "constraint",
    "imply"
  ];
  const setupTerms = ["we use", "we study", "we investigate", "we analyze", "we examine"];
  let score = Math.max(0, total - index) * 0.12;

  positiveTerms.forEach((term) => {
    if (lower.includes(term)) {
      score += 3;
    }
  });

  setupTerms.forEach((term) => {
    if (lower.includes(term)) {
      score += 1.2;
    }
  });

  if (/\b(first|new|novel|significant|robust|strong|high|low)\b/.test(lower)) {
    score += 0.8;
  }

  if (sentence.length > 240) {
    score -= 1;
  }

  return score;
}

function trimSentence(sentence) {
  const cleaned = cleanText(sentence);
  return cleaned.length > 260 ? `${cleaned.slice(0, 257).trim()}...` : cleaned;
}

function openBibtexModal(paper, libraryMenu) {
  bibtexModalTitle.textContent = paper.title;
  bibtexText.value = buildBibtexEntry(paper);
  bibtexAdsLink.href = adsExportCitationUrl(paper);
  bibtexCopyButton.textContent = "Copy BibTeX";
  libraryMenu.open = false;
  bibtexModal.showModal();
  bibtexText.focus();
  bibtexText.select();
}

async function copyBibtex() {
  const copied = await copyText(bibtexText.value);

  if (copied) {
    bibtexCopyButton.textContent = "Copied";
    window.setTimeout(() => {
      bibtexCopyButton.textContent = "Copy BibTeX";
    }, 1400);
    return;
  }

  bibtexText.focus();
  bibtexText.select();
  bibtexCopyButton.textContent = "Select text";
}

function buildBibtexEntry(paper) {
  const arxivId = paperArxivId(paper);
  const publishedDate = paper.published ? new Date(paper.published) : null;
  const safeDate = publishedDate && Number.isFinite(publishedDate.getTime()) ? publishedDate : new Date();
  const year = safeDate.getUTCFullYear();
  const month = monthAbbreviation(safeDate);
  const key = bibtexKey(paper, arxivId, year);
  const fields = [
    ["author", `{${formatBibtexAuthors(paper.authors)}}`, 7],
    ["title", `"{${escapeBibtexValue(paper.title)}}"`, 8],
    ["journal", "{arXiv e-prints}", 6],
    ["keywords", `{${escapeBibtexValue(paper.categories.join(", "))}}`, 5],
    ["year", String(year), 9],
    ["month", month, 8],
    ["eid", `{arXiv:${escapeBibtexValue(arxivId)}}`, 10],
    ["pages", `{arXiv:${escapeBibtexValue(arxivId)}}`, 8],
    ["archivePrefix", "{arXiv}", 0],
    ["eprint", `{${escapeBibtexValue(arxivId)}}`, 7],
    ["primaryClass", paper.categories[0] ? `{${escapeBibtexValue(paper.categories[0])}}` : "", 1]
  ].filter(([, value]) => value);

  const body = fields
    .map(([field, value, indent]) => `${" ".repeat(indent)}${field} = ${value}`)
    .join(",\n");

  return `@ARTICLE{${key},\n${body}\n}`;
}

function paperArxivId(paper) {
  const source = paper.url || paper.id || "";
  const match = source.match(/arxiv\.org\/abs\/([^?#]+)/i);

  if (match) {
    return decodeURIComponent(match[1]);
  }

  return source.split("/").filter(Boolean).pop() || "arxiv";
}

function adsExportCitationUrl(paper) {
  return `https://ui.adsabs.harvard.edu/abs/arXiv:${encodeURIComponent(paperArxivId(paper))}/exportcitation`;
}

function bibtexKey(paper, arxivId, year) {
  const firstAuthor = paper.authors[0] || "arxiv";
  const surname = firstAuthor
    .split(/\s+/)
    .filter(Boolean)
    .pop()
    ?.replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase() || "arxiv";
  const compactId = arxivId.replace(/[^A-Za-z0-9]/g, "").toLowerCase().slice(0, 16);

  return `${surname}${year}${compactId}`;
}

function monthAbbreviation(date) {
  return ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][date.getUTCMonth()];
}

function formatBibtexAuthors(authors) {
  return authors
    .map(formatBibtexAuthor)
    .filter(Boolean)
    .join(" and ");
}

function formatBibtexAuthor(author) {
  const parts = cleanText(author).split(/\s+/).filter(Boolean);

  if (!parts.length) {
    return "";
  }

  if (parts.length === 1) {
    return `{${escapeBibtexValue(parts[0])}}`;
  }

  const lastName = parts.pop();
  return `{${escapeBibtexValue(lastName)}}, ${escapeBibtexValue(parts.join(" "))}`;
}

function escapeBibtexValue(value) {
  return cleanText(value)
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}");
}

async function copyPaperLink(button, url, shareMenu) {
  try {
    const copied = await copyText(url);
    if (!copied) {
      showCopyFallback(button, url);
      return;
    }

    clearCopyFallback(button);
    button.textContent = "Copied";
    window.setTimeout(() => {
      shareMenu.open = false;
    }, 500);
  } catch {
    showCopyFallback(button, url);
  }

  window.setTimeout(() => {
    button.textContent = "Copy link";
  }, 1400);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return fallbackCopy(value);
    }
  }

  return fallbackCopy(value);
}

function fallbackCopy(value) {
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  return copied;
}

function showCopyFallback(button, url) {
  clearCopyFallback(button);
  button.textContent = "Select link";

  const input = document.createElement("input");
  input.className = "copy-fallback";
  input.value = url;
  input.readOnly = true;
  input.setAttribute("aria-label", "arXiv abstract link");
  button.after(input);
  input.focus();
  input.select();
}

function clearCopyFallback(button) {
  button.parentElement?.querySelector(".copy-fallback")?.remove();
}

async function openFigureModal(paper) {
  figureState.figures = [];
  figureState.index = 0;
  figureModalTitle.textContent = paper.title;
  figureStatus.textContent = "Loading figures from arXiv HTML...";
  figureCarousel.hidden = true;
  figureModal.showModal();

  try {
    const response = await fetch(`/api/figures?id=${encodeURIComponent(arxivIdFromUrl(paper.url))}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || data.error || `Request failed with HTTP ${response.status}`);
    }

    if (!data.figures?.length) {
      figureStatus.textContent = "No figures were found in the arXiv HTML rendering for this paper.";
      return;
    }

    figureState.figures = data.figures;
    figureStatus.textContent = `${data.figures.length} ${data.figures.length === 1 ? "figure" : "figures"} found`;
    figureCarousel.hidden = false;
    showFigure(0);
  } catch (error) {
    figureStatus.textContent = `Could not load figures. ${error.message}`;
  }
}

function showFigure(index) {
  if (!figureState.figures.length) {
    return;
  }

  figureState.index = (index + figureState.figures.length) % figureState.figures.length;
  const figure = figureState.figures[figureState.index];
  figureImage.src = figure.src;
  figureImage.alt = figure.caption;
  figureCaption.textContent = figure.caption;
  prevFigureButton.disabled = figureState.figures.length < 2;
  nextFigureButton.disabled = figureState.figures.length < 2;
  typesetMath(figureCaption);
}

function arxivIdFromUrl(url) {
  return url.split("/").pop() || "";
}

function typesetMath(root) {
  if (!window.MathJax?.typesetPromise) {
    return;
  }

  window.MathJax.typesetClear?.([root]);
  window.MathJax.typesetPromise([root]).catch((error) => {
    console.warn("MathJax typesetting failed", error);
  });
}

// Papers whose authors the user revealed (when "Hide author names by default" is on in the profile).
const revealedAuthorPapers = new Set();

function renderAuthors(container, authors, paper) {
  container.textContent = "";
  const key = paper ? favoriteKey(paper) : "";

  if (state.sessionUser?.hideAuthors && authors.length && key && !revealedAuthorPapers.has(key)) {
    const hidden = document.createElement("span");
    hidden.className = "authors-hidden";
    hidden.textContent = `Authors hidden (${authors.length})`;
    const reveal = document.createElement("button");
    reveal.type = "button";
    reveal.className = "author-toggle reveal-authors-button";
    reveal.textContent = "Reveal authors";
    reveal.addEventListener("click", () => {
      revealedAuthorPapers.add(key);
      renderAuthors(container, authors, paper);
    });
    container.append(hidden, reveal);
    return;
  }

  if (!authors.length) {
    container.textContent = "No authors listed";
    return;
  }

  const firstAuthors = authors.slice(0, 3);
  const hiddenAuthors = authors.slice(3);
  const visible = document.createElement("span");
  visible.textContent = firstAuthors.join(", ");
  container.appendChild(visible);

  if (!hiddenAuthors.length) {
    return;
  }

  const more = document.createElement("span");
  more.hidden = true;
  more.textContent = `, ${hiddenAuthors.join(", ")}`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "author-toggle";
  button.title = "Show remaining authors";
  button.setAttribute("aria-expanded", "false");
  button.textContent = `+${hiddenAuthors.length}`;

  button.addEventListener("click", () => {
    const isOpen = !more.hidden;
    more.hidden = isOpen;
    button.setAttribute("aria-expanded", String(!isOpen));
    button.title = isOpen ? "Show remaining authors" : "Hide remaining authors";
    button.textContent = isOpen ? `+${hiddenAuthors.length}` : "-";
  });

  container.append(more, button);
}

function matchesSearch(paper) {
  if (!state.search) {
    return true;
  }

  return `${paper.title} ${paper.abstract} ${paper.authors.join(" ")} ${paper.categories.join(" ")} ${paper.suggestedBy?.username || ""} ${paper.suggestedBy?.fullName || ""}`
    .toLowerCase()
    .includes(state.search);
}

function matchesCategoryFilter(paper) {
  if (!state.activeCategories.size) {
    return false;
  }

  return paper.categories.some((category) => state.activeCategories.has(category));
}

function statusMessage(filteredCount, totalCount) {
  if (!totalCount) {
    return `No astro-ph submissions found for ${formatDate(state.selectedDate)}.`;
  }

  if (filteredCount !== totalCount) {
    return `${filteredCount} of ${totalCount} papers shown for ${formatDate(state.selectedDate)}.`;
  }

  return `${totalCount} papers found for ${formatDate(state.selectedDate)}.`;
}

function setStatus(message) {
  statusText.textContent = message;
}

function formatDate(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(`${value}T12:00:00`));
}

function cleanText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function extractNameSignature(value) {
  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = normalized.split(" ").filter(Boolean);

  if (tokens.length < 2) {
    return null;
  }

  return {
    first: tokens[0],
    last: tokens[tokens.length - 1]
  };
}

function sameNameSignature(left, right) {
  if (!left || !right || left.last !== right.last) {
    return false;
  }

  return left.first === right.first || left.first[0] === right.first[0];
}

function normalizeOrcid(value) {
  return cleanText(value)
    .toUpperCase()
    .replace(/^HTTPS?:\/\/ORCID\.ORG\//, "")
    .replace(/[^0-9X]/g, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
