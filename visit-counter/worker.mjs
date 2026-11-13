const VISITOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VISITOR_ID_BYTES = 36;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function response(status, headers = {}) {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

async function readVisitorId(request) {
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength !== null && Number(declaredLength) !== VISITOR_ID_BYTES) return;
  const reader = request.body?.getReader();
  if (!reader) return;
  const bytes = new Uint8Array(VISITOR_ID_BYTES);
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (length + value.length > bytes.length) return;
      bytes.set(value, length);
      length += value.length;
    }
    if (length !== bytes.length) return;
    const id = decoder.decode(bytes);
    return VISITOR_ID.test(id) ? id.toLowerCase() : undefined;
  } catch {
    return;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function visitorKey(id, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, encoder.encode(id));
}

async function authorized(request, token) {
  const supplied = request.headers.get('Authorization') || '';
  if (!token || !supplied.startsWith('Bearer ') || supplied.length > 512) return false;
  const digest = value => crypto.subtle.digest('SHA-256', encoder.encode(value));
  const [expected, actual] = await Promise.all([digest(token), digest(supplied.slice(7))]);
  const expectedBytes = new Uint8Array(expected);
  const actualBytes = new Uint8Array(actual);
  let difference = 0;
  for (let i = 0; i < expectedBytes.length; i++) difference |= expectedBytes[i] ^ actualBytes[i];
  return difference === 0;
}

async function recordVisit(request, env) {
  const origin = request.headers.get('Origin');
  if (!env.SITE_ORIGIN || origin !== env.SITE_ORIGIN) return response(403, { Vary: 'Origin' });
  const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };

  if (request.method === 'OPTIONS') {
    return response(204, { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' });
  }
  if (request.method !== 'POST') return response(405, { ...cors, Allow: 'POST, OPTIONS' });
  if (request.headers.get('Sec-GPC') === '1' || request.headers.get('DNT') === '1') return response(204, cors);
  if (request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !== 'text/plain') {
    return response(415, cors);
  }
  const id = await readVisitorId(request);
  if (!id) return response(400, cors);
  if (!env.COUNTER_DB || !env.VISITOR_KEY || env.VISITOR_KEY.length < 32) return response(503, cors);

  try {
    const key = await visitorKey(id, env.VISITOR_KEY);
    // D1 executes the batch as a single transaction.
    await env.COUNTER_DB.batch([
      env.COUNTER_DB.prepare('INSERT INTO visitors (visitor_key) VALUES (?) ON CONFLICT DO NOTHING').bind(key),
      env.COUNTER_DB.prepare('UPDATE counters SET total_visits = total_visits + 1 WHERE id = 1'),
    ]);
    return response(204, cors);
  } catch {
    return response(503, cors);
  }
}

async function readTotals(request, env) {
  if (request.method !== 'GET') return response(405, { Allow: 'GET' });
  if (!await authorized(request, env.TOTALS_TOKEN)) return response(401, { 'WWW-Authenticate': 'Bearer' });
  try {
    const totals = await env.COUNTER_DB.prepare(`
      SELECT total_visits AS totalVisits, (SELECT COUNT(*) FROM visitors) AS uniqueVisitors
      FROM counters WHERE id = 1
    `).first();
    if (!totals) return response(503);
    return Response.json(totals, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return response(503);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/visit') return recordVisit(request, env);
    if (pathname === '/totals') return readTotals(request, env);
    return response(404);
  },
};
