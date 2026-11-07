import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { createClient } from 'redis';
import { RedisStore } from 'connect-redis';
import { Worker } from 'bullmq';
import supertest from 'supertest';
import { migrate } from '../src/config/migrate.js';
import { createPool, queueConnection } from '../src/config/resources.js';
import { userRepository } from '../src/repositories/users.js';
import { linkRepository } from '../src/repositories/links.js';
import { eventRepository } from '../src/repositories/events.js';
import { analyticsRepository } from '../src/repositories/analytics.js';
import { redirectCache } from '../src/services/cache.js';
import { linkService } from '../src/services/links.js';
import { createAnalyticsQueue, clickProducer, QUEUE_NAME } from '../src/queues/analytics.js';
import { createApp } from '../src/app.js';
import { config as base, logger, counters } from './helpers.js';

test(
  'real MySQL + Redis: authenticated redirect -> queue -> event -> report, and cache mutation',
  {
    skip: process.env.RUN_MYSQL_TESTS !== '1' || process.env.RUN_REDIS_TESTS !== '1',
    timeout: 30000,
  },
  async () => {
    const name = `ziplink_test_${randomUUID().replaceAll('-', '')}`;
    const config = {
      ...base,
      redisUrl: process.env.REDIS_URL || base.redisUrl,
      prefix: `test-${randomUUID().slice(0, 8)}`,
    };
    const redis = createClient({
      url: config.redisUrl,
      disableOfflineQueue: true,
      commandOptions: { timeout: 1000 },
      socket: { connectTimeout: 1000, reconnectStrategy: false },
    });
    redis.on('error', () => {});
    let admin, pool, queue, producer, worker;
    try {
      await redis.connect(); // Fail without touching MySQL if Redis is unavailable.
      const options = {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        timezone: 'Z',
        dateStrings: true,
      };
      admin = await mysql.createConnection(options);
      assert.match(name, /^ziplink_test_[0-9a-f]{32}$/);
      await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`);
      pool = createPool({ db: { ...options, database: name, connectionLimit: 6 } });
      await migrate(pool);
      const metrics = counters();
      const cache = redirectCache({ redis, config, logger, metrics });
      const links = linkService({ repository: linkRepository(pool), cache, config });
      queue = createAnalyticsQueue(config);
      queue.on('error', () => {});
      await queue.waitUntilReady();
      producer = clickProducer({ queue, logger, metrics });
      const events = eventRepository(pool);
      worker = new Worker(QUEUE_NAME, (job) => events.persist(job.data), {
        prefix: `${config.prefix}-queue`,
        connection: queueConnection(config, true),
      });
      worker.on('error', () => {});
      await worker.waitUntilReady();
      const app = createApp({
        config,
        pool,
        redis,
        logger,
        metrics,
        links,
        producer,
        sessionStore: new RedisStore({ client: redis, prefix: `${config.prefix}:session:` }),
        users: userRepository(pool),
        analytics: analyticsRepository(pool),
      });
      const agent = supertest.agent(app);
      const initial = await agent.get('/api/auth/me').expect(200);
      const registration = await agent
        .post('/api/auth/register')
        .set('X-CSRF-Token', initial.body.data.csrfToken)
        .send({ email: 'pipeline@example.com', password: 'pipeline-test-password' })
        .expect(201);
      const token = registration.body.data.csrfToken;
      const created = await agent
        .post('/api/links')
        .set('X-CSRF-Token', token)
        .send({ originalUrl: 'https://example.com/first', alias: 'pipeline-link' })
        .expect(201);
      const id = created.body.data.id;
      await supertest(app).get('/pipeline-link').set('User-Agent', 'Mozilla/5.0').expect(302);
      await supertest(app).head('/pipeline-link').expect(302); // Warm hit, no extra event.
      assert.ok(metrics.cacheHits >= 1);
      assert.ok(metrics.cacheMisses >= 1);
      const deadline = Date.now() + 10000;
      let clicks = 0;
      while ((clicks !== 1 || metrics.eventsAccepted !== 1) && Date.now() < deadline) {
        const [[row]] = await pool.execute('SELECT clicks FROM urls WHERE id=?', [id]);
        clicks = Number(row.clicks);
        if (!clicks) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.equal(clicks, 1);
      assert.equal(metrics.eventsAccepted, 1);
      const report = await agent.get(`/api/links/${id}/analytics`).expect(200);
      assert.equal(report.body.data.totalClicks, 1);
      await agent
        .patch(`/api/links/${id}`)
        .set('X-CSRF-Token', token)
        .send({ originalUrl: 'https://example.com/updated' })
        .expect(200);
      await supertest(app)
        .head('/pipeline-link')
        .expect(302)
        .expect('Location', 'https://example.com/updated');
      // Simulate API-side Redis disconnection: public reads fall back; sessions fail closed.
      await redis.close();
      await supertest(app)
        .head('/pipeline-link')
        .expect(302)
        .expect('Location', 'https://example.com/updated');
      await agent.get('/api/links').expect(503);
      await redis.connect();
      await agent.delete(`/api/links/${id}`).set('X-CSRF-Token', token).expect(200);
      await supertest(app).get('/pipeline-link').expect(410);
    } finally {
      await producer?.drain();
      await worker?.close();
      if (queue) {
        await queue.obliterate({ force: true });
        await queue.close();
      }
      if (redis.isReady) {
        const keys = await redis.keys(`${config.prefix}:*`);
        if (keys.length) await redis.del(keys);
      }
      if (redis.isOpen) redis.destroy();
      await pool?.end();
      if (admin) {
        await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
        await admin.end();
      }
    }
  },
);
