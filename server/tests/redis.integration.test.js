import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';
import supertest from 'supertest';
import { queueConnection } from '../src/config/resources.js';
import { redirectCache } from '../src/services/cache.js';
import { createAnalyticsQueue, QUEUE_NAME } from '../src/queues/analytics.js';
import { config as base, logger, counters, testApp } from './helpers.js';

test(
  'real Redis: TTLs, cache invalidation, shared sessions/rate limits and BullMQ retries',
  { skip: process.env.RUN_REDIS_TESTS !== '1', timeout: 30000 },
  async () => {
    const config = {
      ...base,
      redisUrl: process.env.REDIS_URL || base.redisUrl,
      prefix: `test-${randomUUID().slice(0, 8)}`,
      cacheTtl: 2,
      negativeTtl: 1,
    };
    const redis = createClient({
      url: config.redisUrl,
      disableOfflineQueue: true,
      commandOptions: { timeout: 1000 },
      socket: { connectTimeout: 1000, reconnectStrategy: false },
    });
    redis.on('error', () => {});
    let queue;
    const metrics = counters();
    let worker;
    try {
      await redis.connect();
      queue = createAnalyticsQueue(config);
      queue.on('error', () => {});
      await queue.waitUntilReady();
      const cache = redirectCache({ redis, config, logger, metrics });
      let loads = 0;
      const loader = async () => ({
        id: 1,
        enabled: true,
        original_url: `https://example.com/${++loads}`,
      });
      await cache.resolve('hot', loader);
      await cache.resolve('hot', loader);
      assert.equal(loads, 1);
      await cache.invalidate('hot');
      await cache.resolve('hot', loader);
      assert.equal(loads, 2);
      await new Promise((resolve) => setTimeout(resolve, 2100));
      await cache.resolve('hot', loader);
      assert.equal(loads, 3);
      let negativeLoads = 0;
      const absent = async () => {
        negativeLoads++;
        return null;
      };
      await cache.resolve('absent', absent);
      await cache.resolve('absent', absent);
      assert.equal(negativeLoads, 1);
      const sessionStore = new RedisStore({ client: redis, prefix: `${config.prefix}:session:` });
      const { app, deps } = testApp({ config, redis, sessionStore });
      const agent = supertest.agent(app);
      const anon = await agent.get('/api/auth/me').expect(200);
      const registration = await agent
        .post('/api/auth/register')
        .set('X-CSRF-Token', anon.body.data.csrfToken)
        .send({ email: 'redis@example.com', password: 'redis-test-password' })
        .expect(201);
      assert.ok((await agent.get('/api/auth/me')).body.data.user);
      // Two app instances share the same rate key and Redis session store.
      const second = testApp({ config, redis, sessionStore, users: deps.users });
      await supertest(second.app)
        .get('/api/auth/me')
        .set('Cookie', registration.headers['set-cookie'][0].split(';')[0])
        .expect(200)
        .expect((response) => assert.ok(response.body.data.user));
      const one = supertest.agent(app),
        two = supertest.agent(second.app);
      const tokens = [
        (await one.get('/api/auth/me')).body.data.csrfToken,
        (await two.get('/api/auth/me')).body.data.csrfToken,
      ];
      for (let i = 0; i < 10; i++)
        await (i % 2 ? two : one)
          .post('/api/auth/login')
          .set('X-CSRF-Token', tokens[i % 2])
          .send({ email: 'wrong@example.com', password: 'wrong-password-long' })
          .expect(401);
      await one
        .post('/api/auth/login')
        .set('X-CSRF-Token', tokens[0])
        .send({ email: 'wrong@example.com', password: 'wrong-password-long' })
        .expect(429);
      let attempts = 0;
      const job = await queue.add(
        'retry-test',
        { eventId: randomUUID() },
        { attempts: 2, backoff: { type: 'exponential', delay: 100 }, removeOnComplete: false },
      );
      assert.equal(await job.getState(), 'waiting'); // Accepted while no worker is running.
      worker = new Worker(
        QUEUE_NAME,
        async (job) => {
          if (job.name === 'poison-test') throw new Error('invalid test event');
          attempts++;
          if (attempts < 2) throw new Error('transient test failure');
          return true;
        },
        { prefix: `${config.prefix}-queue`, connection: queueConnection(config, true) },
      );
      worker.on('error', () => {});
      const deadline = Date.now() + 10000;
      while ((await job.getState()) !== 'completed' && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(await job.getState(), 'completed');
      assert.equal(attempts, 2);
      const failed = await queue.add(
        'poison-test',
        {},
        { attempts: 2, backoff: { type: 'exponential', delay: 100 }, removeOnFail: false },
      );
      const failDeadline = Date.now() + 10000;
      while ((await failed.getState()) !== 'failed' && Date.now() < failDeadline)
        await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(await failed.getState(), 'failed');
      assert.equal((await queue.getJobCounts('failed')).failed, 1);
    } finally {
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
    }
  },
);
