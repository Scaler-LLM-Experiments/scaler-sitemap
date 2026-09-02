# Scaler Guide Sitemap

An automated XML sitemap mirror for Scaler's School of Technology and School of
Business guide pages, plus the College Predictor app — for SEO.

## Why this exists

Scaler's guide pages are served under `www.scaler.com` via reverse proxy from
Framer. Framer auto-generates a sitemap for each project, but those sitemaps
live on the `*.framer.app` domains — Google Search Console needs a sitemap
hosted under the `scaler.com` brand domain.

This repo fetches each upstream sitemap, filters it to the pages that belong in
the brand sitemap, rewrites the domain to `https://www.scaler.com`, merges
everything into one file, and serves it.

## Sources

Note that SST and SSB are two **separate** Framer projects — the SST project
returns 404 for every `/school-of-business/*` path.

| Source | Upstream | Included paths |
| --- | --- | --- |
| SST guide | `modest-use-253097.framer.app/sitemap.xml` | `/school-of-technology/guide/*` (hub itself excluded) |
| SSB guide | `reliable-course-598924.framer.app/sitemap.xml` | `/school-of-business/guide` + `/guide/*` incl. `/guide/category/*` |
| College Predictor | `www.scaler.com/school-of-technology/college-predictor/sitemap.xml` | `/school-of-technology/college-predictor*` (already on the brand domain, no rewrite) |

Filtering matches on the URL's **pathname**, not a substring of the whole URL.
That matters: the SSB Framer project also publishes
`/school-of-business/minimal-landing-v*` draft pages and a `/school-of-business-2/`
path, none of which belong in an SEO sitemap.

## Resilience

Each source is fetched independently and concurrently. If one fails — or returns
zero matching URLs — the build falls back to whatever URLs that source already
contributed to the on-disk `sitemap.xml`, so a transient upstream outage can
never silently shrink the brand sitemap. If *every* source fails the build
throws rather than writing an empty `urlset`, leaving the last good file in place.

Stale sources are logged and reported in `/_health` as `staleSources`, which also
flips `status` to `degraded`.

## How the automation works

Two redundant refresh paths:

1. **In-process (primary).** `server.mjs` regenerates the sitemap on boot and
   then every hour (`REFRESH_INTERVAL_MS`). The live file stays fresh with no
   redeploy needed, so a new guide article appears within the hour of going live.
2. **GitHub Actions (backup).** `.github/workflows/update-sitemap.yml` runs the
   same script hourly and commits `chore: update sitemap [skip ci]` if the file
   changed.

## URLs

All of these serve the same merged sitemap:

- `/sitemap.xml` — canonical
- `/scaler-guide-sitemap.xml` — accurate, school-neutral name
- `/scaler-school-of-technology-guide-sitemap.xml` — **the URL currently submitted to Google Search Console**; kept verbatim so that submission keeps working
- `/scaler-school-of-business-guide-sitemap.xml`

**Live:** https://scaler-sitemap-production.up.railway.app/scaler-school-of-technology-guide-sitemap.xml

Hosted on Railway, deployed from this repo's `main` branch. On every push to
`main`, Railway redeploys automatically.

`/_health` returns refresh status, per-source counts and any stale sources.

## Run locally

```bash
node scripts/fetch-and-rewrite.mjs   # write sitemap.xml once
npm start                            # serve on $PORT (default 3000)
```

No dependencies — uses built-in `fetch` (Node 20+).

## Manually trigger an update

GitHub → **Actions** → **Update sitemap** → **Run workflow**. Or just restart the
Railway service, which refreshes on boot.
