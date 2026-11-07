import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/env.js';

test('environment configuration rejects missing secrets, insecure production origins and malformed limits', () => {
  const base = { SESSION_SECRET: 'a-secret-with-more-than-32-characters' };
  assert.throws(() => loadConfig({}), { code: 'CONFIG' });
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'prodution' }), { code: 'CONFIG' });
  assert.throws(() => loadConfig({ ...base, REDIS_URL: 'redis:///missing-host' }), {
    code: 'CONFIG',
  });
  assert.throws(
    () => loadConfig({ SESSION_SECRET: 'replace-with-a-random-secret-of-at-least-32-characters' }),
    { code: 'CONFIG' },
  );
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'production' }), { code: 'CONFIG' });
  assert.throws(() => loadConfig({ ...base, FRONTEND_ORIGINS: 'http://localhost:5173/path' }), {
    code: 'CONFIG',
  });
  assert.throws(() => loadConfig({ ...base, SHORT_CODE_LENGTH: '2' }), { code: 'CONFIG' });
  assert.throws(() => loadConfig({ ...base, DB_POOL_SIZE: '10000' }), { code: 'CONFIG' });
  assert.throws(() => loadConfig({ ...base, REDIS_PREFIX: 'invalid:prefix' }), { code: 'CONFIG' });
  assert.equal(
    loadConfig({
      ...base,
      NODE_ENV: 'production',
      FRONTEND_ORIGINS: 'https://app.example.com',
      PUBLIC_BASE_URL: 'https://go.example.com',
    }).production,
    true,
  );
});
