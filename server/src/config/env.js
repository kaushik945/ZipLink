import 'dotenv/config';
import { assert } from '../utils/errors.js';

export function loadConfig(env = process.env) {
  assert(
    ['development', 'test', 'production'].includes(env.NODE_ENV || 'development'),
    500,
    'CONFIG',
    'NODE_ENV must be development, test or production',
  );
  const production = env.NODE_ENV === 'production';
  function integer(name, fallback, min = 1, max = 1000000) {
    const value = Number(env[name] ?? fallback);
    assert(
      Number.isSafeInteger(value) && value >= min && value <= max,
      500,
      'CONFIG',
      `Invalid ${name}`,
    );
    return value;
  }
  const secret = env.SESSION_SECRET;
  assert(
    typeof secret === 'string' &&
      secret.length >= 32 &&
      secret !== 'replace-with-a-random-secret-of-at-least-32-characters',
    500,
    'CONFIG',
    'SESSION_SECRET must contain at least 32 characters and must not be the example placeholder',
  );
  const origins = (env.FRONTEND_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim());
  for (const origin of origins) {
    const parsed = new URL(origin);
    assert(
      parsed.origin === origin &&
        ['http:', 'https:'].includes(parsed.protocol) &&
        (!production || parsed.protocol === 'https:'),
      500,
      'CONFIG',
      'FRONTEND_ORIGINS must contain exact origins (HTTPS in production)',
    );
  }
  const publicBaseUrl = env.PUBLIC_BASE_URL || 'http://localhost:5002';
  const publicUrl = new URL(publicBaseUrl);
  assert(
    publicUrl.origin === publicBaseUrl &&
      ['http:', 'https:'].includes(publicUrl.protocol) &&
      (!production || publicUrl.protocol === 'https:'),
    500,
    'CONFIG',
    'PUBLIC_BASE_URL must be an origin (HTTPS in production)',
  );
  const redisUrl = env.REDIS_URL || 'redis://127.0.0.1:6379';
  const redisAddress = new URL(redisUrl);
  assert(
    ['redis:', 'rediss:'].includes(redisAddress.protocol) &&
      redisAddress.hostname &&
      /^\/(?:\d+)?$/.test(redisAddress.pathname || '/'),
    500,
    'CONFIG',
    'Invalid REDIS_URL',
  );
  const prefix = env.REDIS_PREFIX || 'ziplink';
  assert(/^[a-zA-Z0-9_-]{1,40}$/.test(prefix), 500, 'CONFIG', 'Invalid REDIS_PREFIX');
  return {
    production,
    port: integer('PORT', 5002, 1, 65535),
    secret,
    origins,
    publicBaseUrl,
    redisUrl,
    prefix,
    trustProxy: env.TRUST_PROXY || false,
    sessionSeconds: integer('SESSION_TTL_SECONDS', 86400, 60, 604800),
    codeLength: integer('SHORT_CODE_LENGTH', 8, 6, 20),
    collisionRetries: integer('COLLISION_RETRIES', 5, 1, 20),
    cacheTtl: integer('CACHE_TTL_SECONDS', 60, 1, 3600),
    negativeTtl: integer('NEGATIVE_CACHE_TTL_SECONDS', 5, 1, 60),
    cacheEnabled: env.CACHE_ENABLED !== 'false',
    workerConcurrency: integer('WORKER_CONCURRENCY', 5, 1, 50),
    bcryptRounds: integer('BCRYPT_ROUNDS', 12, 10, 15),
    db: {
      host: env.DB_HOST || '127.0.0.1',
      port: integer('DB_PORT', 3306, 1, 65535),
      user: env.DB_USER || 'ziplink',
      password: env.DB_PASSWORD || '',
      database: env.DB_NAME || 'url_shortener',
      connectionLimit: integer('DB_POOL_SIZE', 10, 1, 100),
      connectTimeout: 5000,
      waitForConnections: true,
      queueLimit: 100,
      timezone: 'Z',
      dateStrings: true,
      charset: 'utf8mb4',
      enableKeepAlive: true,
    },
  };
}
