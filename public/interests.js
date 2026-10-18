// Learns a user's interests from papers they give a thumbs-up.
//
// 1. When a paper is liked, extractKeywords() picks its most distinctive terms
//    (single words and two-word phrases) using TF-IDF against the day's papers,
//    so generic words like "galaxy" or "observations" are down-weighted.
// 2. buildInterestProfile() adds up the keyword weights of all liked papers.
// 3. scoreInterest() rates any paper by how strongly it contains those keywords
//    (title matches count double).

const stopwords = new Set(`
a about above across after again against all almost along already also although always am among an and another any
are around as at available based be because been before being below between both but by can cannot could did do does
doing done down due during each either enough especially etc even ever every few first for found from further given
had has have having here how however if in including into is it its itself just large larger least less like likely
made main make many may more most much must near nearly new no nor not now of off often on once one only onto or other
others our out over own per possible present presented provide provides rather recent recently respectively same several
should show shown shows significant significantly similar since so some such than that the their them then there
therefore these they this those three through thus to together toward towards two under up upon use used using various
very via was we well were what when where whether which while who whose why will with within without would yet
paper work study studies result results find finding findings report reports investigate investigated analysis analyze
analyse method methods approach data model models measurement measurements observation observations observed observe
sample samples total value values range high low higher lower new novel first second third case cases effect effects
evidence suggest suggests suggesting indicate indicates consistent compared comparison order level levels number numbers
show demonstrate demonstrates obtain obtained derive derived estimate estimated estimates find present including
respectively time times scale scales well key strong strongly significant potential properties property different
fraction function functions parameter parameters region regions system systems type types source sources factor
however additionally furthermore moreover addition overall around within across our new two one also non
trace traced tracing reveal revealed revealing discover discovered discovery identify identified identifying detect
detected detecting explore explored exploring examine examined probe probed probing measure measured constrain
constrained constraint characterize characterized describe described discuss discussed propose proposed perform
performed apply applied predict predicted produce produced reproduce reproduced test tested allow allows enable
enables require requires remain remains appear appears include includes lead leads associated related relative
respective possible likely recent current future previous previously new including toward
`.split(/\s+/).filter(Boolean));

const docCache = new Map();

export function normalizeToken(token) {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.length > 4 && token.endsWith("s") && !/(ss|us|is|ous|ics)$/.test(token)) {
    return token.slice(0, -1);
  }

  return token;
}

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/\$[^$]*\$/g, " ")
    .replace(/\\[a-z]+/g, " ")
    .replace(/[^a-z0-9\-\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .map(normalizeToken);
}

function isContentToken(token) {
  return token.length >= 3 && !stopwords.has(token) && !/^\d+(\.\d+)?$/.test(token) && /[a-z]/.test(token);
}

function termsFromText(text) {
  const tokens = tokenize(text);
  const counts = new Map();
  const add = (term) => counts.set(term, (counts.get(term) || 0) + 1);

  tokens.forEach((token, index) => {
    if (!isContentToken(token)) {
      return;
    }

    add(token);
    const next = tokens[index + 1];

    if (next && isContentToken(next)) {
      add(`${token} ${next}`);
    }
  });

  return counts;
}

// Term counts for a paper, with title terms tracked separately. Cached per paper id.
export function paperTerms(paper) {
  const key = paper.id || paper.url || paper.title;

  if (docCache.has(key)) {
    return docCache.get(key);
  }

  const title = termsFromText(paper.title);
  const body = termsFromText(paper.abstract);
  const all = new Map(body);
  title.forEach((count, term) => all.set(term, (all.get(term) || 0) + count));
  const entry = { title, all };
  docCache.set(key, entry);
  return entry;
}

export function extractKeywords(paper, corpus, limit = 12) {
  const docs = corpus.length ? corpus : [paper];
  const docFreq = new Map();

  docs.forEach((doc) => {
    paperTerms(doc).all.forEach((_count, term) => docFreq.set(term, (docFreq.get(term) || 0) + 1));
  });

  const { title, all } = paperTerms(paper);
  const scored = [...all.entries()].map(([term, count]) => {
    const tf = count + (title.get(term) || 0) * 2;
    const idf = Math.log((docs.length + 1) / ((docFreq.get(term) || 0) + 1)) + 1;
    const phraseBoost = term.includes(" ") ? 1.4 : 1;
    return { term, score: tf * idf * phraseBoost, count };
  });

  // A phrase seen only once in the abstract is usually noise ("work present"); keep phrases that repeat or are in the title.
  const candidates = scored
    .filter((entry) => !entry.term.includes(" ") || entry.count > 1 || title.has(entry.term))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const top = candidates[0]?.score || 1;

  return candidates.map((entry) => ({ term: entry.term, weight: Math.round((entry.score / top) * 100) / 100 }));
}

export function buildInterestProfile(likedPapers) {
  const profile = new Map();

  likedPapers.forEach((liked) => {
    (liked.keywords || []).forEach(({ term, weight }) => {
      profile.set(term, (profile.get(term) || 0) + (Number(weight) || 0));
    });
  });

  return profile;
}

export function scoreInterest(paper, profile) {
  if (!profile.size) {
    return { score: 0, matches: [] };
  }

  const { title, all } = paperTerms(paper);
  const contributions = [];

  all.forEach((_count, term) => {
    const weight = profile.get(term);

    if (weight) {
      contributions.push({ term, value: weight * (title.has(term) ? 2 : 1) });
    }
  });

  contributions.sort((a, b) => b.value - a.value);
  return {
    score: contributions.reduce((sum, entry) => sum + entry.value, 0),
    matches: contributions.map((entry) => entry.term)
  };
}

// Picks the day's most interesting papers: score at least 1 and at least 25% of the best match among papers
// not yet liked (a liked paper matches its own keywords perfectly and would otherwise set the bar too high).
export function mostInterestingPapers(papers, profile, likedIds = new Set(), limit = 12) {
  const scored = papers
    .map((paper) => ({ paper, ...scoreInterest(paper, profile) }))
    .filter((entry) => entry.score >= 1)
    .sort((a, b) => b.score - a.score);
  const best = scored.find((entry) => !likedIds.has(entry.paper.id))?.score || 0;

  return scored
    .filter((entry) => entry.score >= best * 0.25)
    .slice(0, limit)
    .map((entry) => ({ ...entry.paper, interestScore: entry.score, interestMatches: entry.matches.slice(0, 4) }));
}

export function aggregateKeywords(likedPapers) {
  return [...buildInterestProfile(likedPapers).entries()]
    .map(([term, weight]) => ({ term, weight }))
    .sort((a, b) => b.weight - a.weight);
}
