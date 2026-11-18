// api/admin/keys.js
import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const adminToken = process.env.ADMIN_TOKEN;
  const provided = req.headers['x-admin-token'] || '';
  if (!adminToken || provided !== adminToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // GET = list current keys (masked)
  if (req.method === 'GET') {
    let store = {};
    try { store = JSON.parse(process.env.API_KEYS || '{}'); } catch {}
    const masked = Object.entries(store).map(([k, v]) => ({
      key: k.slice(0, 10) + '...' + k.slice(-4),
      ...v
    }));
    return res.status(200).json({ keys: masked });
  }

  // POST = generate new key (needs manual env var update)
  if (req.method === 'POST') {
    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const { name, rpm } = body;
    const newKey = 'sk-' + crypto.randomBytes(24).toString('hex');
    return res.status(200).json({
      key: newKey,
      name: name || 'user',
      rpm: rpm || 20,
      instructions: 'Add this to the API_KEYS env var on Vercel manually (runtime env is read-only). Format: {"' + newKey + '": {"name":"' + (name || 'user') + '","rpm":' + (rpm || 20) + '}}'
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
