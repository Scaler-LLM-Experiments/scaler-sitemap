import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { generateSitemap, formatCounts } from "./scripts/fetch-and-rewrite.mjs";

const PORT = Number(process.env.PORT) || 3000;
const ROOT = resolve(process.cwd());
const SITEMAP_PATH = join(ROOT, "sitemap.xml");

// Self-refresh cadence. Default 1 hour; override with REFRESH_INTERVAL_MS.
const REFRESH_INTERVAL_MS =
  Number(process.env.REFRESH_INTERVAL_MS) || 60 * 60 * 1000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// Every alias serves the same merged sitemap (SST guide + SSB guide +
// college predictor). The school-of-technology name is kept verbatim because
// it is the URL already submitted to Google Search Console — renaming it would
// break that submission. `/scaler-guide-sitemap.xml` is the accurate name to
// migrate to when convenient.
const ALIASES = {
  "/scaler-school-of-technology-guide-sitemap.xml": "/sitemap.xml",
  "/scaler-school-of-business-guide-sitemap.xml": "/sitemap.xml",
  "/scaler-guide-sitemap.xml": "/sitemap.xml",
};

let lastRefreshAt = null;
let lastRefreshError = null;
let lastTotalCount = null;
let lastCounts = null;
let lastStaleSources = [];

async function refreshSitemap(reason) {
  const t0 = Date.now();
  try {
    const r = await generateSitemap({ outputPath: SITEMAP_PATH, write: true });
    lastRefreshAt = new Date();
    lastRefreshError = null;
    lastTotalCount = r.totalCount;
    lastCounts = r.counts;
    lastStaleSources = r.stale;
    console.log(
      `[sitemap] refreshed (${reason}): ${r.totalCount} URLs (${formatCounts(r.counts)}) in ${Date.now() - t0}ms`
    );
    if (r.stale.length > 0) {
      console.warn(`[sitemap] stale sources this run: ${r.stale.join(", ")}`);
    }
  } catch (err) {
    lastRefreshError = err.message;
    console.error(`[sitemap] refresh failed (${reason}): ${err.message}`);
  }
}

async function resolvePath(urlPath) {
  let safe = normalize(decodeURIComponent(urlPath.split("?")[0]));
  if (ALIASES[safe]) safe = ALIASES[safe];
  if (safe === "/" || safe === "") safe = "/index.html";
  const filePath = join(ROOT, safe);
  if (!filePath.startsWith(ROOT)) return null;
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) return join(filePath, "index.html");
    return filePath;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  // Lightweight health/status endpoint useful for debugging the refresh loop
  // without scraping the XML.
  if (req.url === "/_health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        status:
          lastRefreshError || lastStaleSources.length > 0 ? "degraded" : "ok",
        lastRefreshAt,
        lastRefreshError,
        lastTotalCount,
        counts: lastCounts,
        staleSources: lastStaleSources,
        refreshIntervalMs: REFRESH_INTERVAL_MS,
      })
    );
    return;
  }

  const filePath = await resolvePath(req.url || "/");
  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  try {
    const data = await readFile(filePath);
    const type =
      MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "public, max-age=300",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(PORT, async () => {
  console.log(`Serving ${ROOT} on port ${PORT}`);
  // Refresh once on boot so a freshly-deployed container picks up upstream
  // changes immediately. The committed sitemap.xml acts as the cold-start
  // fallback if the refresh fails.
  await refreshSitemap("boot");
  // Background refresh loop. unref() so it never blocks shutdown.
  setInterval(() => refreshSitemap("interval"), REFRESH_INTERVAL_MS).unref();
});
