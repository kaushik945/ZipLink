import { Worker } from 'bullmq';
import { loadConfig } from '../config/env.js';
import { createPool, logger, queueConnection } from '../config/resources.js';
import { eventRepository } from '../repositories/events.js';
import { QUEUE_NAME } from '../queues/analytics.js';

const config = loadConfig();
const pool = createPool(config);
const events = eventRepository(pool);
await pool.query('SELECT 1');
const worker = new Worker(QUEUE_NAME, (job) => events.persist(job.data), {
  prefix: `${config.prefix}-queue`,
  connection: queueConnection(config, true),
  concurrency: config.workerConcurrency,
});
worker.on('completed', (job) =>
  logger.info(
    { eventId: job.id },
    'Analytics event processed (duplicates ignored transactionally)',
  ),
);
worker.on('failed', (job, error) =>
  logger.error(
    { eventId: job?.id, attempts: job?.attemptsMade, error: error.message },
    'Analytics job failed; inspect retained failed jobs after retries',
  ),
);
worker.on('error', (error) =>
  logger.error({ code: error.code }, 'Analytics worker connection error'),
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => {
    logger.error('Worker shutdown deadline exceeded');
    process.exit(1);
  }, 30000).unref();
  await worker.close();
  await pool.end();
  clearTimeout(deadline);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
await worker.waitUntilReady();
logger.info('Analytics worker started');
