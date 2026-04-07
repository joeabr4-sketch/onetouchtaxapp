export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── AUTH + PLAN CHECK ──
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Unauthorised' });

  const supabaseUrl  = process.env.SUPABASE_URL || 'https://stcxldjcagyxjfwfforx.supabase.co';
  const supabaseAnon = process.env.SUPABASE_ANON_KEY;
  if (supabaseAnon) {
    try {
      const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { 'Authorization': `Bearer ${token}`, 'apikey': supabaseAnon }
      });
      if (!authRes.ok) return res.status(401).json({ error: 'Unauthorised' });
      const user = await authRes.json();

      // WhatsApp delivery requires Full plan or trial (trial capped at 5)
      const profRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=plan,whatsapp_sent`,
        { headers: { 'Authorization': `Bearer ${token}`, 'apikey': supabaseAnon, 'Accept': 'application/json' } }
      );
      if (profRes.ok) {
        const rows = await profRes.json();
        const plan = rows[0]?.plan || 'free';
        const waSent = rows[0]?.whatsapp_sent || 0;
        if (plan === 'trial' && waSent >= 5) {
          return res.status(429).json({ error: { type: 'rate_limit', message: 'You\'ve used all 5 trial WhatsApp sends. Upgrade to continue.', used: waSent, limit: 5 } });
        }
        if (plan !== 'full' && plan !== 'trial') {
          return res.status(403).json({ error: { type: 'plan_required', message: 'WhatsApp delivery requires a Full plan.' } });
        }
      }
    } catch {
      return res.status(401).json({ error: 'Unauthorised' });
    }
  }

  const { to, clientName, invoiceNumber, amount, dueDate, businessName, invoiceUrl, docType } = req.body;

  if (!to || !invoiceNumber || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_WHATSAPP_NUMBER; // whatsapp:+14155238886

  if (!accountSid || !authToken || !from) {
    return res.status(500).json({ error: 'Twilio credentials not configured' });
  }

  const type = docType === 'quote' ? 'Quote' : 'Invoice';
  const due  = dueDate ? `\nDue date: ${dueDate}` : '';

  const body =
`Hello ${clientName || 'there'} 👋

You have received a new ${type} from *${businessName}*.

📄 *${type} #${invoiceNumber}*
💰 Amount: *${amount}*${due}

${invoiceUrl ? `View your ${type.toLowerCase()} here:\n${invoiceUrl}` : ''}

Please don't hesitate to reach out if you have any questions.

_Sent via OneTouch TaxApp_`;

  try {
    const toNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;

    const params = new URLSearchParams();
    params.append('From', from);
    params.append('To', toNumber);
    params.append('Body', body);

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Twilio error:', data);
      return res.status(response.status).json({ error: data.message || 'Twilio error' });
    }

    return res.status(200).json({ success: true, sid: data.sid });

  } catch (err) {
    console.error('WhatsApp send error:', err);
    return res.status(500).json({ error: err.message });
  }
}
