// PayFast subscription cancellation endpoint
// Called by the in-app cancel flow — fetches the user's stored subscription
// token and calls the PayFast cancel API on their behalf.

import crypto from 'crypto';
import { captureException } from './_sentry.js';

const MERCHANT_ID  = process.env.PAYFAST_MERCHANT_ID;
const MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PASSPHRASE   = process.env.PAYFAST_PASSPHRASE || '';
const SUPABASE_URL = 'https://stcxldjcagyxjfwfforx.supabase.co';
const PF_API_BASE  = 'https://api.payfast.co.za';

function pfEncode(val) {
  return encodeURIComponent(String(val).trim())
    .replace(/!/g,  '%21')
    .replace(/'/g,  '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/~/g,  '%7E')
    .replace(/%20/g, '+');
}

// PayFast API auth headers — required for all subscription API calls
function pfApiHeaders(timestamp) {
  const data = {
    'merchant-id': MERCHANT_ID,
    version:       'v1',
    timestamp,
  };
  let str = Object.keys(data)
    .map(k => `${k}=${pfEncode(data[k])}`)
    .join('&');
  if (PASSPHRASE) str += `&passphrase=${pfEncode(PASSPHRASE)}`;
  const signature = crypto.createHash('md5').update(str).digest('hex');
  return {
    'merchant-id': MERCHANT_ID,
    version:       'v1',
    timestamp,
    signature,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Authenticate — require a valid Supabase JWT
  const authHeader = req.headers.authorization || '';
  const jwt = authHeader.replace('Bearer ', '').trim();
  if (!jwt) return res.status(401).json({ error: 'Unauthorised' });

  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'Server config error' });

  // Verify token and get user
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${jwt}` }
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });
  const { id: userId } = await userRes.json();

  // Fetch the stored PayFast subscription token for this user
  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=payfast_token,plan`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
  });
  if (!profRes.ok) {
    console.error(`payfast-cancel: failed to fetch profile for user ${userId}`, profRes.status);
    return res.status(502).json({ error: 'Failed to retrieve subscription details' });
  }
  const profiles = await profRes.json();
  const profile  = profiles?.[0];

  if (!profile?.payfast_token) {
    // No token stored — user may have subscribed before token-saving was live,
    // or their plan was set manually. Fall back to the manual support process.
    console.warn(`payfast-cancel: no token for user ${userId} — manual cancel required`);
    return res.status(200).json({ method: 'manual', message: 'No subscription token found — cancellation request sent to support.' });
  }

  const token    = profile.payfast_token;
  const timestamp = new Date().toISOString().replace('T', 'T').split('.')[0]; // ISO 8601 no ms

  // Call PayFast cancel API
  const pfRes = await fetch(`${PF_API_BASE}/subscriptions/${token}/cancel`, {
    method: 'PUT',
    headers: {
      ...pfApiHeaders(timestamp),
      'Content-Type': 'application/json',
    }
  });

  if (!pfRes.ok) {
    const errText = await pfRes.text();
    console.error(`payfast-cancel: PayFast API error ${pfRes.status}`, errText);
    await captureException(new Error(`PayFast cancel API error ${pfRes.status}`), { userId, token, detail: errText });
    return res.status(502).json({ error: 'PayFast API error', detail: errText });
  }

  // Clear the stored token in Supabase
  // Note: keep plan as-is — it stays active until billing period ends.
  // PayFast will send an IPN with payment_status=CANCELLED when it lapses.
  const clearRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ payfast_token: null })
  });
  if (!clearRes.ok) {
    const errText = await clearRes.text();
    console.error(`payfast-cancel: profile token clear failed for user ${userId}`, errText);
    await captureException(new Error('PayFast token clear failed after cancel'), { userId, detail: errText });
    // PayFast cancel succeeded — still return success but flag the issue
    return res.status(200).json({ method: 'api', message: 'Subscription cancelled with PayFast. Token cleanup failed — contact support if issues arise.', tokenCleared: false });
  }

  console.log(`payfast-cancel: subscription cancelled for user ${userId}, token ${token}`);
  return res.status(200).json({ method: 'api', message: 'Subscription cancelled with PayFast.', tokenCleared: true });
}
