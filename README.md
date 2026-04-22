# Scaler Guide Sitemap

An automated XML sitemap mirror for Scaler's `/school-of-technology/guide/*` pages, for SEO.

## Why this exists

Scaler's guide pages at `https://www.scaler.com/school-of-technology/guide/*` are served via reverse proxy from Framer (`modest-use-253097.framer.app`). Framer auto-generates a sitemap, but it lives on the Framer domain — Google Search Console needs a sitemap hosted under the `scaler.com` brand domain.

This repo fetches the Framer sitemap, rewrites URLs to `https://www.scaler.com`, filters to just the guide pages, and hosts the rewritten `sitemap.xml` via GitHub Pages.

## How the automation works

A GitHub Actions workflow (`.github/workflows/update-sitemap.yml`) runs hourly:

1. Fetches `https://modest-use-253097.framer.app/sitemap.xml`
2. Extracts every `<loc>` URL
3. Keeps only URLs containing `/school-of-technology/guide/`, excluding the `/guide` hub page itself
4. Rewrites the domain from `modest-use-253097.framer.app` to `www.scaler.com`
5. Sorts alphabetically, writes `sitemap.xml` with today's date as `<lastmod>`
6. Commits and pushes only if `sitemap.xml` changed

Commit messages include `[skip ci]` so the commit does not re-trigger other CI.

## Manually trigger an update

Go to the **Actions** tab in GitHub → **Update sitemap** → **Run workflow**.

## Run locally

```bash
node scripts/fetch-and-rewrite.mjs
```

No dependencies required — uses built-in `fetch` (Node 20+).

## Live sitemap URL

_TBD — will be filled in after GitHub Pages is enabled._

Expected: `https://<github-username>.github.io/scaler-sitemap/sitemap.xml`
