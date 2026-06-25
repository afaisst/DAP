import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 4180);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=900"
  });
  res.end(JSON.stringify(body));
}

function dateToArxivBounds(dateValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    throw new Error("Expected date in YYYY-MM-DD format.");
  }

  const compact = dateValue.replaceAll("-", "");
  return [`${compact}0000`, `${compact}2359`];
}

function parseFigureHtml(html, baseUrl) {
  const figureMatches = html.match(/<figure\b[\s\S]*?<\/figure>/gi) || [];
  const sources = figureMatches.length ? figureMatches : html.match(/<img\b[^>]*>/gi) || [];

  return sources
    .map((block, index) => {
      const imgMatch = block.match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);

      if (!imgMatch) {
        return null;
      }

      const captionMatch = block.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i);
      const altMatch = imgMatch[0].match(/\balt=["']([^"']*)["']/i);
      const caption = cleanHtml(captionMatch?.[1] || altMatch?.[1] || `Figure ${index + 1}`);

      const src = new URL(imgMatch[1], baseUrl).toString();

      return {
        src,
        caption
      };
    })
    .filter(Boolean)
    .filter((figure) => {
      const src = figure.src.toLowerCase();
      return !src.includes("/static/")
        && !src.includes("/images/icons/")
        && !src.includes("/icons/")
        && !src.endsWith(".svg");
    })
    .filter((figure, index, figures) => figures.findIndex((item) => item.src === figure.src) === index)
    .slice(0, 30);
}

function cleanHtml(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function handleFigures(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const id = url.searchParams.get("id")?.trim();

  if (!id || !/^\d{4}\.\d{4,5}(v\d+)?$/.test(id)) {
    return json(res, 400, { error: "Missing or invalid arXiv ID." });
  }

  const htmlUrl = `https://arxiv.org/html/${id}`;

  try {
    const response = await fetch(htmlUrl, {
      headers: {
        "user-agent": "DailyAstroPH/1.0 (local webpage; figure preview)"
      }
    });

    if (!response.ok) {
      throw new Error(`ar5iv returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const figures = parseFigureHtml(html, htmlUrl);
    json(res, 200, { id, source: htmlUrl, figures });
  } catch (error) {
    json(res, 502, {
      error: "Could not load figures for this paper.",
      detail: error.message
    });
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const selectedDate = url.searchParams.get("date");
  const maxResults = Math.min(Number(url.searchParams.get("max") || 150), 300);

  if (!selectedDate) {
    return json(res, 400, { error: "Missing date query parameter." });
  }

  let start;
  let end;
  try {
    [start, end] = dateToArxivBounds(selectedDate);
  } catch (error) {
    return json(res, 400, { error: error.message });
  }

  const params = new URLSearchParams({
    search_query: `cat:astro-ph* AND submittedDate:[${start} TO ${end}]`,
    start: "0",
    max_results: String(maxResults),
    sortBy: "submittedDate",
    sortOrder: "descending"
  });

  try {
    const response = await fetch(`https://export.arxiv.org/api/query?${params}`, {
      headers: {
        "user-agent": "DailyAstroPH/1.0 (local webpage; arxiv daily reader)"
      }
    });

    if (!response.ok) {
      throw new Error(`arXiv returned HTTP ${response.status}`);
    }

    const xml = await response.text();
    res.writeHead(200, {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "public, max-age=900"
    });
    res.end(xml);
  } catch (error) {
    json(res, 502, {
      error: "Could not fetch papers from arXiv.",
      detail: error.message
    });
  }
}

async function handleStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const contents = await readFile(filePath);
    const type = mimeTypes[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(contents);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = http.createServer((req, res) => {
  if (req.url?.startsWith("/api/papers")) {
    return handleApi(req, res);
  }

  if (req.url?.startsWith("/api/figures")) {
    return handleFigures(req, res);
  }

  return handleStatic(req, res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`DailyAstroPH running at http://127.0.0.1:${port}`);
});
