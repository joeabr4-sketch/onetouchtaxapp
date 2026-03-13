export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
