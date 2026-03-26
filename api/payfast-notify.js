// PayFast IPN (Instant Payment Notification) handler
// PayFast POSTs here after every payment event — we verify and update the user's plan

import crypto from 'crypto';

const MERCHANT_ID  = process.env.PAYFAST_MERCHANT_ID;
const PASSPHRASE   = process.env.PAYFAST_PASSPHRASE || '';
const SUPABASE_URL = 'https://stcxldjcagyxjfwfforx.supabase.co';

// Matches PHP urlencode() — encodes ! ~ ' ( ) * which encodeURIComponent leaves unencoded
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

function generateSignature(data, passphrase) {
  let str = Object.keys(data)
    .filter(k => k !== 'signature' && data[k] != null && data[k] !== '')
    .map(k => `${k}=${pfEncode(data[k])}`)
    .join('&');
  if (passphrase) str += `&passphrase=${pfEncode(passphrase)}`;
  return crypto.createHash('md5').update(str).digest('hex');
}

const ALERT_EMAIL   = 'joeabr4@gmail.com';
const RESEND_URL    = 'https://api.resend.com/emails';

async function sendAlert(subject, details) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('PayFast IPN alert: RESEND_API_KEY not set — cannot send alert email');
    return;
  }
  const rows = Object.entries(details)
    .map(([k, v]) => `<tr><td style="padding:4px 8px;font-weight:bold;white-space:nowrap">${k}</td><td style="padding:4px 8px">${v ?? '(none)'}</td></tr>`)
    .join('');
  const html = `<h2 style="color:#c00">PayFast IPN Alert</h2>
<p><strong>${subject}</strong></p>
<table style="border-collapse:collapse;font-family:monospace;font-size:13px">${rows}</table>
<p style="color:#666;font-size:12px">OneTouch TaxApp — payfast-notify.js</p>`;
  try {
    await fetch(RESEND_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'OneTouch Alerts <noreply@onetouch.net.za>',
        to: [ALERT_EMAIL],
        subject: `[OneTouch] PayFast IPN: ${subject}`,
        html
      })
    });
  } catch (err) {
    console.error('PayFast IPN alert: failed to send email —', err.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const data = req.body || {};

  // 1 — Verify merchant
  if (data.merchant_id !== MERCHANT_ID) {
    console.error('PayFast IPN: merchant_id mismatch');
    await sendAlert('merchant_id mismatch', {
      received:   data.merchant_id,
      expected:   MERCHANT_ID,
      payment_id: data.m_payment_id,
      email:      data.email_address,
    });
    return res.status(400).send('Invalid merchant');
  }

  // 2 — Verify signature
  const expected = generateSignature(data, PASSPHRASE);
  if (data.signature !== expected) {
    console.error('PayFast IPN: signature mismatch', { received: data.signature, expected });
    await sendAlert('signature mismatch — possible misconfiguration or replay attack', {
      received:   data.signature,
      expected,
      payment_id: data.m_payment_id,
      email:      data.email_address,
    });
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
    await sendAlert('missing/invalid custom data — plan NOT updated', {
      userId,
      plan,
      payment_id: data.m_payment_id,
      amount:     data.amount_gross,
      email:      data.email_address,
    });
    return res.status(400).send('Invalid custom data');
  }

  // 4 — Update plan (and subscription token) in Supabase
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    console.error('PayFast IPN: SUPABASE_SERVICE_KEY not set');
    await sendAlert('SUPABASE_SERVICE_KEY missing — plan NOT updated', {
      userId,
      plan,
      payment_id: data.m_payment_id,
      amount:     data.amount_gross,
    });
    return res.status(500).send('Server config error');
  }

  // Store the subscription token so we can call the PayFast cancel API later.
  // `token` is only present for recurring/subscription payments.
  const profileUpdate = { plan };
  if (data.token) profileUpdate.payfast_token = data.token;

  const update = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify(profileUpdate)
  });

  if (!update.ok) {
    const err = await update.text();
    console.error('PayFast IPN: Supabase update failed', err);
    await sendAlert('Supabase update failed — plan NOT updated, user paid but still on old plan', {
      userId,
      plan,
      payment_id: data.m_payment_id,
      amount:     data.amount_gross,
      email:      data.email_address,
      db_error:   err,
    });
    return res.status(500).send('DB error');
  }

  console.log(`PayFast IPN: ${userId} upgraded to ${plan} — payment ${data.m_payment_id}${data.token ? ' — token stored' : ''}`);
  return res.status(200).send('OK');
}
