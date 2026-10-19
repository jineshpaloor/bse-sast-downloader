/**
 * Cloudflare Worker: CORS proxy for the BSE SAST API.
 *
 * Why: api.bseindia.com only accepts browser requests that come from bseindia.com,
 * and browsers won't let a GitHub Pages site fake the Origin/Referer headers.
 * This worker calls BSE server-side with the right headers and adds CORS headers
 * to the response so your page can read it.
 *
 * It ONLY forwards to the SAST endpoint (not an open proxy) and only the four
 * expected query parameters.
 *
 * Deploy: Cloudflare dashboard → Workers & Pages → Create → Worker → paste this → Deploy.
 * Then set ALLOWED_ORIGINS below to your GitHub Pages origin.
 */

const SAST_API_BASE_URL = 'https://api.bseindia.com/BseIndiaAPI/api/Corporatesast/w';

// Lock this down to your site, e.g. ['https://jineshpaloor.github.io']. '*' allows any site.
const ALLOWED_ORIGINS = ['*'];

const UPSTREAM_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  origin: 'https://www.bseindia.com',
  referer: 'https://www.bseindia.com/',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
};

const ALLOWED_PARAMS = ['ddlregul', 'fromdate', 'scripcode', 'todate'];

function corsHeaders(origin) {
  const allowAny = ALLOWED_ORIGINS.includes('*');
  const allowed = allowAny || ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowAny ? '*' : allowed ? origin : 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'accept, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });
    if (!ALLOWED_ORIGINS.includes('*') && origin && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Origin not allowed', { status: 403, headers: cors });
    }

    const inUrl = new URL(request.url);
    const out = new URL(SAST_API_BASE_URL);
    for (const p of ALLOWED_PARAMS) out.searchParams.set(p, inUrl.searchParams.get(p) ?? '');
    if (!out.searchParams.get('ddlregul')) out.searchParams.set('ddlregul', 'ALL');

    const dateOk = (d) => /^\d{8}$/.test(d);
    if (!dateOk(out.searchParams.get('fromdate')) || !dateOk(out.searchParams.get('todate'))) {
      return new Response(JSON.stringify({ error: 'fromdate and todate must be YYYYMMDD' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    try {
      // No caching: BSE sometimes returns [] transiently, and a cached [] would
      // keep coming back for that exact date range.
      const upstream = await fetch(out.toString(), {
        headers: UPSTREAM_HEADERS,
        cache: 'no-store',
      });
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: {
          ...cors,
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: `Upstream request failed: ${err.message}` }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  },
};
