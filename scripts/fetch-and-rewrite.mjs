import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

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

// Official sitemaps.org namespace. Note the slash before 0.9 — `sitemap-0.9`
// (hyphen) is wrong and Google Search Console rejects it as "Incorrect namespace".
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
// predictor URLs are already in sitemap.xml — a transient outage must not drop
// ~700 URLs from the brand sitemap (the next successful run re-syncs them).
async function existingPredictorLocs() {
  try {
    const current = await readFile(OUTPUT_PATH, "utf8");
    return extractLocs(current).filter((u) => u.includes(PREDICTOR_PATH));
  } catch {
    return [];
  }
}

async function main() {
  // 1) Guide pages (Framer → www.scaler.com).
  console.log(`Fetching guide sitemap: ${SOURCE_URL}`);
  const guideXml = await fetchSitemap(SOURCE_URL);
  const guideUrls = extractLocs(guideXml).filter(isGuideUrl).map(rewriteDomain);
  console.log(`Guide URLs: ${guideUrls.length}`);

  // 2) College Predictor pages (the app's own sitemap; already www.scaler.com).
  let predictorUrls = [];
  try {
    console.log(`Fetching predictor sitemap: ${PREDICTOR_SITEMAP_URL}`);
    const predXml = await fetchSitemap(PREDICTOR_SITEMAP_URL);
    predictorUrls = extractLocs(predXml).filter((u) => u.includes(PREDICTOR_PATH));
    console.log(`Predictor URLs: ${predictorUrls.length}`);
    if (predictorUrls.length === 0) throw new Error("predictor sitemap had 0 matching URLs");
  } catch (err) {
    console.warn(`Predictor sitemap unavailable (${err.message}); preserving existing predictor URLs.`);
    predictorUrls = await existingPredictorLocs();
    console.log(`Preserved ${predictorUrls.length} predictor URLs from current sitemap.`);
  }

  // 3) Merge, dedupe, sort.
  const all = [...new Set([...guideUrls, ...predictorUrls])].sort();
  const lastmod = todayYMD();
  await writeFile(OUTPUT_PATH, buildSitemap(all, lastmod), "utf8");
  console.log(
    `Wrote ${all.length} URLs (${guideUrls.length} guide + ${predictorUrls.length} predictor) to ${OUTPUT_PATH} (lastmod ${lastmod}).`
  );
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
