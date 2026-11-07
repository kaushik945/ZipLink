import test from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { migrate } from '../src/config/migrate.js';
import { createPool } from '../src/config/resources.js';
import { userRepository } from '../src/repositories/users.js';
import { linkRepository } from '../src/repositories/links.js';
import { analyticsRepository } from '../src/repositories/analytics.js';
import { eventRepository } from '../src/repositories/events.js';
import { linkService } from '../src/services/links.js';
import { config, noCache, testApp } from './helpers.js';

test(
  'real MySQL: legacy migrations, auth, concurrency, pagination, analytics idempotency',
  { skip: process.env.RUN_MYSQL_TESTS !== '1', timeout: 60000 },
  async (t) => {
    // No production/development database name is accepted. Only our generated database is dropped.
    const name = `ziplink_test_${randomUUID().replaceAll('-', '')}`;
    assert.match(name, /^ziplink_test_[0-9a-f]{32}$/);
    const options = {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      timezone: 'Z',
      dateStrings: true,
      connectionLimit: 8,
    };
    const admin = await mysql.createConnection(options);
    let pool;
    try {
      await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`);
      pool = createPool({ db: { ...options, database: name } });
      const [[timezone]] = await pool.query('SELECT @@session.time_zone zone');
      assert.equal(timezone.zone, '+00:00');
      await pool.query(
        'CREATE TABLE urls(id INT AUTO_INCREMENT PRIMARY KEY,original_url TEXT NOT NULL,short_code VARCHAR(20) NOT NULL UNIQUE,clicks INT DEFAULT 0,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB',
      );
      await pool.execute('INSERT INTO urls(original_url,short_code,clicks) VALUES (?,?,?)', [
        'https://example.com/legacy',
        'old12345',
        7,
      ]);
      await migrate(pool);
      await migrate(pool);
      const users = userRepository(pool);
      const repository = linkRepository(pool);
      const analytics = analyticsRepository(pool);
      const service = linkService({ repository, cache: noCache, config });
      const legacy = await service.resolve('old12345');
      assert.equal(legacy.original_url, 'https://example.com/legacy');
      const [[old]] = await pool.query(
        "SELECT clicks,user_id FROM urls WHERE short_code='old12345'",
      );
      assert.equal(Number(old.clicks), 7);
      assert.equal(old.user_id, null);
      const { app } = testApp({ pool, repository, users, links: service, analytics });
      const agent = supertest.agent(app);
      const initial = await agent.get('/api/auth/me');
      const registration = await agent
        .post('/api/auth/register')
        .set('X-CSRF-Token', initial.body.data.csrfToken)
        .send({ email: 'integration@example.com', password: 'integration-password-123' })
        .expect(201);
      const uid = registration.body.data.user.id;
      const token = registration.body.data.csrfToken;
      const [[stored]] = await pool.execute('SELECT password_hash FROM users WHERE id=?', [uid]);
      assert.match(stored.password_hash, /^\$2[aby]\$/);
      assert.notEqual(stored.password_hash, 'integration-password-123');
      const other = await users.create('other@example.com', stored.password_hash);
      const concurrent = await Promise.all(
        Array.from({ length: 30 }, () =>
          service.create(uid, { original_url: 'https://example.com/concurrent' }),
        ),
      );
      assert.equal(new Set(concurrent.map((row) => row.short_code)).size, 30);
      const conflicts = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          service.create(uid, {
            original_url: 'https://example.com/alias',
            short_code: 'same-alias',
          }),
        ),
      );
      assert.equal(conflicts.filter((row) => row.status === 'fulfilled').length, 1);
      assert.ok(
        conflicts
          .filter((row) => row.status === 'rejected')
          .every((row) => row.reason.status === 409),
      );
      assert.equal(
        (await repository.list(other.id, { limit: 10, status: 'all', search: '', cursor: null }))
          .data.length,
        0,
      );
      const seen = [];
      let cursor = null;
      do {
        const page = await repository.list(uid, { limit: 7, status: 'all', search: '', cursor });
        seen.push(...page.data.map((row) => row.id));
        cursor = page.pagination.nextCursor
          ? JSON.parse(Buffer.from(page.pagination.nextCursor, 'base64url').toString())
          : null;
      } while (cursor);
      assert.equal(seen.length, 31);
      assert.equal(new Set(seen).size, 31);
      const first = concurrent[0];
      await assert.rejects(service.update(other.id, first.id, { enabled: false }), { status: 404 });
      const events = eventRepository(pool);
      const event = {
        eventId: randomUUID(),
        linkId: first.id,
        timestamp: new Date().toISOString(),
        device: 'desktop',
        browser: 'Chrome',
        referrer: 'direct',
        isBot: false,
      };
      const persisted = await Promise.all(Array.from({ length: 10 }, () => events.persist(event)));
      assert.equal(persisted.filter(Boolean).length, 1);
      const [[count]] = await pool.execute('SELECT clicks FROM urls WHERE id=?', [first.id]);
      assert.equal(Number(count.clicks), 1);
      const report = await analytics.report(uid, {
        from: '2000-01-01 00:00:00',
        to: '2100-01-01 00:00:00',
      });
      assert.equal(Number(report.totalClicks), 1);
      assert.equal(report.daily.length, 1);
      assert.equal(report.devices[0].name, 'desktop');
      assert.equal(
        Number(
          (
            await analytics.report(other.id, {
              from: '2000-01-01 00:00:00',
              to: '2100-01-01 00:00:00',
            })
          ).totalClicks,
        ),
        0,
      );
      await agent.get('/api/urls?limit=5').expect(200);
      await agent.get('/api/links?cursor=invalid').expect(400);
      await agent
        .patch(`/api/links/${first.id}`)
        .set('X-CSRF-Token', token)
        .send({ enabled: false })
        .expect(200);
      await supertest(app).get(`/${first.short_code}`).expect(410);
      await service.update(uid, first.id, { enabled: true, expires_at: '2000-01-01 00:00:00' });
      await assert.rejects(service.resolve(first.short_code), { status: 410 });
      await service.remove(uid, first.id);
      assert.equal(await events.persist({ ...event, eventId: randomUUID() }), false);
      await supertest(app).get(`/${first.short_code}`).expect(410);
      t.diagnostic(
        `Isolated database ${name}: migration and transactional checks passed; removed in finally.`,
      );
    } finally {
      await pool?.end();
      await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await admin.end();
    }
  },
);
