# BSE SAST Downloader

A single-page web app that fetches SAST (Substantial Acquisition of Shares & Takeovers) disclosures from BSE India and exports them as CSV. It's a browser port of the original Python script, with the same fields, retry policy, and defaults.

**Live app:** https://jineshpaloor.github.io/bse-sast-downloader/ (after enabling GitHub Pages)

## Files

| File | Purpose |
|---|---|
| `index.html` | The whole app: HTML, CSS and JS in one file. Served by GitHub Pages. |
| `worker.js` | A small Cloudflare Worker that acts as a CORS proxy to the BSE API. |

## Why a proxy is needed

The Python script sets `origin: https://www.bseindia.com` and `referer` headers. Browsers don't let a page set those, and BSE's API doesn't send CORS headers for other sites, so a page on `*.github.io` can't call it directly. The worker makes the request server-side with the right headers and returns the JSON with CORS enabled. It only forwards to the SAST endpoint, so it isn't an open proxy.

## Setup

### 1. Deploy the proxy (about 2 minutes, free tier)

1. Sign in at <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Create Worker**.
2. Name it (e.g. `sast-proxy`), click **Deploy**, then **Edit code**.
3. Replace the code with the contents of `worker.js` and click **Deploy**.
4. Copy the URL, e.g. `https://sast-proxy.<your-subdomain>.workers.dev`.
5. (Recommended) Set `ALLOWED_ORIGINS = ['https://jineshpaloor.github.io']` in the worker and redeploy.

Or use the CLI: `npm i -g wrangler && wrangler deploy worker.js --name sast-proxy`.

### 2. Enable GitHub Pages

Repo **Settings** → **Pages** → Source: **Deploy from a branch** → `main` / `(root)` → **Save**.

### 3. Use it

1. Open **Proxy settings** and paste the worker URL (it's remembered in your browser).
2. Choose the date range (defaults to 1 January of this year through today) and an optional scrip code.
3. Click **Fetch data**, check the preview, then **Download CSV** → `sast_YYYYMMDD_YYYYMMDD.csv`.

## Notes

- **Retries:** 5 retries with exponential backoff (1s, 2s, 4s, 8s, 16s) on 429/500/502/503/504, matching the Python `Retry` config. Timeout is 30s.
- **CSV:** same 14 columns and order as the script. Empty values become blank cells, and the file is UTF-8 with a BOM so Excel opens it cleanly.
- **Preview:** the table shows the first 500 rows. The CSV always has every row.
- BSE may change or rate-limit this unofficial endpoint. If requests start failing with 401/403, the worker's headers may need updating.
