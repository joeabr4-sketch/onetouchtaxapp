// OneTouch Email Proxy — powered by Resend
import { captureException } from './_sentry.js';
// Handles: accountant access emails, welcome emails, notifications

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // ── AUTH CHECK ──
  // Verify the caller is an authenticated Supabase user by checking their JWT
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  const supabaseUrl  = process.env.SUPABASE_URL || 'https://stcxldjcagyxjfwfforx.supabase.co';
  const supabaseAnon = process.env.SUPABASE_ANON_KEY;
  if (supabaseAnon) {
    try {
      // Verify JWT and get user id
      const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': supabaseAnon }
      });
      if (!authRes.ok) return res.status(401).json({ error: 'Unauthorised' });
      const user = await authRes.json();

      // Check plan — email delivery requires Full plan or trial (trial capped at 5)
      const profRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=plan,email_sent`,
        { headers: { 'Authorization': `Bearer ${token}`, 'apikey': supabaseAnon, 'Accept': 'application/json' } }
      );
      if (profRes.ok) {
        const rows = await profRes.json();
        const plan = rows[0]?.plan || 'free';
        const emailSent = rows[0]?.email_sent || 0;
        if (plan === 'trial' && emailSent >= 5) {
          return res.status(429).json({ error: { type: 'rate_limit', message: 'You\'ve used all 5 trial email sends. Upgrade to continue.', used: emailSent, limit: 5 } });
        }
        if (plan !== 'full' && plan !== 'trial') {
          return res.status(403).json({ error: { type: 'plan_required', message: 'Email delivery requires a Full plan.' } });
        }
      }
    } catch {
      return res.status(401).json({ error: 'Unauthorised' });
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Email service not configured' });

  const { to, subject, html, from } = req.body;

  // Validate required fields
  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(to)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: from || 'OneTouch TaxApp <noreply@onetouch.net.za>',
        to: [to],
        subject,
        html
      })
    });

    const data = await response.json();

    if (response.ok) {
      return res.status(200).json({ success: true, id: data.id });
    } else {
      console.error('Resend error:', data);
      return res.status(response.status).json({ error: data.message || 'Email sending failed' });
    }
  } catch (err) {
    await captureException(err, { to, subject });
    return res.status(500).json({ error: 'Email proxy error: ' + err.message });
  }
}
