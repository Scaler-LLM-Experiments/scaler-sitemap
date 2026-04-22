import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const SOURCE_URL = "https://modest-use-253097.framer.app/sitemap.xml";
const SOURCE_DOMAIN = "https://modest-use-253097.framer.app";
const TARGET_DOMAIN = "https://www.scaler.com";
const GUIDE_PATH = "/school-of-technology/guide/";
const FETCH_TIMEOUT_MS = 30_000;
const OUTPUT_PATH = join(process.cwd(), "sitemap.xml");

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
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap-0.9">\n${body}\n</urlset>\n`;
}

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  console.log(`Fetching ${SOURCE_URL}...`);
  const xml = await fetchSitemap(SOURCE_URL);

  const allLocs = extractLocs(xml);
  console.log(`Found ${allLocs.length} <loc> entries in source sitemap.`);

  const guideLocs = allLocs.filter(isGuideUrl);
  console.log(`Filtered to ${guideLocs.length} guide URLs.`);

  const rewritten = guideLocs.map(rewriteDomain).sort();

  const lastmod = todayYMD();
  const output = buildSitemap(rewritten, lastmod);

  await writeFile(OUTPUT_PATH, output, "utf8");
  console.log(`Wrote ${rewritten.length} URLs to ${OUTPUT_PATH} (lastmod ${lastmod}).`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
