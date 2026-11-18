// api/v1/models.js
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();

  return res.status(200).json({
    object: 'list',
    data: [
      { id: 'ibrahim-khalil-v1', object: 'model', created: 1700000000, owned_by: 'ibrahim-khalil' }
    ]
  });
}