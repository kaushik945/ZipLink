import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { queueConnection } from '../config/resources.js';
import { safeMetadata } from '../validators/events.js';

export const QUEUE_NAME = 'click-analytics';
export function createAnalyticsQueue(config) {
  return new Queue(QUEUE_NAME, {
    prefix: `${config.prefix}-queue`,
    connection: queueConnection(config),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: { age: 86400, count: 10000 },
      removeOnFail: { age: 604800, count: 10000 },
    },
  });
}
export function clickProducer({ queue, logger, metrics }) {
  const pending = new Set();
  let closing = false;
  return {
    enqueue(link, req) {
      if (req.method !== 'GET') return; // HEAD probes are not clicks.
      if (closing || pending.size >= 500) {
        metrics.eventsDropped++;
        logger.warn('Analytics producer at capacity; redirect still succeeds');
        return;
      }
      const data = {
        eventId: randomUUID(),
        linkId: link.id,
        timestamp: new Date().toISOString(),
        ...safeMetadata(req),
      };
      const task = queue
        .add('click', data, { jobId: data.eventId })
        .then(() => {
          metrics.eventsAccepted++;
        })
        .catch((error) => {
          metrics.eventsDropped++;
          logger.error(
            { code: error.code },
            'Analytics event not accepted; redirect succeeded without a durable event',
          );
        })
        .finally(() => pending.delete(task));
      pending.add(task);
    },
    async drain() {
      closing = true;
      await Promise.allSettled([...pending]);
    },
    async close() {
      closing = true;
      await Promise.allSettled([...pending]);
      await queue.close();
    },
  };
}
