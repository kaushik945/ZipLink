import { sqlTime } from '../validators/links.js';

export function redirectCache({ redis, config, logger, metrics }) {
  const pending = new Map();
  const key = (code) => `${config.prefix}:link:${code}`;
  return {
    async invalidate(code) {
      try {
        if (redis.isReady) await redis.del(key(code));
        else throw new Error('Redis unavailable');
      } catch {
        metrics.cacheInvalidationFailures++;
        logger.warn({ code }, 'Cache invalidation failed; TTL bounds stale data');
      }
    },
    async resolve(code, loader) {
      if (!config.cacheEnabled) return loader();
      try {
        if (redis.isReady) {
          const cached = await redis.get(key(code));
          if (cached !== null) {
            const row = JSON.parse(cached);
            metrics.cacheHits++;
            return row;
          }
        }
      } catch {
        metrics.cacheErrors++;
        logger.warn('Cache read failed; falling back to MySQL');
      }
      metrics.cacheMisses++;
      if (pending.has(code)) return pending.get(code);
      const promise = (async () => {
        const row = await loader();
        let ttl = row ? config.cacheTtl : config.negativeTtl;
        if (row?.expires_at)
          ttl = Math.min(
            ttl,
            Math.max(1, Math.floor((sqlTime(row.expires_at) - Date.now()) / 1000)),
          );
        try {
          if (redis.isReady) await redis.set(key(code), JSON.stringify(row), { EX: ttl });
        } catch {
          metrics.cacheErrors++;
          logger.warn('Cache population failed');
        }
        return row;
      })();
      // Bound single-flight bookkeeping; this is per process, not a distributed lock.
      if (pending.size < 1000) pending.set(code, promise);
      try {
        return await promise;
      } finally {
        if (pending.get(code) === promise) pending.delete(code);
      }
    },
  };
}
