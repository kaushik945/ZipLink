import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';
import { loadConfig } from '../server/src/config/env.js';
import { createRedis } from '../server/src/config/resources.js';
import { createAnalyticsQueue } from '../server/src/queues/analytics.js';
import { renderLoadTestReport } from './load-test-report.js';

const config = loadConfig();
const base = process.env.BASE_URL || 'http://localhost:5002';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname))
  throw new Error(
    'Automatic runner is local-only. Use the explicit k6 harness for an authorized remote target.',
  );
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = resolve('.local-services', 'load-tests', timestamp);
const version = spawnSync('k6', ['version'], { encoding: 'utf8' });
if (version.status !== 0) throw new Error('Install k6 and make it available on PATH.');
const ready = await fetch(`${base}/ready`, { signal: AbortSignal.timeout(5000) });
if (!ready.ok) throw new Error('API is not ready; start MySQL, Redis, API and worker.');
const redis = createRedis(config);
let queue;
let baselineQueue;
try {
  await redis.connect();
  queue = createAnalyticsQueue(config);
  queue.on('error', () => {});
  await queue.waitUntilReady();
  baselineQueue = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
  if (baselineQueue.waiting + baselineQueue.active + baselineQueue.delayed > 0)
    throw new Error('Queue is not drained; investigate/start workers before measuring.');
  if (!(await queue.getWorkers()).length)
    throw new Error('No analytics worker is connected. Start npm run worker.');
  if (process.argv.includes('--check')) {
    console.log('Preflight passed: k6, API readiness, Redis and connected worker; queue drained.');
    await queue.close();
    await redis.close();
    process.exit(0);
  }
} catch (error) {
  await queue?.close();
  if (redis.isOpen) redis.destroy();
  throw error;
}
mkdirSync(directory, { recursive: true });
let cookie = '';
let csrf = '';
let userId = null;
const runs = [];
const samples = [];
let sampling = false;
const sample = async () => {
  if (sampling) return;
  sampling = true;
  try {
    samples.push({
      time: new Date().toISOString(),
      ...(await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed')),
    });
  } catch (error) {
    samples.push({ time: new Date().toISOString(), error: error.code || 'QUEUE_SAMPLE_FAILED' });
  } finally {
    sampling = false;
  }
};
const timer = setInterval(sample, 1000);
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(`${method} ${path}: HTTP ${response.status} (${value.error?.code || 'ERROR'})`);
  const updatedCookie = response.headers
    .getSetCookie()
    .find((header) =>
      header.startsWith(config.production ? '__Host-ziplink.sid=' : 'ziplink.sid='),
    );
  if (updatedCookie) cookie = updatedCookie.split(';')[0];
  if (value.data?.csrfToken) csrf = value.data.csrfToken;
  return value;
}
async function run(label, scenario, vus, duration, targets, iterations) {
  console.log(
    `Starting ${label}: ${vus} VUs, ${iterations ? `${iterations} iterations` : duration}`,
  );
  const summaryPath = resolve(directory, `${label}.json`);
  const split = cookie.indexOf('=');
  const startedAt = new Date().toISOString();
  const child = spawn('k6', ['run', '--quiet', 'benchmarks/scenarios.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      BASE_URL: base,
      SCENARIO: scenario,
      VUS: String(vus),
      DURATION: duration,
      ITERATIONS: String(iterations || 20),
      PAUSE_SECONDS: '0.2',
      BENCH_COOKIE_NAME: cookie.slice(0, split),
      BENCH_COOKIE: cookie.slice(split + 1),
      BENCH_CSRF_TOKEN: csrf,
      BENCH_TARGETS: JSON.stringify(targets),
      SUMMARY_PATH: summaryPath,
      K6_NO_USAGE_REPORT: 'true',
      NO_COLOR: '1',
    },
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
    process.stderr.write(chunk);
  });
  const code = await new Promise((resolveRun, reject) => {
    child.on('error', reject);
    child.on('close', resolveRun);
  });
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  writeFileSync(resolve(directory, `${label}.log`), output);
  runs.push({
    label,
    scenario,
    vus,
    duration,
    iterations: iterations || null,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode: code,
    ...summary,
  });
  await sample();
  if (code !== 0)
    throw new Error(`${label} failed its k6 thresholds (exit ${code}); inspect the saved summary.`);
}
let report;
try {
  await api('/api/auth/me');
  const email = `benchmark-${randomUUID()}@example.com`;
  const registered = await api('/api/auth/register', 'POST', {
    email,
    password: randomBytes(24).toString('hex'),
  });
  userId = registered.data.user.id;
  const targets = [];
  for (let i = 0; i < 3; i++) {
    const created = await api('/api/links', 'POST', {
      originalUrl: `https://example.com/ziplink-load-test/${timestamp}/${i}`,
    });
    targets.push(`${base}/api/short/${created.data.short_code}`);
  }
  await run('warmup', 'cache-hit', 5, '30s', targets);
  for (let i = 1; i <= 3; i++) await run(`baseline-${i}`, 'cache-hit', 10, '30s', targets);
  await run('higher-concurrency', 'cache-hit', 20, '30s', targets);
  await run('creation', 'create', 5, '1s', targets, 20);
  await run('mixed', 'mixed', 5, '1s', targets, 20);
  const expectedEvents = runs.reduce(
    (sum, run) =>
      sum +
      (run.metrics.ziplink_redirect_requests?.values.count || 0) +
      (run.scenario === 'cache-hit' ? 3 : 0),
    0,
  );
  const deadline = Date.now() + 30000;
  let analytics;
  do {
    analytics = (await api('/api/analytics/overview')).data;
    if (Number(analytics.totalClicks) === expectedEvents) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  } while (Date.now() < deadline);
  report = {
    timestamp,
    base,
    environment: {
      node: process.version,
      k6: version.stdout.trim(),
      platform: `${os.platform()} ${os.release()}`,
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      memoryGb: +(os.totalmem() / 2 ** 30).toFixed(1),
      cacheEnabled: config.cacheEnabled,
      configuredCacheTtlSeconds: config.cacheTtl,
      configuredWorkerConcurrency: config.workerConcurrency,
      apiAndWorkerAndDatabasesAndGeneratorShareLocalResources: true,
    },
    benchmarkUserId: userId,
    expectedEvents,
    persistedEvents: Number(analytics.totalClicks),
    eventCountMatches: Number(analytics.totalClicks) === expectedEvents,
    baselineQueue,
    finalQueue: await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
    queuePeakSampled: Math.max(
      0,
      ...samples.map((row) => (row.waiting || 0) + (row.active || 0) + (row.delayed || 0)),
    ),
    runs,
    samples,
    limitations: [
      'Local HTTP and paced closed-loop VUs; not an unpaced capacity/stress test.',
      'Three warmed target links; no large-dataset or naturally cold-miss comparison.',
      'Higher-concurrency run is exploratory and not repeated.',
      'No Redis/worker outage or synchronous original-version baseline in this run.',
      'Queue snapshots are sampled once per second and may miss short peaks.',
    ],
  };
  if (!report.eventCountMatches) process.exitCode = 1;
} catch (error) {
  process.exitCode = 1;
  report = { timestamp, base, benchmarkUserId: userId, error: error.message, runs, samples };
  console.error(error.message);
} finally {
  clearInterval(timer);
  if (userId) {
    try {
      let page;
      do {
        page = await api('/api/links?limit=100');
        for (const link of page.data) await api(`/api/links/${link.id}`, 'DELETE');
      } while (page.pagination.hasMore);
      await api('/api/auth/logout', 'POST');
      report.cleanup =
        'Only benchmark-owned links soft-deleted; session invalidated. Account, tombstones and events remain; password was never saved.';
    } catch (error) {
      report.cleanupError = error.message;
      process.exitCode = 1;
    }
  }
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(resolve(directory, 'report.md'), renderLoadTestReport(report));
  await queue.close();
  if (redis.isOpen) await redis.close();
  console.log(`Results saved: ${directory}`);
}
