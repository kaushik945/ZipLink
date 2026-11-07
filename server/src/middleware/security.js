import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, assert } from '../utils/errors.js';

export function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = randomBytes(32).toString('hex');
  return req.session.csrf;
}
export function csrf(config) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    const received = req.get('x-csrf-token') || '';
    assert(!origin || config.origins.includes(origin), 403, 'CSRF', 'Origin is not allowed.');
    const actual = Buffer.from(received);
    const expected = Buffer.from(req.session?.csrf || '');
    assert(
      expected.length === 64 &&
        actual.length === expected.length &&
        timingSafeEqual(actual, expected),
      403,
      'CSRF',
      'Missing or invalid CSRF token. Refresh your session.',
    );
    next();
  };
}
export function requireAuth(req, res, next) {
  assert(req.session?.userId, 401, 'UNAUTHENTICATED', 'Sign in to manage links.');
  next();
}

export const RATE_SCRIPT = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('PTTL',KEYS[1])}`;
export function rateLimiter(
  { redis, config, logger, metrics },
  name,
  limit,
  seconds,
  publicTraffic = false,
) {
  return async (req, res, next) => {
    // Attempt limits stay IP-bound even after a login/registration rotates the user identity.
    const accountAttempt = name === 'login' || name === 'register';
    const identity =
      !publicTraffic && !accountAttempt && req.session?.userId
        ? `user:${req.session.userId}`
        : `ip:${req.ip}`;
    const digest = createHash('sha256').update(identity).digest('hex');
    try {
      if (!redis.isReady) throw new Error('Redis not ready');
      const [count, remainingMs] = await redis.eval(RATE_SCRIPT, {
        keys: [`${config.prefix}:rate:${name}:${digest}`],
        arguments: [String(seconds * 1000)],
      });
      res.set('RateLimit-Limit', String(limit));
      res.set('RateLimit-Remaining', String(Math.max(0, limit - count)));
      if (count > limit) {
        res.set('Retry-After', String(Math.max(1, Math.ceil(remainingMs / 1000))));
        return next(
          new AppError(429, 'RATE_LIMITED', 'Too many requests. Retry after the indicated delay.'),
        );
      }
      next();
    } catch {
      metrics.rateLimitErrors++;
      logger.warn({ policy: name }, 'Rate limiter unavailable');
      // Authentication and writes fail closed; public redirect availability is favored.
      next(
        publicTraffic
          ? undefined
          : new AppError(
              503,
              'RATE_LIMIT_UNAVAILABLE',
              'Security service unavailable. Please try again.',
            ),
      );
    }
  };
}
