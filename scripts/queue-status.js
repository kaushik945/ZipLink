import { loadConfig } from '../server/src/config/env.js';
import { createAnalyticsQueue } from '../server/src/queues/analytics.js';
const queue = createAnalyticsQueue(loadConfig());
queue.on('error', (error) =>
  console.error(JSON.stringify({ code: error.code, message: 'Queue connection error' })),
);
try {
  if (process.argv[2] === 'retry') {
    const id = process.argv[3];
    if (!id) throw new Error('Usage: npm run queue:status -- retry JOB_ID');
    const job = await queue.getJob(id);
    if (!job) throw new Error('Job not found');
    await job.retry();
  }
  console.log(
    JSON.stringify(
      {
        counts: await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
        sampledAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} finally {
  await queue.close();
}
