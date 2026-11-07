import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, BASE62 } from '../src/utils/codes.js';
import { normalizeUrl, alias, linkInput, listInput } from '../src/validators/links.js';
import { credentials } from '../src/validators/auth.js';
import { dateRange } from '../src/repositories/analytics.js';
import { linkService } from '../src/services/links.js';
import { redirectCache } from '../src/services/cache.js';
import { safeMetadata, validateEvent } from '../src/validators/events.js';
import { clickProducer } from '../src/queues/analytics.js';
import { randomUUID } from 'node:crypto';
import { rateLimiter } from '../src/middleware/security.js';
import { config, logger, counters, memoryRepository, noCache } from './helpers.js';

test('Base62 uses crypto randomInt bounds, full alphabet, and configured length', () => {
  let next = 0;
  assert.equal(
    generateCode(40, (bound) => {
      assert.equal(bound, 62);
      return next++ % 62;
    }),
    BASE62.slice(0, 40),
  );
  for (let i = 0; i < 100; i++) assert.match(generateCode(), /^[A-Za-z0-9]{8}$/);
  assert.throws(() => generateCode(0), RangeError);
});
test('URL normalization retains path/query/fragment semantics and normalizes host/default port', () => {
  assert.equal(
    normalizeUrl('HTTPS://Example.COM:443/a?b=2&b=1#section'),
    'https://example.com/a?b=2&b=1#section',
  );
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com/');
});
for (const value of [
  'javascript:alert(1)',
  'ftp://example.com',
  'https://user:pass@example.com',
  'http://localhost',
  'http://127.0.0.1',
  'http://[::1]',
  'http://2130706433',
  'http://host.internal',
  'https://example.com/\nfoo',
  'x'.repeat(4097),
  null,
  {},
  'https://example.com\\evil',
]) {
  test(`reject unsafe URL ${JSON.stringify(value).slice(0, 60)}`, () =>
    assert.throws(() => normalizeUrl(value), { status: 400 }));
}
test('aliases are case sensitive and system names reserved regardless of case', () => {
  assert.equal(alias('Launch'), 'Launch');
  assert.equal(alias('launch'), 'launch');
  for (const value of ['API', 'health', 'a', 'bad alias', 'a/b']) assert.throws(() => alias(value));
});
test('strict link payload and date validation', () => {
  assert.throws(() => linkInput({ user_id: 1 }, true));
  assert.throws(() => linkInput({}, true));
  assert.throws(() => linkInput({ enabled: 'true' }, true));
  assert.throws(() => linkInput({ expiresAt: '2020-01-01T00:00:00Z' }, true));
  assert.equal(linkInput({ expiresAt: null }, true).expires_at, null);
  assert.equal(
    linkInput({ originalUrl: 'https://example.com' }).original_url,
    'https://example.com/',
  );
});
test('pagination limits, malformed cursor, filters, date ranges and credentials', () => {
  assert.equal(listInput({ limit: '100' }).limit, 100);
  for (const value of ['0', '101', '1.2', 'abc']) assert.throws(() => listInput({ limit: value }));
  assert.throws(() => listInput({ cursor: 'not-json' }));
  assert.throws(() => listInput({ cursor: Buffer.from('{"t":"x","id":1}').toString('base64url') }));
  assert.throws(() => listInput({ status: 'unknown' }));
  assert.throws(() => dateRange({ from: '2000-01-01', to: '2026-01-01' }));
  assert.equal(
    credentials({ email: ' USER@Example.com ', password: 'a-strong-password' }).email,
    'user@example.com',
  );
  assert.throws(() => credentials({ email: 'bad', password: 'password' }));
  assert.throws(() => credentials({ email: 'user@example.com', password: 'é'.repeat(40) }));
});
test('bounded collision retries, conflict aliases, and unrelated database errors', async () => {
  let attempts = 0;
  const repository = {
    insert: async () => {
      attempts++;
      throw Object.assign(new Error(), { code: 'ER_DUP_ENTRY' });
    },
  };
  const service = linkService({ repository, config, cache: noCache });
  await assert.rejects(service.create(1, { original_url: 'https://example.com/' }), {
    code: 'CODE_EXHAUSTED',
  });
  assert.equal(attempts, 5);
  await assert.rejects(
    service.create(1, { original_url: 'https://example.com/', short_code: 'mine' }),
    { status: 409 },
  );
  repository.insert = async () => {
    throw new Error('database offline');
  };
  await assert.rejects(service.create(1, {}), /database offline/);
});
test('a collision can recover on the next database-enforced insert', async () => {
  const repository = memoryRepository();
  await repository.insert(1, { short_code: 'same', original_url: 'https://example.com' });
  let n = 0;
  const service = linkService({
    config,
    repository,
    cache: noCache,
    codeGenerator: () => (n++ ? 'different' : 'same'),
  });
  assert.equal(
    (await service.create(1, { original_url: 'https://example.org' })).short_code,
    'different',
  );
});
test('lifecycle ownership, disabled, expired and tombstone behavior', async () => {
  const repository = memoryRepository();
  const service = linkService({ repository, config, cache: noCache });
  const row = await service.create(1, {
    original_url: 'https://example.com',
    short_code: 'public',
  });
  await assert.rejects(service.owned(2, row.id), { status: 404 });
  await assert.rejects(service.update(2, row.id, { enabled: false }), { status: 404 });
  await service.update(1, row.id, { enabled: false });
  await assert.rejects(service.resolve('public'), { status: 410 });
  await service.update(1, row.id, { enabled: true, expires_at: '2000-01-01 00:00:00' });
  await assert.rejects(service.resolve('public'), { status: 410 });
  await service.remove(1, row.id);
  await assert.rejects(service.resolve('public'), { status: 410 });
  await assert.rejects(service.resolve('missing'), { status: 404 });
  await repository.insert(null, {
    short_code: 'legacy-unsafe',
    original_url: 'javascript:alert(1)',
  });
  await assert.rejects(service.resolve('legacy-unsafe'), {
    status: 410,
    code: 'UNSAFE_DESTINATION',
  });
});
test('cache hits, negative caching, single-flight, invalidation and Redis fallback', async () => {
  const data = new Map();
  const metrics = counters();
  let reads = 0;
  const redis = {
    isReady: true,
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => data.set(key, value),
    del: async (key) => data.delete(key),
  };
  const cache = redirectCache({ redis, metrics, logger, config });
  const load = async () => {
    reads++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { id: 1, enabled: true };
  };
  await Promise.all(Array.from({ length: 20 }, () => cache.resolve('hot', load)));
  assert.equal(reads, 1);
  await cache.resolve('hot', load);
  assert.equal(metrics.cacheHits, 1);
  await cache.invalidate('hot');
  await cache.resolve('hot', load);
  assert.equal(reads, 2);
  let misses = 0;
  await cache.resolve('absent', async () => {
    misses++;
    return null;
  });
  await cache.resolve('absent', async () => {
    misses++;
    return null;
  });
  assert.equal(misses, 1);
  redis.get = async () => {
    throw new Error();
  };
  assert.equal((await cache.resolve('other', load)).id, 1);
  assert.equal(metrics.cacheErrors, 1);
});
test('analytics metadata drops raw IP, user agent and referrer paths', () => {
  const metadata = safeMetadata({
    get: (name) =>
      ({ 'user-agent': 'Googlebot', referer: 'https://referrer.example/private?token=secret' })[
        name
      ],
  });
  assert.equal(metadata.referrer, 'referrer.example');
  assert.equal(metadata.isBot, true);
  assert.equal(metadata.ip, undefined);
  assert.throws(() => validateEvent({}));
  validateEvent({
    eventId: randomUUID(),
    linkId: 1,
    timestamp: new Date().toISOString(),
    ...metadata,
  });
});
test('queue acceptance failures are counted and do not throw through redirect producer', async () => {
  const metrics = counters();
  const producer = clickProducer({
    queue: {
      add: async () => {
        throw new Error('offline');
      },
      close: async () => {},
    },
    metrics,
    logger,
  });
  producer.enqueue({ id: 1 }, { method: 'GET', get: () => '' });
  await producer.close();
  assert.equal(metrics.eventsDropped, 1);
  assert.equal(metrics.eventsAccepted, 0);
});
test('cached link eligibility still enforces expiration/deletion on each hit', async () => {
  const repository = memoryRepository();
  const cache = {
    ...noCache,
    resolve: async () => ({ id: 1, enabled: true, expires_at: '2000-01-01 00:00:00' }),
  };
  const service = linkService({ repository, config, cache });
  await assert.rejects(service.resolve('expired-cache'), { status: 410 });
  cache.resolve = async () => ({ id: 1, enabled: true, deleted_at: '2026-01-01 00:00:00' });
  await assert.rejects(service.resolve('deleted-cache'), { status: 410 });
});
test('account attempt rate keys remain IP-scoped across user changes; management uses owner', async () => {
  const keys = [];
  const deps = {
    config,
    logger,
    metrics: counters(),
    redis: {
      isReady: true,
      eval: async (script, options) => {
        keys.push(options.keys[0]);
        return [1, 60000];
      },
    },
  };
  const response = { set() {} };
  for (const name of ['register', 'login', 'management']) {
    const limiter = rateLimiter(deps, name, 10, 60);
    for (const userId of [1, 2])
      await limiter({ ip: '127.0.0.1', session: { userId } }, response, (error) => {
        if (error) throw error;
      });
  }
  assert.equal(keys[0], keys[1]);
  assert.equal(keys[2], keys[3]);
  assert.notEqual(keys[4], keys[5]);
});
