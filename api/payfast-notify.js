// PayFast IPN (Instant Payment Notification) handler
// PayFast POSTs here after every payment event — we verify and update the user's plan

import crypto from 'crypto';

const MERCHANT_ID  = process.env.PAYFAST_MERCHANT_ID;
const PASSPHRASE   = process.env.PAYFAST_PASSPHRASE || '';
const SUPABASE_URL = 'https://stcxldjcagyxjfwfforx.supabase.co';

function generateSignature(data, passphrase) {
  let str = Object.keys(data)
    .filter(k => k !== 'signature' && data[k] !== '')
    .map(k => `${k}=${encodeURIComponent(String(data[k]).trim()).replace(/%20/g, '+')}`)
    .join('&');
  if (passphrase) str += `&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, '+')}`;
  return crypto.createHash('md5').update(str).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const data = req.body || {};

  // 1 — Verify merchant
  if (data.merchant_id !== MERCHANT_ID) {
    console.error('PayFast IPN: merchant_id mismatch');
    return res.status(400).send('Invalid merchant');
  }

  // 2 — Verify signature
  const expected = generateSignature(data, PASSPHRASE);
  if (data.signature !== expected) {
    console.error('PayFast IPN: signature mismatch', { received: data.signature, expected });
    return res.status(400).send('Invalid signature');
  }

  // 3 — Only act on COMPLETE payments
  if (data.payment_status !== 'COMPLETE') {
    console.log('PayFast IPN: status =', data.payment_status, '— no action');
    return res.status(200).send('OK');
  }

  const userId = data.custom_str1;
  const plan   = data.custom_str2;

  if (!userId || !['pro','full'].includes(plan)) {
    console.error('PayFast IPN: missing/invalid custom data', { userId, plan });
    return res.status(400).send('Invalid custom data');
  }

  // 4 — Update plan in Supabase
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    console.error('PayFast IPN: SUPABASE_SERVICE_KEY not set');
    return res.status(500).send('Server config error');
  }

  const update = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ plan })
  });

  if (!update.ok) {
    const err = await update.text();
    console.error('PayFast IPN: Supabase update failed', err);
    return res.status(500).send('DB error');
  }

  console.log(`PayFast IPN: ${userId} upgraded to ${plan} — payment ${data.m_payment_id}`);
  return res.status(200).send('OK');
}
