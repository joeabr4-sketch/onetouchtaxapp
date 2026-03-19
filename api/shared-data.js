// Shared Financials Data Proxy
// Uses service role key to bypass RLS — returns profile + invoices + recon for a share token

const SUPABASE_URL = 'https://stcxldjcagyxjfwfforx.supabase.co';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Server not configured' });

  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const headers = {
    'Content-Type': 'application/json',
    'apikey': serviceKey,
    'Authorization': 'Bearer ' + serviceKey
  };

  try {
    // Look up profile by share_token
    const profileRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?share_token=eq.${encodeURIComponent(token)}&select=id,biz_name,owner_name,share_token_expiry,vat_registered,vat_number,is_provisional,has_paye&limit=1`,
      { headers }
    );
    const profiles = await profileRes.json();
    if (!profileRes.ok || !profiles.length) {
      return res.status(404).json({ error: 'not_found' });
    }
    const profile = profiles[0];

    // Check expiry
    if (profile.share_token_expiry && new Date(profile.share_token_expiry) < new Date()) {
      return res.status(410).json({ error: 'expired', expiry: profile.share_token_expiry });
    }

    // Fetch invoices
    const invoicesRes = await fetch(
      `${SUPABASE_URL}/rest/v1/invoices?user_id=eq.${profile.id}&order=date.desc&select=*`,
      { headers }
    );
    const invoices = invoicesRes.ok ? await invoicesRes.json() : [];

    // Fetch best recon session — prefer highest confidence (closed month), fall back to most recent
    const reconRes = await fetch(
      `${SUPABASE_URL}/rest/v1/reconciliation_sessions?user_id=eq.${profile.id}&order=confidence.desc,created_at.desc&limit=1&select=*`,
      { headers }
    );
    const reconRows = reconRes.ok ? await reconRes.json() : [];

    return res.status(200).json({
      profile,
      invoices: Array.isArray(invoices) ? invoices : [],
      recon_session: reconRows[0] || null
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
}
