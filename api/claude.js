// OneTouch AI Proxy — Supabase-backed rate limiting + in-memory caching + cost protection
const CACHE_TTL = 3600000; // 1 hour
const cacheStore = {};

const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://stcxldjcagyxjfwfforx.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;

function getTodayMonthSAST() {
  // Returns YYYY-MM in SAST (UTC+2)
  return new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 7);
}

function getCacheKey(body) {
  try {
    const msgs = body.messages || [];
    // Use the last message as cache key — messages[0] is always the same first
    // history entry, causing every reply in a conversation to return the cached first response
    const lastMsg = msgs[msgs.length - 1]?.content || '';
    return (body.model || '') + '_' + lastMsg.substring(0, 200);
  } catch { return null; }
}

function cleanCache() {
  const now = Date.now();
  Object.keys(cacheStore).forEach(k => {
    if (now - cacheStore[k].ts > CACHE_TTL) delete cacheStore[k];
  });
}

// Verify JWT and return user object, or null on failure
async function verifySupabaseJWT(token) {
  if (!token || !SUPABASE_ANON) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON }
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Read profile row using the user's own JWT (passes RLS)
async function getProfile(token, userId) {
  if (!SUPABASE_ANON) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=plan,ai_calls,ai_calls_month`,
      { headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON, 'Accept': 'application/json' } }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    return rows[0] || null;
  } catch { return null; }
}

// Increment ai_calls counter (fire-and-forget is fine here — worst case it under-counts by 1)
function incrementAICalls(token, userId, newCount, monthKey) {
  if (!SUPABASE_ANON) return;
  fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_ANON,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ ai_calls: newCount, ai_calls_month: monthKey })
  }).catch(e => console.warn('AI call counter update failed:', e.message));
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'API key not configured' } });

  // ── AUTH + RATE LIMIT ──
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  let aiCallsUsed = 0;
  let plan = 'free';
  let userId = req.headers['x-user-id'] || 'anon'; // fallback for cache key only
  const monthKey = getTodayMonthSAST();

  if (token && SUPABASE_ANON) {
    const user = await verifySupabaseJWT(token);
    if (!user) return res.status(401).json({ error: { message: 'Unauthorised' } });

    userId = user.id;
    const profile = await getProfile(token, userId);

    if (profile) {
      plan = profile.plan || 'free';
      // Reset counter if we've rolled into a new month
      aiCallsUsed = (profile.ai_calls_month === monthKey) ? (profile.ai_calls || 0) : 0;
    }

    // Enforce per-plan limits
    if (plan === 'free') {
      return res.status(403).json({
        error: { type: 'plan_required', message: 'AI assistant requires a Pro or Full plan.' }
      });
    }
    if (plan === 'pro' && aiCallsUsed >= 10) {
      return res.status(429).json({
        error: { type: 'rate_limit', message: 'You\'ve used all 10 AI calls this month. Resets on the 1st.', used: aiCallsUsed, limit: 10 }
      });
    }
    // 'full' plan: soft warn at 200 via client-side; no hard server block
  }

  // ── CACHE CHECK ──
  cleanCache();
  const body = req.body;
  const cKey = getCacheKey(body);
  if (cKey && cacheStore[cKey]) {
    const age = Math.round((Date.now() - cacheStore[cKey].ts) / 60000);
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('X-Cache-Age', age + 'm');
    return res.status(200).json(cacheStore[cKey].data);
  }

  // ── CALL ANTHROPIC ──
  try {
    body.model = 'claude-haiku-4-5-20251001';
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
      if (cKey) cacheStore[cKey] = { data, ts: Date.now() };
      // Increment Supabase counter (non-blocking)
      if (token && SUPABASE_ANON) {
        incrementAICalls(token, userId, aiCallsUsed + 1, monthKey);
      }
      res.setHeader('X-Cache', 'MISS');
      return res.status(200).json(data);
    } else {
      return res.status(response.status).json(data);
    }
  } catch (err) {
    return res.status(500).json({ error: { message: 'Proxy error: ' + err.message } });
  }
}
