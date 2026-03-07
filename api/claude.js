// OneTouch AI Proxy — Rate limiting + caching + cost protection
const DAILY_LIMIT = 20;
const CACHE_TTL = 3600000; // 1 hour

const rateLimitStore = {};
const cacheStore = {};

function getTodaySAST() {
  const sast = new Date(Date.now() + 2 * 3600000);
  return sast.toISOString().split('T')[0];
}

function getCacheKey(body) {
  try {
    const msg = body.messages?.[0]?.content || '';
    return (body.model || '') + '_' + msg.substring(0, 200);
  } catch { return null; }
}

function cleanCache() {
  const now = Date.now();
  Object.keys(cacheStore).forEach(k => {
    if (now - cacheStore[k].ts > CACHE_TTL) delete cacheStore[k];
  });
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-user-id');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  // CORS preflight
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'API key not configured' } });

  // ── RATE LIMIT ──
  const userId = req.headers['x-user-id'] || req.headers['x-forwarded-for'] || 'anon';
  const rlKey = userId + '_' + getTodaySAST();
  if (!rateLimitStore[rlKey]) rateLimitStore[rlKey] = 0;
  const used = rateLimitStore[rlKey];

  if (used >= DAILY_LIMIT) {
    return res.status(429).json({
      error: { type: 'rate_limit', message: `Daily AI limit of ${DAILY_LIMIT} calls reached. Resets at midnight SAST.`, used, limit: DAILY_LIMIT }
    });
  }

  // ── CACHE CHECK ──
  cleanCache();
  const body = req.body;
  const cKey = getCacheKey(body);
  if (cKey && cacheStore[cKey]) {
    const age = Math.round((Date.now() - cacheStore[cKey].ts) / 60000);
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('X-Cache-Age', age + 'm');
    res.setHeader('X-Remaining-Today', String(DAILY_LIMIT - used));
    return res.status(200).json(cacheStore[cKey].data);
  }

  // ── CALL ANTHROPIC ──
  try {
    body.model = 'claude-sonnet-4-20250514';
    if (!body.max_tokens || body.max_tokens > 3000) body.max_tokens = 3000;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (response.ok) {
      rateLimitStore[rlKey]++;
      if (cKey) cacheStore[cKey] = { data, ts: Date.now() };
      const remaining = DAILY_LIMIT - rateLimitStore[rlKey];
      res.setHeader('X-Cache', 'MISS');
      res.setHeader('X-Remaining-Today', String(remaining));
      res.setHeader('X-Used-Today', String(rateLimitStore[rlKey]));
      return res.status(200).json(data);
    } else {
      return res.status(response.status).json(data);
    }
  } catch (err) {
    return res.status(500).json({ error: { message: 'Proxy error: ' + err.message } });
  }
}
