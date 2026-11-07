import { RedisStore } from 'connect-redis';
import { loadConfig } from './config/env.js';
import { createPool, createRedis, logger } from './config/resources.js';
import { userRepository } from './repositories/users.js';
import { linkRepository } from './repositories/links.js';
import { analyticsRepository } from './repositories/analytics.js';
import { linkService } from './services/links.js';
import { redirectCache } from './services/cache.js';
import { createAnalyticsQueue, clickProducer } from './queues/analytics.js';
import { createApp } from './app.js';

const config = loadConfig();
const pool = createPool(config);
const redis = createRedis(config);
const metrics = {
  cacheHits: 0,
  cacheMisses: 0,
  cacheErrors: 0,
  cacheInvalidationFailures: 0,
  eventsAccepted: 0,
  eventsDropped: 0,
  redirects: 0,
  rateLimitErrors: 0,
};
await pool.query('SELECT 1');
// Migrations are an explicit deployment step, never a side effect of API startup.
await redis.connect();
const sessionStore = new RedisStore({
  client: redis,
  prefix: `${config.prefix}:session:`,
  disableTouch: true,
});
const queue = createAnalyticsQueue(config);
queue.on('error', (error) =>
  logger.error({ code: error.code }, 'Analytics queue connection error'),
);
await queue.waitUntilReady();
const producer = clickProducer({ queue, logger, metrics });
const cache = redirectCache({ redis, config, logger, metrics });
const links = linkService({ repository: linkRepository(pool), cache, config });
const app = createApp({
  config,
  pool,
  redis,
  sessionStore,
  logger,
  users: userRepository(pool),
  links,
  analytics: analyticsRepository(pool),
  producer,
  metrics,
});
const server = app.listen(config.port, () =>
  logger.info({ port: config.port }, 'ZipLink API started'),
);
const metricTimer = setInterval(
  () => logger.info({ metrics }, 'API process counters (reset at restart)'),
  30000,
).unref();
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(metricTimer);
  const deadline = setTimeout(() => {
    logger.error('API shutdown deadline exceeded');
    process.exit(1);
  }, 30000).unref();
  await new Promise((resolve) => server.close(resolve));
  await producer.close();
  await redis.close();
  await pool.end();
  clearTimeout(deadline);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
