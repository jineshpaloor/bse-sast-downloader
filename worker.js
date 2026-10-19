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
 * Every request must carry an `x-access-key` header matching the ACCESS_KEY secret.
 *
 * Deploy: Cloudflare dashboard → Workers & Pages → Create → Worker → paste this → Deploy.
 * Then add the ACCESS_KEY secret under Settings → Variables and Secrets.
 */

const SAST_API_BASE_URL = 'https://api.bseindia.com/BseIndiaAPI/api/Corporatesast/w';

// Only your GitHub Pages site may call this worker from a browser.
const ALLOWED_ORIGINS = ['https://jineshpaloor.github.io'];

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
    'Access-Control-Allow-Headers': 'accept, content-type, x-access-key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// Constant-time string comparison so the key can't be guessed via response timing.
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const json = (obj, status, cors) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });
    if (!ALLOWED_ORIGINS.includes('*') && origin && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response('Origin not allowed', { status: 403, headers: cors });
    }

    // Access key check. Set it in Cloudflare: Worker → Settings → Variables and Secrets →
    // Add → type "Secret", name ACCESS_KEY. Fails closed if the secret isn't set.
    if (!env.ACCESS_KEY) return json({ error: 'Server not configured: ACCESS_KEY secret missing' }, 500, cors);
    const given = request.headers.get('x-access-key') || '';
    if (!given || !(await safeEqual(given, env.ACCESS_KEY))) {
      return json({ error: 'Invalid or missing access key' }, 401, cors);
    }

    const inUrl = new URL(request.url);
    const out = new URL(SAST_API_BASE_URL);
    for (const p of ALLOWED_PARAMS) out.searchParams.set(p, inUrl.searchParams.get(p) ?? '');
    if (!out.searchParams.get('ddlregul')) out.searchParams.set('ddlregul', 'ALL');

    const dateOk = (d) => /^\d{8}$/.test(d);
    if (!dateOk(out.searchParams.get('fromdate')) || !dateOk(out.searchParams.get('todate'))) {
      return json({ error: 'fromdate and todate must be YYYYMMDD' }, 400, cors);
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
      return json({ error: `Upstream request failed: ${err.message}` }, 502, cors);
    }
  },
};
