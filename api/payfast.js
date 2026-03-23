// PayFast Payment Initiator
// Creates signed payment data for a subscription checkout

import crypto from 'crypto';

const MERCHANT_ID  = process.env.PAYFAST_MERCHANT_ID;
const MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PASSPHRASE   = process.env.PAYFAST_PASSPHRASE || '';
const SANDBOX      = process.env.PAYFAST_SANDBOX === 'true';
const SITE_URL     = process.env.SITE_URL || 'https://onetouchtaxapp.vercel.app';

const PLANS = {
  pro:  { name: 'OneTouch Pro Plan',  amount: '299.00' },
  full: { name: 'OneTouch Full Plan', amount: '599.00' }
};

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
  const str = Object.keys(data)
    .filter(k => data[k] != null && data[k] !== '')
    .map(k => `${k}=${pfEncode(data[k])}`)
    .join('&');
  const full = passphrase ? `${str}&passphrase=${pfEncode(passphrase)}` : str;
  console.log('[PayFast] signature input:', full); // visible in Vercel function logs
  return crypto.createHash('md5').update(full).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { plan, userId, email, firstName } = req.body || {};

  if (!PLANS[plan])   return res.status(400).json({ error: 'Invalid plan. Must be pro or full.' });
  if (!userId)        return res.status(400).json({ error: 'Missing userId' });
  if (!email)         return res.status(400).json({ error: 'Missing email' });
  if (!MERCHANT_ID)   return res.status(500).json({ error: 'PayFast not configured on server' });

  const cfg       = PLANS[plan];
  const paymentId = `${plan.toUpperCase()}-${userId.slice(0, 8)}-${Date.now()}`;
  const today     = new Date().toISOString().split('T')[0];

  // Fields must be in this exact order — PayFast validates signature using received field order
  const data = {
    merchant_id:       MERCHANT_ID,
    merchant_key:      MERCHANT_KEY,
    return_url:        `${SITE_URL}/business.html?payment=success&plan=${plan}`,
    cancel_url:        `${SITE_URL}/business.html?payment=cancelled`,
    notify_url:        `${SITE_URL}/api/payfast-notify`,
    name_first:        (firstName || email.split('@')[0]).substring(0, 50),
    email_address:     email,
    m_payment_id:      paymentId,
    amount:            cfg.amount,
    item_name:         cfg.name,
    subscription_type: '1',
    billing_date:      today,
    recurring_amount:  cfg.amount,
    frequency:         '3',
    cycles:            '0',
    custom_str1:       userId,
    custom_str2:       plan,
  };

  console.log('[PayFast] merchant_id:', MERCHANT_ID);
  console.log('[PayFast] passphrase set:', !!PASSPHRASE);
  console.log('[PayFast] fields:', JSON.stringify(data));

  data.signature = generateSignature(data, PASSPHRASE);

  const pfUrl = SANDBOX
    ? 'https://sandbox.payfast.co.za/eng/process'
    : 'https://www.payfast.co.za/eng/process';

  return res.status(200).json({
    action: pfUrl,
    fields: data
  });
}
