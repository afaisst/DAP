const topics = [
  {
    id: "large-scale-structure",
    label: "Large scale structure",
    terms: ["large scale structure", "dark matter halo", "weak lensing", "clustering", "baryon acoustic", "bao", "simulation", "halo", "void", "cosmic web"]
  },
  {
    id: "reionization",
    label: "Reionization",
    terms: ["reionization", "epoch of reionization", "eor", "first galaxies", "high-redshift", "high redshift", "igm", "lyman alpha", "21 cm", "jwst"]
  },
  {
    id: "galaxies",
    label: "Galaxies",
    terms: ["galaxy", "galaxies", "galactic", "morphology", "stellar mass", "metallicity", "quenching", "gas", "dust", "ism", "circumgalactic", "cgm"]
  },
  {
    id: "black-holes",
    label: "Black holes",
    terms: ["black hole", "agn", "quasar", "accretion", "event horizon", "supermassive", "smbh", "jets", "tidal disruption", "tde"]
  },
  {
    id: "local-galaxies",
    label: "Local galaxies",
    terms: ["milky way", "andromeda", "m31", "local group", "magellanic", "nearby galaxy", "dwarf galaxy", "satellite galaxy", "local volume"]
  },
  {
    id: "stars",
    label: "Stars",
    terms: ["star", "stars", "stellar", "supernova", "nova", "exoplanet", "planet", "white dwarf", "neutron star", "binary", "asteroseismology", "protostar"]
  },
  {
    id: "cosmology",
    label: "Cosmology",
    terms: ["cosmology", "cosmological", "dark matter", "dark energy", "cmb", "inflation", "hubble constant", "h0", "sigma8", "s8", "lambda cdm", "lcdm", "early universe"]
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
  label: "Other topics",
  terms: []
};

const state = {
  papers: [],
  selectedDate: new Date().toISOString().slice(0, 10),
  search: "",
  activeCategories: new Set(astroPhCategories.map((category) => category.id)),
  collapsedTopics: new Set([...topics.map((topic) => topic.id), fallbackTopic.id])
};

const dateInput = document.querySelector("#dateInput");
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

const figureState = {
  figures: [],
  index: 0
};

dateInput.value = state.selectedDate;
renderCategoryFilters();

dateInput.addEventListener("change", () => {
  state.selectedDate = dateInput.value;
  loadPapers();
});

searchInput.addEventListener("input", () => {
  state.search = searchInput.value.trim().toLowerCase();
  render();
});

refreshButton.addEventListener("click", loadPapers);
figureCloseButton.addEventListener("click", () => figureModal.close());
prevFigureButton.addEventListener("click", () => showFigure(figureState.index - 1));
nextFigureButton.addEventListener("click", () => showFigure(figureState.index + 1));

loadPapers();

async function loadPapers() {
  topicList.innerHTML = "";
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
    topicList.innerHTML = `<div class="empty error">Could not load papers. ${escapeHtml(error.message)}</div>`;
    setStatus("arXiv is unreachable from this local server right now.");
  }
}

function parseArxivFeed(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const entries = [...doc.querySelectorAll("entry")];

  return entries.map((entry) => {
    const authors = [...entry.querySelectorAll("author name")].map((node) => cleanText(node.textContent));
    const categories = [...entry.querySelectorAll("category")].map((node) => node.getAttribute("term")).filter(Boolean);
    const links = [...entry.querySelectorAll("link")];
    const abstractUrl = links.find((link) => link.getAttribute("rel") === "alternate")?.getAttribute("href");

    return {
      id: cleanText(entry.querySelector("id")?.textContent || ""),
      title: cleanText(entry.querySelector("title")?.textContent || ""),
      authors,
      abstract: cleanText(entry.querySelector("summary")?.textContent || ""),
      published: entry.querySelector("published")?.textContent || "",
      updated: entry.querySelector("updated")?.textContent || "",
      categories,
      url: abstractUrl || cleanText(entry.querySelector("id")?.textContent || "")
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

  setStatus(statusMessage(filtered.length, state.papers.length));

  if (!grouped.length) {
    topicList.innerHTML = `<div class="empty">No papers match this date and search.</div>`;
    return;
  }

  topicList.innerHTML = "";
  grouped.forEach((group) => {
    const section = document.createElement("section");
    section.className = "topic-section";
    const gridId = `topic-grid-${group.topic.id}`;
    const isCollapsed = state.collapsedTopics.has(group.topic.id);
    section.innerHTML = `
      <button class="topic-heading" type="button" aria-expanded="${String(!isCollapsed)}" aria-controls="${gridId}">
        <span class="topic-title">
          <span class="topic-chevron" aria-hidden="true"></span>
          <span class="topic-name">${escapeHtml(group.topic.label)}</span>
        </span>
        <span class="topic-count">${group.papers.length} ${group.papers.length === 1 ? "paper" : "papers"}</span>
      </button>
      <div class="papers-grid" id="${gridId}" ${isCollapsed ? "hidden" : ""}></div>
    `;

    const grid = section.querySelector(".papers-grid");
    const heading = section.querySelector(".topic-heading");
    heading.addEventListener("click", () => toggleTopic(group.topic.id, heading, grid));
    group.papers.forEach((paper) => grid.appendChild(renderPaper(paper)));
    topicList.appendChild(section);
  });
}

function toggleTopic(topicId, heading, grid) {
  const isCollapsed = state.collapsedTopics.has(topicId);

  if (isCollapsed) {
    state.collapsedTopics.delete(topicId);
    heading.setAttribute("aria-expanded", "true");
    grid.hidden = false;
  } else {
    state.collapsedTopics.add(topicId);
    heading.setAttribute("aria-expanded", "false");
    grid.hidden = true;
  }
}

function renderPaper(paper) {
  const node = template.content.firstElementChild.cloneNode(true);
  const title = node.querySelector(".paper-title");
  const meta = node.querySelector(".paper-meta");
  const authors = node.querySelector(".authors");
  const abstract = node.querySelector(".abstract-block p");
  const copyButton = node.querySelector(".copy-link-button");
  const figuresButton = node.querySelector(".figures-button");

  title.href = paper.url;
  title.textContent = paper.title;
  meta.textContent = `${formatDate(paper.published.slice(0, 10))} · ${paper.categories.join(", ") || "astro-ph"}`;
  abstract.textContent = paper.abstract;
  copyButton.addEventListener("click", () => copyPaperLink(copyButton, paper.url));
  figuresButton.addEventListener("click", () => openFigureModal(paper));
  renderAuthors(authors, paper.authors);

  return node;
}

function renderCategoryFilters() {
  categoryFilters.innerHTML = "";

  astroPhCategories.forEach((category) => {
    const label = document.createElement("label");
    label.className = "category-filter";
    label.innerHTML = `
      <input type="checkbox" value="${category.id}" checked>
      <span>${category.id}</span>
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

async function copyPaperLink(button, url) {
  try {
    const copied = await copyText(url);
    if (!copied) {
      showCopyFallback(button, url);
      return;
    }

    clearCopyFallback(button);
    button.textContent = "Copied";
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
}

function arxivIdFromUrl(url) {
  return url.split("/").pop() || "";
}

function renderAuthors(container, authors) {
  container.textContent = "";

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

  return `${paper.title} ${paper.abstract} ${paper.authors.join(" ")} ${paper.categories.join(" ")}`
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
