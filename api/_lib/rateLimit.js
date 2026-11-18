// api/_lib/rateLimit.js
// Upstash Redis থাকলে distributed, না থাকলে in-memory (per-instance — caveat নিচে)

const memory = new Map();

export async function checkRateLimit(keyId, limitPerMin) {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  // --- Upstash Redis (recommended for production) ---
  if (redisUrl && redisToken) {
    const windowKey = `rl:${keyId}:${Math.floor(Date.now() / 60000)}`;
    try {
      const incrRes = await fetch(`${redisUrl}/incr/${windowKey}`, {
        headers: { Authorization: `Bearer ${redisToken}` }
      });
      const { result: count } = await incrRes.json();
      if (count === 1) {
        await fetch(`${redisUrl}/expire/${windowKey}/60`, {
          headers: { Authorization: `Bearer ${redisToken}` }
        });
      }
      return {
        allowed: count <= limitPerMin,
        remaining: Math.max(0, limitPerMin - count),
        backend: 'redis'
      };
    } catch (e) {
      // Redis fail হলে in-memory-তে fall back
    }
  }

  // --- In-memory (dev / no Upstash) ---
  const now = Date.now();
  const windowKey = `${keyId}:${Math.floor(now / 60000)}`;
  const entry = memory.get(windowKey) || { count: 0, expires: now + 60000 };
  entry.count++;
  memory.set(windowKey, entry);

  for (const [k, v] of memory) {
    if (v.expires < now) memory.delete(k);
  }

  return {
    allowed: entry.count <= limitPerMin,
    remaining: Math.max(0, limitPerMin - entry.count),
    backend: 'memory'
  };
}