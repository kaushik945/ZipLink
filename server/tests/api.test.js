import test from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { testApp } from './helpers.js';

async function register(agent, email) {
  const initial = await agent.get('/api/auth/me').expect(200);
  const result = await agent
    .post('/api/auth/register')
    .set('X-CSRF-Token', initial.body.data.csrfToken)
    .send({ email, password: 'test-password-at-least-12' })
    .expect(201);
  return result.body.data.csrfToken;
}
test('registration, session fixation protection, login, logout and CSRF', async () => {
  const { app } = testApp();
  const agent = supertest.agent(app);
  const anon = await agent.get('/api/auth/me').expect(200);
  assert.equal(anon.body.data.user, null);
  await agent
    .post('/api/auth/register')
    .send({ email: 'a@example.com', password: 'long-enough-password' })
    .expect(403);
  const registration = await agent
    .post('/api/auth/register')
    .set('X-CSRF-Token', anon.body.data.csrfToken)
    .send({ email: 'a@example.com', password: 'long-enough-password' })
    .expect(201);
  assert.notEqual(
    registration.headers['set-cookie'][0].split(';')[0],
    anon.headers['set-cookie'][0].split(';')[0],
  );
  assert.match(registration.headers['set-cookie'][0], /HttpOnly/);
  assert.match(registration.headers['set-cookie'][0], /SameSite=Lax/);
  assert.equal(registration.body.data.user.password_hash, undefined);
  const token = registration.body.data.csrfToken;
  const oldCookie = registration.headers['set-cookie'][0].split(';')[0];
  await agent
    .post('/api/auth/logout')
    .set('X-CSRF-Token', token)
    .set('Origin', 'https://evil.example')
    .expect(403);
  await agent.post('/api/auth/logout').set('X-CSRF-Token', 'é'.repeat(64)).expect(403);
  await agent.post('/api/auth/logout').set('X-CSRF-Token', token).expect(200);
  await agent.get('/api/links').expect(401);
  await supertest(app).get('/api/links').set('Cookie', oldCookie).expect(401);
  const next = await agent.get('/api/auth/me');
  await agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', next.body.data.csrfToken)
    .send({ email: 'a@example.com', password: 'wrong-password-long' })
    .expect(401);
  await agent
    .post('/api/auth/login')
    .set('X-CSRF-Token', next.body.data.csrfToken)
    .send({ email: 'a@example.com', password: 'long-enough-password' })
    .expect(200);
});
test('absolute session expiration invalidates an otherwise valid stored session', async () => {
  const { app, deps } = testApp();
  const agent = supertest.agent(app);
  await register(agent, 'expired@example.com');
  const [sid, encoded] = Object.entries(deps.sessionStore.sessions).find(
    ([, value]) => JSON.parse(value).userId,
  );
  const stored = JSON.parse(encoded);
  stored.authExpiresAt = Date.now() - 1000;
  await new Promise((resolve, reject) =>
    deps.sessionStore.set(sid, stored, (error) => (error ? reject(error) : resolve())),
  );
  await agent.get('/api/links').expect(401);
  const profile = await agent.get('/api/auth/me').expect(200);
  assert.equal(profile.body.data.user, null);
});
test('owner lifecycle, compatibility paths, public redirects and analytics isolation', async () => {
  const { app } = testApp();
  const alice = supertest.agent(app);
  const bob = supertest.agent(app);
  const a = await register(alice, 'alice@example.com');
  const b = await register(bob, 'bob@example.com');
  const created = await alice
    .post('/api/shorten')
    .set('X-CSRF-Token', a)
    .send({ originalUrl: 'https://example.com/path', alias: 'Launch' })
    .expect(201);
  const id = created.body.data.id;
  await supertest(app).get('/Launch').expect(302).expect('Location', 'https://example.com/path');
  await supertest(app).get('/api/short/Launch').expect(302);
  assert.equal((await bob.get('/api/urls')).body.data.length, 0);
  await bob.get(`/api/links/${id}`).expect(404);
  await bob.get(`/api/links/${id}/analytics`).expect(404);
  await bob.get(`/api/links/${id}/analytics/timeseries`).expect(404);
  await bob.patch(`/api/links/${id}`).set('X-CSRF-Token', b).send({ enabled: false }).expect(404);
  await bob.delete(`/api/urls/${id}`).set('X-CSRF-Token', b).expect(404);
  await alice
    .patch(`/api/links/${id}`)
    .set('X-CSRF-Token', a)
    .send({ originalUrl: 'https://example.org/new', enabled: false })
    .expect(200);
  await supertest(app).get('/Launch').expect(410);
  await alice.patch(`/api/links/${id}`).set('X-CSRF-Token', a).send({ enabled: true }).expect(200);
  await supertest(app).get('/Launch').expect(302).expect('Location', 'https://example.org/new');
  await alice.delete(`/api/links/${id}`).set('X-CSRF-Token', a).expect(200);
  await supertest(app).get('/Launch').expect(410);
  await alice
    .post('/api/links')
    .set('X-CSRF-Token', a)
    .send({ originalUrl: 'https://example.com', alias: 'Launch' })
    .expect(409);
});
test('malformed requests, rate failures, headers, reserved aliases and legacy ownership', async () => {
  const { app, repository, deps } = testApp();
  const agent = supertest.agent(app);
  const token = await register(agent, 'owner@example.com');
  await agent
    .post('/api/links')
    .set('X-CSRF-Token', token)
    .send({ originalUrl: 'file:///secret' })
    .expect(400);
  await agent
    .post('/api/links')
    .set('X-CSRF-Token', token)
    .send({ originalUrl: 'https://example.com', alias: 'api' })
    .expect(400);
  await agent.post('/api/links').set('Content-Type', 'application/json').send('{').expect(400);
  await agent.get('/api/links?limit=10000').expect(400);
  await agent
    .post('/api/links')
    .set('X-CSRF-Token', token)
    .send({ originalUrl: 'https://example.com/' + 'x'.repeat(17000) })
    .expect(413);
  await repository.insert(null, {
    short_code: 'legacy01',
    original_url: 'https://example.com/old',
  });
  await supertest(app).get('/api/short/legacy01').expect(302);
  assert.equal((await agent.get('/api/links')).body.data.length, 0);
  await agent.get('/health').expect('X-Content-Type-Options', 'nosniff').expect(200);
  await agent
    .get('/api/openapi.json')
    .expect(200)
    .expect((response) => assert.equal(response.body.info.title, 'ZipLink API'));
  deps.redis.eval = async () => [99999, 10000];
  await agent.get('/api/links').expect(429).expect('Retry-After', '10');
  deps.redis.isReady = false;
  await agent.get('/api/links').expect(503);
  await supertest(app).get('/legacy01').expect(302);
});
