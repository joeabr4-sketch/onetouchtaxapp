// OneTouch AI Proxy — Rate limiting + caching + cost protection
const DAILY_LIMIT = 20;
const CACHE_TTL = 3600000; // 1 hour

const rateLimitStore = {};
const cacheStore = {};

function getTodaySAST() {
  const sast = new Date(Date.now() + 2 * 3600000);
  return sast.toISOString().split('T')[0];
}

function getCacheKey(bodyStr) {
  try {
    const b = JSON.parse(bodyStr);
    const msg = b.messages?.[0]?.content || '';
    return (b.model || '') + '_' + msg.substring(0, 200);
  } catch { return null; }
}

function cleanCache() {
  const now = Date.now();
  Object.keys(cacheStore).forEach(k => {
    if (now - cacheStore[k].ts > CACHE_TTL) delete cacheStore[k];
  });
}

exports.handler = async function(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, x-user-id', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: { message: 'API key not configured' } }) };

  // ── RATE LIMIT ──
  const userId = event.headers['x-user-id'] || event.headers['x-forwarded-for'] || 'anon';
  const rlKey = userId + '_' + getTodaySAST();
  if (!rateLimitStore[rlKey]) rateLimitStore[rlKey] = 0;
  const used = rateLimitStore[rlKey];

  if (used >= DAILY_LIMIT) {
    return {
      statusCode: 429,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: { type: 'rate_limit', message: `Daily AI limit of ${DAILY_LIMIT} calls reached. Resets at midnight SAST.`, used, limit: DAILY_LIMIT } })
    };
  }

  // ── CACHE CHECK ──
  cleanCache();
  const cKey = getCacheKey(event.body);
  if (cKey && cacheStore[cKey]) {
    const age = Math.round((Date.now() - cacheStore[cKey].ts) / 60000);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'X-Cache': 'HIT', 'X-Cache-Age': age + 'm', 'X-Remaining-Today': String(DAILY_LIMIT - used) }, body: JSON.stringify(cacheStore[cKey].data) };
  }

  // ── CALL ANTHROPIC ──
  try {
    const body = JSON.parse(event.body);
    body.model = 'claude-sonnet-4-20250514';
    if (!body.max_tokens || body.max_tokens > 2000) body.max_tokens = 2000;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (res.ok) {
      rateLimitStore[rlKey]++;
      if (cKey) cacheStore[cKey] = { data, ts: Date.now() };
      const remaining = DAILY_LIMIT - rateLimitStore[rlKey];
      return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'X-Cache': 'MISS', 'X-Remaining-Today': String(remaining), 'X-Used-Today': String(rateLimitStore[rlKey]) }, body: JSON.stringify(data) };
    } else {
      return { statusCode: res.status, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) };
    }
  } catch (err) {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: { message: 'Proxy error: ' + err.message } }) };
  }
};
