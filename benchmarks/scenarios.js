import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const base = __ENV.BASE_URL || 'http://localhost:5002';
const mode = __ENV.SCENARIO || 'cache-hit';
const errors = new Rate('ziplink_error_rate');
const requests = new Counter('ziplink_workload_requests');
const limited = new Counter('ziplink_rate_limited');
const serverErrors = new Counter('ziplink_server_errors');
const duration = new Trend('ziplink_workload_duration', true);
const redirectDuration = new Trend('ziplink_redirect_duration', true);
const createDuration = new Trend('ziplink_create_duration', true);
const listDuration = new Trend('ziplink_list_duration', true);
const redirectRequests = new Counter('ziplink_redirect_requests');
function record(response, operation, expected) {
  requests.add(1);
  limited.add(response.status === 429 ? 1 : 0);
  serverErrors.add(response.status === 0 || response.status >= 500 ? 1 : 0);
  duration.add(response.timings.duration);
  if (operation === 'redirect') {
    redirectDuration.add(response.timings.duration);
    redirectRequests.add(1);
  }
  if (operation === 'create') createDuration.add(response.timings.duration);
  if (operation === 'list') listDuration.add(response.timings.duration);
  errors.add(
    !check(response, {
      [`${operation} returns ${expected}`]: (result) => result.status === expected,
    }),
  );
}
const allowed = [
  'cache-hit',
  'cache-miss',
  'create',
  'mixed',
  'analytics-heavy',
  'redis-down',
  'worker-down',
];
if (!allowed.includes(mode)) throw new Error(`SCENARIO must be one of ${allowed.join(', ')}`);
export const options = {
  scenarios: {
    workload:
      mode === 'create' || mode === 'mixed'
        ? {
            executor: 'shared-iterations',
            vus: Number(__ENV.VUS || 5),
            iterations: Number(__ENV.ITERATIONS || 20),
            maxDuration: '1m',
          }
        : {
            executor: 'constant-vus',
            vus: Number(__ENV.VUS || 10),
            duration: __ENV.DURATION || '30s',
          },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(50)', 'p(95)', 'p(99)', 'max'],
  thresholds: { ziplink_error_rate: ['rate<0.01'], http_req_duration: ['p(95)<1000'] },
};
export function setup() {
  let token = __ENV.BENCH_CSRF_TOKEN;
  let cookieName = __ENV.BENCH_COOKIE_NAME;
  let cookie = __ENV.BENCH_COOKIE;
  if (!token || !cookieName || !cookie) {
    if (!__ENV.BENCH_EMAIL || !__ENV.BENCH_PASSWORD)
      throw new Error(
        'Provide benchmark credentials or an existing benchmark session through environment variables.',
      );
    const me = http.get(`${base}/api/auth/me`);
    if (me.status !== 200)
      throw new Error('Cannot initialize session; start MySQL, Redis and API.');
    const login = http.post(
      `${base}/api/auth/login`,
      JSON.stringify({ email: __ENV.BENCH_EMAIL, password: __ENV.BENCH_PASSWORD }),
      {
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.json('data.csrfToken') },
      },
    );
    if (login.status !== 200) throw new Error(`Benchmark login failed: HTTP ${login.status}`);
    token = login.json('data.csrfToken');
    cookieName = Object.keys(login.cookies).find((name) => name.endsWith('ziplink.sid'));
    cookie = login.cookies[cookieName][0].value;
  }
  http.cookieJar().set(base, cookieName, cookie);
  const targets = __ENV.BENCH_TARGETS ? JSON.parse(__ENV.BENCH_TARGETS) : [];
  if (
    !Array.isArray(targets) ||
    targets.some((url) => typeof url !== 'string' || !url.startsWith(`${base}/api/short/`))
  )
    throw new Error('Benchmark targets must be short-link paths on BASE_URL.');
  for (let i = targets.length ? 3 : 0; i < 3; i++) {
    const result = http.post(
      `${base}/api/links`,
      JSON.stringify({ originalUrl: `https://example.com/ziplink-benchmark/${Date.now()}/${i}` }),
      { headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token } },
    );
    if (result.status !== 201) throw new Error(`Fixture creation failed: HTTP ${result.status}`);
    targets.push(`${base}/api/short/${result.json('data.short_code')}`);
  }
  if (!targets.length) throw new Error('No benchmark targets.');
  if (mode === 'cache-hit') targets.forEach((url) => http.get(url, { redirects: 0 }));
  return { targets, token, cookieName, cookie };
}
export default function (data) {
  http.cookieJar().set(base, data.cookieName, data.cookie);
  const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': data.token };
  const write = mode === 'create' || (mode === 'mixed' && __ITER % 5 === 0);
  let result;
  if (write) {
    result = http.post(
      `${base}/api/links`,
      JSON.stringify({
        originalUrl: `https://example.com/ziplink-benchmark/${__VU}/${__ITER}/${Date.now()}`,
      }),
      { headers, tags: { operation: 'create' } },
    );
    record(result, 'create', 201);
  } else {
    result = http.get(data.targets[__ITER % data.targets.length], {
      redirects: 0,
      tags: { operation: 'redirect' },
    });
    record(result, 'redirect', 302);
    if (mode === 'mixed' && __ITER % 5 === 1) {
      const list = http.get(`${base}/api/links?limit=20`, { tags: { operation: 'list' } });
      record(list, 'list', 200);
    }
  }
  sleep(Number(__ENV.PAUSE_SECONDS || 0.2));
}

export function handleSummary(data) {
  // Never serialize setup data, cookies, CSRF tokens or environment variables.
  const safe = {
    metrics: data.metrics,
    state: data.state,
    scenario: mode,
    vus: Number(__ENV.VUS || (mode === 'create' || mode === 'mixed' ? 5 : 10)),
    duration: __ENV.DURATION || '30s',
  };
  const latency = data.metrics.ziplink_workload_duration?.values || {};
  const count = data.metrics.ziplink_workload_requests?.values || {};
  const result = {
    stdout: `\n${mode}: ${count.count || 0} workload requests, ${(count.rate || 0).toFixed(2)} req/s; p50=${(latency['p(50)'] || 0).toFixed(2)}ms p95=${(latency['p(95)'] || 0).toFixed(2)}ms p99=${(latency['p(99)'] || 0).toFixed(2)}ms; errors=${((data.metrics.ziplink_error_rate?.values.rate || 0) * 100).toFixed(2)}%\n`,
  };
  if (__ENV.SUMMARY_PATH) result[__ENV.SUMMARY_PATH] = JSON.stringify(safe, null, 2);
  return result;
}
