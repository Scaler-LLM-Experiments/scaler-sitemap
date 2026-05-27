import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Source 1 — Framer guide pages (rewritten from the Framer domain to scaler.com).
const SOURCE_URL = "https://modest-use-253097.framer.app/sitemap.xml";
const SOURCE_DOMAIN = "https://modest-use-253097.framer.app";
const TARGET_DOMAIN = "https://www.scaler.com";
const GUIDE_PATH = "/school-of-technology/guide/";

// Source 2 — College Predictor app's own sitemap. Already served under
// www.scaler.com (reverse-proxied subpath), so no domain rewrite is needed.
const PREDICTOR_SITEMAP_URL =
  "https://www.scaler.com/school-of-technology/college-predictor/sitemap.xml";
const PREDICTOR_PATH = "/school-of-technology/college-predictor";

const FETCH_TIMEOUT_MS = 30_000;
const OUTPUT_PATH = join(process.cwd(), "sitemap.xml");

// Official sitemaps.org namespace. The `/` before 0.9 matters — `sitemap-0.9`
// (hyphen) is rejected by Google Search Console as "Incorrect namespace".
const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";

async function fetchSitemap(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractLocs(xml) {
  const locs = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let match;
  while ((match = re.exec(xml)) !== null) {
    locs.push(match[1].trim());
  }
  return locs;
}

function isGuideUrl(url) {
  if (!url.includes(GUIDE_PATH)) return false;
  if (url.endsWith("/guide") || url.endsWith("/guide/")) return false;
  return true;
}

function rewriteDomain(url) {
  return url.replace(SOURCE_DOMAIN, TARGET_DOMAIN);
}

function buildSitemap(urls, lastmod) {
  const body = urls
    .map(
      (url) =>
        `  <url>\n    <loc>${url}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${SITEMAP_NS}">\n${body}\n</urlset>\n`;
}

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

// If the live predictor sitemap can't be fetched this run, preserve whatever
// predictor URLs are already in the on-disk sitemap.xml — a transient outage
// must not drop ~700 URLs from the brand sitemap.
async function existingPredictorLocs(outputPath) {
  try {
    const current = await readFile(outputPath, "utf8");
    return extractLocs(current).filter((u) => u.includes(PREDICTOR_PATH));
  } catch {
    return [];
  }
}

/**
 * Generate the merged sitemap XML and (optionally) write it to disk.
 * Returns { xml, guideCount, predictorCount, totalCount }.
 *
 * Exposed as a function so server.mjs can call it on a self-refresh
 * interval without depending on GitHub Actions cron.
 */
export async function generateSitemap({ outputPath = OUTPUT_PATH, write = true } = {}) {
  // 1) Guide pages (Framer → www.scaler.com).
  const guideXml = await fetchSitemap(SOURCE_URL);
  const guideUrls = extractLocs(guideXml).filter(isGuideUrl).map(rewriteDomain);

  // 2) College Predictor pages.
  let predictorUrls = [];
  try {
    const predXml = await fetchSitemap(PREDICTOR_SITEMAP_URL);
    predictorUrls = extractLocs(predXml).filter((u) => u.includes(PREDICTOR_PATH));
    if (predictorUrls.length === 0) throw new Error("predictor sitemap had 0 matching URLs");
  } catch (err) {
    console.warn(`[sitemap] predictor unavailable (${err.message}); preserving prior URLs.`);
    predictorUrls = await existingPredictorLocs(outputPath);
  }

  // 3) Merge, dedupe, sort.
  const all = [...new Set([...guideUrls, ...predictorUrls])].sort();
  const xml = buildSitemap(all, todayYMD());
  if (write) await writeFile(outputPath, xml, "utf8");

  return {
    xml,
    guideCount: guideUrls.length,
    predictorCount: predictorUrls.length,
    totalCount: all.length,
  };
}

// CLI entry point — `node scripts/fetch-and-rewrite.mjs` still works for the
// GitHub Action (which remains as a redundant backup if the Railway in-process
// refresher fails).
const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  generateSitemap()
    .then((r) => {
      console.log(
        `Wrote ${r.totalCount} URLs (${r.guideCount} guide + ${r.predictorCount} predictor) to ${OUTPUT_PATH}.`
      );
    })
    .catch((err) => {
      console.error("Error:", err.message);
      process.exit(1);
    });
}
