// Shared CORS helper — restricts API access to known app origins
const ALLOWED_ORIGINS = [
  'https://onetouchtaxapp.vercel.app',
  'https://onetouch.net.za',
  'https://www.onetouch.net.za'
];

export function setCors(req, res, methods = 'POST, OPTIONS') {
  const origin = req.headers.origin || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id');
  res.setHeader('Access-Control-Allow-Methods', methods);
}
