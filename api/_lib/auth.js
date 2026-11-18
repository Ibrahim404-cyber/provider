// api/_lib/auth.js
// API_KEYS env var (JSON): {"sk-xxxx": {"name": "user1", "rpm": 20}, ...}

export function getKeyStore() {
  try {
    return JSON.parse(process.env.API_KEYS || '{}');
  } catch (e) {
    return {};
  }
}

function extractKey(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return (req.headers['x-api-key'] || '').trim();
}

export function verifyKey(req) {
  const key = extractKey(req);
  if (!key) return { ok: false, code: 401, error: 'Missing API key. Send Authorization: Bearer sk-... or x-api-key header.' };

  const store = getKeyStore();
  const info = store[key];
  if (!info) return { ok: false, code: 401, error: 'Invalid API key.' };

  return { ok: true, key, info };
}
