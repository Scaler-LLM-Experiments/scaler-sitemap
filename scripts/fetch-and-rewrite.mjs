import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET_DOMAIN = "https://www.scaler.com";

const FETCH_TIMEOUT_MS = 30_000;
const OUTPUT_PATH = join(process.cwd(), "sitemap.xml");

// Official sitemaps.org namespace. The `/` before 0.9 matters — `sitemap-0.9`
// (hyphen) is rejected by Google Search Console as "Incorrect namespace".
const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";

/**
 * Path helpers. We match on the URL's *pathname*, not a substring of the whole
 * URL, so a source's own unrelated pages can never leak in. This matters:
 * the SSB Framer project also publishes `/school-of-business/minimal-landing-v*`
 * draft pages and a 404ing `/school-of-business-2/`, none of which belong in an
 * SEO sitemap.
 */
function underPrefix(prefix, { includeSelf = false } = {}) {
  const bare = prefix.replace(/\/$/, "");
  return (path) => {
    const p = path.replace(/\/$/, "");
    if (p === bare) return includeSelf;
    return p.startsWith(bare + "/");
  };
}

/**
 * Every source is fetched independently. A source that fails falls back to
 * whatever URLs it already contributed to the on-disk sitemap.xml, so one
 * upstream outage can never silently shrink the brand sitemap.
 */
const SOURCES = [
  {
    key: "sstGuide",
    label: "SST guide",
    url: "https://modest-use-253097.framer.app/sitemap.xml",
    // Served to users via reverse proxy under www.scaler.com, so rewrite the
    // Framer origin away.
    rewriteFrom: "https://modest-use-253097.framer.app",
    // The /guide hub itself is deliberately excluded (pre-existing behaviour).
    matches: underPrefix("/school-of-technology/guide"),
  },
  {
    key: "ssbGuide",
    label: "SSB guide",
    // A *different* Framer project from SST — modest-use-253097 returns 404 for
    // every /school-of-business/* path.
    url: "https://reliable-course-598924.framer.app/sitemap.xml",
    rewriteFrom: "https://reliable-course-598924.framer.app",
    // Includes the /school-of-business/guide hub and the /guide/category/* pages.
    matches: underPrefix("/school-of-business/guide", { includeSelf: true }),
  },
  {
    key: "predictor",
    label: "college predictor",
    // Already served under www.scaler.com (reverse-proxied subpath), so there
    // is no origin to rewrite.
    url: "https://www.scaler.com/school-of-technology/college-predictor/sitemap.xml",
    rewriteFrom: null,
    matches: underPrefix("/school-of-technology/college-predictor", {
      includeSelf: true,
    }),
  },
];

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

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/** Keep only the URLs belonging to `source`, rewritten onto the brand domain. */
function selectFor(source, urls) {
  const out = [];
  for (const url of urls) {
    const path = pathOf(url);
    if (path === null || !source.matches(path)) continue;
    out.push(
      source.rewriteFrom ? url.replace(source.rewriteFrom, TARGET_DOMAIN) : url
    );
  }
  return out;
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

/**
 * If a source can't be fetched this run, preserve the URLs it already
 * contributed to the on-disk sitemap.xml. A transient upstream outage must not
 * drop a whole school's pages from the brand sitemap.
 */
async function previousLocsFor(source, outputPath) {
  try {
    const current = await readFile(outputPath, "utf8");
    return extractLocs(current).filter((u) => {
      const path = pathOf(u);
      return path !== null && source.matches(path);
    });
  } catch {
    return [];
  }
}

/**
 * Generate the merged sitemap XML and (optionally) write it to disk.
 * Returns { xml, counts, stale, totalCount }.
 *
 * Exposed as a function so server.mjs can call it on a self-refresh
 * interval without depending on GitHub Actions cron.
 */
export async function generateSitemap({
  outputPath = OUTPUT_PATH,
  write = true,
} = {}) {
  const counts = {};
  const stale = [];

  // Sources are independent, so fetch them concurrently.
  const collected = await Promise.all(
    SOURCES.map(async (source) => {
      try {
        const xml = await fetchSitemap(source.url);
        const urls = selectFor(source, extractLocs(xml));
        if (urls.length === 0) {
          throw new Error("sitemap had 0 matching URLs");
        }
        return urls;
      } catch (err) {
        console.warn(
          `[sitemap] ${source.label} unavailable (${err.message}); preserving prior URLs.`
        );
        stale.push(source.key);
        return previousLocsFor(source, outputPath);
      }
    })
  );

  SOURCES.forEach((source, i) => {
    counts[source.key] = collected[i].length;
  });

  // Merge, dedupe, sort.
  const all = [...new Set(collected.flat())].sort();

  // Refuse to write an empty sitemap — better to keep the last good file than
  // to publish a urlset with nothing in it.
  if (all.length === 0) {
    throw new Error("refusing to write an empty sitemap (all sources failed)");
  }

  const xml = buildSitemap(all, todayYMD());
  if (write) await writeFile(outputPath, xml, "utf8");

  return { xml, counts, stale, totalCount: all.length };
}

/** "111 SST guide + 64 SSB guide + 14 college predictor" */
export function formatCounts(counts) {
  return SOURCES.map((s) => `${counts[s.key] ?? 0} ${s.label}`).join(" + ");
}

// CLI entry point — `node scripts/fetch-and-rewrite.mjs` still works for the
// GitHub Action (which remains as a redundant backup if the Railway in-process
// refresher fails).
const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  generateSitemap()
    .then((r) => {
      console.log(
        `Wrote ${r.totalCount} URLs (${formatCounts(r.counts)}) to ${OUTPUT_PATH}.`
      );
      if (r.stale.length > 0) {
        console.warn(`Stale sources this run: ${r.stale.join(", ")}`);
      }
    })
    .catch((err) => {
      console.error("Error:", err.message);
      process.exit(1);
    });
}
