# Reproducible performance experiments

**Measured local results:** a paced hot-cache run with three repeated 10-VU baselines, a 20-VU probe and small write/mixed bursts is recorded in [LOAD_TEST_RESULTS.md](LOAD_TEST_RESULTS.md). No before/after speedup, maximum-capacity, cold-cache or outage benchmark has been measured. Correctness tests and mocked browser timings are separate evidence.

## One-command local test

Start the API, MySQL, Redis and analytics worker, then run:

```sh
npm run loadtest -- --check
npm run loadtest
```

The runner is restricted to loopback targets. It creates a dedicated account with an in-memory random password, reuses three test links, runs 30-second warm-up + three 30-second 10-VU baselines + a 30-second 20-VU probe, then 20-iteration creation and mixed tests. It samples the queue every second and waits up to 30 seconds for the expected benchmark-owned event count. Cleanup soft-deletes only that account's links and logs out; account/tombstones/events remain. No credentials are saved in results or passed through command arguments.

Find JSON summaries, logs, queue samples and `report.md` under ignored `.local-services/load-tests/<timestamp>/`. The default runner does not stop services, raise quotas or prove saturation capacity. Registration is still limited to 5/hour/IP. To repeat more frequently, use an existing dedicated account and custom direct-harness runs rather than bypassing security limits.

Custom k6 metrics separate workload latency/counts from setup, count 429/server errors, and record per-operation trends. Generic Redis keyspace hit counters are not a redirect cache-hit ratio: use API process-counter deltas separately. The run report's setup data, environment secrets and session tokens are excluded from the custom k6 JSON summary.

For custom experiments, use a dedicated disposable deployment and benchmark account. Register through the UI first when using the direct harness. Never load-test a shared or production service without authorization. The original user-owned `test.js` remains untouched; it targets the old unauthenticated API and must not be used as the current test harness.

## Procedure

1. Record commit/worktree state, Node/MySQL/Redis/k6 versions, machine CPU/RAM, database row count, indexes, process count and all relevant environment configuration. Close unrelated workloads. Use the same setup for all runs.
2. Start MySQL, Redis (`noeviction`, AOF) and the API. Run migrations. Start a worker except for the worker-outage scenario.
3. Set `BASE_URL`, `BENCH_EMAIL` and `BENCH_PASSWORD` in the shell environment. Do not put passwords in command arguments, tracked files or result artifacts. Keep the same host spelling for frontend/API cookies.
4. Capture API structured counters at start/end. `npm run queue:status` reports waiting, active, delayed, failed and completed jobs. Record these before, during and after every run. Counters reset on process restart and are per API instance; sum deltas across replicas.
5. Warm up for 30 seconds, then repeat each measurement at least three times with a fresh comparable dataset. Start with low load, then increase concurrency. State whether DNS/TLS, authentication setup and client machine resource usage are included.
6. Save k6 output with `--summary-export benchmark-results.json`; keep local artifacts private if they include deployment information. k6 reports request rate, p50/p95/p99 and error rate. Calculate cache-hit ratio as hit delta / (hit delta + miss delta). Queue backlog is waiting + active + delayed; failed jobs are reported separately.
7. Restore services and wait for the queue to drain after failure experiments. Test-account links remain for investigation; remove them through the owner API/UI when finished.

PowerShell example (after setting credentials securely in the environment):

```powershell
$env:SCENARIO='cache-hit'
k6 run --summary-export benchmark-results.json benchmarks/scenarios.js
```

POSIX equivalent:

```sh
SCENARIO=cache-hit k6 run --summary-export benchmark-results.json benchmarks/scenarios.js
```

## Scenarios

| SCENARIO          | Setup                                                                     | What it exercises                                                                         |
| ----------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `cache-hit`       | `CACHE_ENABLED=true`, running worker; fixtures are warmed                 | Redis reads, redirect response, event enqueue                                             |
| `cache-miss`      | Restart API with `CACHE_ENABLED=false`                                    | Positive MySQL lookups for real links, not fabricated 404s; no population/hit benefit     |
| `create`          | MySQL and Redis healthy                                                   | 20 concurrent creations by default, unique constraint and auth/write path                 |
| `mixed`           | All services healthy                                                      | Reads and 20% writes, with occasional management listing                                  |
| `analytics-heavy` | Healthy worker(s), increase VUS gradually                                 | Queue production, persistence throughput and backlog/drain time                           |
| `redis-down`      | Allow setup to finish, then stop Redis **only in disposable environment** | Warm/miss redirects fall back to MySQL; management fails closed; lost-event counters rise |
| `worker-down`     | Stop worker, keep Redis healthy                                           | Redirect availability and queue accumulation; restart worker and measure drain            |

`cache-miss` is a no-cache comparison, not a measurement of Redis lookup overhead plus a natural miss. For natural cold misses, clear only `${REDIS_PREFIX}:link:*` keys through a namespace-aware operator script between runs, or use a larger prepared link set; do not flush a shared Redis database. Cache invalidation races require separate correctness tests.

Default redirect load is approximately 50 requests/second, before server latency, below the 6000/minute/IP policy. Creation has a 30/minute/user quota: three setup links plus 20 test writes fit within one window. Repeated tests need a window reset/wait. Larger creation loads intentionally encounter 429 unless the configured policy is adjusted in an isolated environment; report those as policy saturation, not database failures. Login is limited to 10/15 minutes/IP. The p95 < 1s and error <1% thresholds are test expectations, not measured results or a production SLA.

To establish a synchronous baseline, benchmark the original repository revision in a separate checkout/test database before comparing this version. That baseline has not been run. For a narrower same-version comparison, use `CACHE_ENABLED=false` versus `true`; asynchronous analytics remains enabled in both, so this does not isolate the queue benefit.

Local MySQL, Redis, API, worker and k6 contend for CPU, RAM and disk. A single-machine test cannot substantiate multi-region behavior or production capacity. Monitor MySQL pool waits, event transaction duration, worker CPU, Redis memory/AOF latency and load-generator saturation as concurrency rises.
